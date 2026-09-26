import type { Server, Socket } from "socket.io";
import {
  ROOM_CAPACITY,
  isIceCandidate,
  isSessionDescription,
  parseJoinRequest,
  type ClientToServerEvents,
  type JoinResponse,
  type ServerToClientEvents,
} from "../shared/protocol.ts";
import { clientIp, isLocalAddress } from "./client-ip.ts";
import type { IceServerProvider } from "./ice-servers.ts";
import type { Logger } from "./logger.ts";
import { RateLimiter } from "./rate-limit.ts";

interface SocketData {
  /** The client's IP address, used for per-IP limits. */
  ip: string;
  /** The room this connection joined; a connection can join only one. */
  room?: string;
  clientId?: string;
  /** Set when the same browser tab reconnected and replaced this connection. */
  replaced?: boolean;
}

export type SignalingServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type SignalingSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface SignalingLimits {
  /** Concurrent connections from one public IP address. */
  connectionsPerIp: number;
  /** Joins per minute from one public IP address (bursts up to this many). */
  joinsPerMinute: number;
  /** Offers, answers, and candidates one connection may send at once… */
  relayBurst: number;
  /** …and per second after that. */
  relaysPerSecond: number;
}

export interface SignalingOptions {
  getIceServers: IceServerProvider;
  logger: Logger;
  /** Reverse proxies in front of the server (see Config.trustProxy). */
  trustProxy: number;
  limits: SignalingLimits;
}

export const DEFAULT_LIMITS: SignalingLimits = {
  connectionsPerIp: 50,
  // Generous for real use, but makes guessing room names slow.
  joinsPerMinute: 30,
  // Setting up a call takes an offer or answer and a few dozen candidates.
  relayBurst: 200,
  relaysPerSecond: 50,
};

/**
 * Pairs up the two browsers in a room and relays their WebRTC offer, answer,
 * and ICE candidates. Media and chat never pass through the server.
 *
 * Handlers treat every payload as untrusted: anything malformed is dropped,
 * and messages are only ever relayed within the room the sender joined.
 */
export function registerSignaling(
  io: SignalingServer,
  { getIceServers, logger, trustProxy, limits }: SignalingOptions,
): () => void {
  const connectionsByIp = new Map<string, number>();
  const joinLimiter = new RateLimiter({
    capacity: limits.joinsPerMinute,
    perSecond: limits.joinsPerMinute / 60,
  });
  const relayLimiter = new RateLimiter({
    capacity: limits.relayBurst,
    perSecond: limits.relaysPerSecond,
  });
  const pruneTimer = setInterval(() => joinLimiter.prune(), 60_000);
  pruneTimer.unref();

  // Limits apply per public IP. Local and private addresses are exempt:
  // they're either local users or a proxy whose forwarded addresses aren't
  // trusted, and limiting them would lump every visitor together.
  io.use((socket, next) => {
    const ip = clientIp(socket.request, trustProxy);
    socket.data.ip = ip;
    if (isLocalAddress(ip)) return next();
    const connections = connectionsByIp.get(ip) ?? 0;
    if (connections >= limits.connectionsPerIp) {
      logger.warn(`Refused a connection from ${ip}: too many open connections`);
      return next(new Error("too-many-connections"));
    }
    connectionsByIp.set(ip, connections + 1);
    next();
  });

  io.on("connection", (socket) => {
    const { ip } = socket.data;
    const limited = !isLocalAddress(ip);
    let warnedAboutRelays = false;

    /** Whether this connection may relay another message right now. */
    const mayRelay = (): boolean => {
      if (relayLimiter.take(socket.id)) return true;
      if (!warnedAboutRelays) {
        warnedAboutRelays = true;
        logger.warn(`${socket.data.room ?? "no room"}: dropping relayed messages from ${ip}`);
      }
      return false;
    };

    socket.on("join", async (request: unknown, ack: unknown) => {
      if (typeof ack !== "function") return;
      const reply = ack as (response: JoinResponse) => void;
      if (limited && !joinLimiter.take(ip)) {
        reply({ ok: false, error: "rate-limited" });
        return;
      }
      try {
        await handleJoin(io, socket, request, reply, getIceServers, logger);
      } catch (error) {
        logger.error("Failed to handle join", error);
        // Give the slot back so the room isn't stuck looking occupied.
        const room = socket.data.room;
        if (room !== undefined) {
          socket.data.room = undefined;
          void socket.leave(room);
        }
        reply({ ok: false, error: "server-error" });
      }
    });

    socket.on("offer", (description: unknown) => {
      const room = socket.data.room;
      if (room !== undefined && isSessionDescription(description, "offer") && mayRelay()) {
        socket.to(room).emit("offer", description);
      }
    });

    socket.on("answer", (description: unknown) => {
      const room = socket.data.room;
      if (room !== undefined && isSessionDescription(description, "answer") && mayRelay()) {
        socket.to(room).emit("answer", description);
      }
    });

    socket.on("candidate", (candidate: unknown) => {
      const room = socket.data.room;
      if (room !== undefined && isIceCandidate(candidate) && mayRelay()) {
        socket.to(room).emit("candidate", candidate);
      }
    });

    socket.on("disconnect", (reason) => {
      relayLimiter.forget(socket.id);
      if (limited) {
        const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
        if (remaining > 0) connectionsByIp.set(ip, remaining);
        else connectionsByIp.delete(ip);
      }
      const { room, replaced } = socket.data;
      if (room === undefined || replaced === true) return;
      logger.info(`${room}: peer left (${reason})`);
      socket.to(room).emit("peer-left");
    });
  });

  return () => clearInterval(pruneTimer);
}

async function handleJoin(
  io: SignalingServer,
  socket: SignalingSocket,
  rawRequest: unknown,
  reply: (response: JoinResponse) => void,
  getIceServers: IceServerProvider,
  logger: Logger,
): Promise<void> {
  const request = parseJoinRequest(rawRequest);
  if (request === null) {
    reply({ ok: false, error: "invalid-request" });
    return;
  }
  if (socket.data.room !== undefined) {
    reply({ ok: false, error: "already-joined" });
    return;
  }

  // Everything up to the first `await` runs without interruption, so the
  // capacity check and the join can't race with another connection.
  const { room, clientId } = request;
  const members = roomMembers(io, room);
  for (const member of members) {
    if (member.data.clientId === clientId) {
      // The same tab reconnected (after a network drop, say) before the
      // server noticed its old connection was gone. Drop the stale one
      // quietly so it doesn't count against the room's capacity.
      member.data.replaced = true;
      member.disconnect(true);
    }
  }
  const others = members.filter((member) => member.data.replaced !== true);
  if (others.length >= ROOM_CAPACITY) {
    logger.info(`${room}: rejected a join because the room is full`);
    reply({ ok: false, error: "room-full" });
    return;
  }

  socket.data.room = room;
  socket.data.clientId = clientId;
  void socket.join(room);
  logger.info(`${room}: peer joined (${others.length + 1}/${ROOM_CAPACITY})`);

  const iceServers = await getIceServers();
  if (socket.disconnected) return;
  reply({ ok: true, iceServers });
  // Sent after the reply so the newcomer is ready before the offer arrives.
  // Whoever was already waiting starts the call.
  if (others.length > 0) socket.to(room).emit("peer-joined");
}

function roomMembers(io: SignalingServer, room: string): SignalingSocket[] {
  const ids = io.sockets.adapter.rooms.get(room) ?? new Set<string>();
  return [...ids].flatMap((id) => {
    const member = io.sockets.sockets.get(id);
    return member === undefined ? [] : [member];
  });
}
