/** Read-only Blockbench theme snapshot contract. No native globals at module load. */
export const THEME_SNAPSHOT_SCHEMA = 1 as const;
export const THEME_COLOR_KEYS = [
  "ui", "back", "dark", "border", "selected", "elevated",
  "button", "accent", "text", "subtle_text",
] as const;
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
export type ThemeColors = Record<ThemeColorKey, string>;
export type ThemeSnapshot = {
  schema: typeof THEME_SNAPSHOT_SCHEMA;
  profile_id: string;
  generation: string;
  revision: number;
  observed_at_unix_ms: number;
  colors: ThemeColors;
};
export const BLOCKBENCH_DARK_COLORS: Readonly<ThemeColors> = Object.freeze({
  ui: "#1e2127", back: "#181b1f", dark: "#101316",
  border: "#101316", selected: "#3b3e49", elevated: "#272a31",
  button: "#33383f", accent: "#3e90ff", text: "#cacad4",
  subtle_text: "#848891",
});
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const PROFILE = /^[0-9a-f]{32}$/;
const GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Reject extra keys, arbitrary CSS, malformed colors, and unbounded payloads. */
export function parseThemeSnapshot(
  value: unknown,
  expectedProfileId: string,
): ThemeSnapshot | null {
  if (!record(value) || !PROFILE.test(expectedProfileId)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 6 || !["schema","profile_id","generation","revision","observed_at_unix_ms","colors"].every(k => keys.includes(k))) return null;
  if (value.schema !== THEME_SNAPSHOT_SCHEMA || value.profile_id !== expectedProfileId
    || typeof value.generation !== "string" || !GENERATION.test(value.generation)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || !Number.isSafeInteger(value.observed_at_unix_ms) || (value.observed_at_unix_ms as number) <= 0
    || !record(value.colors)) return null;
  const colors = value.colors;
  if (Object.keys(colors).length !== THEME_COLOR_KEYS.length
    || !THEME_COLOR_KEYS.every(k => typeof colors[k] === "string" && HEX_COLOR.test(colors[k] as string))) return null;
  return {
    schema: THEME_SNAPSHOT_SCHEMA,
    profile_id: expectedProfileId,
    generation: value.generation,
    revision: value.revision as number,
    observed_at_unix_ms: value.observed_at_unix_ms as number,
    colors: Object.fromEntries(THEME_COLOR_KEYS.map(k => [k, (colors[k] as string).toLowerCase()])) as ThemeColors,
  };
}
/** Monotonic within one producer generation; new generations require a separately verified lease. */
export function isNewerThemeSnapshot(next: ThemeSnapshot, current: ThemeSnapshot): boolean {
  return next.profile_id === current.profile_id
    && next.generation === current.generation
    && next.revision > current.revision
    && next.observed_at_unix_ms >= current.observed_at_unix_ms;
}
