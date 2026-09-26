import { ArrowRight, Shuffle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ROOM_NAME_MAX_LENGTH, isValidRoomName, normalizeRoomName } from "../../shared/protocol";
import { pageMeta } from "../lib/meta";
import { randomRoomName } from "../lib/room-names";
import { useClientValue } from "../lib/use-client-value";
import type { Route } from "./+types/new-call";

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Start a call · Zipcall",
    description: "Pick a name for your call and share the link. Anyone with the link can join.",
  });

// Picked in the browser so the pre-rendered page doesn't bake one name in for
// everyone. Cached so every read during a visit agrees.
let suggestedName: string | undefined;
const suggestName = () => (suggestedName ??= randomRoomName());

export default function NewCall() {
  const navigate = useNavigate();
  const suggestion = useClientValue(suggestName, "");
  // null until the person edits the field or asks for another suggestion.
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? suggestion;

  const room = normalizeRoomName(name);
  const valid = isValidRoomName(room);

  const startCall = (event: FormEvent) => {
    event.preventDefault();
    if (valid) void navigate(`/join/${encodeURIComponent(room)}`);
  };

  return (
    <section className="container narrow">
      <form className="card" onSubmit={startCall} noValidate>
        <h1 className="card-title">Start a call</h1>
        <p className="card-text">
          Pick a name for your call and share the link. Each call is for two people.
        </p>
        <label className="field-label" htmlFor="room-name">
          Call name
        </label>
        <div className="input-row">
          <input
            id="room-name"
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={ROOM_NAME_MAX_LENGTH}
            placeholder="happy-panda"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={name !== "" && !valid}
            aria-describedby="room-name-hint"
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => setName(randomRoomName())}
            aria-label="Suggest another name"
            title="Suggest another name"
          >
            <Shuffle size={18} aria-hidden="true" />
          </button>
        </div>
        <p id="room-name-hint" className={name !== "" && !valid ? "field-error" : "field-hint"}>
          {name !== "" && !valid
            ? "Call names can't contain slashes, ? or #."
            : "Anyone with the link can join."}
        </p>
        <button type="submit" className="button button-primary button-block" disabled={!valid}>
          Start call
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
