/**
 * Messages the two browsers exchange over the WebRTC data channel.
 *
 * The other side is not trusted: everything received goes through
 * decodePeerMessage, and chat text is only ever rendered as text.
 */
export type PeerMessage =
  | { type: "chat"; text: string }
  | { type: "caption"; text: string }
  /** Ask the other person to start or stop sending captions of their speech. */
  | { type: "captions-request"; enabled: boolean }
  | { type: "captions-unavailable" }
  | { type: "media-state"; audio: boolean; video: boolean };

export const CHAT_MESSAGE_MAX_LENGTH = 2000;
const CAPTION_MAX_LENGTH = 300;
const ENCODED_MAX_LENGTH = 16 * 1024;

export function encodePeerMessage(message: PeerMessage): string {
  return JSON.stringify(message);
}

export function decodePeerMessage(data: unknown): PeerMessage | null {
  if (typeof data !== "string" || data.length > ENCODED_MAX_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;

  switch (message.type) {
    case "chat":
      return typeof message.text === "string" && message.text.trim() !== ""
        ? { type: "chat", text: message.text.slice(0, CHAT_MESSAGE_MAX_LENGTH) }
        : null;
    case "caption":
      return typeof message.text === "string"
        ? { type: "caption", text: message.text.slice(-CAPTION_MAX_LENGTH) }
        : null;
    case "captions-request":
      return typeof message.enabled === "boolean"
        ? { type: "captions-request", enabled: message.enabled }
        : null;
    case "captions-unavailable":
      return { type: "captions-unavailable" };
    case "media-state":
      return typeof message.audio === "boolean" && typeof message.video === "boolean"
        ? { type: "media-state", audio: message.audio, video: message.video }
        : null;
    default:
      return null;
  }
}
