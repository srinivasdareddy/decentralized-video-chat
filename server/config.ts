import { fileURLToPath } from "node:url";

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
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
  /** Credentials for Twilio's TURN relays, or null to use STUN only. */
  twilio: TwilioCredentials | null;
  /** STUN servers handed to browsers when TURN relays are unavailable. */
  stunUrls: string[];
  /** Directory holding the built web client (`npm run build`). */
  clientDir: string;
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
  return {
    port: parseInteger("PORT", env.PORT, { min: 0, max: 65_535 }) ?? DEFAULT_PORT,
    forceHttps: parseBoolean("FORCE_HTTPS", env.FORCE_HTTPS) ?? onHeroku,
    trustProxy: parseTrustProxy(env.TRUST_PROXY) ?? (onHeroku ? 1 : 0),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    maxConnectionsPerIp:
      parseInteger("MAX_CONNECTIONS_PER_IP", env.MAX_CONNECTIONS_PER_IP, { min: 1 }) ??
      DEFAULT_MAX_CONNECTIONS_PER_IP,
    twilio: parseTwilioCredentials(env),
    stunUrls: parseList(env.STUN_URLS) ?? DEFAULT_STUN_URLS,
    clientDir: DEFAULT_CLIENT_DIR,
  };
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

function firstSet(...values: (string | undefined)[]): string | undefined {
  return values.map((value) => value?.trim()).find((value) => value !== undefined && value !== "");
}
