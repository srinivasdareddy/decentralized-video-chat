import { createHash } from "node:crypto";
import fs from "node:fs";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { silentLogger } from "./logger.ts";
import { MetricsRegistry } from "./metrics.ts";

const PREVIEW = '<meta property="og:image" content="/og-image.png"/>';

const PAGES: Record<string, string> = {
  "index.html": "landing page<script>window.landing = true;</script>",
  "newcall/index.html": `new call page${PREVIEW}`,
  "privacy/index.html": "privacy page",
  "notsupported/index.html": "not supported page",
  "notsupportedios/index.html": "not supported on iOS page",
  "__spa-fallback.html": "app shell",
  "assets/root-Ab12Cd.js": "console.log('hi')",
  "assets/big-Ef34Gh.js": `console.log("${"compress me ".repeat(500)}")`,
  "images/logo.svg": "<svg></svg>",
  "og-image.png": "png",
  "manifest.webmanifest": "{}",
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

async function start(
  options: {
    forceHttps?: boolean;
    dir?: string;
    trustProxy?: number;
    metrics?: { registry: MetricsRegistry; token: string };
    publicUrl?: string;
  } = {},
) {
  const app = createApp({
    clientDir: options.dir ?? clientDir,
    forceHttps: options.forceHttps ?? false,
    trustProxy: options.trustProxy ?? 0,
    logger: silentLogger,
    version: { version: "9.9.9", revision: "abc1234" },
    metrics: options.metrics,
    publicUrl: options.publicUrl,
  });
  const listening = app.listen(0, "127.0.0.1");
  server = listening;
  await new Promise((resolve) => listening.once("listening", resolve));
  const { port } = listening.address() as AddressInfo;
  return (pathname: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${pathname}`, { headers, redirect: "manual" });
}

/** GETs from the running server with a custom Host header, which fetch doesn't allow. */
function getWithHost(
  pathname: string,
  headers: Record<string, string>,
): Promise<{ headers: http.IncomingHttpHeaders; body: string }> {
  const { port } = server?.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    http
      .get({ port, host: "127.0.0.1", path: pathname, headers }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () => resolve({ headers: response.headers, body }));
      })
      .on("error", reject);
  });
}

describe("web app", () => {
  it("reports health, version, and uptime", async () => {
    const get = await start();
    const response = await get("/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      version: "9.9.9",
      revision: "abc1234",
      uptimeSeconds: expect.any(Number) as unknown,
    });
  });

  it("serves metrics only with the token, and only when enabled", async () => {
    const registry = new MetricsRegistry();
    registry.gauge("test_gauge", "A gauge.", () => 7);
    const get = await start({ metrics: { registry, token: "a-long-enough-token" } });

    expect((await get("/metrics")).status).toBe(401);
    expect((await get("/metrics", { authorization: "Bearer wrong-token" })).status).toBe(401);
    const response = await get("/metrics", { authorization: "Bearer a-long-enough-token" });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("test_gauge 7");

    const withoutMetrics = await start();
    expect((await withoutMetrics("/metrics")).status).toBe(404);
  });

  it.each([
    ["/", "landing page<script>window.landing = true;</script>"],
    ["/privacy", "privacy page"],
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

  it("sends a Content-Security-Policy allowing each page's own inline scripts", async () => {
    const get = await start();
    const landing = await get("/");
    const policy = landing.headers.get("content-security-policy") ?? "";
    expect(policy).toContain(
      `'sha256-${createHash("sha256").update("window.landing = true;").digest("base64")}'`,
    );
    expect(policy).toContain("object-src 'none'");
    // Pages without inline scripts get no hashes at all.
    const newCall = await get("/newcall");
    expect(newCall.headers.get("content-security-policy")).toContain("script-src 'self';");
  });

  it("keeps call links and help pages out of search engines", async () => {
    const get = await start();
    expect((await get("/join/room")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await get("/notsupported")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await get("/")).headers.get("x-robots-tag")).toBeNull();
    expect((await get("/newcall")).headers.get("x-robots-tag")).toBeNull();
    expect((await get("/privacy")).headers.get("x-robots-tag")).toBeNull();
  });

  it("gives link previews an absolute image URL", async () => {
    await start();
    expect((await getWithHost("/newcall", { host: "call.example:8080" })).body).toBe(
      'new call page<meta property="og:image" content="http://call.example:8080/og-image.png"/>',
    );
    // A Host header that isn't a plain hostname is never echoed.
    expect((await getWithHost("/newcall", { host: 'x"><script>' })).body).toContain(
      'content="/og-image.png"',
    );
  });

  it("uses the configured public URL for link previews", async () => {
    await start({ publicUrl: "https://call.example.com" });
    expect((await getWithHost("/newcall", { host: "other.example" })).body).toContain(
      'content="https://call.example.com/og-image.png"',
    );
  });

  it("lets other sites show the preview image, but nothing else", async () => {
    const get = await start();
    const image = await get("/og-image.png");
    expect(image.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    const other = await get("/images/logo.svg");
    expect(other.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("compresses text responses for clients that accept it", async () => {
    const get = await start();
    for (const encoding of ["br", "gzip"]) {
      const response = await get("/assets/big-Ef34Gh.js", { "accept-encoding": encoding });
      expect(response.headers.get("content-encoding")).toBe(encoding);
      expect(response.headers.get("vary")).toContain("Accept-Encoding");
      expect(await response.text()).toContain("compress me");
    }
    const plain = await get("/assets/big-Ef34Gh.js", { "accept-encoding": "identity" });
    expect(plain.headers.get("content-encoding")).toBeNull();
  });

  it("serves the web app manifest", async () => {
    const get = await start();
    const response = await get("/manifest.webmanifest");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/manifest\+json/);
  });

  it("isolates the page from other sites' windows", async () => {
    const get = await start();
    const response = await get("/");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("sends HSTS only for HTTPS requests to real hosts, seen through a trusted proxy", async () => {
    const get = await start({ trustProxy: 1 });
    const hstsFor = async (host: string, proto: string) =>
      (await getWithHost("/", { host, "x-forwarded-proto": proto })).headers[
        "strict-transport-security"
      ];
    expect(await hstsFor("zipcall.example", "https")).toBe("max-age=31536000");
    expect(await hstsFor("zipcall.example", "http")).toBeUndefined();
    expect(await hstsFor("localhost:3000", "https")).toBeUndefined();
    expect((await get("/")).headers.get("strict-transport-security")).toBeNull();
  });

  it("does not trust X-Forwarded-Proto without a trusted proxy", async () => {
    await start({ trustProxy: 0 });
    const { port } = server?.address() as AddressInfo;
    const hsts = await new Promise<string | undefined>((resolve, reject) => {
      http
        .get(
          {
            port,
            host: "127.0.0.1",
            path: "/",
            headers: { host: "zipcall.example", "x-forwarded-proto": "https" },
          },
          (response) => {
            response.resume();
            resolve(response.headers["strict-transport-security"]);
          },
        )
        .on("error", reject);
    });
    expect(hsts).toBeUndefined();
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
