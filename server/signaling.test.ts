import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  IceServer,
  JoinResponse,
  ServerToClientEvents,
} from "../shared/protocol.ts";
import { silentLogger } from "./logger.ts";
import { createZipcallServer, type ZipcallServer } from "./server.ts";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const ICE_SERVERS: IceServer[] = [{ urls: "stun:stun.example:3478" }];
const OFFER = { type: "offer", sdp: "v=0 offer" } as const;
const ANSWER = { type: "answer", sdp: "v=0 answer" } as const;
const CANDIDATE = { candidate: "candidate:1 1 udp 1 10.0.0.1 9 typ host", sdpMid: "0" };

let server: ZipcallServer | undefined;
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await server?.close();
  server = undefined;
});

async function startServer(
  getIceServers: () => Promise<IceServer[]> = () => Promise.resolve(ICE_SERVERS),
): Promise<() => Promise<Client>> {
  server = createZipcallServer(
    { port: 0, forceHttps: false, twilio: null, stunUrls: [], clientDir: "/nonexistent" },
    { logger: silentLogger, getIceServers },
  );
  const httpServer = server.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;

  return async () => {
    const client: Client = connect(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    clients.push(client);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    return client;
  };
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
    const newClient = await startServer(() =>
      fail ? Promise.reject(new Error("boom")) : Promise.resolve(ICE_SERVERS),
    );
    const alice = await newClient();
    const bob = await newClient();
    const carol = await newClient();

    expect(await join(alice, "room")).toEqual({ ok: false, error: "server-error" });
    fail = false;
    expect(await join(bob, "room")).toMatchObject({ ok: true });
    expect(await join(carol, "room")).toMatchObject({ ok: true });
  });
});
