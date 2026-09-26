import fs from "node:fs";
import path from "node:path";
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type { Logger } from "./logger.ts";

export interface AppOptions {
  clientDir: string;
  forceHttps: boolean;
  logger: Logger;
}

/** Pages that `react-router build` pre-renders to static HTML. */
const PRERENDERED_PAGES: Record<string, string> = {
  "/": "index.html",
  "/newcall": "newcall/index.html",
  "/notsupported": "notsupported/index.html",
  "/notsupportedios": "notsupportedios/index.html",
};

/** Shell that boots the client-side router for every other route. */
const SPA_FALLBACK = "__spa-fallback.html";

/** Everything under assets/ has a content hash in its file name. */
const IMMUTABLE_ASSETS = `${path.sep}assets${path.sep}`;

export function createApp({ clientDir, forceHttps, logger }: AppOptions): express.Express {
  if (!fs.existsSync(path.join(clientDir, SPA_FALLBACK))) {
    logger.warn(
      `The web client has not been built (${clientDir} is missing). Run "npm run build", or use "npm run dev" during development.`,
    );
  }

  const app = express();
  app.disable("x-powered-by");
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

  for (const [route, file] of Object.entries(PRERENDERED_PAGES)) {
    app.get(route, sendPage(clientDir, file));
  }
  app.get("/join/:room", sendPage(clientDir, SPA_FALLBACK));
  // Unknown pages still get the app shell so the client can render its
  // "not found" page, but with the right status code.
  app.use(sendPage(clientDir, SPA_FALLBACK, 404));
  app.use(handleError(logger));

  return app;
}

function sendPage(clientDir: string, file: string, status = 200): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.status(status).sendFile(
      path.join(clientDir, file),
      { headers: { "Cache-Control": "no-cache" } },
      (error) => {
        if (error) next(error);
      },
    );
  };
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(self), display-capture=(self)",
  );
  next();
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
    if (isMissingFile(error)) {
      res
        .status(503)
        .type("text")
        .send('The web client has not been built. Run "npm run build".');
      return;
    }
    logger.error("Unhandled request error", error);
    res.status(500).type("text").send("Something went wrong.");
  };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
