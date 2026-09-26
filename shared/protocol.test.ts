import { describe, expect, it } from "vitest";
import {
  ROOM_NAME_MAX_LENGTH,
  isIceCandidate,
  isSessionDescription,
  isValidRoomName,
  normalizeRoomName,
  parseJoinRequest,
} from "./protocol.ts";

describe("room names", () => {
  it("are case-insensitive and trimmed", () => {
    expect(normalizeRoomName("  PurpleSquid ")).toBe("purplesquid");
  });

  it("treat composed and decomposed accents as the same name", () => {
    expect(normalizeRoomName("Café")).toBe(normalizeRoomName("Café"));
  });

  it("reject empty, overlong, and path-like names", () => {
    expect(isValidRoomName("happy-panda")).toBe(true);
    expect(isValidRoomName("")).toBe(false);
    expect(isValidRoomName("a".repeat(ROOM_NAME_MAX_LENGTH + 1))).toBe(false);
    expect(isValidRoomName("a/b")).toBe(false);
    expect(isValidRoomName("a\nb")).toBe(false);
  });
});

describe("parseJoinRequest", () => {
  it("normalises a valid request", () => {
    expect(parseJoinRequest({ room: " Room ", clientId: "tab-1" })).toEqual({
      room: "room",
      clientId: "tab-1",
    });
  });

  it.each([
    null,
    "room",
    { room: "room" },
    { room: "", clientId: "tab-1" },
    { room: "room", clientId: "" },
    { room: "room", clientId: "has spaces" },
    { room: 42, clientId: "tab-1" },
  ])("rejects %j", (request) => {
    expect(parseJoinRequest(request)).toBeNull();
  });
});

describe("payload validation", () => {
  it("accepts well-formed descriptions of the expected type only", () => {
    const offer = { type: "offer", sdp: "v=0" };
    expect(isSessionDescription(offer, "offer")).toBe(true);
    expect(isSessionDescription(offer, "answer")).toBe(false);
    expect(isSessionDescription({ type: "offer", sdp: 1 }, "offer")).toBe(false);
    expect(isSessionDescription({ type: "offer", sdp: "x".repeat(70_000) }, "offer")).toBe(
      false,
    );
  });

  it("accepts ICE candidates with nullable fields", () => {
    expect(isIceCandidate({ candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 })).toBe(
      true,
    );
    expect(isIceCandidate({ candidate: "", sdpMid: null, sdpMLineIndex: null })).toBe(true);
    expect(isIceCandidate({ candidate: "candidate:1", sdpMLineIndex: "0" })).toBe(false);
    expect(isIceCandidate([])).toBe(false);
  });
});
