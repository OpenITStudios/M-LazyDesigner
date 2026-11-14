import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

export type ReadOnlyAuthoringCliResponse = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function parseAuthoringPlanFlags(
  argv: readonly string[],
  errorPrefix: string
): { inputPath: string | null; json: boolean; help: boolean } {
  let inputPath: string | null = null;
  let json = false;
  let help = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" && !help) {
      help = true;
    } else if (arg === "--json" && !json) {
      json = true;
    } else if (arg === "--input" && inputPath === null) {
      inputPath = argv[++index] ?? null;
    } else {
      throw new Error(errorPrefix + "_CLI_ARGUMENT_INVALID");
    }
  }
  if (!help && (!inputPath || inputPath.startsWith("--"))) {
    throw new Error(errorPrefix + "_INPUT_PATH_REQUIRED");
  }
  return { inputPath, json, help };
}

/** Identical read-only input boundary for developer and compiled CLI routes. */
export async function readAuthoringPlanJson(
  inputPath: string,
  errorPrefix: string,
  maxBytes: number
): Promise<{ value: unknown; sha256: string }> {
  let info;
  try { info = await stat(inputPath); }
  catch { throw new Error(errorPrefix + "_INPUT_UNAVAILABLE"); }
  if (!info.isFile() || info.size < 2 || info.size > maxBytes) {
    throw new Error(errorPrefix + "_INPUT_FILE_INVALID");
  }
  const bytes = await readFile(inputPath);
  if (bytes.byteLength > maxBytes) {
    throw new Error(errorPrefix + "_INPUT_TOO_LARGE");
  }
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(errorPrefix + "_INPUT_JSON_INVALID"); }
  return { value, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Never print untrusted plan content or arbitrary local path in CLI errors. */
export function authoringPlanError(
  error: unknown,
  fallback: string
): string {
  const code = error instanceof Error
    ? /^([A-Z][A-Z0-9_]{2,95})(?::|$)/.exec(error.message)?.[1]
    : null;
  return (code ?? fallback) + "\n";
}
