import { io, type Socket } from "socket.io-client";
import {
  isIceCandidate,
  isSessionDescription,
  type ClientToServerEvents,
  type IceCandidate,
  type IceServer,
  type JoinResponse,
  type ServerToClientEvents,
  type SessionDescription,
} from "../../shared/protocol";
import { Store } from "../lib/store";
import { startTranscriber, type Transcriber } from "./captions";
import type { LocalMedia, TrackKind } from "./local-media";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  decodePeerMessage,
  encodePeerMessage,
  type PeerMessage,
} from "./peer-messages";

export type CallStatus =
  /** Connecting to the server and joining the room. */
  | "joining"
  /** In the room alone. */
  | "waiting"
  /** Setting up the connection with the other person. */
  | "connecting"
  | "connected"
  /** The connection dropped and is being restored. */
  | "reconnecting"
  | "room-full"
  | "failed";

export interface ChatMessage {
  id: number;
  from: "me" | "peer";
  text: string;
}

export interface CallState {
  status: CallStatus;
  remoteStream: MediaStream | null;
  messages: ChatMessage[];
  /** Whether chat and captions can be used (the data channel is open). */
  peerChannelOpen: boolean;
  /** Whether we asked the other person to send captions. */
  captionsOn: boolean;
  /** The other person's latest caption while captions are on. */
  peerCaption: string;
  /** Whether our speech is being transcribed for the other person. */
  transcribing: boolean;
  peerAudioOn: boolean;
  peerVideoOn: boolean;
  /** Connecting is taking unusually long, e.g. a network blocks it. */
  slowToConnect: boolean;
}

export const INITIAL_CALL_STATE: CallState = {
  status: "joining",
  remoteStream: null,
  messages: [],
  peerChannelOpen: false,
  captionsOn: false,
  peerCaption: "",
  transcribing: false,
  peerAudioOn: true,
  peerVideoOn: true,
  slowToConnect: false,
};

/** One-off events worth telling the person about. */
export type CallNotice =
  | { type: "peer-left" }
  | { type: "captions-unavailable" }
  | { type: "transcribing-started" }
  | { type: "message"; text: string };

type SignalingSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const JOIN_TIMEOUT_MS = 10_000;
const JOIN_RETRY_MS = 2_000;
/** A dropped connection often recovers by itself (say, a Wi-Fi blip). */
const RECOVERY_GRACE_MS = 8_000;
/** Start over if a connection attempt hasn't succeeded by then. */
const CONNECT_TIMEOUT_MS = 20_000;
const CAPTION_HIDE_MS = 4_000;
const MAX_PENDING_CANDIDATES = 200;
const MAX_MESSAGES = 500;

/**
 * Identifies this tab to the signaling server, so a reconnect replaces the
 * tab's previous connection instead of counting as a second person.
 */
const CLIENT_ID =
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * A call in one room: talks to the signaling server, sets up the WebRTC
 * connection with the other person, and carries chat, captions, and
 * camera/microphone status over a data channel.
 *
 * Whoever was in the room first (the "initiator") sends offers; the other
 * side answers. When the connection fails, the initiator starts over with a
 * fresh RTCPeerConnection instead of reloading the page, so chat history
 * and local media survive network changes.
 */
export class CallSession {
  readonly store = new Store<CallState>(INITIAL_CALL_STATE);
  readonly #room: string;
  readonly #media: LocalMedia;
  readonly #socket: SignalingSocket;
  /** Groups our audio and video tracks for the other side. */
  readonly #outgoingStream = new MediaStream();
  readonly #noticeListeners = new Set<(notice: CallNotice) => void>();
  readonly #cleanups: (() => void)[] = [];

  #started = false;
  #disposed = false;
  #joined = false;
  #iceServers: IceServer[] = [];
  #iceTransportPolicy: RTCIceTransportPolicy = "all";
  #initiator = false;
  #pc: RTCPeerConnection | null = null;
  #channel: RTCDataChannel | null = null;
  /** Candidates that arrived before the connection could accept them. */
  #pendingCandidates: IceCandidate[] = [];
  /** An offer that arrived before our join finished. */
  #pendingOffer: SessionDescription | null = null;
  #transcriber: Transcriber | null = null;
  #lastSentMediaState = "";
  #nextMessageId = 1;
  #connectTimer: ReturnType<typeof setTimeout> | undefined;
  #captionTimer: ReturnType<typeof setTimeout> | undefined;
  #joinRetryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor({
    room,
    media,
    connect = () => io({ autoConnect: false }),
  }: {
    room: string;
    media: LocalMedia;
    connect?: () => SignalingSocket;
  }) {
    this.#room = room;
    this.#media = media;
    this.#socket = connect();
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;

    const socket = this.#socket;
    socket.on("connect", () => void this.#join());
    socket.on("disconnect", this.#onSignalingDisconnect);
    socket.on("peer-joined", this.#onPeerJoined);
    socket.on("peer-left", this.#onPeerLeft);
    socket.on("offer", this.#onOffer);
    socket.on("answer", (description) => void this.#onAnswer(description));
    socket.on("candidate", this.#onCandidate);
    this.#cleanups.push(
      this.#media.onTrackChange(this.#replaceTrack),
      this.#media.store.subscribe(() => this.#sendMediaState()),
    );
    socket.connect();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#socket.removeAllListeners();
    this.#socket.disconnect();
    this.#closePeerConnection();
    this.#stopTranscribing();
    for (const cleanup of this.#cleanups) cleanup();
    clearTimeout(this.#captionTimer);
    clearTimeout(this.#joinRetryTimer);
    this.#noticeListeners.clear();
  }

  onNotice(listener: (notice: CallNotice) => void): () => void {
    this.#noticeListeners.add(listener);
    return () => {
      this.#noticeListeners.delete(listener);
    };
  }

  /** Sends a chat message; returns false if the other person can't receive it yet. */
  sendChat(text: string): boolean {
    const trimmed = text.trim().slice(0, CHAT_MESSAGE_MAX_LENGTH);
    if (trimmed === "" || !this.#send({ type: "chat", text: trimmed })) return false;
    this.#addMessage("me", trimmed);
    return true;
  }

  /** Asks the other person to start or stop sending captions. */
  setCaptions(on: boolean): boolean {
    if (!this.#send({ type: "captions-request", enabled: on })) return false;
    clearTimeout(this.#captionTimer);
    this.store.set({ captionsOn: on, peerCaption: "" });
    return true;
  }

  // Signaling

  async #join(): Promise<void> {
    clearTimeout(this.#joinRetryTimer);
    this.#joined = false;
    // A fresh join never starts as the initiator; the server tells us with
    // "peer-joined" if someone arrives after us.
    this.#initiator = false;
    if (this.#pc === null) this.store.set({ status: "joining" });

    let response: JoinResponse;
    try {
      response = await this.#socket
        .timeout(JOIN_TIMEOUT_MS)
        .emitWithAck("join", { room: this.#room, clientId: CLIENT_ID });
    } catch {
      this.#retryJoinLater();
      return;
    }
    if (this.#disposed) return;

    if (!response.ok) {
      if (response.error === "room-full" || response.error === "invalid-request") {
        this.store.set({ status: response.error === "room-full" ? "room-full" : "failed" });
        this.#closePeerConnection();
        this.#socket.disconnect();
      } else {
        this.#retryJoinLater();
      }
      return;
    }

    this.#iceServers = response.iceServers;
    this.#iceTransportPolicy = response.iceTransportPolicy ?? "all";
    this.#joined = true;
    const offer = this.#pendingOffer;
    this.#pendingOffer = null;
    if (offer !== null) {
      void this.#answer(offer);
    } else if (this.#pc === null) {
      this.store.set({ status: "waiting" });
    }
  }

  /** Reconnects and joins again, for timeouts and transient server errors. */
  #retryJoinLater(): void {
    if (this.#disposed) return;
    this.#joinRetryTimer = setTimeout(() => {
      if (!this.#disposed) this.#socket.disconnect().connect();
    }, JOIN_RETRY_MS);
  }

  #onSignalingDisconnect = (reason: Socket.DisconnectReason): void => {
    this.#joined = false;
    const { status } = this.store.get();
    if (status === "room-full" || status === "failed" || this.#disposed) return;
    // The client reconnects by itself unless the server closed the connection.
    if (reason === "io server disconnect") this.#socket.connect();
    // An established call doesn't need the server; only update the status
    // if we weren't talking to anyone.
    if (this.#pc === null) this.store.set({ status: "joining" });
  };

  #onPeerJoined = (): void => {
    if (!this.#joined) return;
    this.#initiator = true;
    void this.#makeOffer();
  };

  #onPeerLeft = (): void => {
    this.#closePeerConnection();
    this.#pendingOffer = null;
    this.#pendingCandidates = [];
    this.#stopTranscribing();
    clearTimeout(this.#captionTimer);
    this.store.set({
      status: this.#joined ? "waiting" : "joining",
      remoteStream: null,
      peerChannelOpen: false,
      captionsOn: false,
      peerCaption: "",
      peerAudioOn: true,
      peerVideoOn: true,
      slowToConnect: false,
    });
    this.#emitNotice({ type: "peer-left" });
  };

  #onOffer = (description: unknown): void => {
    if (!isSessionDescription(description, "offer")) return;
    // Candidates for this offer always arrive after it.
    this.#pendingCandidates = [];
    this.#initiator = false;
    if (!this.#joined) {
      this.#pendingOffer = description;
      return;
    }
    void this.#answer(description);
  };

  async #onAnswer(description: unknown): Promise<void> {
    const pc = this.#pc;
    if (pc === null || !isSessionDescription(description, "answer")) return;
    if (pc.signalingState !== "have-local-offer") return;
    try {
      await pc.setRemoteDescription(description);
      if (pc === this.#pc) this.#flushCandidates(pc);
    } catch (error) {
      console.warn("Could not apply the answer", error);
    }
  }

  #onCandidate = (candidate: unknown): void => {
    if (!isIceCandidate(candidate)) return;
    const pc = this.#pc;
    if (pc?.remoteDescription) {
      pc.addIceCandidate(candidate).catch(ignoreStaleCandidate);
    } else if (this.#pendingCandidates.length < MAX_PENDING_CANDIDATES) {
      this.#pendingCandidates.push(candidate);
    }
  };

  // Peer connection

  async #makeOffer(): Promise<void> {
    this.#pendingCandidates = [];
    const pc = this.#createPeerConnection();
    for (const kind of ["audio", "video"] as const) {
      // A transceiver per kind, even without a track, so tracks can be
      // swapped later (screen sharing, a new camera) without renegotiating.
      pc.addTransceiver(this.#media.outgoingTrack(kind) ?? kind, {
        direction: "sendrecv",
        streams: [this.#outgoingStream],
      });
    }
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if (pc === this.#pc) this.#signal("offer", pc.localDescription);
    } catch (error) {
      console.warn("Could not create an offer", error);
    }
  }

  async #answer(offer: SessionDescription): Promise<void> {
    const pc = this.#createPeerConnection();
    try {
      await pc.setRemoteDescription(offer);
      if (pc !== this.#pc) return;
      this.#flushCandidates(pc);
      for (const transceiver of pc.getTransceivers()) {
        const kind = transceiver.receiver.track.kind;
        if (kind !== "audio" && kind !== "video") continue;
        transceiver.direction = "sendrecv";
        await transceiver.sender.replaceTrack(this.#media.outgoingTrack(kind));
        // Not in every browser; the other side copes without it.
        transceiver.sender.setStreams?.(this.#outgoingStream);
      }
      if (pc !== this.#pc) return;
      await pc.setLocalDescription(await pc.createAnswer());
      if (pc === this.#pc) this.#signal("answer", pc.localDescription);
    } catch (error) {
      console.warn("Could not answer the call", error);
    }
  }

  #createPeerConnection(): RTCPeerConnection {
    this.#closePeerConnection();
    const pc = new RTCPeerConnection({
      iceServers: this.#iceServers,
      iceTransportPolicy: this.#iceTransportPolicy,
    });
    this.#pc = pc;

    const remoteStream = new MediaStream();
    pc.ontrack = ({ track }) => {
      if (pc !== this.#pc) return;
      remoteStream.addTrack(track);
      this.store.set({ remoteStream });
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate !== null && pc === this.#pc && this.#socket.connected) {
        this.#socket.emit("candidate", candidate.toJSON() as IceCandidate);
      }
    };
    pc.onconnectionstatechange = () => this.#onConnectionStateChange(pc);

    // Negotiated with a fixed id on both sides, so neither has to wait for
    // the other to announce it.
    this.#setUpChannel(pc.createDataChannel("zipcall", { negotiated: true, id: 0 }));

    const { status } = this.store.get();
    this.store.set({
      status: status === "connected" || status === "reconnecting" ? "reconnecting" : "connecting",
      peerChannelOpen: false,
    });
    this.#armConnectTimer(CONNECT_TIMEOUT_MS);
    return pc;
  }

  #onConnectionStateChange(pc: RTCPeerConnection): void {
    if (pc !== this.#pc) return;
    switch (pc.connectionState) {
      case "connected":
        clearTimeout(this.#connectTimer);
        this.store.set({ status: "connected", slowToConnect: false });
        break;
      case "disconnected":
        this.store.set({ status: "reconnecting" });
        this.#armConnectTimer(RECOVERY_GRACE_MS);
        break;
      case "failed":
        this.store.set({ status: "reconnecting" });
        this.#restart();
        break;
      default:
        break;
    }
  }

  /** If we're not connected when the timer fires, start over. */
  #armConnectTimer(delay: number): void {
    clearTimeout(this.#connectTimer);
    this.#connectTimer = setTimeout(() => {
      if (this.#pc === null || this.#pc.connectionState === "connected") return;
      this.store.set({ slowToConnect: true });
      this.#restart();
    }, delay);
  }

  /** Starts over with a fresh connection; the other side waits for our offer. */
  #restart(): void {
    if (this.#initiator && this.#joined && !this.#disposed) void this.#makeOffer();
  }

  #closePeerConnection(): void {
    clearTimeout(this.#connectTimer);
    const pc = this.#pc;
    this.#pc = null;
    this.#channel = null;
    pc?.close();
  }

  #flushCandidates(pc: RTCPeerConnection): void {
    for (const candidate of this.#pendingCandidates.splice(0)) {
      pc.addIceCandidate(candidate).catch(ignoreStaleCandidate);
    }
  }

  #replaceTrack = (kind: TrackKind, track: MediaStreamTrack | null): void => {
    const transceiver = this.#pc
      ?.getTransceivers()
      .find((candidate) => candidate.receiver.track.kind === kind);
    transceiver?.sender
      .replaceTrack(track)
      .catch((error: unknown) => console.warn("Could not switch tracks", error));
  };

  #signal(event: "offer" | "answer", description: RTCSessionDescription | null): void {
    if (description === null || !this.#socket.connected) return;
    this.#socket.emit(event, { type: event, sdp: description.sdp });
  }

  // Data channel

  #setUpChannel(channel: RTCDataChannel): void {
    this.#channel = channel;
    channel.onopen = () => {
      if (channel !== this.#channel) return;
      this.store.set({ peerChannelOpen: true });
      this.#lastSentMediaState = "";
      this.#sendMediaState();
      // After a reconnect, ask for captions again if they were on.
      if (this.store.get().captionsOn) this.#send({ type: "captions-request", enabled: true });
    };
    channel.onclose = () => {
      if (channel === this.#channel) this.store.set({ peerChannelOpen: false });
    };
    channel.onmessage = ({ data }: MessageEvent) => {
      if (channel !== this.#channel) return;
      const message = decodePeerMessage(data);
      if (message !== null) this.#onPeerMessage(message);
    };
  }

  #onPeerMessage(message: PeerMessage): void {
    switch (message.type) {
      case "chat":
        this.#addMessage("peer", message.text);
        this.#emitNotice({ type: "message", text: message.text });
        break;
      case "caption":
        if (!this.store.get().captionsOn) return;
        this.store.set({ peerCaption: message.text });
        clearTimeout(this.#captionTimer);
        this.#captionTimer = setTimeout(() => this.store.set({ peerCaption: "" }), CAPTION_HIDE_MS);
        break;
      case "captions-request":
        if (message.enabled) this.#startTranscribing();
        else this.#stopTranscribing();
        break;
      case "captions-unavailable":
        this.store.set({ captionsOn: false, peerCaption: "" });
        this.#emitNotice({ type: "captions-unavailable" });
        break;
      case "media-state":
        this.store.set({ peerAudioOn: message.audio, peerVideoOn: message.video });
        break;
    }
  }

  #send(message: PeerMessage): boolean {
    const channel = this.#channel;
    if (channel?.readyState !== "open") return false;
    try {
      channel.send(encodePeerMessage(message));
      return true;
    } catch {
      return false;
    }
  }

  #sendMediaState(): void {
    const { hasMicrophone, micOn, hasCamera, cameraOn, sharingScreen } = this.#media.store.get();
    const audio = hasMicrophone && micOn;
    const video = sharingScreen || (hasCamera && cameraOn);
    const key = `${audio}/${video}`;
    if (key !== this.#lastSentMediaState && this.#send({ type: "media-state", audio, video })) {
      this.#lastSentMediaState = key;
    }
  }

  #addMessage(from: ChatMessage["from"], text: string): void {
    const messages = [...this.store.get().messages, { id: this.#nextMessageId++, from, text }];
    this.store.set({ messages: messages.slice(-MAX_MESSAGES) });
  }

  // Captions of our own speech, sent when the other person asks for them.

  #startTranscribing(): void {
    if (this.#transcriber !== null) return;
    this.#transcriber = startTranscriber({
      onText: (text) => this.#send({ type: "caption", text }),
      onUnavailable: () => {
        this.#stopTranscribing();
        this.#send({ type: "captions-unavailable" });
      },
    });
    if (this.#transcriber === null) {
      this.#send({ type: "captions-unavailable" });
      return;
    }
    this.store.set({ transcribing: true });
    this.#emitNotice({ type: "transcribing-started" });
  }

  #stopTranscribing(): void {
    this.#transcriber?.stop();
    this.#transcriber = null;
    if (this.store.get().transcribing) this.store.set({ transcribing: false });
  }

  #emitNotice(notice: CallNotice): void {
    for (const listener of this.#noticeListeners) listener(notice);
  }
}

function ignoreStaleCandidate(): void {
  // Candidates from an abandoned connection attempt are expected to fail.
}
