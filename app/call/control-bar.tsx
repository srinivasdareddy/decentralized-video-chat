import {
  Captions,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  PictureInPicture2,
  Settings,
  Video,
  VideoOff,
  type LucideIcon,
} from "lucide-react";
import { SHORTCUT_KEYS, shortcutAria, shortcutLabel } from "../lib/shortcuts";
import type { LocalMediaState } from "./local-media";

export interface ControlBarProps {
  media: LocalMediaState;
  connected: boolean;
  captionsOn: boolean;
  chatOpen: boolean;
  unreadMessages: number;
  canShareScreen: boolean;
  canPictureInPicture: boolean;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleCaptions: () => void;
  onPictureInPicture: () => void;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  onLeave: () => void;
}

export function ControlBar(props: ControlBarProps) {
  const { media, connected } = props;
  const micOn = media.hasMicrophone && media.micOn;
  const cameraOn = media.hasCamera && media.cameraOn;

  return (
    <div className="control-bar" role="toolbar" aria-label="Call controls">
      <ControlButton
        icon={micOn ? Mic : MicOff}
        label={micOn ? "Turn off microphone" : "Turn on microphone"}
        tone={micOn ? "default" : "off"}
        disabled={!media.hasMicrophone}
        shortcut={SHORTCUT_KEYS.microphone}
        onClick={props.onToggleMicrophone}
      />
      <ControlButton
        icon={cameraOn ? Video : VideoOff}
        label={cameraOn ? "Turn off camera" : "Turn on camera"}
        tone={cameraOn ? "default" : "off"}
        disabled={!media.hasCamera}
        shortcut={SHORTCUT_KEYS.camera}
        onClick={props.onToggleCamera}
      />
      {props.canShareScreen && (
        <ControlButton
          icon={MonitorUp}
          label={media.sharingScreen ? "Stop sharing" : "Share screen"}
          tone={media.sharingScreen ? "active" : "default"}
          onClick={props.onToggleScreenShare}
        />
      )}
      <ControlButton
        icon={Captions}
        label={props.captionsOn ? "Turn off captions" : "Turn on captions"}
        tone={props.captionsOn ? "active" : "default"}
        disabled={!connected}
        onClick={props.onToggleCaptions}
      />
      {props.canPictureInPicture && (
        <ControlButton
          icon={PictureInPicture2}
          label="Picture in picture"
          disabled={!connected}
          onClick={props.onPictureInPicture}
        />
      )}
      <ControlButton
        icon={MessageSquare}
        label={props.chatOpen ? "Hide chat" : "Show chat"}
        tone={props.chatOpen ? "active" : "default"}
        badge={props.chatOpen ? 0 : props.unreadMessages}
        onClick={props.onToggleChat}
      />
      <ControlButton icon={Settings} label="Settings" onClick={props.onOpenSettings} />
      <button
        type="button"
        className="control control-leave"
        onClick={props.onLeave}
        aria-label="Leave call"
        data-tooltip="Leave call"
      >
        <PhoneOff size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

function ControlButton({
  icon: Icon,
  label,
  tone = "default",
  disabled = false,
  badge = 0,
  shortcut,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  tone?: "default" | "off" | "active";
  disabled?: boolean;
  badge?: number;
  /** Pressed with Ctrl or ⌘. */
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`control control-${tone}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={badge > 0 ? `${label} (${badge} unread)` : label}
      aria-keyshortcuts={shortcut === undefined ? undefined : shortcutAria(shortcut)}
      data-tooltip={shortcut === undefined ? label : `${label} (${shortcutLabel(shortcut)})`}
    >
      <Icon size={20} aria-hidden="true" />
      {badge > 0 && <span className="control-badge">{badge > 9 ? "9+" : badge}</span>}
    </button>
  );
}
