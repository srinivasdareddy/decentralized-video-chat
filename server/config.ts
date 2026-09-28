import { fileURLToPath } from "node:url";
import type { LogFormat, LogLevel } from "./logger.ts";

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

/** Your own TURN server, using the shared-secret scheme (coturn's use-auth-secret). */
export interface TurnServerConfig {
  urls: string[];
  secret: string;
}

export interface Config {
  /** Port for both HTTP and Socket.IO. */
  port: number;
  /**
   * Redirect requests that a proxy reports as plain HTTP (X-Forwarded-Proto)
   * to HTTPS. Browsers only allow camera access on secure origins.
   */
  forceHttps: boolean;
  /**
   * How many reverse proxies sit in front of the server. Their
   * X-Forwarded-For entries are trusted to find the client's IP address;
   * with 0 the connection's own address is used.
   */
  trustProxy: number;
  /** Extra origins allowed to open signaling connections, besides the site itself. */
  allowedOrigins: string[];
  /** Concurrent signaling connections allowed from one IP address. */
  maxConnectionsPerIp: number;
  /** Credentials for Twilio's TURN relays, or null. */
  twilio: TwilioCredentials | null;
  /** Your own TURN server, or null. At most one of this and `twilio` is set. */
  turn: TurnServerConfig | null;
  /**
   * "relay" sends all media through TURN, so participants never learn each
   * other's IP addresses. Needs a TURN server (yours or Twilio's).
   */
  iceTransportPolicy: "all" | "relay";
  /** STUN servers handed to browsers when TURN relays are unavailable. */
  stunUrls: string[];
  /** Directory holding the built web client (`npm run build`). */
  clientDir: string;
  logLevel: LogLevel;
  /** JSON lines for log collectors (the default in production), or readable text. */
  logFormat: LogFormat;
  /** Bearer token for /metrics; null leaves metrics off. */
  metricsToken: string | null;
  /**
   * The site's public origin, e.g. https://call.example.com. Link previews
   * need absolute URLs; without it they're built from each request's Host.
   */
  publicUrl: string | null;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const DEFAULT_PORT = 3000;
const DEFAULT_MAX_CONNECTIONS_PER_IP = 50;
const DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302"];
const DEFAULT_CLIENT_DIR = fileURLToPath(new URL("../build/client", import.meta.url));

/** Reads the configuration from environment variables, failing fast on bad values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Heroku (which sets DYNO) terminates TLS in its router, so redirect by
  // default there, as earlier versions of Zipcall did, and trust its router.
  const onHeroku = "DYNO" in env;
  const twilio = parseTwilioCredentials(env);
  const turn = parseTurnServer(env);
  if (twilio !== null && turn !== null) {
    throw new ConfigError(
      "Configure either your own TURN server (TURN_URLS, TURN_SECRET) or Twilio, not both.",
    );
  }
  const iceTransportPolicy =
    parseChoice("ICE_TRANSPORT_POLICY", env.ICE_TRANSPORT_POLICY, ["all", "relay"]) ?? "all";
  if (iceTransportPolicy === "relay" && twilio === null && turn === null) {
    throw new ConfigError(
      "ICE_TRANSPORT_POLICY=relay needs a TURN server: set TURN_URLS and TURN_SECRET, or Twilio credentials.",
    );
  }
  return {
    port: parseInteger("PORT", env.PORT, { min: 0, max: 65_535 }) ?? DEFAULT_PORT,
    forceHttps: parseBoolean("FORCE_HTTPS", env.FORCE_HTTPS) ?? onHeroku,
    trustProxy: parseTrustProxy(env.TRUST_PROXY) ?? (onHeroku ? 1 : 0),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    maxConnectionsPerIp:
      parseInteger("MAX_CONNECTIONS_PER_IP", env.MAX_CONNECTIONS_PER_IP, { min: 1 }) ??
      DEFAULT_MAX_CONNECTIONS_PER_IP,
    twilio,
    turn,
    iceTransportPolicy,
    stunUrls: parseList(env.STUN_URLS) ?? DEFAULT_STUN_URLS,
    clientDir: DEFAULT_CLIENT_DIR,
    logLevel: parseChoice("LOG_LEVEL", env.LOG_LEVEL, ["debug", "info", "warn", "error"]) ?? "info",
    logFormat:
      parseChoice("LOG_FORMAT", env.LOG_FORMAT, ["json", "pretty"]) ??
      (env.NODE_ENV === "production" ? "json" : "pretty"),
    metricsToken: parseMetricsToken(env.METRICS_TOKEN),
    publicUrl: parsePublicUrl(env.PUBLIC_URL),
  };
}

function parsePublicUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") return null;
  const url = URL.parse(trimmed);
  if (
    url === null ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new ConfigError(
      `PUBLIC_URL must be the site's address, like https://call.example.com, got "${value}".`,
    );
  }
  return url.origin;
}

function parseChoice<T extends string>(
  name: string,
  value: string | undefined,
  choices: readonly T[],
): T | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized === "") return undefined;
  if ((choices as readonly string[]).includes(normalized)) return normalized as T;
  throw new ConfigError(`${name} must be one of ${choices.join(", ")}, got "${value}".`);
}

function parseMetricsToken(value: string | undefined): string | null {
  const token = value?.trim();
  if (token === undefined || token === "") return null;
  if (token.length < 16) {
    throw new ConfigError("METRICS_TOKEN must be at least 16 characters, so it can't be guessed.");
  }
  return token;
}

function parseInteger(
  name: string,
  value: string | undefined,
  { min, max = Number.MAX_SAFE_INTEGER }: { min: number; max?: number },
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `from ${min} to ${max}`;
    throw new ConfigError(`${name} must be a whole number ${range}, got "${value}".`);
  }
  return number;
}

function parseBoolean(name: string, value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized === "") return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ConfigError(`${name} must be true or false, got "${value}".`);
}

/** A number of proxy hops; "true" and "false" are accepted as 1 and 0. */
function parseTrustProxy(value: string | undefined): number | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true") return 1;
  if (normalized === "false") return 0;
  return parseInteger("TRUST_PROXY", value, { min: 0, max: 10 });
}

function parseOrigins(value: string | undefined): string[] {
  return (parseList(value) ?? []).map((origin) => {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new ConfigError(`ALLOWED_ORIGINS entries must be URLs, got "${origin}".`);
    }
    if (url.origin === "null" || url.origin !== origin.replace(/\/$/, "")) {
      throw new ConfigError(
        `ALLOWED_ORIGINS entries must be origins like https://example.com, got "${origin}".`,
      );
    }
    return url.origin;
  });
}

function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function parseTwilioCredentials(env: NodeJS.ProcessEnv): TwilioCredentials | null {
  // The HEROKU_* and LOCAL_* names are what earlier versions read; keep
  // accepting them so existing deployments don't lose their TURN relays.
  const accountSid = firstSet(
    env.TWILIO_ACCOUNT_SID,
    env.HEROKU_TWILLIO_SID,
    env.LOCAL_TWILLIO_SID,
  );
  const authToken = firstSet(env.TWILIO_AUTH_TOKEN, env.HEROKU_AUTH_TOKEN, env.LOCAL_AUTH_TOKEN);
  if (accountSid === undefined && authToken === undefined) return null;
  if (accountSid === undefined || authToken === undefined) {
    throw new ConfigError(
      "Set both TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN, or neither to run without TURN relays.",
    );
  }
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) {
    throw new ConfigError(
      'TWILIO_ACCOUNT_SID should be "AC" followed by 32 hexadecimal characters (see console.twilio.com).',
    );
  }
  return { accountSid, authToken };
}

function parseTurnServer(env: NodeJS.ProcessEnv): TurnServerConfig | null {
  const urls = parseList(env.TURN_URLS);
  const secret = env.TURN_SECRET?.trim() || undefined;
  if (urls === undefined && secret === undefined) return null;
  if (urls === undefined || secret === undefined) {
    throw new ConfigError("Set both TURN_URLS and TURN_SECRET to use your own TURN server.");
  }
  for (const url of urls) {
    if (!/^turns?:[^\s]+$/.test(url)) {
      throw new ConfigError(`TURN_URLS entries must start with turn: or turns:, got "${url}".`);
    }
  }
  if (secret.length < 16) {
    throw new ConfigError("TURN_SECRET must be at least 16 characters, so it can't be guessed.");
  }
  return { urls, secret };
}

function firstSet(...values: (string | undefined)[]): string | undefined {
  return values.map((value) => value?.trim()).find((value) => value !== undefined && value !== "");
}
