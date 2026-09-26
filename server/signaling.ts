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
import type { IceServerProvider } from "./ice-servers.ts";
import type { Logger } from "./logger.ts";

interface SocketData {
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

export interface SignalingOptions {
  getIceServers: IceServerProvider;
  logger: Logger;
}

/**
 * Pairs up the two browsers in a room and relays their WebRTC offer, answer,
 * and ICE candidates. Media and chat never pass through the server.
 *
 * Handlers treat every payload as untrusted: anything malformed is dropped,
 * and messages are only ever relayed within the room the sender joined.
 */
export function registerSignaling(
  io: SignalingServer,
  { getIceServers, logger }: SignalingOptions,
): void {
  io.on("connection", (socket) => {
    socket.on("join", async (request: unknown, ack: unknown) => {
      if (typeof ack !== "function") return;
      const reply = ack as (response: JoinResponse) => void;
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
      if (room !== undefined && isSessionDescription(description, "offer")) {
        socket.to(room).emit("offer", description);
      }
    });

    socket.on("answer", (description: unknown) => {
      const room = socket.data.room;
      if (room !== undefined && isSessionDescription(description, "answer")) {
        socket.to(room).emit("answer", description);
      }
    });

    socket.on("candidate", (candidate: unknown) => {
      const room = socket.data.room;
      if (room !== undefined && isIceCandidate(candidate)) {
        socket.to(room).emit("candidate", candidate);
      }
    });

    socket.on("disconnect", (reason) => {
      const { room, replaced } = socket.data;
      if (room === undefined || replaced === true) return;
      logger.info(`${room}: peer left (${reason})`);
      socket.to(room).emit("peer-left");
    });
  });
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
