import { describe, expect, test } from "bun:test";
import { createThemeObserver, extractThemeColors } from "../plugin/themeObserver";
import { BLOCKBENCH_DARK_COLORS, type ThemeSnapshot } from "../plugin/themeSnapshot";

const profileId = "a".repeat(32);
const generation = "12345678-1234-1234-1234-123456789abc";
describe("isolated Blockbench theme observer", () => {
  test("does not publish partial or arbitrary CSS palette", () => {
    expect(extractThemeColors({ ui: "#123456" })).toBeNull();
    expect(extractThemeColors({ ...BLOCKBENCH_DARK_COLORS, accent: "url(https://example.org)" })).toBeNull();
  });
  test("publishes once per palette and advances revision on change", () => {
    let colors = { ...BLOCKBENCH_DARK_COLORS };
    const published: ThemeSnapshot[] = [];
    const observer = createThemeObserver({
      profileId, generation, readColors: () => colors,
      now: () => 1730000000000, publish: s => published.push(s),
    });
    expect(observer.observe()).toBe("published");
    expect(observer.observe()).toBe("unchanged");
    colors = { ...colors, accent: "#123456" };
    expect(observer.observe()).toBe("published");
    expect(published.map(s => s.revision)).toEqual([1, 2]);
    observer.dispose();
    expect(observer.observe()).toBe("unavailable");
  });
  test("does not mark a failed publish as completed", () => {
    let failures = 1;
    const published: ThemeSnapshot[] = [];
    const observer = createThemeObserver({
      profileId, generation, readColors: () => BLOCKBENCH_DARK_COLORS,
      now: () => 1730000000000,
      publish: s => { if (failures--) throw Error("write failed"); published.push(s); },
    });
    expect(observer.observe()).toBe("unavailable");
    expect(observer.observe()).toBe("published");
    expect(published[0].revision).toBe(1);
  });
  test("does not read or publish after disposal", () => {
    let reads = 0;
    const observer = createThemeObserver({
      profileId, generation, readColors: () => { reads++; return BLOCKBENCH_DARK_COLORS; },
      now: () => 1730000000000, publish: () => {},
    });
    observer.dispose();
    expect(observer.observe()).toBe("unavailable");
    expect(reads).toBe(0);
  });
});
