import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures.ts";

let roomCounter = 0;
/** A room name no other test (or earlier run) uses. */
export function uniqueRoom(): string {
  return `e2e-${process.pid}-${Date.now()}-${++roomCounter}`;
}

/** Opens the call page for `room` as a new person. `origin` defaults to the base URL. */
export async function join(
  newPerson: () => Promise<Page>,
  room: string,
  origin = "",
): Promise<Page> {
  const page = await newPerson();
  await page.goto(`${origin}/join/${room}`);
  return page;
}

export async function expectConnected(page: Page): Promise<void> {
  await expect(page.locator(".call-status")).toHaveText("Connected", { timeout: 20_000 });
  // Real frames from the other side are rendering.
  await expect
    .poll(() =>
      page.locator(".remote-video").evaluate((video: HTMLVideoElement) => video.videoWidth),
    )
    .toBeGreaterThan(0);
}

/** Keeps a reference to every RTCPeerConnection the page creates. Call before loading the page. */
export async function trackPeerConnections(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tracked: RTCPeerConnection[] = [];
    Object.assign(window, { __peerConnections: tracked });
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        tracked.push(this);
      }
    };
  });
}

export function peerConnectionCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __peerConnections: RTCPeerConnection[] }).__peerConnections.length,
  );
}

const METRICS_TOKEN = "e2e-metrics-token-0123456789";

/**
 * A server of the test's own, for tests that stop and restart it (the shared
 * one keeps running for the other tests). Uses the build from the shared
 * server's start-up.
 */
export class TestServer {
  readonly url: string;
  readonly #port: number;
  #process: ChildProcess | null = null;

  private constructor(port: number) {
    this.#port = port;
    this.url = `http://localhost:${port}`;
  }

  static async start(): Promise<TestServer> {
    const server = new TestServer(await freePort());
    await server.start();
    return server;
  }

  async start(): Promise<void> {
    const child = spawn(process.execPath, ["server/index.ts"], {
      env: {
        ...process.env,
        PORT: String(this.#port),
        METRICS_TOKEN,
        LOG_LEVEL: "warn",
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    this.#process = child;
    const healthy = () =>
      fetch(`${this.url}/healthz`).then(
        (response) => response.ok,
        () => false,
      );
    await expect.poll(healthy, { timeout: 15_000 }).toBe(true);
  }

  /** SIGTERM shuts down gracefully, as in a deploy; SIGKILL is a crash. */
  async stop(signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<void> {
    const child = this.#process;
    this.#process = null;
    if (child === null || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill(signal);
    await exited;
  }

  /** Calls with both people connected to this server. */
  async activeCalls(): Promise<number> {
    const response = await fetch(`${this.url}/metrics`, {
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    const match = /^zipcall_active_calls (\d+)$/m.exec(await response.text());
    return Number(match?.[1] ?? 0);
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  server.close();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}
