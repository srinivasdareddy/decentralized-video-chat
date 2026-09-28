import { useEffect, type RefObject } from "react";

/**
 * Plays `stream` in a <video> element. Calls `onPlaybackBlocked` if the
 * browser refuses to autoplay (it wants a click before playing sound).
 */
export function useVideoStream(
  videoRef: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
  onPlaybackBlocked?: () => void,
): void {
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    if (stream === null) return;
    video.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        onPlaybackBlocked?.();
      }
    });
  }, [videoRef, stream, onPlaybackBlocked]);
}
