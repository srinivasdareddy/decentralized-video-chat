import { findDevice, type DevicePreferences } from "../lib/device-preferences";
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
  /** The devices in use, as reported by the browser. */
  cameraId: string | null;
  microphoneId: string | null;
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
  cameraId: null,
  microphoneId: null,
};

export type TrackKind = "audio" | "video";
type TrackListener = (kind: TrackKind, track: MediaStreamTrack | null) => void;

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };
const CAMERA: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };

/** A particular microphone, or else the default one. */
function microphoneConstraints(deviceId?: string | null): MediaTrackConstraints {
  return deviceId == null ? AUDIO : { ...AUDIO, deviceId: { exact: deviceId } };
}

/** A particular camera, or else the front one. */
function cameraConstraints(deviceId?: string | null): MediaTrackConstraints {
  return deviceId == null
    ? { ...CAMERA, facingMode: "user" }
    : { ...CAMERA, deviceId: { exact: deviceId } };
}

const constraintsFor = (kind: TrackKind, deviceId?: string | null) =>
  kind === "audio" ? microphoneConstraints(deviceId) : cameraConstraints(deviceId);

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
  readonly #preferred: Pick<DevicePreferences, "camera" | "microphone">;
  #disposed = false;

  /** `preferred`: devices chosen before, used if they're still there. */
  constructor(preferred: Pick<DevicePreferences, "camera" | "microphone"> = {}) {
    this.#preferred = preferred;
  }

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
      stream = await requestCameraAndMicrophone(await this.#findPreferredDevices());
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
      cameraId: deviceIdOf(this.#camera),
      microphoneId: deviceIdOf(this.#microphone),
    });
    return true;
  }

  async #findPreferredDevices(): Promise<{ cameraId?: string; microphoneId?: string }> {
    const { camera, microphone } = this.#preferred;
    if (camera === undefined && microphone === undefined) return {};
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    return {
      cameraId: findDevice(devices, "videoinput", camera),
      microphoneId: findDevice(devices, "audioinput", microphone),
    };
  }

  /** Switches to another camera. Resolves to false if it couldn't be opened. */
  switchCamera(deviceId: string): Promise<boolean> {
    return this.#switchDevice("video", deviceId);
  }

  /** Switches to another microphone. Resolves to false if it couldn't be opened. */
  switchMicrophone(deviceId: string): Promise<boolean> {
    return this.#switchDevice("audio", deviceId);
  }

  async #switchDevice(kind: TrackKind, deviceId: string): Promise<boolean> {
    const current = kind === "audio" ? this.#microphone : this.#camera;
    if (this.#disposed || deviceIdOf(current) === deviceId) return true;
    const open = (id: string | null) =>
      navigator.mediaDevices.getUserMedia({ [kind]: constraintsFor(kind, id) }).then(
        (stream) => stream.getTracks()[0] ?? null,
        () => null,
      );

    // Stop the current device first: phones can't open two cameras at once.
    current?.stop();
    let track = await open(deviceId);
    // If the new device fails, go back to the one we had.
    track ??= await open(deviceIdOf(current));
    if (this.#disposed) {
      track?.stop();
      return false;
    }
    if (track !== null) {
      track.enabled = current?.enabled ?? true;
      this.#watchForLoss(track);
    }
    this.#adopt(kind, track);
    return deviceIdOf(track) === deviceId;
  }

  /** Makes `track` the current device of its kind and tells the call. */
  #adopt(kind: TrackKind, track: MediaStreamTrack | null): void {
    if (kind === "audio") {
      this.#microphone = track;
      this.store.set({
        hasMicrophone: track !== null,
        micOn: track?.enabled ?? false,
        microphoneId: deviceIdOf(track),
      });
      this.#emit("audio", track);
      return;
    }
    this.#camera = track;
    this.store.set({
      hasCamera: track !== null,
      cameraOn: track?.enabled ?? false,
      cameraId: deviceIdOf(track),
    });
    // While sharing the screen, the camera takes over again when sharing stops.
    if (this.#screen === null) {
      this.store.set({ preview: previewOf(track) });
      this.#emit("video", track);
    }
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
      const stream = await navigator.mediaDevices.getUserMedia({ [kind]: constraintsFor(kind) });
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
    this.#adopt(kind, replacement);
  }
}

/**
 * Camera and microphone: the chosen devices if they're still there, else the
 * defaults, falling back to whichever one is available.
 */
async function requestCameraAndMicrophone(preferred: {
  cameraId?: string;
  microphoneId?: string;
}): Promise<MediaStream> {
  const getUserMedia = (constraints: MediaStreamConstraints) =>
    navigator.mediaDevices.getUserMedia(constraints);
  // Asked for exactly: browsers may pass over a device that's only "ideal".
  if (preferred.cameraId !== undefined || preferred.microphoneId !== undefined) {
    try {
      return await getUserMedia({
        audio: microphoneConstraints(preferred.microphoneId),
        video: cameraConstraints(preferred.cameraId),
      });
    } catch (error) {
      if (!canFallBack(error)) throw error;
    }
  }
  const audio = microphoneConstraints();
  const video = cameraConstraints();
  try {
    return await getUserMedia({ audio, video });
  } catch (error) {
    if (!canFallBack(error)) throw error;
  }
  try {
    return await getUserMedia({ audio });
  } catch (error) {
    if (!canFallBack(error)) throw error;
  }
  return getUserMedia({ video });
}

function deviceIdOf(track: MediaStreamTrack | null): string | null {
  return track?.getSettings().deviceId ?? null;
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
