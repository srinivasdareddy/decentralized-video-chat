/**
 * The signaling protocol spoken between browsers and the server over
 * Socket.IO.
 *
 * This module is imported by the browser bundle (via Vite) and by the server
 * (run directly by Node), so it must not use browser- or Node-specific APIs.
 * Payload shapes mirror the WebRTC types (RTCSessionDescriptionInit,
 * RTCIceCandidateInit, RTCIceServer) without depending on the DOM typings.
 */

/** A call is always between exactly two people. */
export const ROOM_CAPACITY = 2;

export const ROOM_NAME_MAX_LENGTH = 64;

/** Generous upper bound for an SDP blob; real ones are a few kilobytes. */
const SDP_MAX_LENGTH = 64 * 1024;
const CANDIDATE_MAX_LENGTH = 1024;
const CLIENT_ID_PATTERN = /^[\w-]{1,64}$/;
// Control characters and URL delimiters that could never come from a
// /join/:room path segment.
// eslint-disable-next-line no-control-regex
const ROOM_NAME_FORBIDDEN = /[\u0000-\u001f\u007f/\\?#]/;

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface SessionDescription {
  type: "offer" | "answer";
  sdp: string;
}

export interface IceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface JoinRequest {
  room: string;
  /**
   * Random id chosen by the browser tab. Lets the server recognise a tab that
   * reconnects before its previous connection has timed out.
   */
  clientId: string;
}

export type JoinError =
  | "invalid-request"
  | "already-joined"
  | "room-full"
  | "server-error";

export type JoinResponse =
  | { ok: true; iceServers: IceServer[] }
  | { ok: false; error: JoinError };

export interface ClientToServerEvents {
  join: (request: JoinRequest, ack: (response: JoinResponse) => void) => void;
  offer: (description: SessionDescription) => void;
  answer: (description: SessionDescription) => void;
  candidate: (candidate: IceCandidate) => void;
}

export interface ServerToClientEvents {
  /** Another person joined the room; the recipient should send an offer. */
  "peer-joined": () => void;
  /** The other person left the room. */
  "peer-left": () => void;
  offer: (description: SessionDescription) => void;
  answer: (description: SessionDescription) => void;
  candidate: (candidate: IceCandidate) => void;
}

/**
 * Room names are case-insensitive, so "PurpleSquid" and "purplesquid" are the
 * same call.
 */
export function normalizeRoomName(name: string): string {
  return name.normalize("NFC").trim().toLowerCase();
}

export function isValidRoomName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= ROOM_NAME_MAX_LENGTH &&
    !ROOM_NAME_FORBIDDEN.test(name)
  );
}

/** Validates an untrusted join request and normalises its room name. */
export function parseJoinRequest(value: unknown): JoinRequest | null {
  if (!isRecord(value)) return null;
  const { room, clientId } = value;
  if (typeof room !== "string" || typeof clientId !== "string") return null;
  const normalizedRoom = normalizeRoomName(room);
  if (!isValidRoomName(normalizedRoom) || !CLIENT_ID_PATTERN.test(clientId)) {
    return null;
  }
  return { room: normalizedRoom, clientId };
}

export function isSessionDescription(
  value: unknown,
  type: SessionDescription["type"],
): value is SessionDescription {
  return (
    isRecord(value) &&
    value.type === type &&
    typeof value.sdp === "string" &&
    value.sdp.length <= SDP_MAX_LENGTH
  );
}

export function isIceCandidate(value: unknown): value is IceCandidate {
  return (
    isRecord(value) &&
    typeof value.candidate === "string" &&
    value.candidate.length <= CANDIDATE_MAX_LENGTH &&
    isOptional(value.sdpMid, "string") &&
    isOptional(value.sdpMLineIndex, "number") &&
    isOptional(value.usernameFragment, "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptional(value: unknown, type: "string" | "number"): boolean {
  return value === undefined || value === null || typeof value === type;
}
