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
const DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302"];
const DEFAULT_CLIENT_DIR = fileURLToPath(new URL("../build/client", import.meta.url));

/** Reads the configuration from environment variables, failing fast on bad values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: parsePort(env.PORT),
    // Heroku (which sets DYNO) terminates TLS in its router, so redirect by
    // default there, as earlier versions of Zipcall did.
    forceHttps: parseBoolean("FORCE_HTTPS", env.FORCE_HTTPS) ?? "DYNO" in env,
    twilio: parseTwilioCredentials(env),
    stunUrls: parseList(env.STUN_URLS) ?? DEFAULT_STUN_URLS,
    clientDir: DEFAULT_CLIENT_DIR,
  };
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ConfigError(`PORT must be a number from 0 to 65535, got "${value}".`);
  }
  return port;
}

function parseBoolean(name: string, value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized === "") return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ConfigError(`${name} must be true or false, got "${value}".`);
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
