import { assessParticlePreviewWorkload, assessParticleGameCost, type ParticlePreviewWorkload, type ParticleGameCostReview } from "./previewBudget";
import {
  assertJsonValue,
  cloneJsonValue,
  type JsonObject,
  type JsonValue,
} from "../jsonValue";
export {
  assertJsonValue,
  cloneJsonValue,
  type JsonObject,
  type JsonValue,
} from "../jsonValue";

export const BEDROCK_PARTICLE_FORMAT_VERSION = "1.10.0";
export const BEDROCK_PARTICLE_PRESETS = ["steady", "burst", "trail", "ambient", "collision_splash"] as const;
export type BedrockParticlePreset = (typeof BEDROCK_PARTICLE_PRESETS)[number];

export type ParticleDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
};
export type ParticleMutationOperation =
  | { op: "set_identifier"; identifier: string }
  | { op: "set_render"; material?: string | null; texture?: string | null }
  | { op: "set_component"; component: string; value: JsonValue }
  | { op: "remove_component"; component: string }
  | { op: "set_curve"; name: string; value: JsonValue }
  | { op: "remove_curve"; name: string }
  | { op: "set_event"; name: string; value: JsonValue }
  | { op: "remove_event"; name: string }
  | { op: "patch"; path: Array<string | number>; value?: JsonValue; remove?: boolean };

export type ParticleDocumentSummary = {
  format_version: string | number | null;
  identifier: string | null;
  material: string | null;
  texture: string | null;
  component_count: number;
  components: string[];
  component_groups: Record<"emitter" | "particle" | "appearance" | "unknown", string[]>;
  curves: string[];
  events: string[];
  nested_particle_effects: string[];
  estimated_molang_strings: number;
  preview_workload: ParticlePreviewWorkload;
  game_cost: ParticleGameCostReview;
  diagnostics: ParticleDiagnostic[];
};

const CATALOG = {
  emitter: new Set([
    "minecraft:emitter_initialization", "minecraft:emitter_local_space",
    "minecraft:emitter_rate_instant", "minecraft:emitter_rate_steady", "minecraft:emitter_rate_manual",
    "minecraft:emitter_lifetime_looping", "minecraft:emitter_lifetime_once", "minecraft:emitter_lifetime_expression", "minecraft:emitter_lifetime_events",
    "minecraft:emitter_shape_point", "minecraft:emitter_shape_sphere", "minecraft:emitter_shape_box", "minecraft:emitter_shape_disc", "minecraft:emitter_shape_custom", "minecraft:emitter_shape_entity_aabb",
  ]),
  particle: new Set([
    "minecraft:particle_initialization", "minecraft:particle_lifetime_expression", "minecraft:particle_expire_if_in_blocks", "minecraft:particle_expire_if_not_in_blocks", "minecraft:particle_lifetime_events",
    "minecraft:particle_initial_speed", "minecraft:particle_initial_spin", "minecraft:particle_motion_dynamic", "minecraft:particle_motion_parametric", "minecraft:particle_motion_collision", "minecraft:particle_kill_plane",
  ]),
  appearance: new Set([
    "minecraft:particle_appearance_billboard", "minecraft:particle_appearance_tinting", "minecraft:particle_appearance_lighting",
  ]),
};
const RATE = ["minecraft:emitter_rate_instant", "minecraft:emitter_rate_steady", "minecraft:emitter_rate_manual"] as const;
const EMITTER_LIFETIME = ["minecraft:emitter_lifetime_looping", "minecraft:emitter_lifetime_once", "minecraft:emitter_lifetime_expression"] as const;
const SHAPE = ["minecraft:emitter_shape_point", "minecraft:emitter_shape_sphere", "minecraft:emitter_shape_box", "minecraft:emitter_shape_disc", "minecraft:emitter_shape_custom", "minecraft:emitter_shape_entity_aabb"] as const;
const MOTION = ["minecraft:particle_motion_dynamic", "minecraft:particle_motion_parametric"] as const;

export const BEDROCK_PARTICLE_COMPONENT_REFERENCE = {
  materials: ["particles_opaque", "particles_alpha", "particles_blend", "particles_add"],
  facing_camera_modes: [
    "lookat_xyz", "lookat_y", "lookat_direction", "rotate_xyz", "rotate_y",
    "direction_x", "direction_y", "direction_z", "emitter_transform_xy",
    "emitter_transform_xz", "emitter_transform_yz",
  ],
  emitter: {
    "minecraft:emitter_initialization": ["creation_expression", "per_update_expression"],
    "minecraft:emitter_local_space": ["position", "rotation", "velocity"],
    "minecraft:emitter_rate_instant": ["num_particles"],
    "minecraft:emitter_rate_steady": ["spawn_rate", "max_particles"],
    "minecraft:emitter_rate_manual": ["max_particles"],
    "minecraft:emitter_lifetime_looping": ["active_time", "sleep_time"],
    "minecraft:emitter_lifetime_once": ["active_time"],
    "minecraft:emitter_lifetime_expression": ["activation_expression", "expiration_expression"],
    "minecraft:emitter_lifetime_events": ["creation_event", "expiration_event", "timeline", "travel_distance_events", "looping_travel_distance_events"],
    "minecraft:emitter_shape_point": ["offset", "direction"],
    "minecraft:emitter_shape_sphere": ["offset", "radius", "surface_only", "direction"],
    "minecraft:emitter_shape_box": ["offset", "half_dimensions", "surface_only", "direction"],
    "minecraft:emitter_shape_disc": ["offset", "radius", "plane_normal", "surface_only", "direction"],
    "minecraft:emitter_shape_custom": ["offset", "direction"],
    "minecraft:emitter_shape_entity_aabb": ["surface_only", "direction"],
  },
  particle: {
    "minecraft:particle_initialization": ["per_update_expression", "per_render_expression"],
    "minecraft:particle_lifetime_expression": ["max_lifetime", "expiration_expression"],
    "minecraft:particle_expire_if_in_blocks": ["block identifiers[]"],
    "minecraft:particle_expire_if_not_in_blocks": ["block identifiers[]"],
    "minecraft:particle_lifetime_events": ["creation_event", "expiration_event", "timeline"],
    "minecraft:particle_initial_speed": ["Molang scalar or vec3"],
    "minecraft:particle_initial_spin": ["rotation", "rotation_rate"],
    "minecraft:particle_motion_dynamic": ["linear_acceleration", "linear_drag_coefficient", "rotation_acceleration", "rotation_drag_coefficient"],
    "minecraft:particle_motion_parametric": ["relative_position", "direction", "rotation"],
    "minecraft:particle_motion_collision": ["enabled", "collision_drag", "coefficient_of_restitution", "collision_radius", "expire_on_contact", "events"],
    "minecraft:particle_kill_plane": ["plane coefficients [A,B,C,D]"],
  },
  appearance: {
    "minecraft:particle_appearance_billboard": ["size", "facing_camera_mode", "direction", "uv / flipbook"],
    "minecraft:particle_appearance_tinting": ["color / gradient / interpolant"],
    "minecraft:particle_appearance_lighting": [],
  },
  mutually_exclusive: { emitter_rate: RATE, emitter_lifetime: EMITTER_LIFETIME, emitter_shape: SHAPE, particle_motion: MOTION },
} as const;
export const BEDROCK_PARTICLE_CURVE_REFERENCE = {
  types: ["linear", "bezier", "bezier_chain", "catmull_rom"],
  fields: ["type", "input", "horizontal_range", "nodes"],
  rule: "Curve keys are Molang variables and should begin with variable.; the curve output is evaluated into that variable.",
} as const;
export const BEDROCK_PARTICLE_EVENT_REFERENCE = {
  node_fields: ["expression", "log", "particle_effect", "sound_effect", "randomize", "sequence"],
  particle_effect_types: ["emitter", "emitter_bound", "particle", "particle_with_velocity"],
  particle_effect_fields: ["effect", "type", "pre_effect_expression"],
  sound_effect_fields: ["event_name"],
  randomize_extra_fields: ["weight"],
  lifetime_triggers: ["creation_event", "expiration_event", "timeline", "travel_distance_events", "looping_travel_distance_events"],
} as const;
export const BEDROCK_PARTICLE_PRESET_REFERENCE: Record<BedrockParticlePreset, { description: string; intended_use: string }> = {
  steady: { description: "Balanced continuous point emitter with bounded count.", intended_use: "smoke, sparks, magic, exhaust" },
  burst: { description: "Short one-shot spherical burst.", intended_use: "impact, hit, pop" },
  trail: { description: "Short-lived continuous world-space trail.", intended_use: "projectile, vehicle, limb trails" },
  ambient: { description: "Low-rate volume emitter.", intended_use: "dust, spores, aura" },
  collision_splash: { description: "One-shot disc burst with collision expiry.", intended_use: "droplets, debris, splash" },
};

const object = (value: JsonValue | undefined): JsonObject | null => value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const text = (value: JsonValue | undefined): string | null => typeof value === "string" ? value : null;

export function isBedrockParticleIdentifier(value: string): boolean {
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value);
}
function effectOf(document: JsonObject): JsonObject {
  const effect = object(document.particle_effect);
  if (!effect) throw new Error("Particle document must contain a particle_effect object.");
  return effect;
}
function ensure(parent: JsonObject, key: string): JsonObject {
  if (parent[key] === undefined || parent[key] === null) parent[key] = {};
  const result = object(parent[key]);
  if (!result) throw new Error(`${key} must be an object before patching.`);
  return result;
}
function cleanEmpty(parent: JsonObject, key: string) { const value = object(parent[key]); if (value && !Object.keys(value).length) delete parent[key]; }
function billboard(): JsonObject { return { size: [0.1, 0.1], facing_camera_mode: "rotate_xyz", uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } }; }

function presetComponents(preset: BedrockParticlePreset): JsonObject {
  const visual: JsonObject = { "minecraft:particle_lifetime_expression": { max_lifetime: 1 }, "minecraft:particle_appearance_billboard": billboard() };
  if (preset === "steady") return { "minecraft:emitter_rate_steady": { spawn_rate: 16, max_particles: 128 }, "minecraft:emitter_lifetime_looping": { active_time: 1 }, "minecraft:emitter_shape_point": {}, ...visual, "minecraft:particle_initial_speed": 0.5, "minecraft:particle_motion_dynamic": { linear_acceleration: [0, 0.5, 0], linear_drag_coefficient: 0.1 } };
  if (preset === "burst") return { "minecraft:emitter_rate_instant": { num_particles: 12 }, "minecraft:emitter_lifetime_once": { active_time: 0.05 }, "minecraft:emitter_shape_sphere": { radius: 0.25, surface_only: false, direction: "outwards" }, ...visual, "minecraft:particle_lifetime_expression": { max_lifetime: 0.6 }, "minecraft:particle_initial_speed": 1, "minecraft:particle_motion_dynamic": { linear_acceleration: [0, -1, 0] } };
  if (preset === "trail") return { "minecraft:emitter_rate_steady": { spawn_rate: 24, max_particles: 256 }, "minecraft:emitter_lifetime_looping": { active_time: 1 }, "minecraft:emitter_shape_point": {}, ...visual, "minecraft:particle_lifetime_expression": { max_lifetime: 0.5 }, "minecraft:particle_initial_speed": 0 };
  if (preset === "ambient") return { "minecraft:emitter_rate_steady": { spawn_rate: 4, max_particles: 64 }, "minecraft:emitter_lifetime_looping": { active_time: 1 }, "minecraft:emitter_shape_sphere": { radius: 1, surface_only: false }, ...visual, "minecraft:particle_lifetime_expression": { max_lifetime: 2 }, "minecraft:particle_initial_speed": 0.05, "minecraft:particle_motion_dynamic": { linear_acceleration: [0, 0.05, 0], linear_drag_coefficient: 0.05 } };
  return { "minecraft:emitter_rate_instant": { num_particles: 10 }, "minecraft:emitter_lifetime_once": { active_time: 0.05 }, "minecraft:emitter_shape_disc": { radius: 0.15, plane_normal: [0, 1, 0], surface_only: false, direction: "outwards" }, ...visual, "minecraft:particle_lifetime_expression": { max_lifetime: 0.8 }, "minecraft:particle_initial_speed": 1.2, "minecraft:particle_motion_dynamic": { linear_acceleration: [0, -4, 0] }, "minecraft:particle_motion_collision": { collision_drag: 8, coefficient_of_restitution: 0.15, collision_radius: 0.05, expire_on_contact: true } };
}

export function createParticleDocument(input: { identifier: string; material?: string; texture?: string; preset?: BedrockParticlePreset }): JsonObject {
  if (!isBedrockParticleIdentifier(input.identifier)) throw new Error(`Particle identifier "${input.identifier}" must use lowercase namespace:path syntax.`);
  return { format_version: BEDROCK_PARTICLE_FORMAT_VERSION, particle_effect: { description: { identifier: input.identifier, basic_render_parameters: { material: input.material ?? "particles_alpha", texture: input.texture ?? "textures/particle/particles" } }, components: presetComponents(input.preset ?? "steady") } };
}
export function parseParticleDocument(content: string): JsonObject {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch (error) { throw new Error(`Particle JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`); }
  assertJsonValue(parsed, "particle document");
  const document = object(parsed as JsonValue);
  if (!document) throw new Error("Particle document root must be an object.");
  effectOf(document);
  return document;
}

function patch(effect: JsonObject, path: Array<string | number>, value: JsonValue | undefined, remove: boolean) {
  if (!path.length) throw new Error("patch path must not be empty.");
  let current: JsonValue = effect;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i], next = path[i + 1];
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) throw new Error(`patch array index ${segment} is invalid.`);
      current = current[segment];
    } else {
      const currentObject = object(current);
      if (!currentObject) throw new Error(`patch segment "${segment}" expects an object.`);
      if (currentObject[segment] === undefined) {
        if (typeof next === "number") throw new Error(`patch cannot create missing array "${segment}" implicitly.`);
        currentObject[segment] = {};
      }
      current = currentObject[segment];
    }
  }
  const last = path[path.length - 1];
  if (typeof last === "number") {
    if (!Array.isArray(current) || last >= current.length) throw new Error(`patch array index ${last} is invalid.`);
    if (remove) current.splice(last, 1); else current[last] = cloneJsonValue(value as JsonValue);
  } else {
    const currentObject = object(current);
    if (!currentObject) throw new Error(`patch segment "${last}" expects an object.`);
    if (remove) delete currentObject[last]; else currentObject[last] = cloneJsonValue(value as JsonValue);
  }
}

export function applyParticleOperations(source: JsonObject, operations: readonly ParticleMutationOperation[]): JsonObject {
  const document = cloneJsonValue(source), effect = effectOf(document);
  for (const op of operations) {
    if (op.op === "set_identifier") { if (!isBedrockParticleIdentifier(op.identifier)) throw new Error(`Invalid particle identifier "${op.identifier}".`); ensure(effect, "description").identifier = op.identifier; }
    else if (op.op === "set_render") { const render = ensure(ensure(effect, "description"), "basic_render_parameters"); if (op.material !== undefined) op.material === null ? delete render.material : render.material = op.material; if (op.texture !== undefined) op.texture === null ? delete render.texture : render.texture = op.texture; }
    else if (op.op === "set_component") { assertJsonValue(op.value); ensure(effect, "components")[op.component] = cloneJsonValue(op.value); }
    else if (op.op === "remove_component") { const values = object(effect.components); if (values) delete values[op.component]; }
    else if (op.op === "set_curve") { assertJsonValue(op.value); ensure(effect, "curves")[op.name] = cloneJsonValue(op.value); }
    else if (op.op === "remove_curve") { const values = object(effect.curves); if (values) { delete values[op.name]; cleanEmpty(effect, "curves"); } }
    else if (op.op === "set_event") { assertJsonValue(op.value); ensure(effect, "events")[op.name] = cloneJsonValue(op.value); }
    else if (op.op === "remove_event") { const values = object(effect.events); if (values) { delete values[op.name]; cleanEmpty(effect, "events"); } }
    else { if (op.remove === true && op.value !== undefined) throw new Error("patch remove=true must omit value."); if (op.remove !== true && op.value === undefined) throw new Error("patch requires value unless remove=true."); if (op.value !== undefined) assertJsonValue(op.value); patch(effect, op.path, op.value, op.remove === true); }
  }
  return document;
}

function molangCount(value: JsonValue, key = ""): number {
  if (typeof value === "string") return ["identifier", "material", "texture", "effect", "type", "facing_camera_mode"].includes(key) ? 0 : /(?:variable\.|query\.|math\.|temp\.|context\.|[+*?<>]=?)/i.test(value) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce<number>((sum, entry) => sum + molangCount(entry, key), 0);
  if (value && typeof value === "object") return Object.entries(value).reduce((sum, [childKey, entry]) => sum + molangCount(entry, childKey), 0);
  return 0;
}
function nestedEffects(value: JsonValue, out: Set<string>) {
  if (Array.isArray(value)) { value.forEach((entry) => nestedEffects(entry, out)); return; }
  const current = object(value); if (!current) return;
  const nested = object(current.particle_effect), effect = nested ? text(nested.effect) : null;
  if (effect) out.add(effect);
  Object.values(current).forEach((entry) => nestedEffects(entry, out));
}
function eventNames(value: JsonValue | undefined): string[] { return typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
function lifetimeEventRefs(component: JsonObject | null): string[] {
  if (!component) return [];
  const refs = new Set<string>();
  eventNames(component.creation_event).concat(eventNames(component.expiration_event)).forEach((event) => refs.add(event));
  for (const key of ["timeline", "travel_distance_events"]) { const values = object(component[key]); if (values) Object.values(values).forEach((value) => eventNames(value).forEach((event) => refs.add(event))); }
  if (Array.isArray(component.looping_travel_distance_events)) for (const entry of component.looping_travel_distance_events) { const value = object(entry); if (value) eventNames(value.effects).forEach((event) => refs.add(event)); }
  return [...refs];
}
const numberField = (value: JsonObject | null, key: string) => typeof value?.[key] === "number" && Number.isFinite(value[key]) ? value[key] as number : null;
function exclusive(diagnostics: ParticleDiagnostic[], components: JsonObject, code: string, names: readonly string[]) { const present = names.filter((name) => components[name] !== undefined); if (present.length > 1) diagnostics.push({ severity: "error", code, message: `Mutually exclusive components are present together: ${present.join(", ")}.`, path: "particle_effect.components" }); }
function validateFormatVersion(diagnostics: ParticleDiagnostic[], value: JsonValue | undefined) {
  if (value === undefined || value === null || (typeof value !== "string" && typeof value !== "number")) { diagnostics.push({ severity: "error", code: "missing_format_version", message: "Particle document requires format_version.", path: "format_version" }); return; }
  if (typeof value === "number") { diagnostics.push({ severity: "warning", code: "numeric_format_version", message: "Particle format_version is normally authored as a dotted string such as 1.10.0; numeric form is preserved but may be ambiguous.", path: "format_version" }); return; }
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) { diagnostics.push({ severity: "warning", code: "unrecognized_format_version", message: `Particle format_version "${value}" is not a standard dotted version; it is preserved for forward compatibility.`, path: "format_version" }); return; }
  const version = match.slice(1).map(Number);
  if (version[0] < 1 || (version[0] === 1 && version[1] < 10)) diagnostics.push({ severity: "error", code: "legacy_particle_format", message: `Particle format_version ${value} predates the modern 1.10.0 component system.`, path: "format_version" });
}
function arrayLengthDiagnostic(diagnostics: ParticleDiagnostic[], value: JsonValue | undefined, length: number, code: string, path: string) {
  if (Array.isArray(value) && value.length !== length) diagnostics.push({ severity: "error", code, message: `${path} must contain exactly ${length} values.`, path });
}
function validateKnownComponentShapes(diagnostics: ParticleDiagnostic[], components: JsonObject) {
  const vec3 = [
    ["minecraft:emitter_shape_point", "offset"], ["minecraft:emitter_shape_point", "direction"],
    ["minecraft:emitter_shape_custom", "offset"], ["minecraft:emitter_shape_custom", "direction"],
    ["minecraft:emitter_shape_sphere", "offset"], ["minecraft:emitter_shape_box", "offset"],
    ["minecraft:emitter_shape_box", "half_dimensions"], ["minecraft:emitter_shape_disc", "offset"],
    ["minecraft:particle_motion_dynamic", "linear_acceleration"], ["minecraft:particle_motion_parametric", "relative_position"],
    ["minecraft:particle_motion_parametric", "direction"],
  ] as const;
  for (const [component, field] of vec3) arrayLengthDiagnostic(diagnostics, object(components[component])?.[field], 3, "invalid_vec3", `particle_effect.components.${component}.${field}`);
  const initialSpeed = components["minecraft:particle_initial_speed"]; if (Array.isArray(initialSpeed) && initialSpeed.length !== 3) diagnostics.push({ severity: "error", code: "invalid_initial_speed_vector", message: "particle_initial_speed vector must contain exactly 3 values.", path: "particle_effect.components.minecraft:particle_initial_speed" });
  arrayLengthDiagnostic(diagnostics, components["minecraft:particle_kill_plane"], 4, "invalid_kill_plane", "particle_effect.components.minecraft:particle_kill_plane");
  for (const component of ["minecraft:particle_expire_if_in_blocks", "minecraft:particle_expire_if_not_in_blocks"]) { const value = components[component]; if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))) diagnostics.push({ severity: "error", code: "invalid_block_filter", message: `${component} must be an array of block identifier strings.`, path: `particle_effect.components.${component}` }); }
  const billboard = object(components["minecraft:particle_appearance_billboard"]);
  arrayLengthDiagnostic(diagnostics, billboard?.size, 2, "invalid_billboard_size", "particle_effect.components.minecraft:particle_appearance_billboard.size");
  const facing = billboard ? text(billboard.facing_camera_mode) : null; if (facing && !(BEDROCK_PARTICLE_COMPONENT_REFERENCE.facing_camera_modes as readonly string[]).includes(facing)) diagnostics.push({ severity: "warning", code: "unknown_billboard_facing_mode", message: `Billboard facing_camera_mode "${facing}" is not in the current Bedrock reference; preserve only when intentionally targeting another/newer runtime.`, path: "particle_effect.components.minecraft:particle_appearance_billboard.facing_camera_mode" });
  const tint = object(components["minecraft:particle_appearance_tinting"]), color = tint?.color; if (Array.isArray(color) && (color.length < 3 || color.length > 4)) diagnostics.push({ severity: "error", code: "invalid_tint_color", message: "Particle tint color array must contain 3 or 4 values.", path: "particle_effect.components.minecraft:particle_appearance_tinting.color" });
}
function validateCurves(diagnostics: ParticleDiagnostic[], curves: JsonObject) {
  for (const [name, raw] of Object.entries(curves)) {
    if (!name.startsWith("variable.")) diagnostics.push({ severity: "warning", code: "curve_name_not_variable", message: `Curve "${name}" should use a variable.* name so its output is addressable from Molang.`, path: `particle_effect.curves.${name}` });
    const curve = object(raw); if (!curve) { diagnostics.push({ severity: "error", code: "invalid_curve", message: `Curve "${name}" must be an object.`, path: `particle_effect.curves.${name}` }); continue; }
    const type = text(curve.type); if (!type) diagnostics.push({ severity: "error", code: "curve_type_missing", message: `Curve "${name}" requires type.`, path: `particle_effect.curves.${name}.type` });
    else if (!(BEDROCK_PARTICLE_CURVE_REFERENCE.types as readonly string[]).includes(type)) diagnostics.push({ severity: "warning", code: "unknown_curve_type", message: `Curve type "${type}" is not in the current Bedrock reference.`, path: `particle_effect.curves.${name}.type` });
    if (curve.input === undefined) diagnostics.push({ severity: "error", code: "curve_input_missing", message: `Curve "${name}" requires input.`, path: `particle_effect.curves.${name}.input` });
    if (curve.nodes === undefined) diagnostics.push({ severity: "error", code: "curve_nodes_missing", message: `Curve "${name}" requires nodes.`, path: `particle_effect.curves.${name}.nodes` });
  }
}
function validateNestedEventNodes(diagnostics: ParticleDiagnostic[], value: JsonValue, path: string) {
  if (Array.isArray(value)) { value.forEach((entry, index) => validateNestedEventNodes(diagnostics, entry, `${path}.${index}`)); return; }
  const node = object(value); if (!node) return;
  const nested = object(node.particle_effect); if (nested) {
    const effect = text(nested.effect); if (!effect) diagnostics.push({ severity: "error", code: "particle_event_effect_missing", message: "Nested particle event requires an effect identifier.", path: `${path}.particle_effect.effect` });
    const type = text(nested.type); if (type && !(BEDROCK_PARTICLE_EVENT_REFERENCE.particle_effect_types as readonly string[]).includes(type)) diagnostics.push({ severity: "warning", code: "unknown_particle_event_type", message: `Nested particle event type "${type}" is not in the current Bedrock reference.`, path: `${path}.particle_effect.type` });
  }
  const sound = object(node.sound_effect); if (sound && !text(sound.event_name)) diagnostics.push({ severity: "error", code: "sound_event_name_missing", message: "Particle sound event requires event_name.", path: `${path}.sound_effect.event_name` });
  for (const child of ["randomize", "sequence"]) { const branch = node[child]; if (branch !== undefined && !Array.isArray(branch)) diagnostics.push({ severity: "error", code: "invalid_event_branch", message: `${child} must be an array of event nodes.`, path: `${path}.${child}` }); }
  Object.entries(node).forEach(([key, child]) => { if (key !== "particle_effect" && key !== "sound_effect") validateNestedEventNodes(diagnostics, child, `${path}.${key}`); });
}

export function inspectParticleDocument(document: JsonObject): ParticleDocumentSummary {
  const diagnostics: ParticleDiagnostic[] = [], effect = object(document.particle_effect), description = effect ? object(effect.description) : null, render = description ? object(description.basic_render_parameters) : null;
  const components = effect ? object(effect.components) ?? {} : {}, curves = effect ? object(effect.curves) ?? {} : {}, events = effect ? object(effect.events) ?? {} : {};
  const identifier = description ? text(description.identifier) : null, material = render ? text(render.material) : null, texture = render ? text(render.texture) : null;
  validateFormatVersion(diagnostics, document.format_version);
  if (!effect) diagnostics.push({ severity: "error", code: "missing_particle_effect", message: "Missing particle_effect object." });
  if (!identifier || !isBedrockParticleIdentifier(identifier)) diagnostics.push({ severity: "error", code: "invalid_identifier", message: "Particle identifier must use lowercase namespace:path syntax.", path: "particle_effect.description.identifier" });
  if (!material) diagnostics.push({ severity: "error", code: "missing_material", message: "basic_render_parameters.material is required.", path: "particle_effect.description.basic_render_parameters.material" });
  if (!texture) diagnostics.push({ severity: "error", code: "missing_texture", message: "basic_render_parameters.texture is required.", path: "particle_effect.description.basic_render_parameters.texture" });
  exclusive(diagnostics, components, "multiple_emitter_rates", RATE); exclusive(diagnostics, components, "multiple_emitter_lifetimes", EMITTER_LIFETIME); exclusive(diagnostics, components, "multiple_emitter_shapes", SHAPE); exclusive(diagnostics, components, "multiple_particle_motion_models", MOTION);
  validateKnownComponentShapes(diagnostics, components); validateCurves(diagnostics, curves); Object.entries(events).forEach(([name, event]) => validateNestedEventNodes(diagnostics, event, `particle_effect.events.${name}`));
  if (components["minecraft:particle_lifetime_expression"] === undefined) diagnostics.push({ severity: "warning", code: "missing_particle_lifetime", message: "No particle lifetime expression is authored.", path: "particle_effect.components" });
  if (components["minecraft:particle_appearance_billboard"] === undefined) diagnostics.push({ severity: "warning", code: "missing_billboard_appearance", message: "No billboard appearance is authored; verify this is intentional.", path: "particle_effect.components" });
  const local = object(components["minecraft:emitter_local_space"]); if (local?.rotation === true && local.position !== true) diagnostics.push({ severity: "error", code: "invalid_local_space_rotation", message: "emitter_local_space rotation=true requires position=true.", path: "particle_effect.components.minecraft:emitter_local_space" });
  const steady = object(components["minecraft:emitter_rate_steady"]), spawnRate = numberField(steady, "spawn_rate"), burst = numberField(object(components["minecraft:emitter_rate_instant"]), "num_particles"), cap = numberField(steady, "max_particles") ?? numberField(object(components["minecraft:emitter_rate_manual"]), "max_particles");
  if (spawnRate !== null && spawnRate > 500) diagnostics.push({ severity: "warning", code: "high_spawn_rate", message: `spawn_rate ${spawnRate} is high; profile target hardware.` });
  if (burst !== null && burst > 1000) diagnostics.push({ severity: "warning", code: "high_instant_burst", message: `instant num_particles ${burst} is high; profile target hardware.` });
  if (cap !== null && cap > 2000) diagnostics.push({ severity: "warning", code: "high_particle_cap", message: `max_particles ${cap} is high; profile target hardware.` });
  if (cap !== null && cap > 1000 && components["minecraft:particle_motion_collision"] !== undefined) diagnostics.push({ severity: "warning", code: "collision_particle_cost", message: "Collision plus a high particle cap may be expensive." });
  const refs = new Set<string>(); ["minecraft:emitter_lifetime_events", "minecraft:particle_lifetime_events"].forEach((name) => lifetimeEventRefs(object(components[name])).forEach((event) => refs.add(event)));
  const collisionEvents = object(components["minecraft:particle_motion_collision"])?.events;
  if (Array.isArray(collisionEvents)) for (const entry of collisionEvents) { const name = text(object(entry)?.event); if (name) refs.add(name); }
  else { const name = text(object(collisionEvents)?.event); if (name) refs.add(name); }
  const localEvents = new Set(Object.keys(events)); refs.forEach((name) => { if (!localEvents.has(name)) diagnostics.push({ severity: "warning", code: "missing_local_event", message: `Referenced local event "${name}" is not defined.`, path: "particle_effect.events" }); });
  const nested = new Set<string>(); Object.values(events).forEach((event) => nestedEffects(event, nested)); if (identifier && nested.has(identifier)) diagnostics.push({ severity: "warning", code: "self_recursive_particle_event", message: "An event can spawn the same particle identifier; verify recursion is bounded.", path: "particle_effect.events" });
  const groups = { emitter: [] as string[], particle: [] as string[], appearance: [] as string[], unknown: [] as string[] }, names = Object.keys(components).sort();
  for (const name of names) { if (CATALOG.emitter.has(name)) groups.emitter.push(name); else if (CATALOG.particle.has(name)) groups.particle.push(name); else if (CATALOG.appearance.has(name)) groups.appearance.push(name); else groups.unknown.push(name); }
  // One bounded inspection pass serves both editor-preview admission and
  // game-cost *review*. Neither result evaluates MoLang or asserts game FPS.
  const nestedIds = [...nested].sort();
  const previewWorkload = assessParticlePreviewWorkload(document, nestedIds);
  return {
    format_version: typeof document.format_version === "string" || typeof document.format_version === "number" ? document.format_version : null,
    identifier, material, texture, component_count: names.length, components: names,
    component_groups: groups, curves: Object.keys(curves).sort(), events: Object.keys(events).sort(),
    nested_particle_effects: nestedIds, estimated_molang_strings: molangCount(document),
    preview_workload: previewWorkload,
    game_cost: assessParticleGameCost(document, previewWorkload, nestedIds), diagnostics,
  };
}
export const particleDocumentIsValid = (document: JsonObject) => !inspectParticleDocument(document).diagnostics.some((entry) => entry.severity === "error");
export function serializeParticleDocument(document: JsonObject): string { assertJsonValue(document); return `${JSON.stringify(document, null, 2)}\n`; }
