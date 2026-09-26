import { ConfigError, loadConfig, type Config } from "./config.ts";
import { createLogger, type Logger } from "./logger.ts";
import { createZipcallServer } from "./server.ts";
import { readVersion } from "./version.ts";

const SHUTDOWN_TIMEOUT_MS = 10_000;

// Settings from .env, if there is one. Real environment variables win.
// (Loaded here rather than with --env-file-if-exists, which breaks
// `node --watch` when the file doesn't exist.)
try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

// Until the configuration has been read, log the way production would.
let logger: Logger = createLogger({
  format: process.env.NODE_ENV === "production" ? "json" : "pretty",
});

// Record crashes in the same log format before exiting; the container or
// process manager restarts the server.
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception, exiting", error);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection, exiting", reason);
  process.exit(1);
});

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  logger.error(`Configuration error: ${error.message}`);
  process.exit(1);
}

logger = createLogger({ level: config.logLevel, format: config.logFormat });
const version = readVersion();
const server = createZipcallServer(config, { logger, version });

server.httpServer.on("error", (error) => {
  logger.error("Could not start the server", error);
  process.exit(1);
});

server.httpServer.listen(config.port, () => {
  logger.info("Zipcall is listening", {
    url: `http://localhost:${config.port}`,
    version: version.version,
    revision: version.revision ?? undefined,
    turn: config.twilio === null ? "off" : "twilio",
    metrics: config.metricsToken !== null,
  });
  if (config.twilio === null) {
    logger.warn(
      "TURN relays are off because Twilio isn't configured, so calls between some networks may fail to connect. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to enable them.",
    );
  }
});

let shuttingDown = false;
function shutDown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down", { signal });
  setTimeout(() => {
    logger.warn("Shutdown timed out, exiting anyway");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  server.close().then(
    () => process.exit(0),
    (error: unknown) => {
      logger.error("Error while shutting down", error);
      process.exit(1);
    },
  );
}

process.on("SIGTERM", shutDown);
process.on("SIGINT", shutDown);
