import type {
  JsonObject,
  JsonValue,
  ParticleDiagnostic,
} from "./documentCore";

const DIAGNOSTIC_LIMIT = 64;
const BILLBOARD_FACING_MODES = new Set([
  "lookat_xyz",
  "lookat_y",
  "lookat_direction",
  "rotate_xyz",
  "rotate_y",
  "direction_x",
  "direction_y",
  "direction_z",
  "emitter_transform_xy",
  "emitter_transform_xz",
  "emitter_transform_yz",
]);
const BILLBOARD_DIRECTION_MODES = new Set([
  "derive_from_velocity",
  "custom",
  "custom_direction",
]);
const RADIAL_DIRECTIONS = new Set(["inwards", "outwards"]);
const DISC_NORMAL_AXES = new Set(["x", "y", "z"]);
const PARTICLE_EVENT_TYPES = new Set([
  "emitter",
  "emitter_bound",
  "particle",
  "particle_with_velocity",
]);

function object(value: JsonValue | undefined): JsonObject | null {
  return value !== undefined &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
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
  if (diagnostics.length < DIAGNOSTIC_LIMIT - 1) {
    diagnostics.push({ severity, code, message, path });
    return;
  }
  // Reserve the final bounded slot for overflow evidence. A validation
  // error after 63 prior warnings must NEVER be hidden by an info marker.
  const hiddenError = severity === "error" ||
    diagnostics[DIAGNOSTIC_LIMIT - 1]?.severity === "error";
  diagnostics[DIAGNOSTIC_LIMIT - 1] = {
    severity: hiddenError ? "error" : "info",
    code: hiddenError
      ? "particle_schema_diagnostics_truncated_with_errors"
      : "particle_schema_diagnostics_truncated",
    message: hiddenError
      ? "Particle schema diagnostic limit exceeded with error(s); document is not valid."
      : `Particle schema diagnostics were bounded to ${DIAGNOSTIC_LIMIT} entries.`,
    path: "particle_effect",
  };
}

function legacyMolang(value: JsonValue | undefined): boolean {
  const node = object(value);
  if (!node || typeof node.expression !== "string") return false;
  return (
    node.version === undefined ||
    (typeof node.version === "number" && Number.isInteger(node.version))
  );
}

function isMolang(value: JsonValue | undefined): boolean {
  return (
    typeof value === "number" ||
    typeof value === "string" ||
    legacyMolang(value)
  );
}

function validateMolang(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue | undefined,
  path: string,
  required = false
): void {
  if (value === undefined) {
    if (required) {
      emit(
        diagnostics,
        "error",
        "missing_particle_molang",
        `${path} requires a number or Molang expression.`,
        path
      );
    }
    return;
  }
  if (!isMolang(value)) {
    emit(
      diagnostics,
      "error",
      "invalid_particle_molang",
      `${path} must be a number, Molang string, or legacy {expression, version?} object.`,
      path
    );
    return;
  }
  const node = object(value);
  if (
    node &&
    node.version !== undefined &&
    (typeof node.version !== "number" || !Number.isInteger(node.version))
  ) {
    emit(
      diagnostics,
      "error",
      "invalid_legacy_molang_version",
      `${path}.version must be an integer when authored.`,
      `${path}.version`
    );
  }
}

function validateMolangVector(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue | undefined,
  length: number,
  path: string,
  required = false
): void {
  if (value === undefined) {
    if (required) {
      emit(
        diagnostics,
        "error",
        "missing_particle_vector",
        `${path} requires exactly ${length} number/Molang values.`,
        path
      );
    }
    return;
  }
  if (!Array.isArray(value) || value.length !== length) {
    emit(
      diagnostics,
      "error",
      "invalid_particle_vector",
      `${path} must contain exactly ${length} number/Molang values.`,
      path
    );
    return;
  }
  value.forEach((entry, index) =>
    validateMolang(diagnostics, entry, `${path}[${index}]`, true)
  );
}

function validateFiniteNumber(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue | undefined,
  path: string,
  options: { required?: boolean; min?: number; exclusiveMin?: boolean } = {}
): void {
  if (value === undefined) {
    if (options.required) {
      emit(
        diagnostics,
        "error",
        "missing_particle_number",
        `${path} requires a finite number.`,
        path
      );
    }
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    emit(
      diagnostics,
      "error",
      "invalid_particle_number",
      `${path} must be a finite number.`,
      path
    );
    return;
  }
  if (options.min !== undefined) {
    const invalid = options.exclusiveMin
      ? value <= options.min
      : value < options.min;
    if (invalid) {
      emit(
        diagnostics,
        "error",
        "particle_number_out_of_range",
        `${path} must be ${options.exclusiveMin ? "greater than" : "at least"} ${options.min}.`,
        path
      );
    }
  }
}

function validateBoolean(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue | undefined,
  path: string
): void {
  if (value !== undefined && typeof value !== "boolean") {
    emit(
      diagnostics,
      "error",
      "invalid_particle_boolean",
      `${path} must be boolean when authored.`,
      path
    );
  }
}

function validateObjectComponent(
  diagnostics: ParticleDiagnostic[],
  components: JsonObject,
  name: string
): JsonObject | null {
  const value = components[name];
  if (value === undefined) return null;
  const node = object(value);
  if (!node) {
    emit(
      diagnostics,
      "error",
      "invalid_particle_component_shape",
      `${name} must be an object.`,
      `particle_effect.components.${name}`
    );
  }
  return node;
}

function validateInitializationAndLifetime(
  diagnostics: ParticleDiagnostic[],
  components: JsonObject
): void {
  const emitterInitialization = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:emitter_initialization"
  );
  if (emitterInitialization) {
    validateMolang(
      diagnostics,
      emitterInitialization.creation_expression,
      "particle_effect.components.minecraft:emitter_initialization.creation_expression"
    );
    validateMolang(
      diagnostics,
      emitterInitialization.per_update_expression,
      "particle_effect.components.minecraft:emitter_initialization.per_update_expression"
    );
  }

  const emitterLifetime = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:emitter_lifetime_expression"
  );
  if (emitterLifetime) {
    validateMolang(
      diagnostics,
      emitterLifetime.activation_expression,
      "particle_effect.components.minecraft:emitter_lifetime_expression.activation_expression"
    );
    validateMolang(
      diagnostics,
      emitterLifetime.expiration_expression,
      "particle_effect.components.minecraft:emitter_lifetime_expression.expiration_expression"
    );
  }

  const particleInitialization = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:particle_initialization"
  );
  if (particleInitialization) {
    validateMolang(
      diagnostics,
      particleInitialization.per_update_expression,
      "particle_effect.components.minecraft:particle_initialization.per_update_expression"
    );
    validateMolang(
      diagnostics,
      particleInitialization.per_render_expression,
      "particle_effect.components.minecraft:particle_initialization.per_render_expression"
    );
  }

  const particleLifetime = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:particle_lifetime_expression"
  );
  if (particleLifetime) {
    validateMolang(
      diagnostics,
      particleLifetime.max_lifetime,
      "particle_effect.components.minecraft:particle_lifetime_expression.max_lifetime"
    );
    validateMolang(
      diagnostics,
      particleLifetime.expiration_expression,
      "particle_effect.components.minecraft:particle_lifetime_expression.expiration_expression"
    );
  }

  const spin = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:particle_initial_spin"
  );
  if (spin) {
    validateMolang(
      diagnostics,
      spin.rotation,
      "particle_effect.components.minecraft:particle_initial_spin.rotation"
    );
    validateMolang(
      diagnostics,
      spin.rotation_rate,
      "particle_effect.components.minecraft:particle_initial_spin.rotation_rate"
    );
  }
}

function validateRates(
  diagnostics: ParticleDiagnostic[],
  components: JsonObject
): void {
  const specs = [
    ["minecraft:emitter_rate_instant", ["num_particles"]],
    ["minecraft:emitter_rate_manual", ["max_particles"]],
    ["minecraft:emitter_rate_steady", ["spawn_rate", "max_particles"]],
    ["minecraft:emitter_lifetime_looping", ["active_time", "sleep_time"]],
    ["minecraft:emitter_lifetime_once", ["active_time"]],
  ] as const;

  for (const [componentName, fields] of specs) {
    const component = validateObjectComponent(
      diagnostics,
      components,
      componentName
    );
    if (!component) continue;
    for (const field of fields) {
      validateMolang(
        diagnostics,
        component[field],
        `particle_effect.components.${componentName}.${field}`
      );
    }
  }
}

function validateLocalSpace(
  diagnostics: ParticleDiagnostic[],
  components: JsonObject
): void {
  const local = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:emitter_local_space"
  );
  if (!local) return;
  for (const field of ["position", "rotation", "velocity"] as const) {
    validateBoolean(
      diagnostics,
      local[field],
      `particle_effect.components.minecraft:emitter_local_space.${field}`
    );
  }
}

function validateRadialDirection(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue | undefined,
  path: string
): void {
  if (value === undefined) return;
  if (typeof value === "string") {
    if (!RADIAL_DIRECTIONS.has(value)) {
      emit(
        diagnostics,
        "error",
        "invalid_emitter_shape_direction",
        `${path} must be "inwards", "outwards", or a 3-value Molang vector.`,
        path
      );
    }
    return;
  }
  validateMolangVector(diagnostics, value, 3, path, true);
}

function validateShapes(
  diagnostics: ParticleDiagnostic[],
  components: JsonObject
): void {
  for (const name of [
    "minecraft:emitter_shape_box",
    "minecraft:emitter_shape_sphere",
    "minecraft:emitter_shape_disc",
    "minecraft:emitter_shape_entity_aabb",
  ] as const) {
    const shape = validateObjectComponent(diagnostics, components, name);
    if (!shape) continue;
    validateRadialDirection(
      diagnostics,
      shape.direction,
      `particle_effect.components.${name}.direction`
    );
    validateBoolean(
      diagnostics,
      shape.surface_only,
      `particle_effect.components.${name}.surface_only`
    );
  }

  for (const name of [
    "minecraft:emitter_shape_point",
    "minecraft:emitter_shape_custom",
  ] as const) {
    const shape = validateObjectComponent(diagnostics, components, name);
    if (!shape) continue;
    validateMolangVector(
      diagnostics,
      shape.direction,
      3,
      `particle_effect.components.${name}.direction`
    );
  }

  const disc = object(components["minecraft:emitter_shape_disc"]);
  if (disc?.plane_normal !== undefined) {
    const path =
      "particle_effect.components.minecraft:emitter_shape_disc.plane_normal";
    if (typeof disc.plane_normal === "string") {
      if (!DISC_NORMAL_AXES.has(disc.plane_normal)) {
        emit(
          diagnostics,
          "error",
          "invalid_disc_plane_normal",
          `${path} must be "x", "y", "z", or a 3-value Molang vector.`,
          path
        );
      }
    } else {
      validateMolangVector(diagnostics, disc.plane_normal, 3, path, true);
    }
  }
}

function validateEventNames(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue | undefined,
  path: string
): void {
  if (value === undefined) return;
  const values = typeof value === "string" ? [value] : value;
  if (
    !Array.isArray(values) ||
    values.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    emit(
      diagnostics,
      "error",
      "invalid_particle_event_reference",
      `${path} must be a non-empty event name or an array of non-empty event names.`,
      path
    );
  }
}

function validateEventMap(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue | undefined,
  path: string
): void {
  if (value === undefined) return;
  const map = object(value);
  if (!map) {
    emit(
      diagnostics,
      "error",
      "invalid_particle_event_map",
      `${path} must be an object mapping numeric positions to event names.`,
      path
    );
    return;
  }
  for (const [key, names] of Object.entries(map)) {
    const numeric = Number(key);
    if (!Number.isFinite(numeric) || numeric < 0) {
      emit(
        diagnostics,
        "error",
        "invalid_particle_event_map_key",
        `${path}.${key} must use a finite non-negative numeric key.`,
        `${path}.${key}`
      );
    }
    validateEventNames(diagnostics, names, `${path}.${key}`);
  }
}

function validateLifetimeEvents(
  diagnostics: ParticleDiagnostic[],
  components: JsonObject
): void {
  const emitter = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:emitter_lifetime_events"
  );
  if (emitter) {
    validateEventNames(
      diagnostics,
      emitter.creation_event,
      "particle_effect.components.minecraft:emitter_lifetime_events.creation_event"
    );
    validateEventNames(
      diagnostics,
      emitter.expiration_event,
      "particle_effect.components.minecraft:emitter_lifetime_events.expiration_event"
    );
    validateEventMap(
      diagnostics,
      emitter.timeline,
      "particle_effect.components.minecraft:emitter_lifetime_events.timeline"
    );
    validateEventMap(
      diagnostics,
      emitter.travel_distance_events,
      "particle_effect.components.minecraft:emitter_lifetime_events.travel_distance_events"
    );
    if (emitter.looping_travel_distance_events !== undefined) {
      const path =
        "particle_effect.components.minecraft:emitter_lifetime_events.looping_travel_distance_events";
      const loops = emitter.looping_travel_distance_events;
      if (!Array.isArray(loops)) {
        emit(
          diagnostics,
          "error",
          "invalid_looping_travel_distance_events",
          `${path} must be an array.`,
          path
        );
      } else {
        loops.forEach((raw, index) => {
          const itemPath = `${path}[${index}]`;
          const item = object(raw);
          if (!item) {
            emit(
              diagnostics,
              "error",
              "invalid_looping_travel_distance_event",
              `${itemPath} must be an object.`,
              itemPath
            );
            return;
          }
          validateFiniteNumber(
            diagnostics,
            item.distance,
            `${itemPath}.distance`,
            { required: true, min: 0, exclusiveMin: true }
          );
          validateEventNames(
            diagnostics,
            item.effects,
            `${itemPath}.effects`
          );
        });
      }
    }
  }

  const particle = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:particle_lifetime_events"
  );
  if (particle) {
    validateEventNames(
      diagnostics,
      particle.creation_event,
      "particle_effect.components.minecraft:particle_lifetime_events.creation_event"
    );
    validateEventNames(
      diagnostics,
      particle.expiration_event,
      "particle_effect.components.minecraft:particle_lifetime_events.expiration_event"
    );
    validateEventMap(
      diagnostics,
      particle.timeline,
      "particle_effect.components.minecraft:particle_lifetime_events.timeline"
    );
  }
}

function validateBillboard(
  diagnostics: ParticleDiagnostic[],
  components: JsonObject
): void {
  const billboard = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:particle_appearance_billboard"
  );
  if (!billboard) return;

  validateMolangVector(
    diagnostics,
    billboard.size,
    2,
    "particle_effect.components.minecraft:particle_appearance_billboard.size"
  );

  if (billboard.facing_camera_mode !== undefined) {
    const path =
      "particle_effect.components.minecraft:particle_appearance_billboard.facing_camera_mode";
    if (typeof billboard.facing_camera_mode !== "string") {
      emit(
        diagnostics,
        "error",
        "invalid_billboard_facing_mode_type",
        `${path} must be a string.`,
        path
      );
    } else if (!BILLBOARD_FACING_MODES.has(billboard.facing_camera_mode)) {
      emit(
        diagnostics,
        "warning",
        "unknown_billboard_facing_mode",
        `Billboard facing mode "${billboard.facing_camera_mode}" is not in the current stable Bedrock set.`,
        path
      );
    }
  }

  if (billboard.direction !== undefined) {
    const path =
      "particle_effect.components.minecraft:particle_appearance_billboard.direction";
    const direction = object(billboard.direction);
    if (!direction) {
      emit(
        diagnostics,
        "error",
        "invalid_billboard_direction",
        `${path} must be an object.`,
        path
      );
    } else {
      if (direction.mode !== undefined) {
        if (typeof direction.mode !== "string") {
          emit(
            diagnostics,
            "error",
            "invalid_billboard_direction_mode",
            `${path}.mode must be a string.`,
            `${path}.mode`
          );
        } else if (!BILLBOARD_DIRECTION_MODES.has(direction.mode)) {
          emit(
            diagnostics,
            "warning",
            "unknown_billboard_direction_mode",
            `Billboard direction mode "${direction.mode}" is not recognized. Current generated docs use "custom"/"derive_from_velocity"; legacy stable docs used "custom_direction"/"derive_from_velocity".`,
            `${path}.mode`
          );
        }
      }
      if (
        direction.mode === "custom" ||
        direction.mode === "custom_direction"
      ) {
        validateMolangVector(
          diagnostics,
          direction.custom_direction,
          3,
          `${path}.custom_direction`,
          true
        );
      } else if (direction.custom_direction !== undefined) {
        validateMolangVector(
          diagnostics,
          direction.custom_direction,
          3,
          `${path}.custom_direction`
        );
      }
      validateFiniteNumber(
        diagnostics,
        direction.min_speed_threshold,
        `${path}.min_speed_threshold`,
        { min: 0 }
      );
    }
  }

  if (billboard.uv !== undefined) {
    const path =
      "particle_effect.components.minecraft:particle_appearance_billboard.uv";
    const uv = object(billboard.uv);
    if (!uv) {
      emit(
        diagnostics,
        "error",
        "invalid_particle_uv",
        `${path} must be an object.`,
        path
      );
      return;
    }
    const hasStatic = uv.uv !== undefined || uv.uv_size !== undefined;
    const hasFlipbook = uv.flipbook !== undefined;
    if (hasStatic && hasFlipbook) {
      emit(
        diagnostics,
        "error",
        "particle_uv_mode_conflict",
        "Billboard static uv/uv_size and flipbook are alternate UV modes and must not be authored together.",
        path
      );
    }
    if (!hasFlipbook && hasStatic) {
      if ((uv.uv === undefined) !== (uv.uv_size === undefined)) {
        emit(
          diagnostics,
          "error",
          "incomplete_static_particle_uv",
          "Static billboard UV requires both uv and uv_size.",
          path
        );
      }
    }
    const flipbook = object(uv.flipbook);
    if (hasFlipbook && !flipbook) {
      emit(
        diagnostics,
        "error",
        "invalid_particle_flipbook",
        `${path}.flipbook must be an object.`,
        `${path}.flipbook`
      );
    } else if (flipbook) {
      validateMolangVector(
        diagnostics,
        flipbook.base_UV,
        2,
        `${path}.flipbook.base_UV`,
        true
      );
      for (const field of ["size_UV", "step_UV"] as const) {
        const value = flipbook[field];
        if (
          !Array.isArray(value) ||
          value.length !== 2 ||
          value.some(
            (entry) => typeof entry !== "number" || !Number.isFinite(entry)
          )
        ) {
          emit(
            diagnostics,
            "error",
            "invalid_flipbook_numeric_vector",
            `${path}.flipbook.${field} must contain exactly two finite numbers in the current stable schema.`,
            `${path}.flipbook.${field}`
          );
        }
      }
      validateMolang(
        diagnostics,
        flipbook.max_frame,
        `${path}.flipbook.max_frame`,
        true
      );
    }
  }
}

function validHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value);
}

function validateColorValue(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue | undefined,
  path: string,
  allowGradientObject = true
): void {
  if (typeof value === "string") {
    if (!validHexColor(value)) {
      emit(
        diagnostics,
        "error",
        "invalid_particle_hex_color",
        `${path} string colors must use #RRGGBB or an 8-digit hex color.`,
        path
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length < 3 || value.length > 4) {
      emit(
        diagnostics,
        "error",
        "invalid_particle_color_array",
        `${path} must contain 3 or 4 color channels.`,
        path
      );
      return;
    }
    value.forEach((entry, index) => {
      validateMolang(diagnostics, entry, `${path}[${index}]`, true);
      if (
        typeof entry === "number" &&
        Number.isFinite(entry) &&
        (entry < 0 || entry > 1)
      ) {
        emit(
          diagnostics,
          "warning",
          "particle_color_channel_out_of_unit_range",
          `${path}[${index}] is outside the documented 0..1 numeric color range.`,
          `${path}[${index}]`
        );
      }
    });
    return;
  }
  const node = object(value);
  if (!allowGradientObject || !node) {
    emit(
      diagnostics,
      "error",
      "invalid_particle_color",
      `${path} must be a hex color, RGB(A) number/Molang array, or gradient object.`,
      path
    );
    return;
  }
  const gradient = node.gradient;
  if (gradient === undefined) {
    emit(
      diagnostics,
      "error",
      "particle_gradient_missing",
      `${path}.gradient is required for gradient tinting.`,
      `${path}.gradient`
    );
  } else if (Array.isArray(gradient)) {
    if (gradient.length === 0) {
      emit(
        diagnostics,
        "error",
        "empty_particle_gradient",
        `${path}.gradient must contain at least one color.`,
        `${path}.gradient`
      );
    }
    gradient.forEach((entry, index) =>
      validateColorValue(
        diagnostics,
        entry,
        `${path}.gradient[${index}]`,
        false
      )
    );
  } else {
    const gradientMap = object(gradient);
    if (!gradientMap) {
      emit(
        diagnostics,
        "error",
        "invalid_particle_gradient",
        `${path}.gradient must be an array or numeric-keyed object.`,
        `${path}.gradient`
      );
    } else {
      for (const [key, entry] of Object.entries(gradientMap)) {
        const stop = Number(key);
        if (!Number.isFinite(stop)) {
          emit(
            diagnostics,
            "error",
            "invalid_particle_gradient_stop",
            `${path}.gradient key "${key}" must be numeric.`,
            `${path}.gradient.${key}`
          );
        }
        validateColorValue(
          diagnostics,
          entry,
          `${path}.gradient.${key}`,
          false
        );
      }
    }
  }
  validateMolang(
    diagnostics,
    node.interpolant,
    `${path}.interpolant`,
    true
  );
}

function validateAppearance(
  diagnostics: ParticleDiagnostic[],
  components: JsonObject
): void {
  validateBillboard(diagnostics, components);

  const tint = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:particle_appearance_tinting"
  );
  if (tint) {
    if (tint.color === undefined) {
      emit(
        diagnostics,
        "error",
        "particle_tint_color_missing",
        "particle_appearance_tinting requires color.",
        "particle_effect.components.minecraft:particle_appearance_tinting.color"
      );
    } else {
      validateColorValue(
        diagnostics,
        tint.color,
        "particle_effect.components.minecraft:particle_appearance_tinting.color"
      );
    }
  }

  validateObjectComponent(
    diagnostics,
    components,
    "minecraft:particle_appearance_lighting"
  );
}

function validateCollision(
  diagnostics: ParticleDiagnostic[],
  components: JsonObject
): void {
  const collision = validateObjectComponent(
    diagnostics,
    components,
    "minecraft:particle_motion_collision"
  );
  if (!collision) return;

  validateMolang(
    diagnostics,
    collision.enabled,
    "particle_effect.components.minecraft:particle_motion_collision.enabled"
  );
  validateFiniteNumber(
    diagnostics,
    collision.collision_drag,
    "particle_effect.components.minecraft:particle_motion_collision.collision_drag",
    { min: 0 }
  );
  validateFiniteNumber(
    diagnostics,
    collision.coefficient_of_restitution,
    "particle_effect.components.minecraft:particle_motion_collision.coefficient_of_restitution"
  );
  validateFiniteNumber(
    diagnostics,
    collision.collision_radius,
    "particle_effect.components.minecraft:particle_motion_collision.collision_radius",
    { min: 0 }
  );
  validateBoolean(
    diagnostics,
    collision.expire_on_contact,
    "particle_effect.components.minecraft:particle_motion_collision.expire_on_contact"
  );

  if (collision.events !== undefined) {
    const path =
      "particle_effect.components.minecraft:particle_motion_collision.events";
    const entries = Array.isArray(collision.events)
      ? collision.events
      : [collision.events];
    entries.forEach((raw, index) => {
      const itemPath = Array.isArray(collision.events)
        ? `${path}[${index}]`
        : path;
      const event = object(raw);
      if (!event) {
        emit(
          diagnostics,
          "error",
          "invalid_collision_event",
          `${itemPath} must be an object.`,
          itemPath
        );
        return;
      }
      if (
        typeof event.event !== "string" ||
        event.event.trim() === ""
      ) {
        emit(
          diagnostics,
          "error",
          "collision_event_name_missing",
          `${itemPath}.event must be a non-empty local event name.`,
          `${itemPath}.event`
        );
      }
      validateFiniteNumber(
        diagnostics,
        event.min_speed,
        `${itemPath}.min_speed`,
        { min: 0 }
      );
    });
  }
}

function validateEventNode(
  diagnostics: ParticleDiagnostic[],
  value: JsonValue,
  path: string,
  randomBranch = false
): void {
  const node = object(value);
  if (!node) {
    emit(
      diagnostics,
      "error",
      "invalid_particle_event_node",
      `${path} must be an event-node object.`,
      path
    );
    return;
  }

  validateMolang(diagnostics, node.expression, `${path}.expression`);
  if (node.log !== undefined && typeof node.log !== "string") {
    emit(
      diagnostics,
      "error",
      "invalid_particle_event_log",
      `${path}.log must be a string.`,
      `${path}.log`
    );
  }
  if (randomBranch && node.weight !== undefined) {
    validateFiniteNumber(diagnostics, node.weight, `${path}.weight`, { min: 0 });
  }

  if (node.particle_effect !== undefined) {
    const effectPath = `${path}.particle_effect`;
    const visual = object(node.particle_effect);
    if (!visual) {
      emit(
        diagnostics,
        "error",
        "invalid_particle_event_effect",
        `${effectPath} must be an object.`,
        effectPath
      );
    } else {
      if (
        typeof visual.effect !== "string" ||
        visual.effect.trim() === ""
      ) {
        emit(
          diagnostics,
          "error",
          "particle_event_effect_missing",
          `${effectPath}.effect must be a non-empty particle identifier.`,
          `${effectPath}.effect`
        );
      } else if (
        !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(visual.effect)
      ) {
        emit(
          diagnostics,
          "warning",
          "nonstandard_nested_particle_identifier",
          `Nested particle effect "${visual.effect}" is not lowercase namespace:path syntax.`,
          `${effectPath}.effect`
        );
      }
      validateMolang(
        diagnostics,
        visual.pre_effect_expression,
        `${effectPath}.pre_effect_expression`
      );
      if (visual.type !== undefined) {
        if (
          typeof visual.type !== "string" ||
          !PARTICLE_EVENT_TYPES.has(visual.type)
        ) {
          emit(
            diagnostics,
            "error",
            "invalid_particle_event_type",
            `${effectPath}.type must be emitter, emitter_bound, particle, or particle_with_velocity.`,
            `${effectPath}.type`
          );
        }
      }
    }
  }

  if (node.sound_effect !== undefined) {
    const soundPath = `${path}.sound_effect`;
    const sound = object(node.sound_effect);
    if (!sound) {
      emit(
        diagnostics,
        "error",
        "invalid_particle_sound_event",
        `${soundPath} must be an object.`,
        soundPath
      );
    } else if (
      typeof sound.event_name !== "string" ||
      sound.event_name.trim() === ""
    ) {
      emit(
        diagnostics,
        "error",
        "sound_event_name_missing",
        `${soundPath}.event_name must be a non-empty sound identifier.`,
        `${soundPath}.event_name`
      );
    }
  }

  for (const key of ["sequence", "randomize"] as const) {
    if (node[key] === undefined) continue;
    const branches = node[key];
    if (!Array.isArray(branches)) {
      emit(
        diagnostics,
        "error",
        "invalid_particle_event_branch",
        `${path}.${key} must be an array of event nodes.`,
        `${path}.${key}`
      );
      continue;
    }
    branches.forEach((branch, index) =>
      validateEventNode(
        diagnostics,
        branch,
        `${path}.${key}[${index}]`,
        key === "randomize"
      )
    );
  }
}

function validateEvents(
  diagnostics: ParticleDiagnostic[],
  events: JsonObject
): void {
  for (const [name, value] of Object.entries(events)) {
    validateEventNode(
      diagnostics,
      value,
      `particle_effect.events.${name}`
    );
  }
}

function validateContainers(
  diagnostics: ParticleDiagnostic[],
  document: JsonObject
): {
  effect: JsonObject | null;
  components: JsonObject;
  events: JsonObject;
} {
  const effect = object(document.particle_effect);
  if (!effect) return { effect: null, components: {}, events: {} };

  for (const key of ["description", "components", "curves", "events"] as const) {
    if (effect[key] !== undefined && !object(effect[key])) {
      emit(
        diagnostics,
        "error",
        "invalid_particle_container",
        `particle_effect.${key} must be an object when authored.`,
        `particle_effect.${key}`
      );
    }
  }
  const description = object(effect.description);
  if (
    description?.basic_render_parameters !== undefined &&
    !object(description.basic_render_parameters)
  ) {
    emit(
      diagnostics,
      "error",
      "invalid_basic_render_parameters",
      "particle_effect.description.basic_render_parameters must be an object.",
      "particle_effect.description.basic_render_parameters"
    );
  }

  return {
    effect,
    components: object(effect.components) ?? {},
    events: object(effect.events) ?? {},
  };
}

/**
 * Completes current stable Bedrock particle field-shape coverage that is too
 * detailed for the lossless mutation core. This validator is intentionally
 * forward-compatible: unknown fields/components are preserved, while known
 * stable fields are checked against their documented shapes.
 */
export function analyzeBedrockParticleSchemaCoverage(
  document: JsonObject
): ParticleDiagnostic[] {
  const diagnostics: ParticleDiagnostic[] = [];
  const { effect, components, events } = validateContainers(
    diagnostics,
    document
  );
  if (!effect) return diagnostics;

  validateInitializationAndLifetime(diagnostics, components);
  validateRates(diagnostics, components);
  validateLocalSpace(diagnostics, components);
  validateShapes(diagnostics, components);
  validateLifetimeEvents(diagnostics, components);
  validateAppearance(diagnostics, components);
  validateCollision(diagnostics, components);
  validateEvents(diagnostics, events);

  return diagnostics;
}
