# Security policy

## Reporting a vulnerability

Please report security problems privately rather than in a public issue: use **Report a
vulnerability** on this repository's **Security** tab. Include what's affected, how to reproduce
it, and what an attacker could do with it. The fix and any advisory will be coordinated with you
before details are made public.

## Supported versions

Security fixes go into the latest version on the default branch. Keep deployments up to date with
it (see [Upgrading](docs/deployment.md#upgrading)); Dependabot keeps the dependencies current.

## Scope

In scope: the signaling server, the web client, and the Docker, Compose, Caddy, and coturn
configuration in this repository, including insecure defaults.

Out of scope: flaws in browsers' WebRTC implementations or in third-party services (Twilio, public
STUN servers), and problems caused by changing the defaults to less safe values.

## How Zipcall protects calls

- **Media stays between the browsers.** Audio, video, and chat are encrypted by the browsers
  (DTLS-SRTP) and go peer to peer, or through a TURN relay that can't decrypt them. The server
  only relays connection setup messages, which it validates and confines to the room the sender
  joined.
- **The server is trusted with setup.** As in most WebRTC apps, the connection setup the server
  relays includes each browser's encryption fingerprint, so a compromised server could put itself
  in the middle of new calls. Run it on infrastructure you trust.
- **Rooms** hold two people. Suggested call names have a random part (about 1.3 billion
  combinations), and join rate limits make guessing slow.
- **The web client** is served with a strict Content-Security-Policy (inline scripts only by hash,
  no inline styles), HSTS, and headers that stop other sites from framing it or reaching into its
  window. Chat is rendered only as text, with links made clickable safely.
- **Abuse limits:** signaling connections only from the site's own origin, and per-address limits
  on connections, joins, and relayed messages. Client addresses come from `X-Forwarded-For` only
  through the configured number of trusted proxies.
- **TURN** credentials are HMAC-signed and expire after a day. The bundled coturn refuses to start
  without a strong secret and won't relay to private, loopback, or cloud-metadata addresses.
- **Logs** replace call names with short hashes and record IP addresses only when rate limits turn
  someone away. `/metrics` needs a bearer token, compared in constant time.

See [docs/production-readiness.md](docs/production-readiness.md) for the full list, and the
privacy page (`/privacy` on any Zipcall site, source in
[app/routes/privacy.tsx](app/routes/privacy.tsx)) for what data goes where.
