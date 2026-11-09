import {
  parseThemeSnapshot, THEME_COLOR_KEYS,
  type ThemeColors, type ThemeSnapshot,
} from "./themeSnapshot";

/** Minimal theme observation boundary. Caller supplies the current Blockbench theme
 * and an owned, permission-scoped transport; this module never mutates Blockbench. */
export type ThemeObserverDependencies = {
  readColors(): unknown;
  publish(snapshot: ThemeSnapshot): void;
  now(): number;
  profileId: string;
  generation: string;
};
export type ThemeObserver = {
  observe(): "published" | "unchanged" | "unavailable";
  dispose(): void;
};

/** Accept only a complete palette. No partial theme may masquerade as active. */
export function extractThemeColors(value: unknown): ThemeColors | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const colors: Record<string, unknown> = {};
  for (const key of THEME_COLOR_KEYS) colors[key] = source[key];
  const candidate = parseThemeSnapshot({
    schema: 1,
    profile_id: "a".repeat(32),
    generation: "00000000-0000-0000-0000-000000000000",
    revision: 1,
    observed_at_unix_ms: 1,
    colors,
  }, "a".repeat(32));
  return candidate?.colors ?? null;
}

/** Change-driven, fail-closed publisher. The caller owns timer/listener lifecycle.
 * Never publishes on missing/partial theme, and never retries a failed publish
 * without an explicit subsequent observation. */
export function createThemeObserver(deps: ThemeObserverDependencies): ThemeObserver {
  let revision = 0;
  let lastSignature: string | null = null;
  let lastObserved = 0;
  let disposed = false;
  return {
    observe() {
      if (disposed) return "unavailable";
      let colors: ThemeColors | null;
      try { colors = extractThemeColors(deps.readColors()); }
      catch { return "unavailable"; }
      if (!colors) return "unavailable";
      const signature = THEME_COLOR_KEYS.map(key => colors[key]).join("|");
      if (signature === lastSignature) return "unchanged";
      const now = deps.now();
      if (!Number.isSafeInteger(now) || now <= 0) return "unavailable";
      const observedAt = Math.max(now, lastObserved);
      const snapshot = parseThemeSnapshot({
        schema: 1,
        profile_id: deps.profileId,
        generation: deps.generation,
        revision: revision + 1,
        observed_at_unix_ms: observedAt,
        colors,
      }, deps.profileId);
      if (!snapshot) return "unavailable";
      try { deps.publish(snapshot); }
      catch { return "unavailable"; }
      revision = snapshot.revision;
      lastObserved = snapshot.observed_at_unix_ms;
      lastSignature = signature;
      return "published";
    },
    dispose() { disposed = true; },
  };
}
