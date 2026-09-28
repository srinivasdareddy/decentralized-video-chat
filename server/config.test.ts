import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

const SID = "AC" + "0123456789abcdef".repeat(2);

describe("loadConfig", () => {
  it("runs with no configuration at all", () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.forceHttps).toBe(false);
    expect(config.twilio).toBeNull();
    expect(config.stunUrls).toEqual(["stun:stun.l.google.com:19302"]);
  });

  it("reads the documented Twilio variables", () => {
    const config = loadConfig({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: "secret" });
    expect(config.twilio).toEqual({ accountSid: SID, authToken: "secret" });
  });

  it("still accepts the variable names used by earlier versions", () => {
    expect(loadConfig({ HEROKU_TWILLIO_SID: SID, HEROKU_AUTH_TOKEN: "a" }).twilio).toEqual({
      accountSid: SID,
      authToken: "a",
    });
    expect(loadConfig({ LOCAL_TWILLIO_SID: SID, LOCAL_AUTH_TOKEN: "b" }).twilio).toEqual({
      accountSid: SID,
      authToken: "b",
    });
  });

  it("rejects half-configured or malformed Twilio credentials", () => {
    expect(() => loadConfig({ TWILIO_ACCOUNT_SID: SID })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ TWILIO_ACCOUNT_SID: "YourAccountSIDHere", TWILIO_AUTH_TOKEN: "x" }),
    ).toThrow(/TWILIO_ACCOUNT_SID/);
  });

  it("treats blank values as unset", () => {
    expect(loadConfig({ PORT: "", TWILIO_ACCOUNT_SID: " ", TWILIO_AUTH_TOKEN: "" })).toMatchObject({
      port: 3000,
      twilio: null,
    });
  });

  it("validates PORT", () => {
    expect(loadConfig({ PORT: "8080" }).port).toBe(8080);
    expect(() => loadConfig({ PORT: "http" })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: "70000" })).toThrow(ConfigError);
  });

  it("forces HTTPS on Heroku unless told otherwise", () => {
    expect(loadConfig({ DYNO: "web.1" }).forceHttps).toBe(true);
    expect(loadConfig({ DYNO: "web.1", FORCE_HTTPS: "false" }).forceHttps).toBe(false);
    expect(loadConfig({ FORCE_HTTPS: "true" }).forceHttps).toBe(true);
    expect(() => loadConfig({ FORCE_HTTPS: "maybe" })).toThrow(ConfigError);
  });

  it("trusts proxies only when told how many there are", () => {
    expect(loadConfig({}).trustProxy).toBe(0);
    expect(loadConfig({ DYNO: "web.1" }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: "2" }).trustProxy).toBe(2);
    expect(loadConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: "false" }).trustProxy).toBe(0);
    expect(() => loadConfig({ TRUST_PROXY: "all" })).toThrow(ConfigError);
  });

  it("accepts extra signaling origins", () => {
    expect(loadConfig({}).allowedOrigins).toEqual([]);
    expect(
      loadConfig({ ALLOWED_ORIGINS: "https://a.example, http://localhost:5173/" }).allowedOrigins,
    ).toEqual(["https://a.example", "http://localhost:5173"]);
    expect(() => loadConfig({ ALLOWED_ORIGINS: "a.example" })).toThrow(ConfigError);
    expect(() => loadConfig({ ALLOWED_ORIGINS: "https://a.example/path" })).toThrow(ConfigError);
  });

  it("limits connections per IP", () => {
    expect(loadConfig({}).maxConnectionsPerIp).toBe(50);
    expect(loadConfig({ MAX_CONNECTIONS_PER_IP: "200" }).maxConnectionsPerIp).toBe(200);
    expect(() => loadConfig({ MAX_CONNECTIONS_PER_IP: "0" })).toThrow(ConfigError);
  });

  it("logs JSON in production and readable text elsewhere", () => {
    expect(loadConfig({})).toMatchObject({ logLevel: "info", logFormat: "pretty" });
    expect(loadConfig({ NODE_ENV: "production" }).logFormat).toBe("json");
    expect(loadConfig({ NODE_ENV: "production", LOG_FORMAT: "pretty" }).logFormat).toBe("pretty");
    expect(loadConfig({ LOG_LEVEL: "DEBUG" }).logLevel).toBe("debug");
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow(ConfigError);
  });

  it("enables metrics only with a strong enough token", () => {
    expect(loadConfig({}).metricsToken).toBeNull();
    expect(loadConfig({ METRICS_TOKEN: "0123456789abcdef" }).metricsToken).toBe("0123456789abcdef");
    expect(() => loadConfig({ METRICS_TOKEN: "short" })).toThrow(ConfigError);
  });

  it("accepts your own TURN server", () => {
    const config = loadConfig({
      TURN_URLS: "turn:turn.example:3478?transport=udp, turns:turn.example:5349",
      TURN_SECRET: "a-long-shared-secret",
    });
    expect(config.turn).toEqual({
      urls: ["turn:turn.example:3478?transport=udp", "turns:turn.example:5349"],
      secret: "a-long-shared-secret",
    });
    expect(loadConfig({}).turn).toBeNull();
  });

  it("rejects incomplete, malformed, or conflicting TURN settings", () => {
    const secret = "a-long-shared-secret";
    expect(() => loadConfig({ TURN_URLS: "turn:turn.example" })).toThrow(ConfigError);
    expect(() => loadConfig({ TURN_URLS: "stun:x", TURN_SECRET: secret })).toThrow(/turn:/);
    expect(() => loadConfig({ TURN_URLS: "turn:x", TURN_SECRET: "short" })).toThrow(/16/);
    expect(() =>
      loadConfig({
        TURN_URLS: "turn:x",
        TURN_SECRET: secret,
        TWILIO_ACCOUNT_SID: SID,
        TWILIO_AUTH_TOKEN: "t",
      }),
    ).toThrow(/not both/);
  });

  it("allows relay-only calls only with a TURN server", () => {
    expect(loadConfig({}).iceTransportPolicy).toBe("all");
    expect(() => loadConfig({ ICE_TRANSPORT_POLICY: "relay" })).toThrow(/needs a TURN server/);
    expect(
      loadConfig({
        ICE_TRANSPORT_POLICY: "relay",
        TURN_URLS: "turn:x",
        TURN_SECRET: "a-long-shared-secret",
      }).iceTransportPolicy,
    ).toBe("relay");
    expect(() => loadConfig({ ICE_TRANSPORT_POLICY: "p2p" })).toThrow(ConfigError);
  });

  it("reads the public URL as an origin", () => {
    expect(loadConfig({}).publicUrl).toBeNull();
    expect(loadConfig({ PUBLIC_URL: "https://call.example.com/" }).publicUrl).toBe(
      "https://call.example.com",
    );
    expect(loadConfig({ PUBLIC_URL: " http://localhost:3000 " }).publicUrl).toBe(
      "http://localhost:3000",
    );
    for (const value of ["call.example.com", "ftp://call.example.com", "https://x.example/app"]) {
      expect(() => loadConfig({ PUBLIC_URL: value })).toThrow(ConfigError);
    }
  });

  it("parses a comma-separated STUN list", () => {
    expect(loadConfig({ STUN_URLS: "stun:a:3478, stun:b:3478" }).stunUrls).toEqual([
      "stun:a:3478",
      "stun:b:3478",
    ]);
  });
});
