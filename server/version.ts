import fs from "node:fs";

export interface VersionInfo {
  /** The version in package.json. */
  version: string;
  /** The source revision the build was made from, if recorded (APP_REVISION). */
  revision: string | null;
}

export function readVersion(env: NodeJS.ProcessEnv = process.env): VersionInfo {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  return {
    version: typeof packageJson.version === "string" ? packageJson.version : "unknown",
    revision: env.APP_REVISION?.trim() || null,
  };
}
