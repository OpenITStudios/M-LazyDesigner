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

/**
 * Read-only authoring signals about IN-GAME cost sources. The game may run
 * many copies of the effect, blend enormous screen coverage, or invoke
 * child events repeatedly; none of those are measurable from this file.
 * Unlike the separate preview admission limits, flags NEVER block or
 * automatically reduce production particle JSON.
 */
export type ParticleGameCostDriver =
  | "numeric_emission_unestimated"
  | "steady_cap_not_numeric"
  | "high_single_emitter_population"
  | "high_continuous_spawn_rate"
  | "long_lived_steady_particles"
  | "translucent_billboard_overdraw_potential"
  | "particle_collision_cost"
  | "parametric_motion_update_cost"
  | "render_expression_or_curve_cost"
  | "nested_effect_activation_cost"
  | "per_particle_nested_event_risk";

export type ParticleGameCostReview = {
  state: "REVIEW_FACTORS" | "NO_STATIC_RISKS_FLAGGED";
  scope: "single_effect_source_only";
  estimated_single_emitter_particles: number | null;
  cost_drivers: ParticleGameCostDriver[];
  visual_quality_verified: false;
  device_fps_verified: false;
  scene_concurrency_verified: false;
};

export function assessParticleGameCost(
  document: JsonObject,
  previewWorkload: ParticlePreviewWorkload,
  childIdentifiers: readonly string[] = [],
): ParticleGameCostReview {
  const effect = object(document.particle_effect);
  const components = object(effect?.components);
  const render = object(object(effect?.description)?.basic_render_parameters);
  const steady = object(components?.["minecraft:emitter_rate_steady"]);
  const lifetime = object(components?.["minecraft:particle_lifetime_expression"]);
  const billboard = object(components?.["minecraft:particle_appearance_billboard"]);
  const collision = object(components?.["minecraft:particle_motion_collision"]);
  const initialization = object(components?.["minecraft:particle_initialization"]);
  const rate = nonnegative(steady?.spawn_rate);
  const seconds = nonnegative(lifetime?.max_lifetime);
  const cap = nonnegative(steady?.max_particles);
  const count = previewWorkload.estimated_active_particles;
  const drivers: ParticleGameCostDriver[] = [];

  if (count === null) drivers.push("numeric_emission_unestimated");
  // "Not numeric" is not "unlimited": Bedrock defaults/expressions depend
  // on schema and host. It simply prevents reliable caller-side budgeting.
  if (steady && cap === null) drivers.push("steady_cap_not_numeric");
  if (count !== null && count > 96)
    drivers.push("high_single_emitter_population");
  if (rate !== null && rate > 64)
    drivers.push("high_continuous_spawn_rate");
  if (steady && seconds !== null && seconds > 3)
    drivers.push("long_lived_steady_particles");

  const size = billboard?.size;
  const w = Array.isArray(size) && size.length === 2 ? nonnegative(size[0]) : null;
  const h = Array.isArray(size) && size.length === 2 ? nonnegative(size[1]) : null;
  // World-space area is only a *potential* alpha-fill signal. Actual
  // screen-space overdraw depends on viewing distance, FOV and overlap.
  if ((render?.material === "particles_blend" || render?.material === "particles_add") &&
      w !== null && h !== null && w * h >= 0.16 &&
      (count === null || count > 8))
    drivers.push("translucent_billboard_overdraw_potential");

  if (collision && collision.enabled !== false)
    drivers.push("particle_collision_cost");
  if (components?.["minecraft:particle_motion_parametric"] !== undefined)
    drivers.push("parametric_motion_update_cost");
  const curves = object(effect?.curves);
  if ((typeof initialization?.per_render_expression === "string" &&
       initialization.per_render_expression.trim().length > 0) ||
      (curves !== null && Object.keys(curves).length > 0))
    drivers.push("render_expression_or_curve_cost");
  if (childIdentifiers.length > 0) {
    drivers.push("nested_effect_activation_cost");
    if (components?.["minecraft:particle_lifetime_events"] !== undefined ||
        (collision && collision.events !== undefined))
      drivers.push("per_particle_nested_event_risk");
  }
  return {
    state: drivers.length > 0 ? "REVIEW_FACTORS" : "NO_STATIC_RISKS_FLAGGED",
    scope: "single_effect_source_only",
    estimated_single_emitter_particles: count,
    cost_drivers: drivers,
    visual_quality_verified: false,
    device_fps_verified: false,
    scene_concurrency_verified: false,
  };
}
