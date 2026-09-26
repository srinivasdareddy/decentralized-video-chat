import { describe, expect, it } from "vitest";
import { unsupportedPageFor } from "./browser-support.ts";

const CHROME_DESKTOP =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1";
const INSTAGRAM_IPHONE = `${SAFARI_IPHONE} Instagram 300.0`;
const FACEBOOK_ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 [FBAN/EMA;FBAV/400.0]";
const IPAD_DESKTOP_MODE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const env = (userAgent: string, overrides = {}) => ({
  userAgent,
  maxTouchPoints: 0,
  hasWebRTC: true,
  ...overrides,
});

describe("unsupportedPageFor", () => {
  it("lets capable browsers through, including Chrome on iOS", () => {
    expect(unsupportedPageFor(env(CHROME_DESKTOP))).toBeNull();
    expect(unsupportedPageFor(env(SAFARI_IPHONE, { maxTouchPoints: 5 }))).toBeNull();
    expect(unsupportedPageFor(env(CHROME_IPHONE, { maxTouchPoints: 5 }))).toBeNull();
  });

  it("sends in-app browsers to the right help page", () => {
    expect(unsupportedPageFor(env(INSTAGRAM_IPHONE, { maxTouchPoints: 5 }))).toBe(
      "/notsupportedios",
    );
    expect(unsupportedPageFor(env(FACEBOOK_ANDROID, { maxTouchPoints: 5 }))).toBe("/notsupported");
  });

  it("sends browsers without WebRTC away", () => {
    expect(unsupportedPageFor(env(CHROME_DESKTOP, { hasWebRTC: false }))).toBe("/notsupported");
    expect(
      unsupportedPageFor(env(IPAD_DESKTOP_MODE, { hasWebRTC: false, maxTouchPoints: 5 })),
    ).toBe("/notsupportedios");
  });
});
