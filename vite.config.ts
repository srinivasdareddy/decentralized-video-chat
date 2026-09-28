import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const signalingServer = `http://localhost:${process.env.PORT ?? "3000"}`;

export default defineConfig({
  plugins: [reactRouter()],
  server: {
    port: 5173,
    // In development the signaling server runs separately (npm run dev
    // starts both); forward its WebSocket traffic.
    proxy: {
      "/socket.io": { target: signalingServer, ws: true },
    },
  },
});
