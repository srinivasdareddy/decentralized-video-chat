import { Compass } from "lucide-react";
import { Link } from "react-router";
import { CopyCallLink } from "../components/copy-call-link";
import { MessagePanel } from "../components/message-panel";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/not-supported-ios";

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Open in Safari · Zipcall",
    description: "Open Zipcall in Safari to make video calls on iPhone and iPad.",
  });

export default function NotSupportedIos() {
  return (
    <section className="container narrow">
      <MessagePanel
        icon={<Compass size={28} aria-hidden="true" />}
        title="Open this call in Safari"
        description="This browser can't use your camera on iPhone or iPad. Copy the call link and open it in Safari."
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
