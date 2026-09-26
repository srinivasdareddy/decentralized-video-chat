import { MonitorX } from "lucide-react";
import { Link } from "react-router";
import { CopyCallLink } from "../components/copy-call-link";
import { MessagePanel } from "../components/message-panel";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/not-supported";

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Browser not supported · Zipcall",
    description: "Zipcall needs a browser that supports WebRTC video calls.",
  });

export default function NotSupported() {
  return (
    <section className="container narrow">
      <MessagePanel
        icon={<MonitorX size={28} aria-hidden="true" />}
        title="This browser can't make video calls"
        description="Open the call in a recent version of Chrome, Firefox, Safari, or Edge. Browsers built into apps like Facebook or Instagram don't allow camera access."
        actions={
          <>
            <CopyCallLink />
            <Link to="/" className="button button-secondary">
              Back to home
            </Link>
          </>
        }
      />
    </section>
  );
}
