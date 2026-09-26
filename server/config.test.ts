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
    expect(loadConfig({ PORT: "", TWILIO_ACCOUNT_SID: " ", TWILIO_AUTH_TOKEN: "" })).toMatchObject(
      { port: 3000, twilio: null },
    );
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

  it("parses a comma-separated STUN list", () => {
    expect(loadConfig({ STUN_URLS: "stun:a:3478, stun:b:3478" }).stunUrls).toEqual([
      "stun:a:3478",
      "stun:b:3478",
    ]);
  });
});
