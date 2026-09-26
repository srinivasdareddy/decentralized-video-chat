import http from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";
import { createIceServerProvider, type IceServerProvider } from "./ice-servers.ts";
import { createLogger, type Logger } from "./logger.ts";
import { createSignalingMetrics, MetricsRegistry } from "./metrics.ts";
import { isAllowedOrigin } from "./security.ts";
import {
  DEFAULT_LIMITS,
  registerSignaling,
  type SignalingLimits,
  type SignalingServer,
} from "./signaling.ts";
import { readVersion, type VersionInfo } from "./version.ts";

export interface ZipcallServer {
  httpServer: http.Server;
  io: SignalingServer;
  /** Disconnects every client and stops accepting connections. */
  close(): Promise<void>;
}

export interface ServerDependencies {
  logger?: Logger;
  getIceServers?: IceServerProvider;
  /** Overrides for the signaling rate limits (mainly for tests). */
  limits?: Partial<SignalingLimits>;
  version?: VersionInfo;
}

/** Wires the web app and the signaling server onto one HTTP server. */
export function createZipcallServer(
  config: Config,
  dependencies: ServerDependencies = {},
): ZipcallServer {
  const logger =
    dependencies.logger ?? createLogger({ level: config.logLevel, format: config.logFormat });
  const version = dependencies.version ?? readVersion();
  const registry = new MetricsRegistry();
  const metrics = createSignalingMetrics(registry);
  const getIceServers =
    dependencies.getIceServers ??
    createIceServerProvider(config, logger, () => metrics.iceServerFailures.inc());

  const app = createApp({
    clientDir: config.clientDir,
    forceHttps: config.forceHttps,
    trustProxy: config.trustProxy,
    logger,
    version,
    metrics: config.metricsToken === null ? undefined : { registry, token: config.metricsToken },
  });
  const httpServer = http.createServer(app);
  const io: SignalingServer = new Server(httpServer, {
    // The browser bundle ships its own copy of the client.
    serveClient: false,
    // Signaling messages are small; SDP blobs are a few kilobytes.
    maxHttpBufferSize: 100_000,
    // Only pages from this site (or ALLOWED_ORIGINS) may connect, so other
    // websites can't use their visitors' browsers to join rooms.
    allowRequest: (req, callback) => {
      const allowed = isAllowedOrigin(req.headers.origin, req.headers.host, config.allowedOrigins);
      if (!allowed) {
        metrics.refused.inc({ reason: "origin" });
        logger.debug("Refused a connection from another origin", { origin: req.headers.origin });
      }
      callback(null, allowed);
    },
  });
  const stopSignaling = registerSignaling(io, {
    getIceServers,
    logger,
    trustProxy: config.trustProxy,
    limits: {
      ...DEFAULT_LIMITS,
      connectionsPerIp: config.maxConnectionsPerIp,
      ...dependencies.limits,
    },
    metrics,
    iceTransportPolicy: config.iceTransportPolicy,
  });

  registry.gauge(
    "zipcall_connections",
    "Open signaling connections.",
    () => io.engine.clientsCount,
  );
  registry.gauge("zipcall_waiting_rooms", "Rooms with one person waiting.", () =>
    countRooms(io, 1),
  );
  registry.gauge("zipcall_active_calls", "Rooms with two people in a call.", () =>
    countRooms(io, 2),
  );
  registry.gauge("process_resident_memory_bytes", "Resident memory in bytes.", () =>
    process.memoryUsage.rss(),
  );
  registry.gauge("process_uptime_seconds", "Seconds since the server started.", () =>
    Math.round(process.uptime()),
  );
  registry.gauge("zipcall_info", "The running version.", () => 1, {
    version: version.version,
    revision: version.revision ?? "",
  });

  return {
    httpServer,
    io,
    close: () =>
      new Promise<void>((resolve, reject) => {
        stopSignaling();
        void io.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** Rooms with exactly `size` people. (Every socket also has a private room named after it.) */
function countRooms(io: SignalingServer, size: number): number {
  let count = 0;
  for (const [name, members] of io.sockets.adapter.rooms) {
    if (members.size === size && !io.sockets.sockets.has(name)) count++;
  }
  return count;
}
