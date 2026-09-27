import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  findDevice,
  loadDevicePreferences,
  saveDevicePreference,
  type DeviceChoice,
} from "../lib/device-preferences";

/** Whether the browser can play audio through a chosen speaker. */
export const canChooseSpeaker = () =>
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

/**
 * Plays the other person through the speaker chosen in settings, remembered
 * between calls. Re-applied whenever `stream` changes, since the video
 * element may not have existed when the speaker was chosen.
 */
export function useSpeaker(
  videoRef: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
) {
  const [choice, setChoice] = useState(() => loadDevicePreferences().speaker ?? null);
  const [speakerId, setSpeakerId] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null || choice === null || !canChooseSpeaker()) return;
    let current = true;
    navigator.mediaDevices
      .enumerateDevices()
      .then(async (devices) => {
        const id = findDevice(devices, "audiooutput", choice);
        if (id === undefined || !current) return;
        await video.setSinkId(id);
        if (current) setSpeakerId(id);
      })
      .catch(() => {
        // The speaker may have been unplugged; keep playing through the current one.
      });
    return () => {
      current = false;
    };
  }, [videoRef, choice, stream]);

  const selectSpeaker = useCallback((device: DeviceChoice) => {
    setChoice(device);
    saveDevicePreference("speaker", device);
  }, []);

  return { speakerId, selectSpeaker };
}
