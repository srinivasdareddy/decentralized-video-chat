import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientIp, isLocalAddress } from "./client-ip.ts";

function request(remoteAddress: string, forwardedFor?: string): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  } as unknown as IncomingMessage;
}

describe("clientIp", () => {
  it("uses the connection's address when no proxy is trusted", () => {
    expect(clientIp(request("203.0.113.9", "198.51.100.1"), 0)).toBe("203.0.113.9");
  });

  it("unwraps IPv4 addresses on IPv6 sockets", () => {
    expect(clientIp(request("::ffff:203.0.113.9"), 0)).toBe("203.0.113.9");
  });

  it("takes the address the trusted proxy saw", () => {
    // Client 198.51.100.7 → proxy (10.0.0.2) → server.
    expect(clientIp(request("10.0.0.2", "198.51.100.7"), 1)).toBe("198.51.100.7");
  });

  it("ignores addresses a client adds to spoof the header", () => {
    expect(clientIp(request("10.0.0.2", "6.6.6.6, 198.51.100.7"), 1)).toBe("198.51.100.7");
  });

  it("walks back through several proxies", () => {
    // Client → CDN (192.0.2.50) → proxy (10.0.0.2) → server.
    expect(clientIp(request("10.0.0.2", "198.51.100.7, 192.0.2.50"), 2)).toBe("198.51.100.7");
  });

  it("falls back to the connection when the header is missing", () => {
    expect(clientIp(request("203.0.113.9"), 1)).toBe("203.0.113.9");
  });
});

describe("isLocalAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "",
  ])("treats %j as local", (address) => expect(isLocalAddress(address)).toBe(true));

  it.each(["203.0.113.9", "172.32.0.1", "8.8.8.8", "2001:db8::1"])(
    "treats %j as public",
    (address) => expect(isLocalAddress(address)).toBe(false),
  );
});
