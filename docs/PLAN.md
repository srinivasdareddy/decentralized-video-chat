# Serverless Multi-Screen-Share + Group Audio — Plan

## 1. Context

Goal: a room where **several people share their screens at the same time** while **all talking**, with **no server infrastructure**, delivered as a **zero-install web app** — open a link, you are in the call.

**No install of any kind.** No PWA install prompt, no "Add to Home Screen", no manifest, no downloaded binary. A URL is the entire distribution mechanism. This suits disposable, single-use rooms: the moment you ask someone to install something to take a call, the link stops working as an invitation.

The original proposal was Pear (Holepunch). This document records why Pear cannot serve a browser app, and specifies the architecture that delivers the same core idea on the open web.

This repo previously held Zipcall (source removed post-acquisition). Nothing here is reused — this is a greenfield project.

## 2. The hard constraint: Pear cannot run in a browser

Pear is not usable here. This is structural, not a difficulty:

| Requirement | Pear reality |
|---|---|
| Runs in a browser | Pear targets **desktop, terminal, mobile** runtimes only. No web target. |
| Transport | Hyperswarm/HyperDHT holepunch over **raw UDP (UDX)**. Browsers cannot open UDP sockets — no API exists, by design. |
| Browser bridge | `hyperswarm-dht-relay` exists, but needs a **WebSocket relay server you run** (defeats "no servers") and is flagged *"Do not use it in production."* |
| Distribution | Pear apps are downloaded desktop binaries — exactly what the zero-install requirement rules out. |

**Conclusion:** Pear ⇒ downloaded desktop app. Zero-install web ⇒ WebRTC. The zero-install requirement settles it: WebRTC.

The core idea itself is proven viable — Keet (Holepunch's own app) does serverless P2P calls with screen share. The question was only ever the transport.

## 3. What "no servers" honestly means in a browser

Decompose it — the parts have different answers:

| Concern | Server needed? | How |
|---|---|---|
| **Media** (audio + screen video) | **No** | WebRTC `RTCPeerConnection`, direct peer-to-peer, DTLS-SRTP encrypted. Never transits a server. |
| **Signaling** (SDP/ICE exchange) | **None that we own** | Trystero rides public **Nostr** relays (default), BitTorrent trackers, or MQTT brokers. No account, no deploy, no cost. |
| **NAT discovery (STUN)** | **None that we own** | Free public STUN (`stun.l.google.com:19302` et al). Tiny UDP ping; carries no media. |
| **Symmetric-NAT fallback (TURN)** | Optional | ~8–15% of peer pairs cannot hole-punch. Without TURN those pairs simply fail to connect. **Decision: ship without TURN**, detect the failure, and tell the user plainly. Revisit only if real usage demands it. |
| **App hosting** | Static only | Plain static files on any CDN/Pages host. No backend, no database, no state. Must be HTTPS — `getUserMedia`/`getDisplayMedia` require a secure context. |

So: **zero servers we operate**, and **zero servers that ever see media**. That is the strongest honest form of the claim in a browser, and it is materially the same guarantee Pear gives for user data.

## 4. Architecture

```
┌────────── Browser tab (static, nothing installed) ────────┐
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

Deliberately thin — no framework lock-in, no build-time magic, and **no service worker**:

- **Vite** + vanilla TS (fast, static output, zero runtime deps)
- **Trystero** — serverless WebRTC matchmaking (Nostr strategy)
- Native `RTCPeerConnection` / `getDisplayMedia` — no WebRTC wrapper library

No service worker is deliberate, not an omission. A live call cannot work offline, so a SW buys nothing here while introducing stale-cache bugs — the classic failure where users hold a cached build and cannot join rooms created by a newer one. Ship a small, fast, always-fresh page instead. Keep the JS bundle lean enough that first paint beats the time it takes to read the room name.

## 7. Milestones

1. **Scaffold** — Vite + TS, static build, deploys to any static host over HTTPS.
2. **Room + presence** — join by room code from the URL (`/#room-id`, so a link is the whole invite), peer list, display names over data channel.
3. **Group audio** — `getUserMedia({audio})`, mesh audio, mute, per-peer speaking indicator via `AnalyserNode`.
4. **Single screen share** — `getDisplayMedia`, `addTrack`, render remote screen. Track↔owner mapping over data channel.
5. **Multi-share (core feature)** — several peers sharing concurrently; responsive grid; per-tile pin/fullscreen.
6. **Resilience** — ICE failure detection with an explicit "couldn't connect directly (strict NAT)" message; reconnect; room-size cap with warning.
7. **Polish** — device pickers, keyboard shortcuts, dark mode, PiP.

Feature-complete on the core idea at milestone 5; 1–4 are the runway.

Because a URL is the only distribution channel, the join flow carries weight the UI would otherwise share with an install step: the room link must work on first click, with no account, no lobby, and permission prompts requested only at the moment they are needed (mic on join, screen only when the user clicks Share).

## 8. Known limitations (state these in the README, not in a support thread)

- **iOS/iPadOS Safari cannot screen share.** `getDisplayMedia` is unimplemented. iOS users can open the link, talk, and *view* others' screens — but cannot share their own. No workaround exists on the open web, and zero-install rules out the native app that would be the only escape. Detect iOS and hide the Share button rather than letting it fail.
- **~10% of peer pairs won't connect** without TURN (symmetric NAT, some corporate networks).
- **4–6 participant ceiling**, per the mesh math above.
- Public Nostr relays are best-effort; Trystero should be configured with several for redundancy.

## 9. Verification

- `npm run build && npm run preview` — served over HTTPS (required for `getUserMedia` and `getDisplayMedia`).
- **Cold link:** paste a room URL into a fresh browser profile with no prior state — lands directly in the call, no install prompt, no account, no service worker registered.
- **Two-peer:** two browser profiles, same room code — audio both directions, one screen shared and visible.
- **Multi-share (the actual acceptance test):** three peers, at least two sharing screens *simultaneously*, all on audio. Confirm every peer sees every live screen at once and hears everyone.
- **Cross-network:** peers on genuinely different networks (not just two tabs) to exercise real NAT traversal.
- **`chrome://webrtc-internals`** to confirm bitrates, resolution, and that no relay candidate is in use.

## 10. Rejected: the Pear desktop path

Recorded so it is not relitigated. Pear (Electron + `pear-runtime`, a Bare worker owning Hyperswarm, WebCodecs encode/decode, media framed over Protomux on the Noise stream) gives a stronger serverless guarantee than this plan: true DHT-based zero-infrastructure, no STUN, no public relays.

It is rejected because it requires users to **download and install a desktop binary**, which the zero-install requirement forbids outright. That constraint is not negotiable against a marginal gain in serverlessness — and the gain really is marginal, since under this plan no server ever sees media either. It would also mean hand-rolling the media pipeline that WebRTC provides for free: congestion control, jitter buffering, packet loss concealment, and echo cancellation.

Revisit only if the zero-install requirement is dropped.
