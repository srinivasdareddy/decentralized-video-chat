export type TextPart =
  { type: "text"; text: string } | { type: "link"; text: string; href: string };

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]+/gi;
const TRAILING_PUNCTUATION = ".,;:!?'\")]}";

/**
 * Splits chat text into plain text and web links so links can be rendered as
 * anchors. Nothing here produces HTML: the caller renders each part as text
 * or as an <a>, so a message can never inject markup.
 */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let position = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimTrailingPunctuation(match[0]);
    if (!isWebUrl(url)) continue;
    const start = match.index;
    if (start > position) parts.push({ type: "text", text: text.slice(position, start) });
    parts.push({ type: "link", text: url, href: url });
    position = start + url.length;
  }

  if (position < text.length) parts.push({ type: "text", text: text.slice(position) });
  return parts;
}

/** Drops punctuation that ends a sentence rather than the URL, keeping balanced parentheses. */
function trimTrailingPunctuation(url: string): string {
  let result = url;
  for (let last = result.at(-1); last !== undefined; last = result.at(-1)) {
    if (!TRAILING_PUNCTUATION.includes(last)) break;
    if (last === ")" && count(result, "(") >= count(result, ")")) break;
    result = result.slice(0, -1);
  }
  return result;
}

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

function isWebUrl(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);
    return (protocol === "http:" || protocol === "https:") && hostname !== "";
  } catch {
    return false;
  }
}
