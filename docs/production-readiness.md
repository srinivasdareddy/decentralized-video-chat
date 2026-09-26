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

## Phase 1: Security hardening

- [ ] Content Security Policy for every page, using hashes of the pre-rendered inline scripts.
- [ ] HSTS whenever the site is known to be served over HTTPS.
- [ ] Call links kept out of search engines (`X-Robots-Tag` and `robots.txt`).
- [ ] Signaling connections only accepted from the site's own origin.
- [ ] Rate limits: connections per IP, joins, and relayed messages per connection.
- [ ] Client IPs taken from the proxy only when configured to trust it.
- [ ] `npm audit` for production dependencies in CI.

Acceptance: unit tests for each measure; all browser tests pass with the policy enforced and no
policy violations reported.

## Phase 2: Observability and operations

- [ ] Structured JSON logs with levels (`LOG_LEVEL`, `LOG_FORMAT`).
- [ ] Page request logging.
- [ ] `/healthz` reports version and uptime; the Docker image knows its version.
- [ ] Optional Prometheus metrics (connections, rooms, joins, relayed messages, TURN errors),
      protected by a token.

## Phase 3: Self-hosted TURN

- [ ] TURN credentials for your own coturn server (`TURN_URLS`, `TURN_SECRET`), as an alternative
      to Twilio.
- [ ] Relay-only mode (`ICE_TRANSPORT_POLICY=relay`) so participants never see each other's IP
      addresses.
- [ ] Docker Compose `turn` profile with a hardened coturn configuration.

Acceptance: unit tests; a relay-only call through a real coturn server in the browser tests if the
image is available.

## Phase 4: Call robustness and UX

- [ ] Choose camera, microphone, and speaker, remembered between calls.
- [ ] Keep the screen awake during a call.
- [ ] Confirm before closing the tab mid-call.
- [ ] Show when the browser is offline.
- [ ] Browser tests for surviving a signaling reconnect mid-call and for switching devices.

## Phase 5: Polish

- [ ] Link-preview image with absolute URLs (`PUBLIC_URL`).
- [ ] Web app manifest and icons.
- [ ] Response compression.
- [ ] Privacy page describing what data goes where.

## Phase 6: Maintenance automation

- [ ] Dependabot for npm, GitHub Actions, and Docker base images, grouped weekly.
- [ ] Cross-browser call test (Chromium to Firefox), if Firefox can run in CI.

## Phase 7: Documentation

- [ ] Production deployment guide.
- [ ] Security policy.

## Known limitations

- Rooms live in the memory of a single server process, so run one instance. One Node process
  handles thousands of concurrent calls' signaling; scaling out would need a shared Socket.IO
  adapter and sticky sessions.
