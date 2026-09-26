import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyText } from "../lib/clipboard";
import { useClientValue } from "../lib/use-client-value";

// These pages are pre-rendered without a query string, so read it in the browser.
const roomFromUrl = () => new URLSearchParams(window.location.search).get("room");

/**
 * Offers the call link that brought the visitor here (passed as ?room=), so
 * they can open it in a supported browser.
 */
export function CopyCallLink() {
  const room = useClientValue(roomFromUrl, null);
  const [copied, setCopied] = useState(false);

  if (!room) return null;
  const link = `${window.location.origin}/join/${encodeURIComponent(room)}`;
  return (
    <button
      type="button"
      className="button button-primary"
      onClick={() => void copyText(link).then(setCopied)}
    >
      {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
      {copied ? "Link copied" : "Copy call link"}
    </button>
  );
}
