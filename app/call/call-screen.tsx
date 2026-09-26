import { Captions, Check, Link2, MicOff, User, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { LogoMark } from "../components/logo";
import { MessagePanel } from "../components/message-panel";
import { ToastViewport, useToast } from "../components/toasts";
import { copyText } from "../lib/clipboard";
import { useIdle } from "../lib/use-idle";
import type { CallNotice, CallState, CallStatus } from "./call-session";
import { ChatPanel } from "./chat-panel";
import { ControlBar } from "./control-bar";
import type { LocalMediaState, MediaProblem } from "./local-media";
import { SelfView } from "./self-view";
import { useCall } from "./use-call";
import { useVideoStream } from "./use-video-stream";

const NOTICES: Record<Exclude<CallNotice["type"], "message">, string> = {
  "peer-left": "The other person left the call.",
  "captions-unavailable":
    "Captions aren't available because the other person's browser can't transcribe speech.",
  "transcribing-started":
    "The other person turned on captions, so your browser is now transcribing what you say.",
};

const MEDIA_PROBLEMS: Record<MediaProblem, { title: string; description: string }> = {
  "permission-denied": {
    title: "Allow camera and microphone",
    description:
      "Zipcall needs your camera and microphone for the call. Allow access from your browser's address bar or site settings, then try again.",
  },
  "no-devices": {
    title: "No camera or microphone found",
    description: "Connect a camera or microphone, then try again.",
  },
  "device-in-use": {
    title: "Your camera or microphone is busy",
    description: "Another app may be using it. Close that app, then try again.",
  },
  "insecure-context": {
    title: "This page needs a secure connection",
    description:
      "Browsers only allow camera access over HTTPS. Open Zipcall with an https:// link (or on localhost while developing).",
  },
  unknown: {
    title: "Couldn't start your camera",
    description: "Something went wrong while starting your camera and microphone.",
  },
};

const STATUS: Record<
  CallStatus,
  { label: string; tone: "neutral" | "waiting" | "live" | "error" }
> = {
  joining: { label: "Connecting", tone: "neutral" },
  waiting: { label: "Waiting for someone to join", tone: "waiting" },
  connecting: { label: "Connecting", tone: "neutral" },
  connected: { label: "Connected", tone: "live" },
  reconnecting: { label: "Reconnecting", tone: "waiting" },
  "room-full": { label: "Call is full", tone: "error" },
  failed: { label: "Couldn't join", tone: "error" },
};

const SLOW_HINT =
  "This is taking longer than usual. If it doesn't connect, one of you may be on a network that blocks calls; try another network.";

const canShareScreen = () => typeof navigator.mediaDevices?.getDisplayMedia === "function";
const canPictureInPicture = () =>
  document.pictureInPictureEnabled || "webkitSetPresentationMode" in HTMLVideoElement.prototype;

export function CallScreen({ room }: { room: string }) {
  const navigate = useNavigate();
  const { media, call, actions } = useCall(room);
  const { toast, show: showToast } = useToast();
  const idle = useIdle(3000);
  const [chatOpen, setChatOpen] = useState(false);
  const [lastReadId, setLastReadId] = useState(0);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callLink = `${window.location.origin}/join/${encodeURIComponent(room)}`;

  const onPlaybackBlocked = useCallback(() => setSoundBlocked(true), []);
  useVideoStream(remoteVideoRef, call.remoteStream, onPlaybackBlocked);

  // Read by the notice listener, which outlives individual renders.
  const chatOpenRef = useRef(chatOpen);
  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  useEffect(
    () =>
      actions.onNotice((notice) => {
        if (notice.type !== "message") showToast(NOTICES[notice.type]);
        else if (!chatOpenRef.current) showToast(`New message: ${truncate(notice.text, 80)}`);
      }),
    [actions, showToast],
  );

  if (media.status === "failed") {
    const problem = MEDIA_PROBLEMS[media.problem ?? "unknown"];
    return (
      <FullScreenMessage
        title={problem.title}
        description={problem.description}
        actions={
          <>
            <button type="button" className="button button-primary" onClick={actions.retryMedia}>
              Try again
            </button>
            <Link to="/" className="button button-secondary">
              Back to home
            </Link>
          </>
        }
      />
    );
  }
  if (call.status === "room-full") {
    return (
      <FullScreenMessage
        title="This call is full"
        description="Calls are for two people, and two are already here. Check that you have the right link, or start a new call."
        actions={
          <Link to="/newcall" className="button button-primary">
            Start a new call
          </Link>
        }
      />
    );
  }
  if (call.status === "failed") {
    return (
      <FullScreenMessage
        title="Couldn't join this call"
        description="Check that the link is complete, then try again."
        actions={
          <Link to="/newcall" className="button button-primary">
            Start a new call
          </Link>
        }
      />
    );
  }

  const inCall = call.status === "connected" || call.status === "reconnecting";
  const showRemoteVideo = inCall && call.remoteStream !== null && call.peerVideoOn;
  const unreadMessages = chatOpen
    ? 0
    : call.messages.filter((message) => message.from === "peer" && message.id > lastReadId).length;

  const toggleChat = () => {
    if (chatOpen) setLastReadId(call.messages.at(-1)?.id ?? 0);
    setChatOpen(!chatOpen);
  };

  const toggleCaptions = () => {
    const turningOn = !call.captionsOn;
    if (actions.setCaptions(turningOn) && turningOn) {
      showToast("Captions are on. They'll appear when the other person speaks.");
    }
  };

  const togglePictureInPicture = async () => {
    const video = remoteVideoRef.current;
    if (video === null) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      } else {
        // Safari on iOS.
        const safariVideo = video as HTMLVideoElement & {
          webkitPresentationMode?: string;
          webkitSetPresentationMode?: (mode: string) => void;
        };
        safariVideo.webkitSetPresentationMode?.(
          safariVideo.webkitPresentationMode === "picture-in-picture"
            ? "inline"
            : "picture-in-picture",
        );
      }
    } catch {
      showToast("Picture in picture isn't available right now.");
    }
  };

  const status = STATUS[call.status];
  const hideChrome = idle && call.status === "connected" && !chatOpen;

  return (
    <div className={`call${hideChrome ? " is-idle" : ""}`}>
      <header className="call-topbar">
        {/* Opens in a new tab so clicking it doesn't end the call. */}
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="call-brand"
          aria-label="Zipcall home"
        >
          <LogoMark size={20} />
        </a>
        <div className="call-heading">
          <h1 className="call-room">{room}</h1>
          <span className={`call-status tone-${status.tone}`}>
            <span className="status-dot" aria-hidden="true" />
            {status.label}
          </span>
        </div>
        {call.transcribing && (
          <span className="call-pill">
            <Captions size={14} aria-hidden="true" />
            Captioning you
          </span>
        )}
        <CopyLinkButton
          link={callLink}
          className="button button-secondary button-small call-copy"
        />
      </header>

      <div className="call-body">
        <main className="call-stage">
          <video
            ref={remoteVideoRef}
            className="remote-video"
            hidden={!showRemoteVideo}
            autoPlay
            playsInline
          />
          <StageOverlay media={media} call={call} callLink={callLink} />
          {inCall && !call.peerAudioOn && (
            <span className="stage-badge">
              <MicOff size={14} aria-hidden="true" />
              Muted
            </span>
          )}
          {call.captionsOn && call.peerCaption !== "" && (
            <p className="caption" aria-live="polite">
              {call.peerCaption}
            </p>
          )}
          {soundBlocked && inCall && (
            <button
              type="button"
              className="button button-primary sound-button"
              onClick={() => {
                void remoteVideoRef.current?.play();
                setSoundBlocked(false);
              }}
            >
              <Volume2 size={18} aria-hidden="true" />
              Turn on sound
            </button>
          )}
          {media.status === "ready" && <SelfView media={media} />}
          <ControlBar
            media={media}
            connected={call.status === "connected" && call.peerChannelOpen}
            captionsOn={call.captionsOn}
            chatOpen={chatOpen}
            unreadMessages={unreadMessages}
            canShareScreen={canShareScreen()}
            canPictureInPicture={canPictureInPicture()}
            onToggleMicrophone={actions.toggleMicrophone}
            onToggleCamera={actions.toggleCamera}
            onToggleScreenShare={() => void actions.toggleScreenShare()}
            onToggleCaptions={toggleCaptions}
            onPictureInPicture={() => void togglePictureInPicture()}
            onToggleChat={toggleChat}
            onLeave={() => void navigate("/newcall")}
          />
        </main>
        {chatOpen && (
          <ChatPanel
            messages={call.messages}
            canSend={call.peerChannelOpen}
            onSend={actions.sendChat}
            onClose={toggleChat}
          />
        )}
      </div>
      <ToastViewport toast={toast} />
    </div>
  );
}

/** What the stage shows before and around the other person's video. */
function StageOverlay({
  media,
  call,
  callLink,
}: {
  media: LocalMediaState;
  call: CallState;
  callLink: string;
}) {
  if (media.status !== "ready") {
    return (
      <StageMessage
        title="Allow camera and microphone"
        text="Your browser will ask to use your camera and microphone for the call."
      />
    );
  }
  switch (call.status) {
    case "waiting":
      return (
        <StageMessage
          title="Waiting for someone to join"
          text="Share this link with the person you want to talk to."
        >
          <div className="invite-link">
            <span className="invite-url">{callLink}</span>
            <CopyLinkButton link={callLink} className="button button-primary button-small" />
          </div>
        </StageMessage>
      );
    case "joining":
      return <StageMessage busy title="Connecting" />;
    case "connecting":
      return (
        <StageMessage
          busy
          title="Connecting to the other person"
          text={call.slowToConnect ? SLOW_HINT : undefined}
        />
      );
    case "reconnecting":
      return (
        <StageMessage
          busy
          dim
          title="Reconnecting"
          text={call.slowToConnect ? SLOW_HINT : undefined}
        />
      );
    case "connected":
      return call.peerVideoOn ? null : (
        <div className="stage-message">
          <span className="stage-avatar">
            <User size={36} aria-hidden="true" />
          </span>
          <p className="stage-text">Their camera is off</p>
        </div>
      );
    default:
      return null;
  }
}

function StageMessage({
  title,
  text,
  busy = false,
  dim = false,
  children,
}: {
  title: string;
  text?: string;
  busy?: boolean;
  dim?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`stage-message${dim ? " is-dim" : ""}`}>
      {busy && <div className="spinner" aria-hidden="true" />}
      <h2 className="stage-title">{title}</h2>
      {text && <p className="stage-text">{text}</p>}
      {children}
    </div>
  );
}

function CopyLinkButton({ link, className }: { link: string; className: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button type="button" className={className} onClick={() => void copyText(link).then(setCopied)}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function FullScreenMessage(props: { title: string; description: string; actions: ReactNode }) {
  return (
    <main className="message-page">
      <MessagePanel {...props} />
    </main>
  );
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
