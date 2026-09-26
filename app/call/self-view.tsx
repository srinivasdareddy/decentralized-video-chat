import { MicOff, VideoOff } from "lucide-react";
import { useRef } from "react";
import { useDraggable } from "../lib/use-draggable";
import type { LocalMediaState } from "./local-media";
import { useVideoStream } from "./use-video-stream";

/** The draggable preview of what the other person sees. */
export function SelfView({ media }: { media: LocalMediaState }) {
  const { ref, style, handlers, dragging } = useDraggable<HTMLDivElement>();
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoStream(videoRef, media.preview);

  const showVideo = media.preview !== null && (media.sharingScreen || media.cameraOn);
  const classes = ["self-view", dragging ? "is-dragging" : ""].join(" ").trim();

  return (
    <div ref={ref} className={classes} style={style} {...handlers} title="Drag to move">
      <video
        ref={videoRef}
        // Mirror the camera like a mirror would, but never a shared screen.
        className={`self-view-video${media.sharingScreen ? "" : " is-mirrored"}`}
        hidden={!showVideo}
        autoPlay
        playsInline
        muted
      />
      {!showVideo && (
        <div className="self-view-placeholder">
          <VideoOff size={18} aria-hidden="true" />
          <span>{media.hasCamera ? "Camera off" : "No camera"}</span>
        </div>
      )}
      <span className="self-view-label">You{media.sharingScreen ? " · sharing screen" : ""}</span>
      {!(media.hasMicrophone && media.micOn) && (
        <span className="self-view-muted" aria-label="Microphone off">
          <MicOff size={14} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
