import type { Config } from "@react-router/dev/config";

export default {
  // Everything runs in the browser; the Node server only serves static files
  // and relays signaling messages, so there is no server rendering.
  ssr: false,
  // Static pages are rendered to HTML at build time for fast first loads and
  // link previews. Call pages (/join/:room) use the SPA fallback shell.
  prerender: ["/", "/newcall", "/privacy", "/notsupported", "/notsupportedios"],
} satisfies Config;
