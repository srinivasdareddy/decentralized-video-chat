import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  decodePeerMessage,
  encodePeerMessage,
  type PeerMessage,
} from "./peer-messages.ts";

describe("peer messages", () => {
  it.each<PeerMessage>([
    { type: "chat", text: "hi <b>there</b>" },
    { type: "caption", text: "hello" },
    { type: "captions-request", enabled: true },
    { type: "captions-unavailable" },
    { type: "media-state", audio: false, video: true },
    { type: "ping" },
    { type: "pong" },
  ])("round-trips %j", (message) => {
    expect(decodePeerMessage(encodePeerMessage(message))).toEqual(message);
  });

  it.each([
    42,
    "not json",
    "null",
    '"chat"',
    '{"type":"chat"}',
    '{"type":"chat","text":"   "}',
    '{"type":"captions-request","enabled":"yes"}',
    '{"type":"media-state","audio":true}',
    '{"type":"exec","code":"alert(1)"}',
    // The previous protocol's string prefixes are not accepted.
    "mes:hello",
  ])("rejects %j", (data) => {
    expect(decodePeerMessage(data)).toBeNull();
  });

  it("truncates oversized chat messages and ignores huge payloads", () => {
    const long = encodePeerMessage({ type: "chat", text: "a".repeat(5000) });
    expect(decodePeerMessage(long)).toEqual({
      type: "chat",
      text: "a".repeat(CHAT_MESSAGE_MAX_LENGTH),
    });
    const huge = encodePeerMessage({ type: "chat", text: "a".repeat(20_000) });
    expect(decodePeerMessage(huge)).toBeNull();
  });
});
