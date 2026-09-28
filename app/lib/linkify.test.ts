import { describe, expect, it } from "vitest";
import { linkify } from "./linkify.ts";

describe("linkify", () => {
  it("leaves plain text alone", () => {
    expect(linkify("hello there")).toEqual([{ type: "text", text: "hello there" }]);
    expect(linkify("")).toEqual([]);
  });

  it("finds web links between text", () => {
    expect(linkify("see https://example.com/a?b=1 now")).toEqual([
      { type: "text", text: "see " },
      { type: "link", text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { type: "text", text: " now" },
    ]);
  });

  it("does not swallow sentence punctuation", () => {
    expect(linkify("Go to http://example.com.")).toEqual([
      { type: "text", text: "Go to " },
      { type: "link", text: "http://example.com", href: "http://example.com" },
      { type: "text", text: "." },
    ]);
    expect(linkify("(https://example.com)")[1]).toMatchObject({ href: "https://example.com" });
  });

  it("keeps balanced parentheses that belong to the URL", () => {
    const url = "https://en.wikipedia.org/wiki/Rust_(programming_language)";
    expect(linkify(`${url}!`)[0]).toEqual({ type: "link", text: url, href: url });
  });

  it("never links anything but http and https", () => {
    expect(linkify("javascript:alert(1)")).toEqual([{ type: "text", text: "javascript:alert(1)" }]);
    expect(linkify("ftp://example.com").every((part) => part.type === "text")).toBe(true);
  });

  it("returns markup as inert text", () => {
    const text = '<img src=x onerror="alert(1)">';
    expect(linkify(text)).toEqual([{ type: "text", text }]);
  });
});
