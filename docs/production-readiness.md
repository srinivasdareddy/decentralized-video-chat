# Production readiness

This is the plan for taking Zipcall from "works" to "ready to run in production", done in phases.
Each phase is one commit with its own tests, and this checklist is updated as phases land.

## Baseline (done)

- Signaling server rebuilt in TypeScript (Express 5, Socket.IO 4) with validated payloads, relays
  confined to the joined room, a health check, and graceful shutdown.
- Web client rebuilt with React Router 8, with the chat XSS and crash-before-connect bugs fixed and
  calls that recover from network drops without reloading.
- Docker Compose deployment with optional automatic HTTPS (Caddy).
- Unit, integration, and browser tests; CI for lint, typecheck, tests, and the Docker image.

## Phase 0: Plan and CI on every push

- [x] CI runs on pushes to every branch (and manually), not only `master` and pull requests, so
      each phase is verified by GitHub Actions, including the Docker image build.

## Phase 1: Security hardening (done)

- [x] Content Security Policy for every page, using hashes of the pre-rendered inline scripts. No
      inline styles, plugins, or framing by other sites. Browser tests fail on any violation.
- [x] HSTS whenever the site is known to be served over HTTPS (never on localhost).
- [x] Call links kept out of search engines (`X-Robots-Tag` and `robots.txt`).
- [x] Signaling connections only accepted from the site's own origin (plus `ALLOWED_ORIGINS`).
- [x] Rate limits: connections per IP, joins per IP (which also slows room-name guessing), and
      relayed messages per connection. Local and private addresses are exempt, so a misconfigured
      proxy can't lump every visitor into one limit.
- [x] Client IPs taken from `X-Forwarded-For` only through `TRUST_PROXY` trusted hops.
- [x] Suggested call names carry a random suffix (about 1.3 billion combinations), so strangers
      can't guess their way into a waiting room.
- [x] `npm audit` for production dependencies in CI.

## Phase 2: Observability and operations (done)

- [x] Structured logs with levels (`LOG_LEVEL`) as JSON lines in production or readable text in
      development (`LOG_FORMAT`). Room names appear only as short hashes, so logs can follow a call
      without revealing what people named it. Crashes are logged before exiting.
- [x] Request logging at `debug` level, with call links masked.
- [x] `/healthz` reports version, build revision, and uptime; the Docker image records its git
      revision (`REVISION` build argument, OCI labels), which CI checks.
- [x] Optional Prometheus metrics at `/metrics` (connections, waiting rooms, active calls, joins by
      result, relayed and dropped messages, refused connections, TURN credential failures, memory),
      only with `METRICS_TOKEN` and a matching bearer token.

## Phase 3: Self-hosted TURN (done)

- [x] TURN credentials for your own coturn server (`TURN_URLS`, `TURN_SECRET`), as an alternative
      to Twilio: fresh HMAC-signed credentials per join that expire after a day.
- [x] Relay-only mode (`ICE_TRANSPORT_POLICY=relay`) so participants never see each other's IP
      addresses.
- [x] Docker Compose `turn` profile with a hardened coturn: it refuses to start without a strong
      secret and won't relay to private, loopback, or cloud-metadata addresses.
- [x] Verified with a real coturn: CI runs the whole browser suite with every call forced through
      the relay, and a test checks the connection's selected candidates are relays.

## Phase 4: Call robustness and UX (done)

- [x] Calls don't depend on the signaling server once connected. If either person loses their
      connection to the server, or the server restarts (a deploy, a crash), the call carries on and
      both quietly rejoin the room. When the server says the other person left but the call is
      still up, the browser asks them directly over the data channel before ending the call.
- [x] Joining can't race: a join completes before the other person is asked to call, and the join
      reply says whether someone is already there.
- [x] Choose camera, microphone, and speaker mid-call without renegotiating, remembered between
      calls (by device name too, since browsers may change device ids between visits).
- [x] Keyboard shortcuts for the microphone (Ctrl/⌘+D) and camera (Ctrl/⌘+E), shown in tooltips.
- [x] The screen stays awake during a call.
- [x] Closing the tab mid-call asks first, and so does going back (with an in-page dialog).
- [x] An offline notice while the browser has no network.
- [x] Browser tests: a call survives a graceful server restart without being set up again; someone
      left alone after a server crash goes back to waiting; switching cameras keeps the video
      flowing and is remembered; shortcuts; the leave confirmation.

## Phase 5: Polish (done)

- [x] Link-preview card (1200 × 630) with an absolute URL, as crawlers need: from `PUBLIC_URL`, or
      else the request's (validated) Host. Other sites may embed this image, and only this one.
- [x] Web app manifest and icons (including maskable and Apple touch icons, and `favicon.ico`), so
      the app can be installed; Chrome reports no manifest or installability errors. The images
      are drawn from the logo by `npm run images`.
- [x] Brotli and gzip compression for pages and assets when no proxy compresses them (the main
      bundle goes from 215 KB to 67 KB).
- [x] Privacy page, linked from the footer, describing what data goes where. The caption
      indicator now also shows on phones, as the page promises.

## Phase 6: Maintenance automation (done)

- [x] Dependabot, weekly: npm (minor and patch updates grouped by production and development
      dependencies; majors one at a time), GitHub Actions (grouped), the Node.js base image, and
      the Caddy and coturn images in Docker Compose. Deliberate majors (Node.js, `@types/node`) are
      left to people. The config validates against the published schema.
- [x] Cross-browser call test: Chrome and Firefox call each other, chat both ways, and see each
      other's mute state, with Firefox's pages also checked for Content-Security-Policy violations.
- [x] The Docker image runs the browser suite in CI, not just a health check.
- [x] CI jobs have timeouts, and `.nvmrc` pins the Node.js version for contributors.

## Phase 7: Documentation

- [ ] Production deployment guide.
- [ ] Security policy.

## Known limitations

- Rooms live in the memory of a single server process, so run one instance. One Node process
  handles thousands of concurrent calls' signaling; scaling out would need a shared Socket.IO
  adapter and sticky sessions.
