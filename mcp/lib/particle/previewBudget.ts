import type { JsonObject, JsonValue } from "../jsonValue";

/** Bounded single-emitter estimate for native AUTHORING preview, not game FPS. */
export type ParticlePreviewWorkload = {
  state: "within_budget" | "unestimated" | "manual_only" | "blocked";
  estimated_active_particles: number | null;
  reason: string | null;
  scope: "single_emitter_static_heuristic";
};
function object(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject : null;
}
function nonnegative(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value : null;
}
export function assessParticlePreviewWorkload(
  document: JsonObject, children: readonly string[] = [],
): ParticlePreviewWorkload {
  const effect = object(document.particle_effect);
  const components = object(effect?.components);
  const rate = object(components?.["minecraft:emitter_rate_steady"]);
  const burst = object(components?.["minecraft:emitter_rate_instant"]);
  const lifetime = object(components?.["minecraft:particle_lifetime_expression"]);
  const spawnRate = nonnegative(rate?.spawn_rate);
  const count = nonnegative(burst?.num_particles);
  const cap = nonnegative(rate?.max_particles);
  const seconds = nonnegative(lifetime?.max_lifetime);
  // Missing fields and Molang expressions are unknown, never silently
  // defaulted or evaluated by the editor. A cap limits visible population,
  // but a very high spawn rate still creates per-frame work.
  const estimated = count !== null ? count
    : spawnRate !== null && seconds !== null
      ? Math.min(spawnRate * seconds, cap ?? Infinity) : null;
  const identifier = object(effect?.description)?.identifier;
  let state: ParticlePreviewWorkload["state"] = estimated === null
    ? "unestimated" : "within_budget";
  let reason: string | null = null;
  if (children.some(id => id === identifier)) {
    state = "blocked";
    reason = "self-referencing particle event may spawn recursively";
  } else if ((estimated !== null && estimated > 1024) ||
             (spawnRate !== null && spawnRate > 5000)) {
    state = "blocked";
    reason = "particle population or emission rate exceeds manual preview ceiling";
  } else if (children.length || (estimated !== null && estimated > 256) ||
             (spawnRate !== null && spawnRate > 500)) {
    state = "manual_only";
    reason = children.length
      ? "child-effect population is outside the single-emitter estimate"
      : "particle population or emission rate exceeds automatic preview budget";
  }
  return { state, estimated_active_particles: estimated, reason,
    scope: "single_emitter_static_heuristic" };
}
