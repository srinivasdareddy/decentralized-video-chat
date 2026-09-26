import http from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";
import { createIceServerProvider, type IceServerProvider } from "./ice-servers.ts";
import { consoleLogger, type Logger } from "./logger.ts";
import { registerSignaling, type SignalingServer } from "./signaling.ts";

export interface ZipcallServer {
  httpServer: http.Server;
  io: SignalingServer;
  /** Disconnects every client and stops accepting connections. */
  close(): Promise<void>;
}

export interface ServerDependencies {
  logger?: Logger;
  getIceServers?: IceServerProvider;
}

/** Wires the web app and the signaling server onto one HTTP server. */
export function createZipcallServer(
  config: Config,
  {
    logger = consoleLogger,
    getIceServers = createIceServerProvider(config, logger),
  }: ServerDependencies = {},
): ZipcallServer {
  const app = createApp({
    clientDir: config.clientDir,
    forceHttps: config.forceHttps,
    logger,
  });
  const httpServer = http.createServer(app);
  const io: SignalingServer = new Server(httpServer, {
    // The browser bundle ships its own copy of the client.
    serveClient: false,
    // Signaling messages are small; SDP blobs are a few kilobytes.
    maxHttpBufferSize: 100_000,
  });
  registerSignaling(io, { getIceServers, logger });

  return {
    httpServer,
    io,
    close: () =>
      new Promise<void>((resolve, reject) => {
        void io.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
