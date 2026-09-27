# Deploying Zipcall

This guide takes a fresh Linux server to a production Zipcall with HTTPS and its own TURN relay,
using the Docker Compose setup in this repository. Other hosting options are at the end.

## What you need

- A Linux server with a public IP address. Signaling is light: 1 vCPU and 1 GB of RAM handle
  thousands of people at once. Relayed calls are what cost bandwidth (see
  [Capacity](#capacity)).
- Docker with Compose v2.24 or newer.
- A domain name, such as `call.example.com`, whose DNS `A` (and `AAAA`, if you use IPv6) record
  points at the server.
- These ports open in the server's firewall and your cloud provider's security group:

  | Port          | Protocol | For                                       |
  | ------------- | -------- | ----------------------------------------- |
  | 80            | TCP      | HTTP, for certificates and redirects      |
  | 443           | TCP, UDP | HTTPS (UDP for HTTP/3)                    |
  | 3478          | TCP, UDP | TURN relay (only with the `turn` profile) |
  | 49152 – 65535 | UDP      | TURN relay traffic                        |

  The relay range is set by `TURN_MIN_PORT` and `TURN_MAX_PORT`. Keep port 3000 closed: the app
  listens on it only for the local machine (`APP_BIND=127.0.0.1`), and Caddy forwards to it.

## Set it up

1. Get the code:

   ```sh
   git clone https://github.com/srinivasdareddy/decentralized-video-chat zipcall
   cd zipcall
   cp .env.template .env
   ```

2. Edit `.env`. A typical production file:

   ```sh
   DOMAIN=call.example.com
   PUBLIC_URL=https://call.example.com

   # Your TURN relay (the turn profile runs it).
   TURN_SECRET=<output of: openssl rand -hex 32>
   TURN_URLS=turn:call.example.com:3478?transport=udp,turn:call.example.com:3478?transport=tcp
   # On clouds where the server only has a private address (AWS, GCP, Azure, ...):
   TURN_EXTERNAL_IP=203.0.113.10

   # Optional: Prometheus metrics at /metrics.
   METRICS_TOKEN=<output of: openssl rand -hex 32>
   ```

   Every setting is described in `.env.template` and the README. Use Twilio instead of your own
   relay by setting `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` and leaving out the TURN
   settings and the `turn` profile.

3. Build and start the app, Caddy, and coturn:

   ```sh
   REVISION=$(git rev-parse --short HEAD) docker compose build
   docker compose --profile https --profile turn up -d
   ```

   When it starts, Caddy gets a Let's Encrypt certificate for `DOMAIN`, which needs ports 80 and
   443 reachable from the internet. `docker compose logs caddy` shows how that went.

4. Check it:

   ```sh
   docker compose ps                      # every service "running", the app "healthy"
   curl https://call.example.com/healthz  # {"status":"ok","version":...,"revision":...}
   ```

   Then make a real call between two different networks, such as a laptop on Wi-Fi and a phone on
   mobile data. That's the case that needs TURN, so it proves the relay works.

## Before going live

- [ ] HTTPS works and `http://` redirects to `https://` (Caddy does both).
- [ ] `TRUST_PROXY` matches the number of proxies in front of the app: `1` with Caddy (the
      Compose default). Too low and every visitor looks like the proxy, so rate limits can't
      apply; too high and visitors can fake their address.
- [ ] `APP_BIND` is `127.0.0.1` (the default), so the app is only reachable through Caddy.
- [ ] `TURN_SECRET` is long and random (coturn refuses to start with fewer than 16 characters),
      and the relay port range is open in every firewall.
- [ ] A call between two different networks connects.
- [ ] `METRICS_TOKEN`, if set, is long and random. Consider scraping metrics from the server
      itself (`http://127.0.0.1:3000/metrics`) rather than through the public site.
- [ ] Someone watches Dependabot's weekly pull requests; CI tests each one.
- [ ] Optional: `ICE_TRANSPORT_POLICY=relay`, so participants never learn each other's IP
      addresses. Every call then goes through your relay, which costs bandwidth.

## Upgrading

```sh
git pull
REVISION=$(git rev-parse --short HEAD) docker compose build app
docker compose up -d app
```

Calls in progress carry on while the app restarts: they don't need the server once connected,
and both browsers quietly rejoin when it's back. Only people who are joining at that moment wait
a few seconds. Restarting coturn (`docker compose up -d turn`) does interrupt relayed calls, so do
that at a quiet time.

`/healthz` reports the running `revision`, so you can confirm the upgrade took.

## Monitoring

With `METRICS_TOKEN` set, `/metrics` serves Prometheus metrics to requests carrying
`Authorization: Bearer <token>`. For Prometheus on the same server:

```yaml
scrape_configs:
  - job_name: zipcall
    authorization:
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ["127.0.0.1:3000"]
```

Worth alerting on:

| Condition                                                   | Meaning                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `up{job="zipcall"} == 0`, or `/healthz` failing             | The app is down.                                             |
| `increase(zipcall_turn_credential_failures_total[15m]) > 0` | Twilio credentials failing: calls fall back to STUN only.    |
| `increase(zipcall_refused_connections_total[15m])` spikes   | Connection limits turning people away: abuse, or limits low. |
| `increase(zipcall_joins_total{result="rate-limited"}[15m])` | Join limits hit: someone guessing call names, or a busy NAT. |
| `process_resident_memory_bytes` growing without levelling   | A leak; restarting the app is safe for calls in progress.    |

`zipcall_active_calls` and `zipcall_waiting_rooms` show usage. Without Prometheus, an uptime
checker on `https://call.example.com/healthz` covers the essentials.

## Logs

```sh
docker compose logs -f app
```

In production the app writes one JSON object per line: joins, leaves, refusals, and errors. Call
names appear only as short hashes, so you can follow one call without logs revealing what people
named it. IP addresses are logged only when rate limits turn someone away. Set `LOG_LEVEL=debug`
to also log every HTTP request.

Docker's `local` log driver (set in `docker-compose.yml`) rotates logs automatically, keeping about
100 MB per service. Ship them elsewhere by changing the driver, or read them with any tool that
understands JSON lines.

## Backups

There's nothing to back up: calls, messages, and rooms are never stored. Keep a copy of `.env`.
Caddy's certificates live in the `caddy-data` volume; if it's lost, Caddy simply requests new
ones (mind Let's Encrypt's rate limits if you recreate it often).

## Capacity

- **Signaling** is cheap: a few kilobytes per call, once, to connect. One app process handles
  thousands of concurrent people.
- **Media** usually goes directly between the two browsers and never touches your server.
- **Relayed calls** (strict firewalls, or everyone with `ICE_TRANSPORT_POLICY=relay`) pass
  through coturn: roughly 1–3 Mbit/s in each direction per person. A server with a 1 Gbit/s link
  relays a few hundred calls. Each relayed call also uses about four ports from the relay range,
  so the default range (16,384 ports) allows about 4,000.

Rooms live in the app's memory, so run a single app instance. See
[Known limitations](production-readiness.md#known-limitations).

## Other ways to host it

**Your own reverse proxy (nginx, Traefik, a load balancer):** leave off the `https` profile and
proxy to port 3000, passing WebSocket upgrades (`Upgrade` and `Connection` headers) for
`/socket.io/`. Set `TRUST_PROXY` to the number of proxies, and `FORCE_HTTPS=true` if the proxy
forwards plain-HTTP requests with `X-Forwarded-Proto: http`. Signaling connections send a ping
every 25 seconds, so a proxy idle timeout of 30 seconds or more keeps them open. (If one does
drop, the browser reconnects and the call carries on.)

**Heroku, Render, Railway, Fly.io, and other platforms:** any service that runs Node.js 22.22 or
newer (or a Dockerfile) and supports WebSockets works. Build with `npm ci && npm run build`, start
with `npm start`, and run a single instance. Set `TRUST_PROXY=1` behind the platform's router (it's
the default on Heroku, which also turns on `FORCE_HTTPS`). These platforms can't host a TURN
relay, which needs UDP ports, so use Twilio or run coturn on a separate server.

**Without Docker:** `npm ci && npm run build && npm start` on Node.js 22.22 or newer, under a
process manager such as systemd that restarts it if it exits. Stop it with `SIGTERM`: it finishes
open requests and closes connections cleanly.

## Upgrading from Zipcall 1.x

Version 2 is a rewrite (TypeScript server, React client) but deploys the same way: `npm start` on
port `PORT`. It needs Node.js 22.22 or newer. The Twilio variable names from earlier versions
(`HEROKU_TWILLIO_SID`, `LOCAL_AUTH_TOKEN`, and so on) still work, and old call links still open
the same calls. See [CHANGELOG.md](../CHANGELOG.md) for everything that changed.
