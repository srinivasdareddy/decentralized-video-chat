import {
  ArrowRight,
  Captions,
  Globe,
  Link2,
  Lock,
  MessageSquare,
  Mic,
  MonitorUp,
  PhoneOff,
  User,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/home";

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Zipcall · Video calls in your browser",
    description:
      "Free peer-to-peer video calls in your browser. Pick a name, share the link, and start talking. No downloads, no sign-up.",
  });

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Zap,
    title: "Peer-to-peer",
    text: "Audio and video go straight between browsers whenever the network allows, for the lowest latency.",
  },
  {
    icon: Lock,
    title: "Encrypted by default",
    text: "Every call is encrypted with DTLS-SRTP, the standard built into WebRTC.",
  },
  {
    icon: Globe,
    title: "Nothing to install",
    text: "Works in any modern browser on desktop and mobile. No apps, no accounts.",
  },
  {
    icon: MonitorUp,
    title: "Screen sharing",
    text: "Share a tab, a window, or your whole screen in one click.",
  },
  {
    icon: Captions,
    title: "Chat and live captions",
    text: "Send messages and links during the call, and turn on captions when you need them.",
  },
  {
    icon: Link2,
    title: "One link per call",
    text: "Each call has its own link for two people. Nothing is stored once you hang up.",
  },
];

const STEPS = [
  { title: "Pick a name", text: "Choose a name for your call, or use the one we suggest." },
  { title: "Share the link", text: "Send the link to the person you want to talk to." },
  { title: "Start talking", text: "When they open it, you're connected. That's it." },
];

export default function Home() {
  return (
    <>
      <section className="hero container">
        <p className="eyebrow">Free · No sign-up · Peer-to-peer</p>
        <h1 className="hero-title">Video calls, straight from your browser.</h1>
        <p className="lead">
          Pick a name, share the link, and start talking. Zipcall connects you directly to the other
          person, with nothing to install.
        </p>
        <div className="hero-actions">
          <Link to="/newcall" className="button button-primary">
            Start a call
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <a href="#how-it-works" className="button button-secondary">
            How it works
          </a>
        </div>
        <CallPreview />
      </section>

      <section className="section container" aria-labelledby="features-title">
        <h2 id="features-title" className="section-title">
          Everything a call needs, nothing it doesn't
        </h2>
        <ul className="feature-grid">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="feature">
              <span className="feature-icon">
                <Icon size={20} aria-hidden="true" />
              </span>
              <h3 className="feature-title">{title}</h3>
              <p className="feature-text">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how-it-works" className="section container" aria-labelledby="steps-title">
        <h2 id="steps-title" className="section-title">
          How it works
        </h2>
        <ol className="steps">
          {STEPS.map(({ title, text }, index) => (
            <li key={title} className="step">
              <span className="step-number">{index + 1}</span>
              <h3 className="feature-title">{title}</h3>
              <p className="feature-text">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section container closing">
        <h2 className="section-title">Ready when you are.</h2>
        <Link to="/newcall" className="button button-primary">
          Start a call
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>
    </>
  );
}

/** A static sketch of the call screen. */
function CallPreview() {
  const controls = [Mic, Video, MonitorUp, MessageSquare];
  return (
    <div className="call-preview" aria-hidden="true">
      <div className="call-preview-avatar">
        <User size={36} />
      </div>
      <div className="call-preview-self" />
      <div className="call-preview-controls">
        {controls.map((Icon, index) => (
          <span key={index} className="call-preview-button">
            <Icon size={16} />
          </span>
        ))}
        <span className="call-preview-button call-preview-leave">
          <PhoneOff size={16} />
        </span>
      </div>
    </div>
  );
}
