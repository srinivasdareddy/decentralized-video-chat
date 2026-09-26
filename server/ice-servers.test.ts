import { describe, expect, it, vi } from "vitest";
import type { IceServer } from "../shared/protocol.ts";
import { createCachedIceServerProvider, normalizeIceServers, stunServers } from "./ice-servers.ts";
import { silentLogger } from "./logger.ts";

const TURN: IceServer[] = [{ urls: "turn:turn.example:3478", username: "u", credential: "c" }];
const STUN: IceServer[] = [{ urls: ["stun:stun.example:3478"] }];

function setup(fetchIceServers: () => Promise<IceServer[]>) {
  let now = 0;
  const logger = { ...silentLogger, warn: vi.fn() };
  const provider = createCachedIceServerProvider({
    fetchIceServers,
    fallback: STUN,
    logger,
    cacheMs: 1000,
    failureCacheMs: 100,
    timeoutMs: 50,
    now: () => now,
  });
  return { provider, logger, advance: (ms: number) => (now += ms) };
}

describe("createCachedIceServerProvider", () => {
  it("reuses fetched credentials until the cache expires", async () => {
    const fetch = vi.fn().mockResolvedValue(TURN);
    const { provider, advance } = setup(fetch);

    await expect(provider()).resolves.toEqual(TURN);
    await provider();
    expect(fetch).toHaveBeenCalledTimes(1);

    advance(1000);
    await provider();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    const fetch = vi.fn().mockResolvedValue(TURN);
    const { provider } = setup(fetch);
    await Promise.all([provider(), provider(), provider()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to STUN on errors and retries later", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("401")).mockResolvedValue(TURN);
    const { provider, logger, advance } = setup(fetch);

    await expect(provider()).resolves.toEqual(STUN);
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), {
      reason: expect.stringContaining("401") as unknown,
    });
    await expect(provider()).resolves.toEqual(STUN);

    advance(100);
    await expect(provider()).resolves.toEqual(TURN);
  });

  it("falls back to STUN when the provider hangs", async () => {
    const { provider } = setup(() => new Promise(() => {}));
    await expect(provider()).resolves.toEqual(STUN);
  });
});

describe("normalizeIceServers", () => {
  it("keeps the standard fields and drops the deprecated url", () => {
    expect(
      normalizeIceServers([
        { url: "stun:global.stun.twilio.com:3478", urls: "stun:global.stun.twilio.com:3478" },
        { urls: "turn:global.turn.twilio.com:3478", username: "u", credential: "c" },
        { username: "no-urls" },
      ]),
    ).toEqual([
      { urls: "stun:global.stun.twilio.com:3478" },
      { urls: "turn:global.turn.twilio.com:3478", username: "u", credential: "c" },
    ]);
  });
});

describe("stunServers", () => {
  it("groups the URLs into one entry", () => {
    expect(stunServers(["stun:a", "stun:b"])).toEqual([{ urls: ["stun:a", "stun:b"] }]);
    expect(stunServers([])).toEqual([]);
  });
});
