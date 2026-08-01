# Serverless Multi-Screen-Share + Group Audio — Plan

## 1. Context

Goal: a room where **several people share their screens at the same time** while **all talking**, with **no server infrastructure**, delivered as a **web app you never have to install** — open a link, you are in the call.

**The app is a PWA, but installation is never required and never prompted.** It ships a manifest and a service worker, so a browser that wants to offer "Install" or "Add to Home Screen" may do so, and a returning user can keep it as a standalone window. But there is **no install button, no `beforeinstallprompt` interstitial, no nag**. A URL is the entire distribution mechanism, and the full app works on first click with nothing installed.

This distinction matters for disposable, single-use rooms: the moment an invitee is asked to install something to take a call, the link stops working as an invitation. Installability is a bonus for the host who uses it weekly — never a toll on the guest who joins once.

The original proposal was Pear (Holepunch). This document records why Pear cannot serve a browser app, and specifies the architecture that delivers the same core idea on the open web.

This repo previously held Zipcall (source removed post-acquisition). Nothing here is reused — this is a greenfield project.

## 2. The hard constraint: Pear cannot run in a browser

Pear is not usable here. This is structural, not a difficulty:

| Requirement | Pear reality |
|---|---|
| Runs in a browser | Pear targets **desktop, terminal, mobile** runtimes only. No web target. |
| Transport | Hyperswarm/HyperDHT holepunch over **raw UDP (UDX)**. Browsers cannot open UDP sockets — no API exists, by design. |
| Browser bridge | `hyperswarm-dht-relay` exists, but needs a **WebSocket relay server you run** (defeats "no servers") and is flagged *"Do not use it in production."* |
| Distribution | Pear apps are downloaded desktop binaries. A guest cannot join by clicking a link. |

**Conclusion:** Pear ⇒ downloaded desktop app. Link-openable web app ⇒ WebRTC. The requirement that a room link just works settles it: WebRTC.

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

Deliberately thin — no framework lock-in, no build-time magic:

- **Vite** + vanilla TS (fast, static output, zero runtime deps)
- **Trystero** — serverless WebRTC matchmaking (Nostr strategy)
- **vite-plugin-pwa** (Workbox) — manifest + service worker, `registerType: 'autoUpdate'`
- Native `RTCPeerConnection` / `getDisplayMedia` — no WebRTC wrapper library

**Service worker caching must be update-first.** The obvious hazard in a P2P app with no backend is version skew: a peer holding a stale cached build tries to join a room created by a newer one, and the wire format silently disagrees. There is no server to arbitrate. So: `autoUpdate` with `skipWaiting` + `clientsClaim`, precache the shell but never serve a stale `index.html`, and treat the signaling payload as versioned — on mismatch, show "reload to update" rather than half-joining a room.

Keep the bundle lean enough that first paint beats the time it takes to read the room name; the service worker is an accelerator for repeat visits, not the delivery path for the first one.

## 7. Milestones

1. **Scaffold** — Vite + TS, static build, deploys to any static host over HTTPS.
2. **Room + presence** — join by room code from the URL (`/#room-id`, so a link is the whole invite), peer list, display names over data channel.
3. **Group audio** — `getUserMedia({audio})`, mesh audio, mute, per-peer speaking indicator via `AnalyserNode`.
4. **Single screen share** — `getDisplayMedia`, `addTrack`, render remote screen. Track↔owner mapping over data channel.
5. **Multi-share (core feature)** — several peers sharing concurrently; responsive grid; per-tile pin/fullscreen.
6. **Resilience** — ICE failure detection with an explicit "couldn't connect directly (strict NAT)" message; reconnect; room-size cap with warning.
7. **PWA layer** — manifest (icons, `display: standalone`, theme colors) + auto-updating service worker. Deliberately late: installability is an enhancement for repeat users, never a gate on the core flow, so it must land on an app that is already complete without it. Explicitly **no** install button or prompt.
8. **Polish** — device pickers, keyboard shortcuts, dark mode, PiP.

Feature-complete on the core idea at milestone 5; 1–4 are the runway.

Because a URL is the real distribution channel, the join flow carries weight the UI would otherwise share with an install step: the room link must work on first click, with no account, no lobby, no install interstitial, and permission prompts requested only at the moment they are needed (mic on join, screen only when the user clicks Share).

## 8. Known limitations (state these in the README, not in a support thread)

- **iOS/iPadOS Safari cannot screen share.** `getDisplayMedia` is unimplemented, and installing the PWA to the home screen does **not** change this — an installed PWA on iOS is still Safari's engine with the same gap. iOS users can open the link, talk, and *view* others' screens, but never share their own. The only escape would be a native app, which the no-install-required goal rules out. Detect iOS and hide the Share button rather than letting it fail.
- **~10% of peer pairs won't connect** without TURN (symmetric NAT, some corporate networks).
- **4–6 participant ceiling**, per the mesh math above.
- Public Nostr relays are best-effort; Trystero should be configured with several for redundancy.

## 9. Verification

- `npm run build && npm run preview` — served over HTTPS (required for `getUserMedia`, `getDisplayMedia`, and service worker registration).
- **Cold link (the key test):** paste a room URL into a fresh browser profile with no prior state — lands directly in the call, with **no install prompt or interstitial shown at any point**, no account, no lobby.
- **PWA present but passive:** Lighthouse reports the app as installable; the browser's own address-bar install affordance appears; the app still never surfaces one itself.
- **Update safety:** load the app, deploy a new build, reload — the client picks up the new version rather than serving a stale shell. Then verify a stale client and a fresh client cannot silently half-join the same room.
- **Two-peer:** two browser profiles, same room code — audio both directions, one screen shared and visible.
- **Multi-share (the actual acceptance test):** three peers, at least two sharing screens *simultaneously*, all on audio. Confirm every peer sees every live screen at once and hears everyone.
- **Cross-network:** peers on genuinely different networks (not just two tabs) to exercise real NAT traversal.
- **`chrome://webrtc-internals`** to confirm bitrates, resolution, and that no relay candidate is in use.

## 10. Rejected: the Pear desktop path

Recorded so it is not relitigated. Pear (Electron + `pear-runtime`, a Bare worker owning Hyperswarm, WebCodecs encode/decode, media framed over Protomux on the Noise stream) gives a stronger serverless guarantee than this plan: true DHT-based zero-infrastructure, no STUN, no public relays.

It is rejected because it requires every participant to **download and install a desktop binary** before they can join — a guest cannot simply click a room link. Note this is not in tension with shipping a PWA: an optional, browser-native install for repeat users is a different thing from a mandatory binary download for every guest.

The tradeoff is not close. The gain is marginal, since under this plan no server ever sees media either, while the cost is hand-rolling the media pipeline WebRTC provides for free: congestion control, jitter buffering, packet loss concealment, and echo cancellation.

Revisit only if the browser ceases to be the target.
