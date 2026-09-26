import fs from "node:fs";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { silentLogger } from "./logger.ts";

const PAGES: Record<string, string> = {
  "index.html": "landing page",
  "newcall/index.html": "new call page",
  "notsupported/index.html": "not supported page",
  "notsupportedios/index.html": "not supported on iOS page",
  "__spa-fallback.html": "app shell",
  "assets/root-Ab12Cd.js": "console.log('hi')",
  "images/logo.svg": "<svg></svg>",
};

let clientDir: string;
let server: Server | undefined;

beforeAll(() => {
  clientDir = fs.mkdtempSync(path.join(os.tmpdir(), "zipcall-client-"));
  for (const [file, content] of Object.entries(PAGES)) {
    fs.mkdirSync(path.dirname(path.join(clientDir, file)), { recursive: true });
    fs.writeFileSync(path.join(clientDir, file), content);
  }
});

afterAll(() => fs.rmSync(clientDir, { recursive: true, force: true }));

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
  server = undefined;
});

async function start(options: { forceHttps?: boolean; dir?: string } = {}) {
  const app = createApp({
    clientDir: options.dir ?? clientDir,
    forceHttps: options.forceHttps ?? false,
    logger: silentLogger,
  });
  const listening = app.listen(0, "127.0.0.1");
  server = listening;
  await new Promise((resolve) => listening.once("listening", resolve));
  const { port } = listening.address() as AddressInfo;
  return (pathname: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${pathname}`, { headers, redirect: "manual" });
}

describe("web app", () => {
  it("reports health", async () => {
    const get = await start();
    const response = await get("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it.each([
    ["/", "landing page"],
    ["/newcall", "new call page"],
    ["/notsupported", "not supported page"],
    ["/notsupportedios", "not supported on iOS page"],
    ["/join/purple-squid", "app shell"],
  ])("serves %s", async (pathname, body) => {
    const get = await start();
    const response = await get(pathname);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers unknown pages with the app shell and a 404", async () => {
    const get = await start();
    const response = await get("/no/such/page");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("app shell");
  });

  it("caches fingerprinted assets forever but not other files", async () => {
    const get = await start();
    const asset = await get("/assets/root-Ab12Cd.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const image = await get("/images/logo.svg");
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).not.toContain("immutable");
  });

  it.each([
    ["/newcall/", 301, "/newcall"],
    ["/join/room/?a=1", 301, "/join/room?a=1"],
    ["//evil.example/", 301, "/evil.example"],
    ["/join", 302, "/newcall"],
    ["/join/room?fbclid=123", 302, "/join/room"],
  ])("redirects %s", async (pathname, status, location) => {
    const get = await start();
    const response = await get(pathname);
    expect(response.status).toBe(status);
    expect(response.headers.get("location")).toBe(location);
  });

  it("redirects proxied plain-HTTP requests to HTTPS when forced", async () => {
    const get = await start({ forceHttps: true });
    const { port } = server?.address() as AddressInfo;

    // fetch() won't let us set the Host header, so use node:http.
    const insecure = await new Promise<http.IncomingMessage>((resolve, reject) => {
      http
        .get(
          {
            port,
            host: "127.0.0.1",
            path: "/newcall?x=1",
            headers: { "x-forwarded-proto": "http", host: "zipcall.example" },
          },
          resolve,
        )
        .on("error", reject);
    });
    insecure.resume();
    expect(insecure.statusCode).toBe(302);
    expect(insecure.headers.location).toBe("https://zipcall.example/newcall?x=1");

    expect((await get("/newcall", { "x-forwarded-proto": "https" })).status).toBe(200);
    expect((await get("/healthz", { "x-forwarded-proto": "http" })).status).toBe(200);
  });

  it("explains when the client hasn't been built", async () => {
    const get = await start({ dir: path.join(clientDir, "missing") });
    const response = await get("/");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("npm run build");
  });
});
