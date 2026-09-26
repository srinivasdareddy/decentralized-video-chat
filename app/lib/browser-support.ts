export interface BrowserEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  /** Whether the browser exposes RTCPeerConnection and getUserMedia. */
  hasWebRTC: boolean;
}

export type UnsupportedPage = "/notsupported" | "/notsupportedios";

// In-app browsers that report WebRTC support but can't open the camera.
const IN_APP_BROWSER = /FBAN|FBAV|Instagram/;
const MOBILE = /Android|iPhone|iPad|iPod|Mobile/;

export function detectBrowserEnvironment(): BrowserEnvironment {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    hasWebRTC:
      typeof RTCPeerConnection !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function",
  };
}

/** Where to send browsers that can't make calls, or null if they can. */
export function unsupportedPageFor(env: BrowserEnvironment): UnsupportedPage | null {
  // iPadOS reports a desktop Mac user agent, but Macs have no touch screen.
  const isIOS =
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1);
  const isMobile = isIOS || MOBILE.test(env.userAgent);
  const inAppBrowser = isMobile && IN_APP_BROWSER.test(env.userAgent);

  if (inAppBrowser || !env.hasWebRTC) {
    return isIOS ? "/notsupportedios" : "/notsupported";
  }
  return null;
}
