import { describe, expect, test } from "bun:test";
import {
  BEDROCK_PARTICLE_COMPONENT_REFERENCE,
  applyParticleOperations,
  createParticleDocument,
  inspectParticleDocument,
} from "../lib/bedrockParticleDocument";

const OFFICIAL_STABLE_COMPONENTS = [
  "minecraft:emitter_initialization",
  "minecraft:emitter_lifetime_events",
  "minecraft:emitter_lifetime_expression",
  "minecraft:emitter_lifetime_looping",
  "minecraft:emitter_lifetime_once",
  "minecraft:emitter_local_space",
  "minecraft:emitter_rate_instant",
  "minecraft:emitter_rate_manual",
  "minecraft:emitter_rate_steady",
  "minecraft:emitter_shape_box",
  "minecraft:emitter_shape_custom",
  "minecraft:emitter_shape_disc",
  "minecraft:emitter_shape_entity_aabb",
  "minecraft:emitter_shape_point",
  "minecraft:emitter_shape_sphere",
  "minecraft:particle_appearance_billboard",
  "minecraft:particle_appearance_lighting",
  "minecraft:particle_appearance_tinting",
  "minecraft:particle_expire_if_in_blocks",
  "minecraft:particle_expire_if_not_in_blocks",
  "minecraft:particle_initial_speed",
  "minecraft:particle_initial_spin",
  "minecraft:particle_initialization",
  "minecraft:particle_kill_plane",
  "minecraft:particle_lifetime_events",
  "minecraft:particle_lifetime_expression",
  "minecraft:particle_motion_collision",
  "minecraft:particle_motion_dynamic",
  "minecraft:particle_motion_parametric",
].sort();

function codes(identifier: string, operations: Parameters<typeof applyParticleOperations>[1]) {
  const document = applyParticleOperations(
    createParticleDocument({ identifier }),
    operations
  );
  return inspectParticleDocument(document).diagnostics.map((entry) => entry.code);
}

describe("Bedrock particle stable schema coverage", () => {
  test("tracks every current stable particle component name", () => {
    const actual = [
      ...Object.keys(BEDROCK_PARTICLE_COMPONENT_REFERENCE.emitter),
      ...Object.keys(BEDROCK_PARTICLE_COMPONENT_REFERENCE.particle),
      ...Object.keys(BEDROCK_PARTICLE_COMPONENT_REFERENCE.appearance),
    ].sort();
    expect(actual).toEqual(OFFICIAL_STABLE_COMPONENTS);
  });

  test("validates initialization, local-space, shape and lifetime-event field shapes", () => {
    const diagnostics = codes("blockit:schema_core", [
      {
        op: "set_component",
        component: "minecraft:emitter_initialization",
        value: { creation_expression: { expression: "v.a=1;", version: 1.5 } },
      },
      {
        op: "set_component",
        component: "minecraft:emitter_local_space",
        value: { position: "true", rotation: true, velocity: 1 },
      },
      {
        op: "set_component",
        component: "minecraft:emitter_shape_sphere",
        value: { direction: "sideways", radius: 1, surface_only: "false" },
      },
      {
        op: "set_component",
        component: "minecraft:particle_lifetime_events",
        value: { creation_event: ["spawn", ""], timeline: { later: "spawn" } },
      },
    ]);

    expect(diagnostics).toContain("invalid_particle_molang");
    expect(diagnostics).toContain("invalid_particle_boolean");
    expect(diagnostics).toContain("invalid_emitter_shape_direction");
    expect(diagnostics).toContain("invalid_particle_event_reference");
    expect(diagnostics).toContain("invalid_particle_event_map_key");
  });

  test("validates billboard direction, alternate UV modes and tint gradients", () => {
    const diagnostics = codes("blockit:schema_visual", [
      {
        op: "set_component",
        component: "minecraft:particle_appearance_billboard",
        value: {
          size: [0.1, 0.1],
          facing_camera_mode: "rotate_xyz",
          direction: { mode: "custom" },
          uv: {
            texture_width: 16,
            texture_height: 16,
            uv: [0, 0],
            uv_size: [8, 8],
            flipbook: {
              base_UV: [0, 0],
              size_UV: ["8", 8],
              step_UV: [8, 0],
              max_frame: 2,
            },
          },
        },
      },
      {
        op: "set_component",
        component: "minecraft:particle_appearance_tinting",
        value: {
          color: {
            gradient: {
              bad: "#ffffff",
              "1": [1.2, 1, 1, 1],
            },
          },
        },
      },
    ]);

    expect(diagnostics).toContain("missing_particle_vector");
    expect(diagnostics).toContain("particle_uv_mode_conflict");
    expect(diagnostics).toContain("invalid_flipbook_numeric_vector");
    expect(diagnostics).toContain("invalid_particle_gradient_stop");
    expect(diagnostics).toContain("missing_particle_molang");
    expect(diagnostics).toContain("particle_color_channel_out_of_unit_range");
  });

  test("validates collision settings and collision-trigger event contracts", () => {
    const diagnostics = codes("blockit:schema_collision", [
      {
        op: "set_component",
        component: "minecraft:particle_motion_collision",
        value: {
          enabled: [],
          collision_drag: "variable.drag",
          collision_radius: -0.1,
          expire_on_contact: 1,
          events: [{ event: "", min_speed: -1 }],
        },
      },
    ]);

    expect(diagnostics).toContain("invalid_particle_molang");
    expect(diagnostics).toContain("invalid_particle_number");
    expect(diagnostics).toContain("particle_number_out_of_range");
    expect(diagnostics).toContain("invalid_particle_boolean");
    expect(diagnostics).toContain("collision_event_name_missing");
  });

  test("validates nested event-node expression, effect, sound and branch shapes", () => {
    const diagnostics = codes("blockit:schema_events", [
      {
        op: "set_event",
        name: "impact",
        value: {
          expression: [],
          log: 1,
          particle_effect: {
            effect: "BAD EFFECT",
            type: "unknown",
            pre_effect_expression: [],
          },
          sound_effect: { event_name: "" },
          sequence: [1],
          randomize: [{ weight: -1 }],
        },
      },
    ]);

    expect(diagnostics).toContain("invalid_particle_molang");
    expect(diagnostics).toContain("invalid_particle_event_log");
    expect(diagnostics).toContain("nonstandard_nested_particle_identifier");
    expect(diagnostics).toContain("invalid_particle_event_type");
    expect(diagnostics).toContain("sound_event_name_missing");
    expect(diagnostics).toContain("invalid_particle_event_node");
    expect(diagnostics).toContain("particle_number_out_of_range");
  });

  test("schema diagnostics remain fail-closed after the bounded result limit", () => {
    const source = createParticleDocument({ identifier: "blockit:overflow_schema" });
    const effect = source.particle_effect as Record<string, any>;
    const events: Record<string, unknown> = {};
    for (let index = 0; index < 78; index += 1) {
      events["future_" + index] = {
        particle_effect: { effect: "blockit:child", type: "future_type" },
      };
    }
    effect.events = events;
    const warningOnly = inspectParticleDocument(source);
    expect(warningOnly.diagnostics.some(entry =>
      entry.code === "particle_schema_diagnostics_truncated" &&
      entry.severity === "info")).toBe(true);
    expect(warningOnly.diagnostics.some(entry => entry.severity === "error")).toBe(false);

    events.last_bad = { sequence: [7] };
    const withError = inspectParticleDocument(source);
    expect(withError.diagnostics.some(entry =>
      entry.code === "particle_schema_diagnostics_truncated_with_errors" &&
      entry.severity === "error")).toBe(true);
    expect(withError.diagnostics.length).toBeLessThan(90);
  });

  test("keeps unknown future components lossless without treating them as malformed known components", () => {
    const document = applyParticleOperations(
      createParticleDocument({ identifier: "blockit:future_component" }),
      [
        {
          op: "set_component",
          component: "vendor:future_particle_component",
          value: { explicit_zero: 0, future_expression: "variable.particle_age" },
        },
      ]
    );
    const summary = inspectParticleDocument(document);
    expect(summary.component_groups.unknown).toContain(
      "vendor:future_particle_component"
    );
    expect(
      summary.diagnostics.some(
        (entry) =>
          entry.code === "invalid_particle_component_shape" &&
          entry.path?.includes("vendor:future_particle_component")
      )
    ).toBe(false);
  });
});
