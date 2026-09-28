import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inlineScriptHashes } from "./pages.ts";
import { contentSecurityPolicy, isAllowedOrigin } from "./security.ts";

const sha256 = (text: string) =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

describe("inlineScriptHashes", () => {
  it("hashes inline scripts exactly as written, and skips external ones", () => {
    const html = [
      "<script>window.a = 1;</script>",
      '<script type="module" async="">import "/assets/x.js";\n</script>',
      '<script src="/assets/y.js"></script>',
      "<script>window.a = 1;</script>",
    ].join("");
    expect(inlineScriptHashes(html)).toEqual([
      sha256("window.a = 1;"),
      sha256('import "/assets/x.js";\n'),
    ]);
  });
});

describe("contentSecurityPolicy", () => {
  it("allows only this origin plus the page's own inline scripts", () => {
    const policy = contentSecurityPolicy({ scriptHashes: ["'sha256-abc'"], host: "zip.example" });
    expect(policy).toContain("script-src 'self' 'sha256-abc'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("connect-src 'self' wss://zip.example ws://zip.example");
    expect(policy).not.toContain("unsafe");
  });

  it("never echoes a suspicious Host header", () => {
    const policy = contentSecurityPolicy({ scriptHashes: [], host: "evil; script-src *" });
    expect(policy).toContain("connect-src 'self';");
    expect(policy).not.toContain("evil");
  });
});

describe("isAllowedOrigin", () => {
  it("allows the site's own origin and requests without one", () => {
    expect(isAllowedOrigin("https://zip.example", "zip.example", [])).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173", "localhost:5173", [])).toBe(true);
    expect(isAllowedOrigin(undefined, "zip.example", [])).toBe(true);
  });

  it("refuses other sites unless listed", () => {
    expect(isAllowedOrigin("https://evil.example", "zip.example", [])).toBe(false);
    expect(isAllowedOrigin("https://zip.example.evil.example", "zip.example", [])).toBe(false);
    expect(isAllowedOrigin("null", "zip.example", [])).toBe(false);
    expect(isAllowedOrigin("https://app.example", "zip.example", ["https://app.example"])).toBe(
      true,
    );
  });
});
