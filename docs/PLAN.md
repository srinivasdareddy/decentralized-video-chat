# Serverless Multi-Screen-Share + Group Audio PWA — Plan

## 1. Context

Goal: a room where **several people share their screens at the same time** while **all talking**, with **no server infrastructure**, delivered as a **web app installable as a PWA**.

The original proposal was Pear (Holepunch). This document records why Pear cannot satisfy the PWA requirement, and specifies the architecture that delivers the same core idea in the browser.

This repo previously held Zipcall (source removed post-acquisition). Nothing here is reused — this is a greenfield project.

## 2. The hard constraint: Pear vs PWA

Pear is not usable for a browser-based PWA. This is structural, not a difficulty:

| Requirement | Pear reality |
|---|---|
| Runs in a browser | Pear targets **desktop, terminal, mobile** runtimes only. No web target. |
| Transport | Hyperswarm/HyperDHT holepunch over **raw UDP (UDX)**. Browsers cannot open UDP sockets — no API exists, by design. |
| Browser bridge | `hyperswarm-dht-relay` exists, but needs a **WebSocket relay server you run** (defeats "no servers") and is flagged *"Do not use it in production."* |
| Install model | Pear apps are downloaded desktop binaries, not `beforeinstallprompt` PWAs. |

**Conclusion:** Pear ⇒ desktop app. PWA ⇒ WebRTC. Cannot have both in one artifact.

The core idea itself is proven viable — Keet (Holepunch's own app) does serverless P2P calls with screen share. The question was only ever the transport.

## 3. What "no servers" honestly means in a browser

Decompose it — the parts have different answers:

| Concern | Server needed? | How |
|---|---|---|
| **Media** (audio + screen video) | **No** | WebRTC `RTCPeerConnection`, direct peer-to-peer, DTLS-SRTP encrypted. Never transits a server. |
| **Signaling** (SDP/ICE exchange) | **None that we own** | Trystero rides public **Nostr** relays (default), BitTorrent trackers, or MQTT brokers. No account, no deploy, no cost. |
| **NAT discovery (STUN)** | **None that we own** | Free public STUN (`stun.l.google.com:19302` et al). Tiny UDP ping; carries no media. |
| **Symmetric-NAT fallback (TURN)** | Optional | ~8–15% of peer pairs cannot hole-punch. Without TURN those pairs simply fail to connect. **Decision: ship without TURN**, detect the failure, and tell the user plainly. Revisit only if real usage demands it. |
| **App hosting** | Static only | Plain static files on any CDN/Pages host. No backend, no database, no state. |

So: **zero servers we operate**, and **zero servers that ever see media**. That is the strongest honest form of the claim in a browser, and it is materially the same guarantee Pear gives for user data.

## 4. Architecture

```
┌──────────── Browser PWA (static, installable) ────────────┐
│                                                            │
│  Capture          getUserMedia({audio})                    │
│                   getDisplayMedia({video})  ← per share    │
│                                                            │
│  Mesh             RTCPeerConnection × (N-1)                │
│                   ├─ audio track   (Opus, always on)       │
│                   └─ screen tracks (VP8/VP9, 0..k per peer)│
│                                                            │
│  Matchmaking      Trystero → Nostr relay (public)          │
│                   room = hash(roomId); SDP/ICE only        │
│                                                            │
│  Control plane    Trystero data channel                    │
│                   presence, names, mute, share start/stop  │
└────────────────────────────────────────────────────────────┘
```

**Topology: full mesh.** Every peer connects directly to every other. No SFU, because an SFU is a server — and a server is what we are refusing.

**Multiple simultaneous screens** is the distinguishing feature and drives the design: a peer may publish *more than one* video track (its own screen(s)) alongside its audio. Track→owner→purpose mapping travels over the Trystero data channel, keyed by `MediaStreamTrack.id`, because WebRTC alone gives no semantic labels. Every peer therefore renders a grid of *all* live screens from *all* sharers concurrently — not a single "active speaker" view.

## 5. Scaling reality (the real limit)

Mesh cost is quadratic in the room, linear per peer. With every participant sharing a screen at ~2 Mbps and audio at ~40 kbps, each peer must **upload** `(N-1) × 2.04 Mbps`:

| Room size | Upload per peer | Verdict |
|---|---|---|
| 3 | ~4 Mbps | Comfortable |
| 4 | ~6 Mbps | Fine on most connections |
| 5 | ~8 Mbps | Upper edge of typical home upload |
| 6 | ~10 Mbps | Strained |
| 8+ | ~14 Mbps+ | Not viable without an SFU |

**Design target: 4–6 participants.** This is the honest ceiling of serverless mesh and should be enforced in the UI, not discovered by users mid-call.

Mitigations that keep us serverless:
- Cap screen encode at 1080p/10–15fps (screens are mostly static; framerate is worth far less than resolution here).
- `contentHint = 'detail'` on screen tracks for text sharpness.
- Adaptive bitrate via `RTCRtpSender.setParameters` when peer count rises.
- Only publish a screen track when actually sharing; tear it down on stop.

## 6. Stack

Deliberately thin — no framework lock-in, no build-time magic:

- **Vite** + vanilla TS (fast, static output, zero runtime deps)
- **Trystero** — serverless WebRTC matchmaking (Nostr strategy)
- **vite-plugin-pwa** (Workbox) — manifest, service worker, install prompt
- Native `RTCPeerConnection` / `getDisplayMedia` — no WebRTC wrapper library

## 7. Milestones

1. **Scaffold** — Vite + TS, static build, deploys to any static host.
2. **PWA shell** — manifest (icons, `display: standalone`), service worker precache, custom install button via `beforeinstallprompt`. Verify installability in Lighthouse.
3. **Room + presence** — Trystero join by room code, peer list, display names over data channel.
4. **Group audio** — `getUserMedia({audio})`, mesh audio, mute, per-peer speaking indicator via `AnalyserNode`.
5. **Single screen share** — `getDisplayMedia`, `addTrack`, render remote screen. Track↔owner mapping over data channel.
6. **Multi-share (core feature)** — several peers sharing concurrently; responsive grid; per-tile pin/fullscreen.
7. **Resilience** — ICE failure detection with an explicit "couldn't connect directly (strict NAT)" message; reconnect; room-size cap with warning.
8. **Polish** — device pickers, keyboard shortcuts, dark mode, PiP.

Feature-complete on the core idea at milestone 6; 1–5 are the runway.

## 8. Known limitations (state these in the README, not in a support thread)

- **iOS/iPadOS Safari cannot screen share.** `getDisplayMedia` is unimplemented. iOS users can install the PWA, talk, and *view* others' screens — but cannot share their own. No workaround exists on the open web.
- **~10% of peer pairs won't connect** without TURN (symmetric NAT, some corporate networks).
- **4–6 participant ceiling**, per the mesh math above.
- Public Nostr relays are best-effort; Trystero should be configured with several for redundancy.

## 9. Verification

- `npm run build && npm run preview` — served over HTTPS (required for `getUserMedia`, `getDisplayMedia`, and service workers).
- **Install:** Chrome/Edge desktop + Android — install prompt appears, launches standalone, works offline to the room-join screen.
- **Two-peer:** two browser profiles, same room code — audio both directions, one screen shared and visible.
- **Multi-share (the actual acceptance test):** three peers, at least two sharing screens *simultaneously*, all on audio. Confirm every peer sees every live screen at once and hears everyone.
- **Cross-network:** peers on genuinely different networks (not just two tabs) to exercise real NAT traversal.
- **`chrome://webrtc-internals`** to confirm bitrates, resolution, and that no relay candidate is in use.

## 10. If the zero-server guarantee outranks the PWA requirement

Then the answer flips to a **Pear desktop app**: Electron + `pear-runtime`, a Bare worker owning Hyperswarm, renderer doing capture and WebCodecs encode/decode, media framed over Protomux on the Noise stream. True DHT-based zero-infrastructure, no STUN/TURN, no public relays — but a downloaded desktop app, not an installable web app, and substantially more work (hand-rolled media pipeline instead of WebRTC's built-in congestion control, jitter buffer, and echo cancellation).

Both paths are viable. They cannot be the same artifact.
