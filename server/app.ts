import path from "node:path";
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type { Logger } from "./logger.ts";
import { loadPage, type Page } from "./pages.ts";
import { contentSecurityPolicy, securityHeaders } from "./security.ts";

export interface AppOptions {
  clientDir: string;
  forceHttps: boolean;
  trustProxy: number;
  logger: Logger;
}

/**
 * Pages that `react-router build` pre-renders to static HTML. Only the
 * landing and new call pages belong in search results.
 */
const PAGES: Record<string, { file: string; indexable: boolean }> = {
  "/": { file: "index.html", indexable: true },
  "/newcall": { file: "newcall/index.html", indexable: true },
  "/notsupported": { file: "notsupported/index.html", indexable: false },
  "/notsupportedios": { file: "notsupportedios/index.html", indexable: false },
};

/** Shell that boots the client-side router for every other route. */
const SPA_FALLBACK = "__spa-fallback.html";

/** Everything under assets/ has a content hash in its file name. */
const IMMUTABLE_ASSETS = `${path.sep}assets${path.sep}`;

export function createApp({
  clientDir,
  forceHttps,
  trustProxy,
  logger,
}: AppOptions): express.Express {
  const fallback = loadPage(path.join(clientDir, SPA_FALLBACK));
  if (fallback === null) {
    logger.warn(
      `The web client has not been built (${clientDir} is missing). Run "npm run build", or use "npm run dev" during development.`,
    );
  }

  const app = express();
  app.disable("x-powered-by");
  // Lets req.ip and req.secure see through that many reverse proxies.
  app.set("trust proxy", trustProxy);
  app.use(securityHeaders);

  // Before the HTTPS redirect, so container health checks over plain HTTP pass.
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  if (forceHttps) app.use(redirectToHttps);
  app.use(removeTrailingSlash);

  app.get("/join", (_req, res) => res.redirect("/newcall"));
  // Keep shared call links clean, e.g. drop tracking parameters.
  app.get("/join/:room", (req, res, next) => {
    const queryStart = req.originalUrl.indexOf("?");
    if (queryStart === -1) return next();
    res.redirect(req.originalUrl.slice(0, queryStart));
  });

  app.use(
    express.static(clientDir, {
      index: false,
      redirect: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(IMMUTABLE_ASSETS)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  for (const [route, { file, indexable }] of Object.entries(PAGES)) {
    app.get(route, sendPage(loadPage(path.join(clientDir, file)), { indexable }));
  }
  app.get("/join/:room", sendPage(fallback, { indexable: false }));
  // Unknown pages still get the app shell so the client can render its
  // "not found" page, but with the right status code.
  app.use(sendPage(fallback, { indexable: false, status: 404 }));
  app.use(handleError(logger));

  return app;
}

function sendPage(
  page: Page | null,
  { indexable, status = 200 }: { indexable: boolean; status?: number },
): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (page === null) {
      res.status(503).type("text").send('The web client has not been built. Run "npm run build".');
      return;
    }
    res.status(status).set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "Content-Security-Policy": contentSecurityPolicy({
        scriptHashes: page.scriptHashes,
        host: req.get("host"),
      }),
    });
    if (!indexable) res.set("X-Robots-Tag", "noindex, nofollow");
    res.send(page.html);
  };
}

function redirectToHttps(req: Request, res: Response, next: NextFunction): void {
  // Behind a TLS-terminating proxy the original scheme is in this header.
  const proto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto === "http") {
    res.redirect(`https://${req.get("host") ?? req.hostname}${req.originalUrl}`);
    return;
  }
  next();
}

function removeTrailingSlash(req: Request, res: Response, next: NextFunction): void {
  if (req.path.length > 1 && req.path.endsWith("/")) {
    const queryStart = req.originalUrl.indexOf("?");
    const query = queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
    // Collapse leading slashes too: redirecting "//example.com/" to
    // "//example.com" would send the browser to another site.
    const pathname = "/" + req.path.replace(/^\/+|\/+$/g, "");
    res.redirect(301, pathname + query);
    return;
  }
  next();
}

function handleError(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) return next(error);
    logger.error("Unhandled request error", error);
    res.status(500).type("text").send("Something went wrong.");
  };
}
