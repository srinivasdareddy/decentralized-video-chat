import { ConfigError, loadConfig, type Config } from "./config.ts";
import { consoleLogger as logger } from "./logger.ts";
import { createZipcallServer } from "./server.ts";

const SHUTDOWN_TIMEOUT_MS = 10_000;

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  logger.error(`Configuration error: ${error.message}`);
  process.exit(1);
}

const server = createZipcallServer(config, { logger });

server.httpServer.on("error", (error) => {
  logger.error("Could not start the server", error);
  process.exit(1);
});

server.httpServer.listen(config.port, () => {
  logger.info(`Zipcall is listening on http://localhost:${config.port}`);
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
  logger.info(`Received ${signal}, shutting down`);
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
