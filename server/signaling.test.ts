import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  IceServer,
  JoinResponse,
  ServerToClientEvents,
} from "../shared/protocol.ts";
import { loadConfig } from "./config.ts";
import { silentLogger } from "./logger.ts";
import { createZipcallServer, type ZipcallServer } from "./server.ts";
import type { SignalingLimits } from "./signaling.ts";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const ICE_SERVERS: IceServer[] = [{ urls: "stun:stun.example:3478" }];
const OFFER = { type: "offer", sdp: "v=0 offer" } as const;
const ANSWER = { type: "answer", sdp: "v=0 answer" } as const;
const CANDIDATE = { candidate: "candidate:1 1 udp 1 10.0.0.1 9 typ host", sdpMid: "0" };

let server: ZipcallServer | undefined;
let serverUrl = "";
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await server?.close();
  server = undefined;
});

interface ServerOptions {
  getIceServers?: () => Promise<IceServer[]>;
  limits?: Partial<SignalingLimits>;
  trustProxy?: number;
  allowedOrigins?: string[];
  metricsToken?: string;
}

/** Starts a server and returns a function that connects a client to it. */
async function startServer(
  options: ServerOptions = {},
): Promise<(headers?: Record<string, string>) => Promise<Client>> {
  server = createZipcallServer(
    {
      ...loadConfig({}),
      port: 0,
      clientDir: "/nonexistent",
      trustProxy: options.trustProxy ?? 0,
      allowedOrigins: options.allowedOrigins ?? [],
      metricsToken: options.metricsToken ?? null,
    },
    {
      logger: silentLogger,
      getIceServers: options.getIceServers ?? (() => Promise.resolve(ICE_SERVERS)),
      limits: options.limits,
    },
  );
  const httpServer = server.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${port}`;

  return async (headers) => {
    const client = open(headers);
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    return client;
  };
}

function open(headers: Record<string, string> = {}): Client {
  const client: Client = connect(serverUrl, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    extraHeaders: headers,
  });
  clients.push(client);
  return client;
}

/** Resolves with the error when the server refuses the connection. */
function refusedConnection(headers: Record<string, string>): Promise<Error> {
  return new Promise((resolve, reject) => {
    const client = open(headers);
    client.once("connect", () => reject(new Error("the connection was accepted")));
    client.once("connect_error", resolve);
  });
}

let tabCounter = 0;
function join(client: Client, room: string, clientId = `tab-${++tabCounter}`) {
  return client.emitWithAck("join", { room, clientId });
}

function nextEvent(client: Client, event: keyof ServerToClientEvents): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${event}" event`)), 2000);
    client.once(event, (payload?: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Resolves true if the event arrives within a short window. */
function receives(client: Client, event: keyof ServerToClientEvents): Promise<boolean> {
  return new Promise((resolve) => {
    const onEvent = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      client.off(event, onEvent);
      resolve(false);
    }, 150);
    client.once(event, onEvent);
  });
}

describe("signaling", () => {
  it("lets the first person wait and asks them to call the second", async () => {
    const newClient = await startServer();
    const alice = await newClient();
    const bob = await newClient();

    expect(await join(alice, "room")).toEqual({ ok: true, iceServers: ICE_SERVERS });
    const aliceIsAsked = nextEvent(alice, "peer-joined");
    const bobIsAsked = receives(bob, "peer-joined");
    expect(await join(bob, "room")).toEqual({ ok: true, iceServers: ICE_SERVERS });

    await aliceIsAsked;
    expect(await bobIsAsked).toBe(false);
  });

  it("treats room names case-insensitively", async () => {
    const newClient = await startServer();
    const alice = await newClient();
    const bob = await newClient();
    await join(alice, "PurpleSquid");
    const aliceIsAsked = nextEvent(alice, "peer-joined");
    await join(bob, "purplesquid");
    await aliceIsAsked;
  });

  it("relays offers, answers, and candidates only within the room", async () => {
    const newClient = await startServer();
    const [alice, bob, carol, dave] = await Promise.all([
      newClient(),
      newClient(),
      newClient(),
      newClient(),
    ]);
    await join(alice, "one");
    await join(bob, "one");
    await join(carol, "two");
    await join(dave, "two");

    const carolHearsOffer = receives(carol, "offer");
    const offer = nextEvent(bob, "offer");
    alice.emit("offer", OFFER);
    expect(await offer).toEqual(OFFER);
    expect(await carolHearsOffer).toBe(false);

    const answer = nextEvent(alice, "answer");
    bob.emit("answer", ANSWER);
    expect(await answer).toEqual(ANSWER);

    const candidate = nextEvent(bob, "candidate");
    alice.emit("candidate", CANDIDATE);
    expect(await candidate).toEqual(CANDIDATE);
  });

  it("ignores messages from connections that haven't joined", async () => {
    const newClient = await startServer();
    const [alice, bob, mallory] = await Promise.all([newClient(), newClient(), newClient()]);
    await join(alice, "room");
    await join(bob, "room");

    const aliceHearsOffer = receives(alice, "offer");
    const bobHearsOffer = receives(bob, "offer");
    // The old protocol let clients name any room when relaying.
    (mallory.emit as (...args: unknown[]) => void)("offer", OFFER, "room");
    expect(await aliceHearsOffer).toBe(false);
    expect(await bobHearsOffer).toBe(false);
  });

  it("drops malformed payloads", async () => {
    const newClient = await startServer();
    const alice = await newClient();
    const bob = await newClient();
    await join(alice, "room");
    await join(bob, "room");

    const bobHearsOffer = receives(bob, "offer");
    const bobHearsCandidate = receives(bob, "candidate");
    (alice.emit as (...args: unknown[]) => void)("offer", "<script>");
    (alice.emit as (...args: unknown[]) => void)("offer", ANSWER);
    (alice.emit as (...args: unknown[]) => void)("candidate", { candidate: 42 });
    expect(await bobHearsOffer).toBe(false);
    expect(await bobHearsCandidate).toBe(false);
  });

  it("turns away a third person", async () => {
    const newClient = await startServer();
    const [alice, bob, carol] = await Promise.all([newClient(), newClient(), newClient()]);
    await join(alice, "room");
    await join(bob, "room");
    expect(await join(carol, "room")).toEqual({ ok: false, error: "room-full" });
  });

  it("rejects invalid and repeated join requests", async () => {
    const newClient = await startServer();
    const alice = await newClient();
    const joinWith = (request: unknown) =>
      (alice.emitWithAck as (...args: unknown[]) => Promise<JoinResponse>)("join", request);

    expect(await joinWith({ room: "a/b", clientId: "tab" })).toEqual({
      ok: false,
      error: "invalid-request",
    });
    expect(await join(alice, "room")).toMatchObject({ ok: true });
    expect(await join(alice, "other")).toEqual({ ok: false, error: "already-joined" });
  });

  it("tells the remaining person when the other one leaves", async () => {
    const newClient = await startServer();
    const alice = await newClient();
    const bob = await newClient();
    await join(alice, "room");
    await join(bob, "room");

    const left = nextEvent(alice, "peer-left");
    bob.disconnect();
    await left;
  });

  it("frees the slot when a tab leaves so someone else can join", async () => {
    const newClient = await startServer();
    const [alice, bob, carol] = await Promise.all([newClient(), newClient(), newClient()]);
    await join(alice, "room");
    await join(bob, "room");
    const left = nextEvent(alice, "peer-left");
    bob.disconnect();
    await left;
    expect(await join(carol, "room")).toMatchObject({ ok: true });
  });

  it("replaces a stale connection when the same tab reconnects", async () => {
    const newClient = await startServer();
    const alice = await newClient();
    const bob = await newClient();
    await join(alice, "room", "alice-tab");
    await join(bob, "room", "bob-tab");

    const bobHearsLeft = receives(bob, "peer-left");
    const bobIsAsked = nextEvent(bob, "peer-joined");
    const staleClosed = new Promise((resolve) => alice.once("disconnect", resolve));
    const aliceAgain = await newClient();
    expect(await join(aliceAgain, "room", "alice-tab")).toMatchObject({ ok: true });

    await staleClosed;
    await bobIsAsked;
    expect(await bobHearsLeft).toBe(false);
  });

  it("gives the slot back if joining fails unexpectedly", async () => {
    let fail = true;
    const newClient = await startServer({
      getIceServers: () =>
        fail ? Promise.reject(new Error("boom")) : Promise.resolve(ICE_SERVERS),
    });
    const alice = await newClient();
    const bob = await newClient();
    const carol = await newClient();

    expect(await join(alice, "room")).toEqual({ ok: false, error: "server-error" });
    fail = false;
    expect(await join(bob, "room")).toMatchObject({ ok: true });
    expect(await join(carol, "room")).toMatchObject({ ok: true });
  });
});

describe("abuse limits", () => {
  const publicIp = (ip: string) => ({ "x-forwarded-for": ip });

  it("refuses connections from other websites", async () => {
    const newClient = await startServer({ allowedOrigins: ["https://app.example"] });
    await expect(refusedConnection({ origin: "https://evil.example" })).resolves.toBeInstanceOf(
      Error,
    );
    await expect(newClient({ origin: serverUrl })).resolves.toBeDefined();
    await expect(newClient({ origin: "https://app.example" })).resolves.toBeDefined();
  });

  it("caps connections per public IP address", async () => {
    const newClient = await startServer({ trustProxy: 1, limits: { connectionsPerIp: 2 } });
    const first = await newClient(publicIp("203.0.113.5"));
    await newClient(publicIp("203.0.113.5"));
    const refused = await refusedConnection(publicIp("203.0.113.5"));
    expect(refused.message).toBe("too-many-connections");
    // Other addresses are unaffected, and closing a connection frees a slot.
    await newClient(publicIp("198.51.100.20"));
    first.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await newClient(publicIp("203.0.113.5"));
  });

  it("doesn't limit local addresses, which may be a proxy for everyone", async () => {
    const newClient = await startServer({ limits: { connectionsPerIp: 1 } });
    await newClient();
    await newClient();
    await newClient();
  });

  it("limits how fast one IP address can join rooms", async () => {
    const newClient = await startServer({ trustProxy: 1, limits: { joinsPerMinute: 2 } });
    const clients = await Promise.all([1, 2, 3].map(() => newClient(publicIp("203.0.113.6"))));
    const [a, b, c] = clients as [Client, Client, Client];
    expect(await join(a, "one")).toMatchObject({ ok: true });
    expect(await join(b, "two")).toMatchObject({ ok: true });
    expect(await join(c, "three")).toEqual({ ok: false, error: "rate-limited" });
  });

  it("drops relayed messages beyond a connection's allowance", async () => {
    const newClient = await startServer({ limits: { relayBurst: 3, relaysPerSecond: 0.01 } });
    const alice = await newClient();
    const bob = await newClient();
    await join(alice, "room");
    await join(bob, "room");

    let received = 0;
    bob.on("candidate", () => received++);
    for (let i = 0; i < 6; i++) alice.emit("candidate", CANDIDATE);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toBe(3);
  });
});

describe("metrics", () => {
  it("counts joins and calls", async () => {
    const token = "metrics-token-for-tests";
    const newClient = await startServer({ metricsToken: token });
    const [alice, bob, carol] = await Promise.all([newClient(), newClient(), newClient()]);
    await join(alice, "room");
    await join(bob, "room");
    await join(carol, "room");
    alice.emit("candidate", CANDIDATE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response = await fetch(`${serverUrl}/metrics`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    expect(text).toContain('zipcall_joins_total{result="ok"} 2');
    expect(text).toContain('zipcall_joins_total{result="room-full"} 1');
    expect(text).toContain('zipcall_relayed_messages_total{type="candidate"} 1');
    expect(text).toContain("zipcall_active_calls 1");
    expect(text).toContain("zipcall_waiting_rooms 0");
    expect(text).toContain("zipcall_connections 3");
  });
});
