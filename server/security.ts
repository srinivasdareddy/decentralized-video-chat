import type { NextFunction, Request, Response } from "express";

/** A Host header we're willing to echo into a policy (hostname or IP, optional port). */
const SAFE_HOST = /^[a-z0-9.-]+(?::\d{1,5})?$|^\[[0-9a-f:.]+\](?::\d{1,5})?$/i;
const LOCAL_HOSTS = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i;

/**
 * The Content-Security-Policy for a page: scripts only from this origin or
 * the page's own inline scripts (by hash), no inline styles, no plugins,
 * and no embedding by other sites.
 */
export function contentSecurityPolicy({
  scriptHashes,
  host,
}: {
  scriptHashes: string[];
  host: string | undefined;
}): string {
  // 'self' covers same-origin WebSockets in current browsers; the explicit
  // entries are for older Safari, which doesn't match ws:/wss: to 'self'.
  const connect = isSafeHost(host) ? `'self' wss://${host} ws://${host}` : "'self'";
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(" ")}`.trim(),
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** Whether a Host header is a plain hostname or IP address (and port), safe to echo. */
export function isSafeHost(host: string | undefined): host is string {
  return host !== undefined && SAFE_HOST.test(host);
}

/** Headers for every response. */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()",
  );
  // Browsers ignore HSTS on plain HTTP, and on localhost it would only get
  // in the way of development.
  if (req.secure && !LOCAL_HOSTS.test(req.get("host") ?? "")) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  next();
}

/**
 * Whether a signaling connection may be opened from `origin`. Browsers
 * always send Origin for WebSocket and cross-origin requests; it's absent
 * only on same-origin polling requests and non-browser clients.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (origin === undefined) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === host?.toLowerCase();
  } catch {
    return false;
  }
}
