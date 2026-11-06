import type { JsonObject, JsonValue } from "../jsonValue";

/** Bounded single-emitter estimate for native AUTHORING preview, not game FPS. */
export type ParticlePreviewWorkload = {
  state: "within_budget" | "unestimated" | "manual_only" | "blocked";
  estimated_active_particles: number | null;
  /** Per-loop instant burst size, when a numeric value is authored. */
  instant_burst_particles: number | null;
  /** Numeric looping burst average; not a measured runtime frame rate. */
  looped_burst_particles_per_second: number | null;
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
  const looping = object(components?.["minecraft:emitter_lifetime_looping"]);
  const spawnRate = nonnegative(rate?.spawn_rate);
  const count = nonnegative(burst?.num_particles);
  const cap = nonnegative(rate?.max_particles);
  const seconds = nonnegative(lifetime?.max_lifetime);
  // Bedrock emits instant num_particles once EACH emitter loop. A repeated
  // 12-particle burst every 0.1 seconds is not a permanent population of 12.
  // For finite numeric values, estimate the overlap of recent loop bursts.
  // Omitted sleep_time is documented by Bedrock as zero; an unknown active
  // time, MoLang rate/lifetime, or nonpositive period remains unevaluated.
  const active = nonnegative(looping?.active_time);
  const sleep = looping?.sleep_time === undefined ? 0
    : nonnegative(looping.sleep_time);
  const rawPeriod = looping && active !== null && sleep !== null
    ? active + sleep : null;
  // Two finite authored values may overflow to Infinity when added.
  // Unknown period must not silently behave like an infinite sleep time.
  const period = rawPeriod !== null && Number.isFinite(rawPeriod)
    ? rawPeriod : null;
  // Clamp arithmetic before exposing it to a JSON receipt. Finite authored
  // values can overflow on division/multiplication; zero * Infinity is NaN.
  const loopedRate = looping && count !== null && period !== null && period > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, count / period) : null;
  const estimated = count !== null
    ? looping
      ? period !== null && period > 0 && seconds !== null
        ? count === 0 ? 0
          : Math.min(Number.MAX_SAFE_INTEGER, count * Math.ceil(seconds / period))
        : null
      : count
    : spawnRate !== null && seconds !== null
      ? Math.min(Number.MAX_SAFE_INTEGER, spawnRate * seconds, cap ?? Number.MAX_SAFE_INTEGER) : null;
  const identifier = object(effect?.description)?.identifier;
  let state: ParticlePreviewWorkload["state"] = estimated === null
    ? "unestimated" : "within_budget";
  let reason: string | null = null;
  if (children.some(id => id === identifier)) {
    state = "blocked";
    reason = "self-referencing particle event may spawn recursively";
  } else if (looping && count !== null && period === 0) {
    state = "blocked";
    reason = "zero-period looping instant burst has unbounded repetition risk";
  } else if (looping && count !== null && (period === null || seconds === null)) {
    state = "manual_only";
    reason = "looping burst period or particle lifetime cannot be estimated numerically";
  } else if ((estimated !== null && estimated > 1024) ||
             (spawnRate !== null && spawnRate > 5000) ||
             (loopedRate !== null && loopedRate > 5000)) {
    state = "blocked";
    reason = "particle population or emission rate exceeds manual preview ceiling";
  } else if (children.length || (estimated !== null && estimated > 256) ||
             (spawnRate !== null && spawnRate > 500) ||
             (loopedRate !== null && loopedRate > 500)) {
    state = "manual_only";
    reason = children.length
      ? "child-effect population is outside the single-emitter estimate"
      : "particle population or emission rate exceeds automatic preview budget";
  }
  return { state, estimated_active_particles: estimated,
    instant_burst_particles: count,
    looped_burst_particles_per_second: loopedRate,
    reason, scope: "single_emitter_static_heuristic" };
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
  | "per_particle_nested_event_risk"
  | "repeating_burst_emission"
  | "repeating_emitter_child_events"
  | "high_repeating_burst_rate";

export type ParticleGameCostReview = {
  state: "REVIEW_FACTORS" | "NO_STATIC_RISKS_FLAGGED";
  scope: "single_effect_source_only";
  estimated_single_emitter_particles: number | null;
  cost_drivers: ParticleGameCostDriver[];
  visual_quality_verified: false;
  device_fps_verified: false;
  scene_concurrency_verified: false;
};

/** Resolve only event names actually referenced by a lifetime owner. */
function eventNames(value: JsonValue | undefined): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter(
    (name): name is string => typeof name === "string"
  ) : [];
}
function lifetimeEventNames(component: JsonObject | null): Set<string> {
  const refs = new Set<string>();
  if (!component) return refs;
  for (const name of [...eventNames(component.creation_event),
                      ...eventNames(component.expiration_event)]) refs.add(name);
  for (const key of ["timeline", "travel_distance_events"]) {
    const timeline = object(component[key]);
    if (!timeline) continue;
    for (const value of Object.values(timeline))
      for (const name of eventNames(value)) refs.add(name);
  }
  if (Array.isArray(component.looping_travel_distance_events)) {
    for (const entry of component.looping_travel_distance_events) {
      const nameList = eventNames(object(entry)?.effects);
      for (const name of nameList) refs.add(name);
    }
  }
  return refs;
}
function eventSpawnsChild(value: JsonValue | undefined): boolean {
  // Bounded read-only traversal of one declared event. Overflow errs toward
  // review, not toward saying an unknown event cannot spawn children.
  const pending: Array<JsonValue | undefined> = [value];
  for (let inspected = 0; pending.length > 0; inspected += 1) {
    if (inspected >= 256) return true;
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (const child of current) {
        if (pending.length >= 256) return true;
        pending.push(child);
      }
      continue;
    }
    const node = object(current);
    if (!node) continue;
    if (object(node.particle_effect)) return true;
    // Never spread an untrusted, arbitrarily wide JSON event into arguments
    // or accumulate more than the bounded preview-inspection budget.
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      if (pending.length >= 256) return true;
      pending.push(node[key]);
    }
  }
  return false;
}
function collisionEventNames(collision: JsonObject | null): Set<string> {
  const refs = new Set<string>();
  if (!collision || collision.enabled === false) return refs;
  const events = collision.events;
  const nodes = Array.isArray(events) ? events : events === undefined ? [] : [events];
  for (const entry of nodes) {
    const event = object(entry)?.event;
    for (const name of eventNames(event)) refs.add(name);
  }
  return refs;
}

export function assessParticleGameCost(
  document: JsonObject,
  previewWorkload: ParticlePreviewWorkload,
  childIdentifiers: readonly string[] = [],
): ParticleGameCostReview {
  const effect = object(document.particle_effect);
  const components = object(effect?.components);
  const render = object(object(effect?.description)?.basic_render_parameters);
  const steady = object(components?.["minecraft:emitter_rate_steady"]);
  const burst = object(components?.["minecraft:emitter_rate_instant"]);
  const emitterLoop = object(components?.["minecraft:emitter_lifetime_looping"]);
  const emitterEvents = object(components?.["minecraft:emitter_lifetime_events"]);
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
  // A small instant burst may repeat indefinitely when the emitter loops:
  // the per-burst count alone cannot establish a safe total game workload.
  if (burst && emitterLoop)
    drivers.push("repeating_burst_emission");
  if (previewWorkload.looped_burst_particles_per_second !== null &&
      previewWorkload.looped_burst_particles_per_second > 64)
    drivers.push("high_repeating_burst_rate");
  if (childIdentifiers.length > 0) {
    drivers.push("nested_effect_activation_cost");
    const events = object(effect?.events);
    const childEvents = new Set(Object.entries(events ?? {})
      .filter(([, value]) => eventSpawnsChild(value))
      .map(([name]) => name));
    // A named child event alone does not imply a per-particle spawn. Match
    // actual event references to the emitter/particle/collision owners.
    const emitterRefs = lifetimeEventNames(emitterEvents);
    if (emitterLoop && [...childEvents].some(name => emitterRefs.has(name)))
      drivers.push("repeating_emitter_child_events");
    const particleRefs = lifetimeEventNames(
      object(components?.["minecraft:particle_lifetime_events"])
    );
    const collisionRefs = collisionEventNames(collision);
    if ([...childEvents].some(name => particleRefs.has(name) || collisionRefs.has(name)))
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
