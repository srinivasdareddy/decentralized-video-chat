import twilio from "twilio";
import type { IceServer } from "../shared/protocol.ts";
import type { Config, TwilioCredentials } from "./config.ts";
import type { Logger } from "./logger.ts";

/**
 * Returns the STUN/TURN servers a browser should use for its next call.
 * Never rejects: when TURN credentials can't be fetched it falls back to
 * STUN, which still connects most calls.
 */
export type IceServerProvider = () => Promise<IceServer[]>;

export function createIceServerProvider(config: Config, logger: Logger): IceServerProvider {
  const stun = stunServers(config.stunUrls);
  if (config.twilio === null) return () => Promise.resolve(stun);
  return createCachedIceServerProvider({
    fetchIceServers: createTwilioFetcher(config.twilio),
    fallback: stun,
    logger,
  });
}

export function stunServers(urls: string[]): IceServer[] {
  return urls.length > 0 ? [{ urls }] : [];
}

export interface CachedIceServerProviderOptions {
  fetchIceServers: () => Promise<IceServer[]>;
  fallback: IceServer[];
  logger: Logger;
  /** How long fetched credentials are reused. They are valid far longer. */
  cacheMs?: number;
  /** How long to use the fallback after a failure before retrying. */
  failureCacheMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Wraps a TURN credential source with caching, request de-duplication, a
 * timeout, and a fallback, so a slow or failing provider never blocks calls.
 */
export function createCachedIceServerProvider({
  fetchIceServers,
  fallback,
  logger,
  cacheMs = 60 * 60 * 1000,
  failureCacheMs = 30 * 1000,
  timeoutMs = 5000,
  now = Date.now,
}: CachedIceServerProviderOptions): IceServerProvider {
  let cached: { servers: IceServer[]; expiresAt: number } | undefined;
  let pending: Promise<IceServer[]> | undefined;

  const refresh = async (): Promise<IceServer[]> => {
    try {
      const servers = await withTimeout(fetchIceServers(), timeoutMs);
      cached = { servers, expiresAt: now() + cacheMs };
      return servers;
    } catch (error) {
      logger.warn(
        `Could not get TURN credentials, using STUN only for now: ${errorMessage(error)}`,
      );
      cached = { servers: fallback, expiresAt: now() + failureCacheMs };
      return fallback;
    } finally {
      pending = undefined;
    }
  };

  return () => {
    if (cached !== undefined && now() < cached.expiresAt) {
      return Promise.resolve(cached.servers);
    }
    pending ??= refresh();
    return pending;
  };
}

/** Fetches short-lived TURN credentials from Twilio's Network Traversal Service. */
export function createTwilioFetcher(
  { accountSid, authToken }: TwilioCredentials,
  ttlSeconds = 24 * 60 * 60,
): () => Promise<IceServer[]> {
  const client = twilio(accountSid, authToken);
  return async () => {
    const token = await client.tokens.create({ ttl: ttlSeconds });
    return normalizeIceServers(token.iceServers);
  };
}

/**
 * Converts Twilio's ICE server entries to the standard RTCIceServer shape,
 * dropping the deprecated `url` field that some browsers warn about.
 */
export function normalizeIceServers(
  servers: readonly { urls?: string; url?: string; username?: string; credential?: string }[],
): IceServer[] {
  return servers.flatMap((server) => {
    const urls = server.urls ?? server.url;
    if (urls === undefined) return [];
    return [
      {
        urls,
        ...(server.username !== undefined && { username: server.username }),
        ...(server.credential !== undefined && { credential: server.credential }),
      },
    ];
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
