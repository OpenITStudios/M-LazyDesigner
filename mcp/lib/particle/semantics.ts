import { MOLANG_ANIMATION_MATH_SYMBOLS } from "../animation/molangSemantics";
import type {
  JsonObject,
  JsonValue,
  ParticleDiagnostic,
} from "./documentCore";

export const BEDROCK_PARTICLE_SPECIAL_MOLANG_VARIABLES = Object.freeze([
  "variable.emitter_age",
  "variable.emitter_lifetime",
  "variable.emitter_random_1",
  "variable.emitter_random_2",
  "variable.emitter_random_3",
  "variable.emitter_random_4",
  "variable.entity_scale",
  "variable.particle_age",
  "variable.particle_lifetime",
  "variable.particle_random_1",
  "variable.particle_random_2",
  "variable.particle_random_3",
  "variable.particle_random_4",
] as const);

const OFFICIAL_MATH = new Set<string>(MOLANG_ANIMATION_MATH_SYMBOLS);
const RANDOM_MATH = new Set(["die_roll", "die_roll_integer", "random", "random_integer"]);
const NON_EXPRESSION_KEYS = new Set([
  "identifier",
  "material",
  "texture",
  "effect",
  "type",
  "event",
  "event_name",
  "facing_camera_mode",
  "mode",
]);
const STATEMENT_FIELDS = new Set([
  "creation_expression",
  "per_update_expression",
  "per_render_expression",
  "expression",
  "pre_effect_expression",
]);
const LIMIT = 32;

type LocatedExpression = { path: string; key: string; expression: string };

function obj(value: JsonValue | undefined): JsonObject | null {
  return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function emit(
  diagnostics: ParticleDiagnostic[],
  severity: ParticleDiagnostic["severity"],
  code: string,
  message: string,
  path: string
): void {
  if (diagnostics.length < LIMIT - 1) {
    diagnostics.push({ severity, code, message, path });
    return;
  }
  // An error beyond the output window is still a blocking error. Never
  // turn the last error into an informational truncation message.
  const hiddenError = severity === "error" ||
    diagnostics[LIMIT - 1]?.severity === "error";
  diagnostics[LIMIT - 1] = {
    severity: hiddenError ? "error" : "info",
    code: hiddenError
      ? "particle_semantic_diagnostics_truncated_with_errors"
      : "particle_semantic_diagnostics_truncated",
    message: hiddenError
      ? "Advanced particle diagnostics exceeded the limit with errors; document is not valid."
      : `Advanced particle diagnostics were bounded to ${LIMIT} entries.`,
    path: "particle_effect",
  };
}

function legacyMolang(value: JsonValue | undefined): boolean {
  const current = obj(value);
  return Boolean(current && typeof current.expression === "string");
}

function isScalar(value: JsonValue | undefined): boolean {
  return typeof value === "number" || typeof value === "string" || legacyMolang(value);
}

function validateScalar(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue | undefined,
  path: string,
  required = false
): void {
  if (value === undefined) {
    if (required) emit(diagnostics, "error", "missing_molang_scalar", `${path} requires a number or Molang expression.`, path);
    return;
  }
  if (!isScalar(value)) {
    emit(diagnostics, "error", "invalid_molang_scalar", `${path} must be a number, Molang string, or legacy Molang expression object.`, path);
  }
}

function validateVector(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue | undefined,
  length: number,
  path: string,
  required = false
): void {
  if (value === undefined) {
    if (required) emit(diagnostics, "error", "missing_molang_vector", `${path} requires ${length} numeric/Molang values.`, path);
    return;
  }
  if (!Array.isArray(value) || value.length !== length) {
    emit(diagnostics, "error", "invalid_molang_vector", `${path} must contain exactly ${length} numeric/Molang values.`, path);
    return;
  }
  value.forEach((entry, index) => {
    if (!isScalar(entry)) {
      emit(diagnostics, "error", "invalid_molang_vector_member", `${path}[${index}] must be a number or Molang expression.`, `${path}[${index}]`);
    }
  });
}

function pathJoin(parent: string, child: string | number): string {
  if (typeof child === "number") return `${parent}[${child}]`;
  return parent ? `${parent}.${child}` : child;
}

function likelyMolang(value: string, key: string): boolean {
  if (NON_EXPRESSION_KEYS.has(key)) return false;
  const text = value.trim();
  return Boolean(
    text &&
      (/\b(?:math|variable|query|temp|context|v|q|t|c)\.[a-z_]/i.test(text) ||
        /[+*/%?<>]=?|==|!=|&&|\|\|/.test(text) ||
        /\breturn\b|[;{}]/i.test(text))
  );
}

function collectExpressions(
  value: JsonValue,
  path: string,
  key: string,
  output: LocatedExpression[]
): void {
  if (typeof value === "string") {
    if (likelyMolang(value, key)) output.push({ path, key, expression: value.trim() });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectExpressions(entry, pathJoin(path, index), key, output));
    return;
  }
  const current = obj(value);
  if (!current) return;
  for (const [childKey, child] of Object.entries(current)) {
    collectExpressions(child, pathJoin(path, childKey), childKey, output);
  }
}

function mathSymbols(expression: string): string[] {
  const found = new Set<string>();
  for (const match of expression.matchAll(/\bmath\.([a-z_][a-z0-9_]*)\s*\(/gi)) found.add(match[1].toLowerCase());
  if (/\bmath\.pi\b/i.test(expression)) found.add("pi");
  return [...found].sort();
}

function scopedVariables(expression: string): string[] {
  const aliases: Record<string, string> = { v: "variable", variable: "variable", q: "query", query: "query", t: "temp", temp: "temp", c: "context", context: "context" };
  const found = new Set<string>();
  for (const match of expression.matchAll(/\b(v|variable|q|query|t|temp|c|context)\.([a-z_][a-z0-9_]*)/gi)) {
    found.add(`${aliases[match[1].toLowerCase()]}.${match[2].toLowerCase()}`);
  }
  return [...found].sort();
}

function delimiterProblem(expression: string): string | null {
  const stack: string[] = [];
  const pair: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const char of expression) {
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === "(" || char === "[" || char === "{") { stack.push(char); continue; }
    if (char === ")" || char === "]" || char === "}") {
      if (stack.pop() !== pair[char]) return `Unexpected ${char}.`;
    }
  }
  if (quote) return "Unterminated quoted string.";
  return stack.length ? `Unclosed ${stack[stack.length - 1]}.` : null;
}

function literalZeroDivisor(expression: string): boolean {
  return /\/\s*(?:\(\s*)?0+(?:\.0+)?(?:\s*\))?(?![\d.])/i.test(expression) || /\bmath\.mod\s*\([^,]+,\s*0+(?:\.0+)?\s*\)/i.test(expression);
}

function validateKnownMathSlots(diagnostics: ParticleDiagnostic[], components: JsonObject): void {
  const scalars = [
    ["minecraft:emitter_rate_instant", "num_particles"],
    ["minecraft:emitter_rate_steady", "spawn_rate"],
    ["minecraft:emitter_rate_steady", "max_particles"],
    ["minecraft:emitter_rate_manual", "max_particles"],
    ["minecraft:emitter_lifetime_looping", "active_time"],
    ["minecraft:emitter_lifetime_looping", "sleep_time"],
    ["minecraft:emitter_lifetime_once", "active_time"],
    ["minecraft:emitter_shape_sphere", "radius"],
    ["minecraft:emitter_shape_disc", "radius"],
    ["minecraft:particle_lifetime_expression", "max_lifetime"],
    ["minecraft:particle_initial_spin", "rotation"],
    ["minecraft:particle_initial_spin", "rotation_rate"],
    ["minecraft:particle_motion_dynamic", "linear_drag_coefficient"],
    ["minecraft:particle_motion_dynamic", "rotation_acceleration"],
    ["minecraft:particle_motion_dynamic", "rotation_drag_coefficient"],
    ["minecraft:particle_motion_parametric", "rotation"],
    ["minecraft:particle_motion_collision", "collision_drag"],
    ["minecraft:particle_motion_collision", "coefficient_of_restitution"],
    ["minecraft:particle_motion_collision", "collision_radius"],
  ] as const;
  for (const [componentName, field] of scalars) {
    const component = obj(components[componentName]);
    if (component) validateScalar(diagnostics, component[field], `particle_effect.components.${componentName}.${field}`);
  }

  const vectors = [
    ["minecraft:emitter_shape_point", "offset", 3],
    ["minecraft:emitter_shape_sphere", "offset", 3],
    ["minecraft:emitter_shape_box", "offset", 3],
    ["minecraft:emitter_shape_box", "half_dimensions", 3],
    ["minecraft:emitter_shape_disc", "offset", 3],
    ["minecraft:emitter_shape_disc", "plane_normal", 3],
    ["minecraft:emitter_shape_custom", "offset", 3],
    ["minecraft:particle_motion_dynamic", "linear_acceleration", 3],
    ["minecraft:particle_motion_parametric", "relative_position", 3],
    ["minecraft:particle_motion_parametric", "direction", 3],
  ] as const;
  for (const [componentName, field, length] of vectors) {
    const component = obj(components[componentName]);
    if (component && component[field] !== undefined) {
      validateVector(diagnostics, component[field], length, `particle_effect.components.${componentName}.${field}`);
    }
  }

  const initialSpeed = components["minecraft:particle_initial_speed"];
  if (initialSpeed !== undefined) {
    if (Array.isArray(initialSpeed)) validateVector(diagnostics, initialSpeed, 3, "particle_effect.components.minecraft:particle_initial_speed");
    else validateScalar(diagnostics, initialSpeed, "particle_effect.components.minecraft:particle_initial_speed");
  }
  if (components["minecraft:particle_kill_plane"] !== undefined) {
    validateVector(diagnostics, components["minecraft:particle_kill_plane"], 4, "particle_effect.components.minecraft:particle_kill_plane");
  }

  const billboard = obj(components["minecraft:particle_appearance_billboard"]);
  if (billboard?.size !== undefined) validateVector(diagnostics, billboard.size, 2, "particle_effect.components.minecraft:particle_appearance_billboard.size");
  const direction = billboard ? obj(billboard.direction) : null;
  if (direction?.custom_direction !== undefined) validateVector(diagnostics, direction.custom_direction, 3, "particle_effect.components.minecraft:particle_appearance_billboard.direction.custom_direction");
  if (direction?.min_speed_threshold !== undefined) validateScalar(diagnostics, direction.min_speed_threshold, "particle_effect.components.minecraft:particle_appearance_billboard.direction.min_speed_threshold");
}

function validateFlipbook(diagnostics: ParticleDiagnostic[], components: JsonObject): void {
  const billboard = obj(components["minecraft:particle_appearance_billboard"]);
  const uv = billboard ? obj(billboard.uv) : null;
  if (!uv) return;
  for (const dimension of ["texture_width", "texture_height"] as const) {
    const value = uv[dimension];
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
      emit(diagnostics, "error", "invalid_particle_texture_dimension", `${dimension} must be a positive integer when authored.`, `particle_effect.components.minecraft:particle_appearance_billboard.uv.${dimension}`);
    }
  }
  if (uv.uv !== undefined) validateVector(diagnostics, uv.uv, 2, "particle_effect.components.minecraft:particle_appearance_billboard.uv.uv");
  if (uv.uv_size !== undefined) validateVector(diagnostics, uv.uv_size, 2, "particle_effect.components.minecraft:particle_appearance_billboard.uv.uv_size");
  const flipbook = obj(uv.flipbook);
  if (!flipbook) return;
  for (const [field, length] of [["base_UV", 2], ["size_UV", 2], ["step_UV", 2]] as const) {
    if (flipbook[field] !== undefined) validateVector(diagnostics, flipbook[field], length, `particle_effect.components.minecraft:particle_appearance_billboard.uv.flipbook.${field}`);
  }
  validateScalar(diagnostics, flipbook.max_frame, "particle_effect.components.minecraft:particle_appearance_billboard.uv.flipbook.max_frame", true);
  const fps = flipbook.frames_per_second;
  if (fps !== undefined && (typeof fps !== "number" || !Number.isFinite(fps) || fps < 0)) {
    emit(diagnostics, "error", "invalid_flipbook_fps", "frames_per_second must be a finite non-negative number.", "particle_effect.components.minecraft:particle_appearance_billboard.uv.flipbook.frames_per_second");
  }
  for (const flag of ["stretch_to_lifetime", "loop"] as const) {
    if (flipbook[flag] !== undefined && typeof flipbook[flag] !== "boolean") emit(diagnostics, "error", "invalid_flipbook_flag", `${flag} must be boolean when authored.`, `particle_effect.components.minecraft:particle_appearance_billboard.uv.flipbook.${flag}`);
  }

  const width = typeof uv.texture_width === "number" && uv.texture_width > 0 ? uv.texture_width : null;
  const height = typeof uv.texture_height === "number" && uv.texture_height > 0 ? uv.texture_height : null;
  const base = flipbook.base_UV;
  const size = flipbook.size_UV;
  const step = flipbook.step_UV;
  const maxFrame = typeof flipbook.max_frame === "number" ? flipbook.max_frame : null;
  if (width && height && Array.isArray(base) && Array.isArray(size) && Array.isArray(step) && base.length === 2 && size.length === 2 && step.length === 2 && base.every((v) => typeof v === "number") && size.every((v) => typeof v === "number") && step.every((v) => typeof v === "number") && maxFrame !== null && Number.isFinite(maxFrame) && maxFrame >= 1) {
    const frame = Math.max(0, Math.ceil(maxFrame) - 1);
    const lastU = (base[0] as number) + (step[0] as number) * frame;
    const lastV = (base[1] as number) + (step[1] as number) * frame;
    const minU = Math.min(base[0] as number, lastU);
    const minV = Math.min(base[1] as number, lastV);
    const maxU = Math.max(base[0] as number, lastU) + (size[0] as number);
    const maxV = Math.max(base[1] as number, lastV) + (size[1] as number);
    if (minU < 0 || minV < 0 || maxU > width || maxV > height) emit(diagnostics, "warning", "flipbook_frame_outside_texture", "The literal flipbook frame sequence extends outside the authored particle texture dimensions.", "particle_effect.components.minecraft:particle_appearance_billboard.uv.flipbook");
  }
}

/**
 * Authoring-only visual visibility/timing clues from literal fields.
 * No Molang evaluation, PNG decode, pixel claim or texture-simulation loop.
 */
function inspectStaticAppearance(diagnostics: ParticleDiagnostic[], effect: JsonObject, components: JsonObject): void {
  const appearance = obj(components["minecraft:particle_appearance_billboard"]);
  const size = appearance?.size;
  if (Array.isArray(size) && size.length === 2 &&
      size.some(value => typeof value === "number" && value === 0)) {
    emit(diagnostics, "warning", "particle_billboard_zero_axis",
      "A constant zero billboard axis may make the sprite invisible. Verify it is deliberate.",
      "particle_effect.components.minecraft:particle_appearance_billboard.size");
  }

  const tint = obj(components["minecraft:particle_appearance_tinting"]);
  const color = tint?.color;
  const zeroAlpha = (Array.isArray(color) && color.length === 4 &&
      typeof color[3] === "number" && color[3] === 0) ||
    (typeof color === "string" && /^#[0-9a-fA-F]{6}00$/.test(color));
  if (zeroAlpha) {
    emit(diagnostics, "warning", "particle_constant_zero_tint_alpha",
      "Static tint has zero alpha. Depending on particle material, the sprite may be invisible; confirm intent in the target renderer.",
      "particle_effect.components.minecraft:particle_appearance_tinting.color");
  }

  const uv = obj(appearance?.uv);
  const flipbook = obj(uv?.flipbook);
  if (!flipbook) return;
  const frameCount = typeof flipbook.max_frame === "number" &&
      Number.isFinite(flipbook.max_frame) ? flipbook.max_frame : null;
  const fps = flipbook.frames_per_second === undefined ? 0
    : typeof flipbook.frames_per_second === "number" && Number.isFinite(flipbook.frames_per_second)
      ? flipbook.frames_per_second : null;
  if (frameCount === null || frameCount <= 1 || flipbook.stretch_to_lifetime === true) return;
  if (fps === 0) {
    emit(diagnostics, "warning", "particle_flipbook_static_frames",
      "Multi-frame flipbook has no effective frame rate or lifetime stretch; verify the intended animation is not frozen.",
      "particle_effect.components.minecraft:particle_appearance_billboard.uv.flipbook.frames_per_second");
    return;
  }
  if (fps === null || fps < 0 || flipbook.loop === true) return;
  const lifetimeComponent = obj(components["minecraft:particle_lifetime_expression"]);
  const lifetime = lifetimeComponent?.max_lifetime;
  if (typeof lifetime === "number" && Number.isFinite(lifetime) && lifetime > 0 &&
      fps * lifetime + 1e-9 < frameCount - 1) {
    emit(diagnostics, "warning", "particle_flipbook_lifetime_too_short",
      "Literal particle lifetime and flipbook FPS may expire before the final frame. Confirm the intended visual ending.",
      "particle_effect.components.minecraft:particle_appearance_billboard.uv.flipbook");
  }
}

function validateCurves(diagnostics: ParticleDiagnostic[], curves: JsonObject): void {
  for (const [name, raw] of Object.entries(curves)) {
    const curve = obj(raw);
    if (!curve) continue;
    const type = typeof curve.type === "string" ? curve.type : null;
    const nodes = curve.nodes;
    if (type === "bezier" && (!Array.isArray(nodes) || nodes.length !== 4)) emit(diagnostics, "error", "invalid_bezier_curve_nodes", `Bezier curve "${name}" requires exactly four control nodes.`, `particle_effect.curves.${name}.nodes`);
    if (type === "linear" && (!Array.isArray(nodes) || nodes.length < 2)) emit(diagnostics, "error", "invalid_linear_curve_nodes", `Linear curve "${name}" requires at least two nodes.`, `particle_effect.curves.${name}.nodes`);
    if (type === "catmull_rom" && (!Array.isArray(nodes) || nodes.length < 4)) emit(diagnostics, "error", "invalid_catmull_rom_curve_nodes", `Catmull-Rom curve "${name}" requires at least four nodes.`, `particle_effect.curves.${name}.nodes`);
    if (type === "bezier_chain") {
      const chain = obj(nodes);
      if (!chain || Object.keys(chain).length < 2) emit(diagnostics, "error", "invalid_bezier_chain_nodes", `Bezier-chain curve "${name}" requires at least two keyed node objects.`, `particle_effect.curves.${name}.nodes`);
      else {
        for (const [key, rawNode] of Object.entries(chain)) {
          if (!Number.isFinite(Number(key))) emit(diagnostics, "error", "invalid_bezier_chain_key", `Bezier-chain key "${key}" must be numeric.`, `particle_effect.curves.${name}.nodes.${key}`);
          const node = obj(rawNode);
          if (!node || !isScalar(node.value)) emit(diagnostics, "error", "invalid_bezier_chain_value", `Bezier-chain node "${key}" requires a numeric/Molang value.`, `particle_effect.curves.${name}.nodes.${key}.value`);
          if (node) {
            for (const slope of ["slope", "left_slope", "right_slope", "left_value", "right_value"] as const) {
              if (node[slope] !== undefined) validateScalar(diagnostics, node[slope], `particle_effect.curves.${name}.nodes.${key}.${slope}`);
            }
          }
        }
      }
      if (curve.horizontal_range !== undefined) emit(diagnostics, "info", "bezier_chain_ignores_horizontal_range", `Curve "${name}" is bezier_chain; Bedrock ignores horizontal_range for this curve type.`, `particle_effect.curves.${name}.horizontal_range`);
    }
    validateScalar(diagnostics, curve.input, `particle_effect.curves.${name}.input`, true);
    if (curve.horizontal_range !== undefined) validateScalar(diagnostics, curve.horizontal_range, `particle_effect.curves.${name}.horizontal_range`);
    if (Array.isArray(nodes)) nodes.forEach((node, index) => { if (!isScalar(node)) emit(diagnostics, "error", "invalid_curve_node_value", `Curve node ${index} must be numeric or Molang.`, `particle_effect.curves.${name}.nodes[${index}]`); });
  }
}

function validateRandomizeWeights(diagnostics: ParticleDiagnostic[], value: JsonValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateRandomizeWeights(diagnostics, entry, `${path}[${index}]`));
    return;
  }
  const node = obj(value);
  if (!node) return;
  if (Array.isArray(node.randomize)) {
    let total = 0;
    let valid = true;
    node.randomize.forEach((raw, index) => {
      const branch = obj(raw);
      const weight = branch?.weight;
      if (weight === undefined) total += 1;
      else if (typeof weight === "number" && Number.isFinite(weight) && weight >= 0) total += weight;
      else {
        valid = false;
        emit(diagnostics, "error", "invalid_particle_randomize_weight", "Particle event randomize weight must be a finite non-negative number.", `${path}.randomize[${index}].weight`);
      }
    });
    if (valid && node.randomize.length > 0 && total <= 0) emit(diagnostics, "error", "zero_particle_randomize_weight", "Particle event randomize branches must have a positive total weight.", `${path}.randomize`);
  }
  for (const [key, child] of Object.entries(node)) validateRandomizeWeights(diagnostics, child, `${path}.${key}`);
}

function countNestedEffects(value: JsonValue): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, entry) => sum + countNestedEffects(entry), 0);
  const node = obj(value);
  if (!node) return 0;
  let count = obj(node.particle_effect) ? 1 : 0;
  for (const child of Object.values(node)) count += countNestedEffects(child);
  return count;
}

function analyzeExpressions(diagnostics: ParticleDiagnostic[], expressions: readonly LocatedExpression[]): void {
  let parametricMathCalls = 0;
  let parametricExpressions = 0;
  for (const input of expressions) {
    const delimiter = delimiterProblem(input.expression);
    if (delimiter) {
      emit(diagnostics, "error", "invalid_particle_molang_syntax", `Molang delimiter/quote structure is invalid: ${delimiter}`, input.path);
      continue;
    }
    const symbols = mathSymbols(input.expression);
    symbols.filter((symbol) => !OFFICIAL_MATH.has(symbol)).forEach((symbol) => emit(diagnostics, "warning", "unknown_particle_molang_math", `math.${symbol} is not in BlockIT's current official Bedrock math catalog; preserve only when intentionally targeting a newer runtime.`, input.path));
    if (literalZeroDivisor(input.expression)) emit(diagnostics, "warning", "literal_zero_divisor", "Molang expression contains an obvious literal zero divisor.", input.path);
    if (!STATEMENT_FIELDS.has(input.key) && input.expression.includes(";") && !/\breturn\b/i.test(input.expression)) emit(diagnostics, "warning", "particle_molang_value_missing_return", "This value-producing Molang field contains statements but no explicit return.", input.path);
    const variables = scopedVariables(input.expression);
    if (input.path.includes(".minecraft:emitter_") && variables.some((value) => /^variable\.particle_(?:age|lifetime|random_[1-4])$/.test(value))) emit(diagnostics, "warning", "particle_variable_in_emitter_context", "Emitter-scoped Molang references a per-particle special variable; verify the runtime context supplies it.", input.path);
    if (input.path.endsWith("minecraft:particle_initialization.per_render_expression")) {
      const random = symbols.filter((symbol) => RANDOM_MATH.has(symbol));
      if (random.length) emit(diagnostics, "warning", "per_render_random_molang", `Per-render Molang uses nondeterministic math (${random.map((name) => `math.${name}`).join(", ")}); verify frame-to-frame variation is intentional.`, input.path);
      if (symbols.length >= 6 || input.expression.length > 320) emit(diagnostics, "warning", "expensive_per_render_molang", "Per-render Molang is relatively complex and executes for every rendered particle frame; profile target hardware.", input.path);
    }
    if (input.path.includes(".minecraft:particle_motion_parametric.")) {
      parametricExpressions += 1;
      parametricMathCalls += symbols.length;
    }
  }
  if (parametricExpressions > 0) emit(diagnostics, parametricMathCalls >= 12 ? "warning" : "info", parametricMathCalls >= 12 ? "complex_parametric_motion_molang" : "parametric_motion_molang", parametricMathCalls >= 12 ? "Parametric particle motion contains many math functions and is evaluated every frame; profile target hardware." : "Parametric particle motion uses Molang evaluated every frame; native preview should verify the intended mathematical path.", "particle_effect.components.minecraft:particle_motion_parametric");
}

export function analyzeBedrockParticleSemantics(document: JsonObject): ParticleDiagnostic[] {
  const diagnostics: ParticleDiagnostic[] = [];
  const effect = obj(document.particle_effect);
  if (!effect) return diagnostics;
  const components = obj(effect.components) ?? {};
  const curves = obj(effect.curves) ?? {};
  const events = obj(effect.events) ?? {};

  validateKnownMathSlots(diagnostics, components);
  validateFlipbook(diagnostics, components);
  inspectStaticAppearance(diagnostics, effect, components);
  validateCurves(diagnostics, curves);
  for (const [name, event] of Object.entries(events)) {
    validateRandomizeWeights(diagnostics, event, `particle_effect.events.${name}`);
    const fanout = countNestedEffects(event);
    if (fanout > 6) emit(diagnostics, "warning", "high_particle_event_fanout", `Event "${name}" contains ${fanout} nested particle-effect nodes; verify runtime fan-out is bounded.`, `particle_effect.events.${name}`);
  }

  const expressions: LocatedExpression[] = [];
  collectExpressions(document, "", "", expressions);
  analyzeExpressions(diagnostics, expressions);

  const capOwner = obj(components["minecraft:emitter_rate_steady"]) ?? obj(components["minecraft:emitter_rate_manual"]);
  const cap = capOwner?.max_particles;
  if (components["minecraft:particle_motion_parametric"] !== undefined && typeof cap === "number" && Number.isFinite(cap) && cap > 512) emit(diagnostics, "warning", "parametric_particle_budget", `Parametric per-frame motion is combined with max_particles=${cap}; profile target hardware.`, "particle_effect.components");

  return diagnostics;
}
