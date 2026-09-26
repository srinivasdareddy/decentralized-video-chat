import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts: the React Router plugin isn't meant to
// run under Vitest.
export default defineConfig({
  test: {
    include: ["{app,server,shared}/**/*.test.{ts,tsx}"],
    environment: "node",
    restoreMocks: true,
  },
});
