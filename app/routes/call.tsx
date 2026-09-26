import "../call/call.css";
import { data, redirect } from "react-router";
import { isValidRoomName, normalizeRoomName } from "../../shared/protocol";
import { CallScreen } from "../call/call-screen";
import { detectBrowserEnvironment, unsupportedPageFor } from "../lib/browser-support";
import type { Route } from "./+types/call";

export function clientLoader({ params }: Route.ClientLoaderArgs) {
  const room = normalizeRoomName(params.room);
  if (!isValidRoomName(room)) throw data("No such call", { status: 404 });

  const unsupported = unsupportedPageFor(detectBrowserEnvironment());
  if (unsupported !== null) {
    throw redirect(`${unsupported}?room=${encodeURIComponent(room)}`);
  }
  return { room };
}

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.room ?? "Call"} · Zipcall` },
  // Call links are private; keep them out of search results.
  { name: "robots", content: "noindex" },
];

export default function Call({ loaderData }: Route.ComponentProps) {
  // Keyed by room so switching calls starts a fresh session.
  return <CallScreen key={loaderData.room} room={loaderData.room} />;
}
