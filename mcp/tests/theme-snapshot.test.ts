import { describe, expect, test } from "bun:test";
import {
  BLOCKBENCH_DARK_COLORS, isNewerThemeSnapshot,
  parseThemeSnapshot, THEME_COLOR_KEYS,
} from "../plugin/themeSnapshot";
const profile = "a".repeat(32);
const base = {
  schema: 1, profile_id: profile,
  generation: "12345678-1234-1234-1234-123456789abc",
  revision: 1, observed_at_unix_ms: 1730000000000,
  colors: { ...BLOCKBENCH_DARK_COLORS },
};
describe("theme snapshot trust boundary", () => {
  test("accepts exact bounded palette and normalizes hex", () => {
    const value = parseThemeSnapshot({ ...base, colors: { ...base.colors, accent: "#ABCDEF" } }, profile);
    expect(value?.colors.accent).toBe("#abcdef");
    expect(Object.keys(value!.colors)).toEqual([...THEME_COLOR_KEYS]);
  });
  test("rejects foreign profile and unknown fields", () => {
    expect(parseThemeSnapshot(base, "b".repeat(32))).toBeNull();
    expect(parseThemeSnapshot({ ...base, css: "body{display:none}" }, profile)).toBeNull();
    expect(parseThemeSnapshot({ ...base, colors: { ...base.colors, injected: "#ffffff" } }, profile)).toBeNull();
  });
  test("rejects CSS expressions, incomplete colors and malformed generation", () => {
    expect(parseThemeSnapshot({ ...base, colors: { ...base.colors, accent: "var(--danger)" } }, profile)).toBeNull();
    const { accent: _removed, ...incomplete } = base.colors;
    expect(parseThemeSnapshot({ ...base, colors: incomplete }, profile)).toBeNull();
    expect(parseThemeSnapshot({ ...base, generation: "wrong" }, profile)).toBeNull();
  });
  test("rejects invalid revision and observation time", () => {
    expect(parseThemeSnapshot({ ...base, revision: -1 }, profile)).toBeNull();
    expect(parseThemeSnapshot({ ...base, revision: 1.5 }, profile)).toBeNull();
    expect(parseThemeSnapshot({ ...base, observed_at_unix_ms: Infinity }, profile)).toBeNull();
  });
  test("accepts newer revision only within same generation and profile", () => {
    const current = parseThemeSnapshot(base, profile)!;
    const next = parseThemeSnapshot({ ...base, revision: 2, observed_at_unix_ms: base.observed_at_unix_ms + 1 }, profile)!;
    expect(isNewerThemeSnapshot(next, current)).toBe(true);
    expect(isNewerThemeSnapshot(current, next)).toBe(false);
    expect(isNewerThemeSnapshot({ ...next, generation: "ffffffff-1234-1234-1234-123456789abc" }, current)).toBe(false);
    expect(isNewerThemeSnapshot({ ...next, observed_at_unix_ms: current.observed_at_unix_ms - 1 }, current)).toBe(false);
  });
});
