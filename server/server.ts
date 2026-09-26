import http from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";
import { createIceServerProvider, type IceServerProvider } from "./ice-servers.ts";
import { consoleLogger, type Logger } from "./logger.ts";
import { isAllowedOrigin } from "./security.ts";
import {
  DEFAULT_LIMITS,
  registerSignaling,
  type SignalingLimits,
  type SignalingServer,
} from "./signaling.ts";

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
}

/** Wires the web app and the signaling server onto one HTTP server. */
export function createZipcallServer(
  config: Config,
  {
    logger = consoleLogger,
    getIceServers = createIceServerProvider(config, logger),
    limits,
  }: ServerDependencies = {},
): ZipcallServer {
  const app = createApp({
    clientDir: config.clientDir,
    forceHttps: config.forceHttps,
    trustProxy: config.trustProxy,
    logger,
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
      callback(null, isAllowedOrigin(req.headers.origin, req.headers.host, config.allowedOrigins));
    },
  });
  const stopSignaling = registerSignaling(io, {
    getIceServers,
    logger,
    trustProxy: config.trustProxy,
    limits: { ...DEFAULT_LIMITS, connectionsPerIp: config.maxConnectionsPerIp, ...limits },
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
