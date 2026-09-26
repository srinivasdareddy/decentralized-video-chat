import { Store } from "../lib/store";

export type MediaProblem =
  "permission-denied" | "no-devices" | "device-in-use" | "insecure-context" | "unknown";

export interface LocalMediaState {
  status: "idle" | "requesting" | "ready" | "failed";
  problem: MediaProblem | null;
  /** What the self-view shows: the camera, or the screen while sharing. */
  preview: MediaStream | null;
  hasMicrophone: boolean;
  hasCamera: boolean;
  micOn: boolean;
  cameraOn: boolean;
  sharingScreen: boolean;
}

export const INITIAL_MEDIA_STATE: LocalMediaState = {
  status: "idle",
  problem: null,
  preview: null,
  hasMicrophone: false,
  hasCamera: false,
  micOn: false,
  cameraOn: false,
  sharingScreen: false,
};

export type TrackKind = "audio" | "video";
type TrackListener = (kind: TrackKind, track: MediaStreamTrack | null) => void;

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };
const CAMERA: MediaTrackConstraints = {
  facingMode: "user",
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

/**
 * The local camera, microphone, and screen share. Tells listeners whenever
 * the outgoing track of a kind changes so the call can swap it in without
 * renegotiating.
 */
export class LocalMedia {
  readonly store = new Store<LocalMediaState>(INITIAL_MEDIA_STATE);
  #microphone: MediaStreamTrack | null = null;
  #camera: MediaStreamTrack | null = null;
  #screen: MediaStreamTrack | null = null;
  readonly #listeners = new Set<TrackListener>();
  #disposed = false;

  /** Asks for the camera and microphone. Resolves to whether the call can go ahead. */
  async start(): Promise<boolean> {
    const { status } = this.store.get();
    if (status === "ready") return true;
    if (status === "requesting" || this.#disposed) return false;

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.store.set({ status: "failed", problem: "insecure-context" });
      return false;
    }

    this.store.set({ status: "requesting", problem: null });
    let stream: MediaStream;
    try {
      stream = await requestCameraAndMicrophone();
    } catch (error) {
      if (!this.#disposed) this.store.set({ status: "failed", problem: describeProblem(error) });
      return false;
    }
    if (this.#disposed) {
      stopTracks(stream);
      return false;
    }

    this.#microphone = stream.getAudioTracks()[0] ?? null;
    this.#camera = stream.getVideoTracks()[0] ?? null;
    for (const track of stream.getTracks()) this.#watchForLoss(track);
    this.store.set({
      status: "ready",
      hasMicrophone: this.#microphone !== null,
      hasCamera: this.#camera !== null,
      micOn: this.#microphone !== null,
      cameraOn: this.#camera !== null,
      preview: previewOf(this.#camera),
    });
    return true;
  }

  outgoingTrack(kind: TrackKind): MediaStreamTrack | null {
    return kind === "audio" ? this.#microphone : (this.#screen ?? this.#camera);
  }

  onTrackChange(listener: TrackListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  toggleMicrophone(): void {
    const microphone = this.#microphone;
    if (microphone === null) return;
    microphone.enabled = !microphone.enabled;
    this.store.set({ micOn: microphone.enabled });
  }

  toggleCamera(): void {
    const camera = this.#camera;
    if (camera === null) return;
    camera.enabled = !camera.enabled;
    this.store.set({ cameraOn: camera.enabled });
  }

  /** Resolves to false if the browser can't share or the person cancelled. */
  async startScreenShare(): Promise<boolean> {
    if (this.#screen !== null) return true;
    if (!navigator.mediaDevices?.getDisplayMedia) return false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return false; // Usually the person closed the picker.
    }
    const track = stream.getVideoTracks()[0];
    if (track === undefined || this.#disposed) {
      stopTracks(stream);
      return false;
    }
    // Favour sharpness over frame rate for text and UI.
    track.contentHint = "detail";
    // Fired when the person uses the browser's own "Stop sharing" button.
    track.addEventListener("ended", () => {
      if (this.#screen === track) this.stopScreenShare();
    });
    this.#screen = track;
    this.store.set({ sharingScreen: true, preview: previewOf(track) });
    this.#emit("video", track);
    return true;
  }

  stopScreenShare(): void {
    const screen = this.#screen;
    if (screen === null) return;
    this.#screen = null;
    screen.stop();
    this.store.set({ sharingScreen: false, preview: previewOf(this.#camera) });
    this.#emit("video", this.#camera);
  }

  dispose(): void {
    this.#disposed = true;
    this.#listeners.clear();
    for (const track of [this.#microphone, this.#camera, this.#screen]) track?.stop();
    this.#microphone = this.#camera = this.#screen = null;
  }

  #emit(kind: TrackKind, track: MediaStreamTrack | null): void {
    for (const listener of this.#listeners) listener(kind, track);
  }

  /** Picks up a replacement when a device is unplugged mid-call. */
  #watchForLoss(track: MediaStreamTrack): void {
    track.addEventListener("ended", () => void this.#replaceLostTrack(track));
  }

  async #replaceLostTrack(lost: MediaStreamTrack): Promise<void> {
    const kind = lost.kind === "audio" ? "audio" : "video";
    const current = kind === "audio" ? this.#microphone : this.#camera;
    if (this.#disposed || current !== lost) return;

    let replacement: MediaStreamTrack | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "audio" ? { audio: AUDIO } : { video: CAMERA },
      );
      replacement = stream.getTracks()[0] ?? null;
    } catch {
      // No other device available; carry on without this one.
    }
    const stillCurrent = (kind === "audio" ? this.#microphone : this.#camera) === lost;
    if (this.#disposed || !stillCurrent) {
      replacement?.stop();
      return;
    }

    if (replacement !== null) {
      replacement.enabled = lost.enabled;
      this.#watchForLoss(replacement);
    }
    if (kind === "audio") {
      this.#microphone = replacement;
      this.store.set({
        hasMicrophone: replacement !== null,
        micOn: replacement?.enabled ?? false,
      });
      this.#emit("audio", replacement);
    } else {
      this.#camera = replacement;
      this.store.set({
        hasCamera: replacement !== null,
        cameraOn: replacement?.enabled ?? false,
      });
      if (this.#screen === null) {
        this.store.set({ preview: previewOf(replacement) });
        this.#emit("video", replacement);
      }
    }
  }
}

/** Camera and microphone, falling back to whichever one is available. */
async function requestCameraAndMicrophone(): Promise<MediaStream> {
  const getUserMedia = (constraints: MediaStreamConstraints) =>
    navigator.mediaDevices.getUserMedia(constraints);
  try {
    return await getUserMedia({ audio: AUDIO, video: CAMERA });
  } catch (error) {
    if (!canFallBack(error)) throw error;
  }
  try {
    return await getUserMedia({ audio: AUDIO });
  } catch (error) {
    if (!canFallBack(error)) throw error;
  }
  return getUserMedia({ video: CAMERA });
}

/** Missing or busy devices; a permission refusal is final. */
function canFallBack(error: unknown): boolean {
  const name = errorName(error);
  return name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError";
}

function describeProblem(error: unknown): MediaProblem {
  switch (errorName(error)) {
    case "NotAllowedError":
    case "SecurityError":
      return "permission-denied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "no-devices";
    case "NotReadableError":
    case "AbortError":
      return "device-in-use";
    default:
      return "unknown";
  }
}

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
}

function previewOf(track: MediaStreamTrack | null): MediaStream | null {
  return track === null ? null : new MediaStream([track]);
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
