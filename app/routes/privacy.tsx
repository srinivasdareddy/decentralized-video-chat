import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/privacy";

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Privacy · Zipcall",
    description:
      "How Zipcall handles your data: calls go directly between browsers, encrypted, and nothing is stored.",
  });

export default function Privacy() {
  return (
    <article className="container prose">
      <h1>Privacy</h1>
      <p className="prose-lead">
        Zipcall is built to know as little about your calls as possible. There are no accounts, no
        cookies, and no analytics, and nothing you say or show in a call is recorded or stored.
      </p>

      <h2>Your call goes straight to the other person</h2>
      <p>
        Audio, video, and chat are encrypted by your browser (with WebRTC&apos;s DTLS-SRTP) and sent
        directly to the other person whenever your networks allow it. When they don&apos;t, the call
        passes through a relay server, still encrypted, so the relay can&apos;t see or hear it.
      </p>

      <h2>What the server sees</h2>
      <p>
        To introduce the two of you, the server sees your IP address and the name of the call you
        join, and passes connection details between your browsers. It keeps a call&apos;s name in
        memory only while someone is in the call.
      </p>
      <p>
        Server logs record events like joining and leaving a call, with the call&apos;s name
        replaced by a one-way hash. IP addresses are logged only when rate limits turn away abuse.
        How long logs are kept is up to whoever runs this site.
      </p>

      <h2>What the other person sees</h2>
      <p>
        With a direct connection, each browser learns the other&apos;s IP address, as with any
        peer-to-peer connection. This site can be set up to send every call through its relay, so
        that neither person sees the other&apos;s address.
      </p>

      <h2>Captions</h2>
      <p>
        When the other person turns on captions, your browser transcribes your speech with its
        built-in speech recognition, and Zipcall shows that it&apos;s captioning you. Some browsers,
        including Chrome, send the audio to their maker&apos;s servers to do this.
      </p>

      <h2>On your device</h2>
      <p>
        Zipcall remembers the camera, microphone, and speaker you chose, in your browser&apos;s
        storage on this device. Clearing this site&apos;s data in your browser removes it.
      </p>

      <h2>Other services</h2>
      <p>
        To find a way to connect, your browser contacts a STUN server (Google&apos;s public one,
        unless this site uses another) and, when a direct connection isn&apos;t possible, a relay
        run by this site or a provider such as Twilio. These services see your IP address.
      </p>

      <p className="prose-note">
        This page describes how the Zipcall software handles data. It&apos;s{" "}
        <a href="https://github.com/ianramzy/decentralized-video-chat">open source</a>, so you can
        check.
      </p>
    </article>
  );
}
