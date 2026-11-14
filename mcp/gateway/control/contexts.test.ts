import { describe, expect, test } from "bun:test";
import { contentHandle, contextFileSignature, contextForAuthoringDomain, readRequiredAuthoringContext, PROFILE_PATHS } from "./contexts";
import { createHash } from "node:crypto";
import { MODELLING_PATH, TEXTURING_PATH } from "../context/authoring";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ControlContextHandle } from "./types";

function handle(path: string): ControlContextHandle {
  return {
    id: "ctx:test@one.two",
    path,
    sha256: "a".repeat(64),
    semantic_dependencies: ["routing"],
    semantic_revision: "b".repeat(64),
  };
}
function systemError(code: string): Error {
  return Object.assign(new Error("fixture only"), { code });
}

describe("required authoring context resolution", () => {
  test("status context delivery reads canonical source bytes with exact handle integrity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lazydesigner-context-delivery-"));
    const file = pathToFileURL(join(directory, "SKILL.md"));
    const text = "---\nname: lazydesigner-texturing\n---\nRead this actual source.";
    const sha256 = createHash("sha256").update(text).digest("hex");
    const current: ControlContextHandle = {
      ...handle(TEXTURING_PATH),
      id: `ctx:skill/texturing@${sha256.slice(0, 12)}.revision`,
      sha256,
    };
    try {
      await writeFile(file, text);
      expect(await readRequiredAuthoringContext(current, file)).toBe(text);
      await expect(readRequiredAuthoringContext({
        ...current, path: "../../other-system/AGENTS.md",
      }, file)).rejects.toThrow("CONTEXT_DELIVERY_PATH_NOT_ALLOWED");
      await writeFile(file, text + "\\nA stale, unseen instruction.");
      await expect(readRequiredAuthoringContext(current, file))
        .rejects.toThrow("CONTEXT_DELIVERY_SOURCE_CHANGED");
      await writeFile(file, "x".repeat(48_001));
      await expect(readRequiredAuthoringContext(current, file))
        .rejects.toThrow("CONTEXT_DELIVERY_SOURCE_TOO_LARGE");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("cache metadata rejects same-size same-mtime context rewrites", () => {
    const before = { dev: 7, ino: 11, size: 4, mtimeMs: 1700000000000, ctimeMs: 1700000000000 };
    const rewritten = { ...before, ctimeMs: before.ctimeMs + 1 };
    // Old discriminator `${size}:${mtimeMs}` would reuse a stale sha256.
    expect(before.size).toBe(rewritten.size);
    expect(before.mtimeMs).toBe(rewritten.mtimeMs);
    expect(contextFileSignature(before)).not.toBe(contextFileSignature(rewritten));
    expect(contextFileSignature({ ...before })).toBe(contextFileSignature(before));
  });

  test("cache metadata invalidates a replaced context file with identical size and timestamps", () => {
    const before = { dev: 7, ino: 11, size: 42, mtimeMs: 1700000000000, ctimeMs: 1700000000000 };
    const replacement = { ...before, ino: 12 };
    expect(contextFileSignature(before)).not.toBe(contextFileSignature(replacement));
    expect(contextFileSignature(before)).not.toBe(contextFileSignature({ ...before, dev: 8 }));
  });

  test("real contentHandle invalidates a same-size rewritten context with restored mtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lazydesigner-context-cache-"));
    const path = `tests/fixtures/${basename(directory)}.md`;
    const file = pathToFileURL(join(directory, "context.md"));
    const fixedTime = new Date("2024-01-01T00:00:00.000Z");
    try {
      await writeFile(file, "ABCD");
      await utimes(file, fixedTime, fixedTime);
      const firstStat = await stat(file);
      const first = await contentHandle(path, file);
      const cacheHit = await contentHandle(path, file);
      expect(cacheHit).toBe(first);

      // Ensure the filesystem registers a distinct change time even if mtime
      // is then explicitly restored to the previous constant value.
      await new Promise((resolve) => setTimeout(resolve, 25));
      await writeFile(file, "WXYZ");
      await utimes(file, fixedTime, fixedTime);
      const secondStat = await stat(file);
      expect(secondStat.size).toBe(firstStat.size);
      expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
      expect(contextFileSignature(secondStat)).not.toBe(contextFileSignature(firstStat));

      const second = await contentHandle(path, file);
      expect(second.sha256).not.toBe(first.sha256);
      expect(second.id).not.toBe(first.id);
      expect(second.path).toBe(path);
      expect(await contentHandle(path, file)).toBe(second);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("missing specialist is reported without returning a fabricated handle", async () => {
    const result = await contextForAuthoringDomain("TEXTURING", null, async () => {
      throw systemError("ENOENT");
    });
    expect(result.required).toEqual([]);
    expect(result.unavailable).toEqual([
      { path: TEXTURING_PATH, code: "CONTEXT_FILE_MISSING" },
    ]);
  });

  test("missing selected profile does not discard a valid modelling specialist", async () => {
    const result = await contextForAuthoringDomain("GEOMETRY", "HUMANOID", async (path) => {
      if (path === PROFILE_PATHS.HUMANOID) throw systemError("ENOTDIR");
      return handle(path);
    });
    expect(result.required.map((item) => item.path)).toEqual([MODELLING_PATH]);
    expect(result.unavailable).toEqual([
      { path: PROFILE_PATHS.HUMANOID, code: "CONTEXT_FILE_MISSING" },
    ]);
  });

  test("permission refusal is distinct from a missing file", async () => {
    const result = await contextForAuthoringDomain("ANIMATION", null, async () => {
      throw systemError("EACCES");
    });
    expect(result.unavailable[0]?.code).toBe("CONTEXT_FILE_UNREADABLE");
  });

  test("a context path pointing to a directory is unreadable, not Runtime offline", async () => {
    const result = await contextForAuthoringDomain("TEXTURING", null, async () => {
      throw systemError("EISDIR");
    });
    expect(result.unavailable).toEqual([
      { path: TEXTURING_PATH, code: "CONTEXT_FILE_UNREADABLE" },
    ]);
  });

  test("unexpected resolver failures propagate instead of being labelled missing", async () => {
    await expect(contextForAuthoringDomain("GEOMETRY", null, async () => {
      throw new Error("broken resolver");
    })).rejects.toThrow("broken resolver");
  });

  test("healthy context and non-authoring domain retain normal resolution", async () => {
    const healthy = await contextForAuthoringDomain("TEXTURING", null, async (path) => handle(path));
    expect(healthy.required).toHaveLength(1);
    expect(healthy.unavailable).toEqual([]);
    const core = await contextForAuthoringDomain("CORE", null, async () => {
      throw new Error("should not read");
    });
    expect(core).toEqual({ required: [], optional: [], unavailable: [] });
  });
});
