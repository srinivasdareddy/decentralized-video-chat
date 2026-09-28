import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

/**
 * The client's IP address. Each trusted reverse proxy appends the address it
 * received the request from to X-Forwarded-For, so the client is
 * `trustedHops` entries from the end of the chain. Anything further left
 * could have been made up by the client and is ignored.
 */
export function clientIp(request: IncomingMessage, trustedHops: number): string {
  const socketAddress = normalize(request.socket.remoteAddress ?? "");
  if (trustedHops === 0) return socketAddress;

  const header = request.headers["x-forwarded-for"];
  const forwarded = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const chain = [...forwarded, socketAddress];
  const client = chain[Math.max(chain.length - 1 - trustedHops, 0)] ?? socketAddress;
  return normalize(client);
}

/**
 * Whether an address is loopback or private (RFC 1918, unique local, link
 * local). Such addresses belong to local users or to a proxy whose
 * forwarded addresses aren't trusted, so per-IP limits don't apply to them:
 * otherwise everyone behind a misconfigured proxy would share one limit.
 */
export function isLocalAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return true; // Not an IP at all (e.g. a Unix socket): treat as local.
}

/** "::ffff:203.0.113.5" (an IPv4 address on an IPv6 socket) → "203.0.113.5". */
function normalize(address: string): string {
  return address.startsWith("::ffff:") && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}
