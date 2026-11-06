import { describe, expect, test } from "bun:test";
import {
  applyParticleOperations,
  createParticleDocument,
  inspectParticleDocument,
} from "../lib/bedrockParticleDocument";
import { BEDROCK_PARTICLE_SPECIAL_MOLANG_VARIABLES } from "../lib/bedrockParticleSemantics";

describe("Bedrock particle advanced semantics", () => {
  test("treats Molang math and parametric motion as first-class particle semantics", () => {
    let document = createParticleDocument({
      identifier: "blockit:math_orbit",
      preset: "trail",
    });
    document = applyParticleOperations(document, [
      {
        op: "set_component",
        component: "minecraft:particle_motion_parametric",
        value: {
          relative_position: [
            "math.sin(variable.particle_age * 180) * 0.5",
            "variable.particle_age * 0.25",
            "math.cos(variable.particle_age * 180) * 0.5",
          ],
          direction: [0, 1, 0],
          rotation: "variable.particle_age * 90",
        },
      },
    ]);

    const summary = inspectParticleDocument(document);
    expect(
      summary.diagnostics.some((entry) => entry.code === "parametric_motion_molang")
    ).toBe(true);
    expect(
      summary.diagnostics.some(
        (entry) => entry.code === "unknown_particle_molang_math"
      )
    ).toBe(false);
    expect(BEDROCK_PARTICLE_SPECIAL_MOLANG_VARIABLES).toContain(
      "variable.particle_age"
    );
  });

  test("warns on unknown math and literal zero divisors without evaluating Molang", () => {
    let document = createParticleDocument({ identifier: "blockit:math_lint" });
    document = applyParticleOperations(document, [
      {
        op: "patch",
        path: [
          "components",
          "minecraft:particle_appearance_billboard",
          "size",
        ],
        value: [
          "math.future_wave(variable.particle_age)",
          "variable.particle_age / 0",
        ],
      },
    ]);

    const summary = inspectParticleDocument(document);
    expect(
      summary.diagnostics.some(
        (entry) => entry.code === "unknown_particle_molang_math"
      )
    ).toBe(true);
    expect(
      summary.diagnostics.some((entry) => entry.code === "literal_zero_divisor")
    ).toBe(true);
  });

  test("detects malformed Molang structure and expensive per-render randomness", () => {
    let malformed = createParticleDocument({ identifier: "blockit:bad_math" });
    malformed = applyParticleOperations(malformed, [
      {
        op: "patch",
        path: ["components", "minecraft:particle_lifetime_expression", "max_lifetime"],
        value: "math.sin((variable.particle_age)",
      },
    ]);
    expect(
      inspectParticleDocument(malformed).diagnostics.some(
        (entry) => entry.code === "invalid_particle_molang_syntax"
      )
    ).toBe(true);

    let expensive = createParticleDocument({ identifier: "blockit:render_math" });
    expensive = applyParticleOperations(expensive, [
      {
        op: "set_component",
        component: "minecraft:particle_initialization",
        value: {
          per_render_expression:
            "v.a=math.sin(v.particle_age);v.b=math.cos(v.particle_age);v.c=math.abs(v.a);v.d=math.floor(v.b);v.e=math.ceil(v.c);v.f=math.random(0,1);v.g=math.sqrt(math.abs(v.f));",
        },
      },
    ]);
    const diagnostics = inspectParticleDocument(expensive).diagnostics;
    expect(
      diagnostics.some((entry) => entry.code === "per_render_random_molang")
    ).toBe(true);
    expect(
      diagnostics.some((entry) => entry.code === "expensive_per_render_molang")
    ).toBe(true);
  });

  test("validates literal flipbook bounds and detailed curve contracts", () => {
    let document = createParticleDocument({ identifier: "blockit:flip_curve" });
    document = applyParticleOperations(document, [
      {
        op: "patch",
        path: [
          "components",
          "minecraft:particle_appearance_billboard",
          "uv",
          "flipbook",
        ],
        value: {
          base_UV: [0, 0],
          size_UV: [8, 8],
          step_UV: [8, 0],
          frames_per_second: 12,
          max_frame: 4,
          loop: true,
        },
      },
      {
        op: "set_curve",
        name: "variable.bad_bezier",
        value: {
          type: "bezier",
          input: "variable.particle_age / variable.particle_lifetime",
          nodes: [0, 1, 0],
        },
      },
    ]);

    const diagnostics = inspectParticleDocument(document).diagnostics;
    expect(
      diagnostics.some((entry) => entry.code === "flipbook_frame_outside_texture")
    ).toBe(true);
    expect(
      diagnostics.some((entry) => entry.code === "invalid_bezier_curve_nodes")
    ).toBe(true);
  });

  test("semantic diagnostic cap cannot erase a late invalid event", () => {
    const source = createParticleDocument({ identifier: "blockit:overflow_semantics" });
    const effect = source.particle_effect as Record<string, any>;
    const events: Record<string, any> = {};
    for (let index = 0; index < 40; index += 1) {
      events["wide_" + index] = {
        sequence: Array.from({ length: 7 }, () => ({
          particle_effect: { effect: "blockit:child", type: "emitter" },
        })),
      };
    }
    effect.events = events;
    expect(inspectParticleDocument(source).diagnostics.some(entry =>
      entry.code === "particle_semantic_diagnostics_truncated" &&
      entry.severity === "info")).toBe(true);

    events.last_bad = { randomize: [{ weight: -1 }] };
    const inspected = inspectParticleDocument(source);
    expect(inspected.diagnostics.some(entry =>
      entry.code === "particle_semantic_diagnostics_truncated_with_errors" &&
      entry.severity === "error")).toBe(true);
  });

  test("rejects invalid randomize weights and surfaces high event fan-out", () => {
    let document = createParticleDocument({ identifier: "blockit:event_quality" });
    document = applyParticleOperations(document, [
      {
        op: "set_event",
        name: "impact",
        value: {
          sequence: [
            { particle_effect: { effect: "blockit:a", type: "emitter" } },
            { particle_effect: { effect: "blockit:b", type: "emitter" } },
            { particle_effect: { effect: "blockit:c", type: "emitter" } },
            { particle_effect: { effect: "blockit:d", type: "emitter" } },
            { particle_effect: { effect: "blockit:e", type: "emitter" } },
            { particle_effect: { effect: "blockit:f", type: "emitter" } },
            { particle_effect: { effect: "blockit:g", type: "emitter" } },
          ],
          randomize: [
            { weight: -1, particle_effect: { effect: "blockit:x", type: "emitter" } },
            { weight: 0 },
          ],
        },
      },
    ]);

    const diagnostics = inspectParticleDocument(document).diagnostics;
    expect(
      diagnostics.some(
        (entry) => entry.code === "invalid_particle_randomize_weight"
      )
    ).toBe(true);
    expect(
      diagnostics.some((entry) => entry.code === "high_particle_event_fanout")
    ).toBe(true);
  });
});
