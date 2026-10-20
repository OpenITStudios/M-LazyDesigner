import { afterEach, describe, expect, test } from "bun:test";
import ts from "typescript-compat";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mapTypeScriptProgramFile,
  mapTypeScriptSource,
} from "../../scripts/development/build-development-symbol-map";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true })
    )
  );
});

describe("development symbol map", () => {
  test("keeps syntax-only mapping available as the zero-setup fallback", () => {
    const mapped = mapTypeScriptSource(
      "export const value = 42; export function label(input) { return String(input); }"
    );
    expect(
      mapped.symbols.find((symbol) => symbol.name === "value")?.signature
    ).toContain("unknown");
  });

  test("uses TypeScript compiler inference without expanding the output shape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazydesigner-symbol-map-"));
    tempDirs.push(dir);
    const file = join(dir, "fixture.ts");
    await writeFile(
      file,
      [
        "export const value = 42;",
        "export function label(input = value) {",
        "  return String(input);",
        "}",
      ].join("\n"),
      "utf8"
    );

    const program = ts.createProgram({
      rootNames: [file],
      options: {
        strict: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
    });

    const mapped = mapTypeScriptProgramFile(program, file, "fixture.ts");
    const value = mapped.symbols.find((symbol) => symbol.name === "value");
    const label = mapped.symbols.find((symbol) => symbol.name === "label");

    expect(value?.signature).not.toContain("unknown");
    expect(label?.signature).toContain("): string");
    expect(Object.keys(mapped).sort()).toEqual(["imports", "path", "symbols"]);
  });
});