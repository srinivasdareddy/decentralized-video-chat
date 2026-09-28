import { SendHorizontal, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { linkify } from "../lib/linkify";
import type { ChatMessage } from "./call-session";
import { CHAT_MESSAGE_MAX_LENGTH } from "./peer-messages";

export function ChatPanel({
  messages,
  canSend,
  onSend,
  onClose,
}: {
  messages: ChatMessage[];
  canSend: boolean;
  onSend: (text: string) => boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  useEffect(() => inputRef.current?.focus(), []);

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (onSend(draft)) setDraft("");
  };

  return (
    <aside className="chat-panel" aria-label="Chat">
      <header className="chat-header">
        <h2 className="chat-title">Chat</h2>
        <button type="button" className="chat-close" onClick={onClose} aria-label="Close chat">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <ol ref={listRef} className="chat-messages" aria-live="polite">
        {messages.length === 0 && (
          <li className="chat-empty">
            Messages go straight to the other person and disappear when the call ends.
          </li>
        )}
        {messages.map((message) => (
          <li
            key={message.id}
            className={`chat-message ${message.from === "me" ? "is-own" : "is-peer"}`}
          >
            <span className="visually-hidden">{message.from === "me" ? "You: " : "Them: "}</span>
            <MessageText text={message.text} />
          </li>
        ))}
      </ol>
      <form className="chat-compose" onSubmit={send}>
        <input
          ref={inputRef}
          className="text-input chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={canSend ? "Send a message" : "Chat opens when someone joins"}
          aria-label="Message"
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          autoComplete="off"
          disabled={!canSend}
        />
        <button
          type="submit"
          className="chat-send"
          disabled={!canSend || draft.trim() === ""}
          aria-label="Send message"
        >
          <SendHorizontal size={18} aria-hidden="true" />
        </button>
      </form>
    </aside>
  );
}

/** Renders text with clickable links. Never interprets markup. */
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((part, index) =>
        part.type === "link" ? (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
