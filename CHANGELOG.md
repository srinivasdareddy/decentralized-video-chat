# Changelog

## 2.0.0

A rewrite that makes Zipcall ready to run in production. Calls work as before: pick a name, share
the link, talk. Everything around them changed.

### Calls

- New web client (React 19 and React Router 8) with a cleaner design, on desktop and phones.
- Calls recover from network drops without reloading the page, carry on while the server restarts
  (a deploy, a crash), and pick up a replaced camera or headset automatically.
- Choose camera, microphone, and speaker mid-call, remembered between calls.
- Keyboard shortcuts: Ctrl+D (⌘D) for the microphone, Ctrl+E (⌘E) for the camera.
- Leaving mid-call asks first; the screen stays awake during a call; an offline notice.
- Fixed: chat messages could run scripts in the other person's browser (XSS), and the page crashed
  if the other person left before the call connected.

### Server

- Rebuilt in TypeScript on Express 5 and Socket.IO 4, run directly by Node.js 22.22 or newer.
- Every signaling message is validated and only relayed within its room.
- Content-Security-Policy and other security headers, origin checks for signaling, and rate
  limits on connections, joins, and relayed messages.
- Your own TURN server (coturn) as an alternative to Twilio, and a relay-only mode that hides
  participants' IP addresses from each other.
- JSON logs, `/healthz` with the running version, and Prometheus metrics.
- Link-preview image, installable web app, compression, and a privacy page.

### Deployment

- Docker image and Docker Compose setup with automatic HTTPS (Caddy) and a TURN relay (coturn).
  See [docs/deployment.md](docs/deployment.md).
- CI runs unit tests, browser tests with real calls (also through a TURN relay, between Chrome and
  Firefox, and against the Docker image), and a dependency audit on every push.

### Upgrading from 1.x

- Node.js 22.22 or newer is required.
- Configuration comes from environment variables, documented in `.env.template`. The Twilio
  variable names from 1.x (`HEROKU_TWILLIO_SID`, `LOCAL_AUTH_TOKEN`, and so on) still work.
- Call links keep the same form, `/join/<name>`. Call names are now case-insensitive.
- Behind a reverse proxy, set `TRUST_PROXY` to the number of proxies (Heroku and Docker Compose
  set it for you).
