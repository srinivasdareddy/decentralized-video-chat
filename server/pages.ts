import { createHash } from "node:crypto";
import fs from "node:fs";

export interface Page {
  html: string;
  /** Content-Security-Policy sources ('sha256-…') allowing the page's inline scripts. */
  scriptHashes: string[];
}

/**
 * Reads a pre-rendered page into memory, or returns null if it hasn't been
 * built. Serving from memory keeps the policy's script hashes in step with
 * the HTML actually sent.
 */
export function loadPage(file: string): Page | null {
  let html: string;
  try {
    html = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  return { html, scriptHashes: inlineScriptHashes(html) };
}

/** Hashes of the inline <script> elements React Router writes into its HTML. */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const [, attributes = "", body = ""] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    hashes.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return [...hashes];
}
