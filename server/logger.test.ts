import { describe, expect, it } from "vitest";
import { createLogger, type LogLevel } from "./logger.ts";

function capture(options: Parameters<typeof createLogger>[0] = {}) {
  const lines: { level: LogLevel; line: string }[] = [];
  const logger = createLogger({
    now: () => new Date("2026-01-02T03:04:05.678Z"),
    write: (level, line) => lines.push({ level, line }),
    ...options,
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("writes one JSON object per line", () => {
    const { logger, lines } = capture({ format: "json" });
    logger.info("Joined a call", { room: "abc123", participants: 2 });
    expect(JSON.parse(lines[0]!.line)).toEqual({
      time: "2026-01-02T03:04:05.678Z",
      level: "info",
      msg: "Joined a call",
      room: "abc123",
      participants: 2,
    });
  });

  it("includes errors with their stack", () => {
    const { logger, lines } = capture({ format: "json" });
    logger.error("It broke", new TypeError("bad input"), { room: "abc" });
    const entry = JSON.parse(lines[0]!.line) as { error: Record<string, string>; room: string };
    expect(entry.room).toBe("abc");
    expect(entry.error.name).toBe("TypeError");
    expect(entry.error.message).toBe("bad input");
    expect(entry.error.stack).toContain("TypeError: bad input");
  });

  it("drops entries below the level", () => {
    const { logger, lines } = capture({ level: "warn" });
    logger.debug("noise");
    logger.info("noise");
    logger.warn("careful");
    logger.error("broken");
    expect(lines.map(({ level }) => level)).toEqual(["warn", "error"]);
  });

  it("writes readable lines for people", () => {
    const { logger, lines } = capture({ format: "pretty" });
    logger.warn("Dropping relayed messages", {
      room: "abc",
      ip: "203.0.113.5",
      skipped: undefined,
    });
    expect(lines[0]!.line).toBe("03:04:05 WARN  Dropping relayed messages room=abc ip=203.0.113.5");
  });

  it("survives fields that can't be serialized", () => {
    const { logger, lines } = capture({ format: "json" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.info("Odd", { circular });
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ level: "info", msg: "Odd" });
  });
});
