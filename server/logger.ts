export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "json" | "pretty";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, error?: unknown, fields?: LogFields): void;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  level?: LogLevel;
  /** "json" writes one object per line for log collectors; "pretty" is for people. */
  format?: LogFormat;
  write?: (level: LogLevel, line: string) => void;
  now?: () => Date;
}

/** Writes JSON lines to stdout; pretty lines to stdout, or stderr for problems. */
function writeLine(format: LogFormat): (level: LogLevel, line: string) => void {
  return (level, line) => {
    const stream =
      format === "pretty" && LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout;
    stream.write(line + "\n");
  };
}

export function createLogger({
  level = "info",
  format = "pretty",
  write = writeLine(format),
  now = () => new Date(),
}: LoggerOptions = {}): Logger {
  const log = (entryLevel: LogLevel, message: string, fields: LogFields) => {
    if (LEVELS[entryLevel] < LEVELS[level]) return;
    const time = now();
    write(
      entryLevel,
      format === "json"
        ? toJson({ time: time.toISOString(), level: entryLevel, msg: message, ...fields })
        : toPretty(time, entryLevel, message, fields),
    );
  };
  return {
    debug: (message, fields = {}) => log("debug", message, fields),
    info: (message, fields = {}) => log("info", message, fields),
    warn: (message, fields = {}) => log("warn", message, fields),
    error: (message, error, fields = {}) =>
      log("error", message, error === undefined ? fields : { ...fields, error: describe(error) }),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function describe(error: unknown): unknown {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : error;
}

function toJson(entry: LogFields): string {
  try {
    return JSON.stringify(entry);
  } catch {
    // Circular or otherwise unserializable fields: keep the essentials.
    return JSON.stringify({ time: entry.time, level: entry.level, msg: entry.msg });
  }
}

function toPretty(time: Date, level: LogLevel, message: string, fields: LogFields): string {
  const clock = time.toISOString().slice(11, 19);
  const { error, ...rest } = fields;
  const details = Object.entries(rest)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  const stack =
    error && typeof error === "object" && "stack" in error && typeof error.stack === "string"
      ? `\n${error.stack}`
      : error === undefined
        ? ""
        : ` error=${JSON.stringify(error)}`;
  return `${clock} ${level.toUpperCase().padEnd(5)} ${message}${details ? ` ${details}` : ""}${stack}`;
}
