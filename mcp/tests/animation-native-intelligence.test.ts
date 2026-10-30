import { describe, expect, test } from "bun:test";
import {
  MOLANG_ANIMATION_MATH_SYMBOLS,
  analyzeAnimationMolangExpressions,
} from "@/lib/animationMolangSemantics";
import { analyzeAnimationMotionDynamics } from "@/lib/animationMotionDynamics";
import { animationNativePropertiesParameters } from "@/server/tools/animation-native-intelligence";

describe("Bedrock animation native intelligence", () => {
  test("recognizes the complete current official Molang math surface compactly", () => {
    expect(MOLANG_ANIMATION_MATH_SYMBOLS).toHaveLength(61);
    expect(new Set(MOLANG_ANIMATION_MATH_SYMBOLS).size).toBe(61);

    for (const direction of ["ease_in", "ease_in_out", "ease_out"]) {
      for (const shape of [
        "back",
        "bounce",
        "circ",
        "cubic",
        "elastic",
        "expo",
        "quad",
        "quart",
        "quint",
        "sine",
      ]) {
        expect(MOLANG_ANIMATION_MATH_SYMBOLS).toContain(
          `${direction}_${shape}`
        );
      }
    }

    for (const name of [
      "abs",
      "acos",
      "asin",
      "atan",
      "atan2",
      "ceil",
      "clamp",
      "copy_sign",
      "cos",
      "die_roll",
      "die_roll_integer",
      "exp",
      "floor",
      "hermite_blend",
      "inverse_lerp",
      "lerp",
      "lerprotate",
      "ln",
      "max",
      "min",
      "min_angle",
      "mod",
      "pi",
      "pow",
      "random",
      "random_integer",
      "round",
      "sign",
      "sin",
      "sqrt",
      "trunc",
    ]) {
      expect(MOLANG_ANIMATION_MATH_SYMBOLS).toContain(name);
    }
  });

  test("Molang diagnostics normalize aliases without evaluating gameplay truth", () => {
    const result = analyzeAnimationMolangExpressions([
      {
        source: "head.rotation",
        expression:
          "math.ease_in_out_back(0, 1, math.clamp(math.sin(q.anim_time * 90), 0, 1)) + math.pi + v.look_bias",
      },
      {
        source: "state.condition",
        expression: "math.future_curve(q.life_time) > 0",
      },
      {
        source: "bad.namespace",
        expression: "geometry.foo + 1",
      },
      {
        source: "complex.value",
        expression: "t.x = 1; t.x + 1;",
      },
    ]);

    expect(result.math.used).toEqual(
      expect.arrayContaining(["ease_in_out_back", "clamp", "sin", "pi"])
    );
    expect(result.math.unknown).toEqual(["future_curve"]);
    expect(result.math.version_sensitive_1_21_120).toEqual([
      "ease_in_out_back",
    ]);
    expect(result.dependencies.query).toEqual(
      expect.arrayContaining(["query.anim_time", "query.life_time"])
    );
    expect(result.dependencies.variable).toEqual(["variable.look_bias"]);
    expect(result.dependencies.temp).toEqual(["temp.x"]);
    expect(result.forbidden_animation_namespaces).toEqual(["geometry.foo"]);
    expect(result.complex_missing_return_count).toBe(1);
  });

  test("one properties branch batches native Bedrock clip semantics", () => {
    const parsed = animationNativePropertiesParameters.parse({
      operation: "properties",
      animation_id: "animation.test.walk",
      length: 1.25,
      fps: 20,
      loop_mode: "hold",
      anim_time_update: "q.modified_distance_moved / 1.4",
      blend_weight: "math.clamp(v.weight, 0, 1)",
      start_delay: "math.random(0, 0.4)",
      loop_delay: 0.25,
      override_previous_animation: true,
      rotation_spaces: [
        { bone_name: "head", relative_to: "entity" },
        { bone_name: "body", relative_to: "parent" },
      ],
    });

    expect(parsed.operation).toBe("properties");
    expect(parsed.loop_mode).toBe("hold");
    expect(parsed.rotation_spaces).toHaveLength(2);
    expect(
      animationNativePropertiesParameters.safeParse({
        operation: "properties",
        animation_id: "animation.test.walk",
      }).success
    ).toBe(false);
    expect(
      animationNativePropertiesParameters.safeParse({
        operation: "properties",
        start_delay: "   ",
      }).success
    ).toBe(false);
  });

  test("motion dynamics use shortest rotation deltas and bounded numeric evidence", () => {
    const result = analyzeAnimationMotionDynamics({
      loop_mode: "loop",
      tracks: [
        {
          group_uuid: "root",
          group_name: "root",
          channel: "position",
          keyframes: [
            { time: 0, value: [0, 0, 0] },
            { time: 0.5, value: [8, 0, 0] },
            { time: 1, value: [16, 0, 0] },
          ],
        },
        {
          group_uuid: "head",
          group_name: "head",
          channel: "rotation",
          keyframes: [
            { time: 0, value: [0, 170, 0] },
            { time: 1, value: [0, -170, 0] },
          ],
        },
      ],
    });

    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("expected dynamics");
    const root = result.examples.find((entry) => entry.group_uuid === "root");
    const head = result.examples.find((entry) => entry.group_uuid === "head");
    expect(root?.path_length).toBe(16);
    expect(root?.boundary_velocity_delta).toBe(0);
    expect(head?.path_length).toBe(20);
  });

  test("motion diagnostics never bridge expressions and report bounded omissions", () => {
    const mixed = {
      group_uuid: "arm", group_name: "arm", channel: "rotation" as const,
      keyframes: [
        { time: 0, value: [0, 0, 0] },
        { time: 0.5, value: ["query.anim_time", 0, 0] },
        { time: 1, value: [90, 0, 0] },
      ],
    };
    const unavailable = analyzeAnimationMotionDynamics({ loop_mode: "loop", tracks: [mixed] });
    expect(unavailable.state).toBe("unavailable");
    expect(unavailable.unevaluated_track_count).toBe(1);
    expect(unavailable.unevaluated_examples[0].reason).toBe("non_numeric_or_invalid_keyframes");

    const result = analyzeAnimationMotionDynamics({
      loop_mode: "loop", example_limit: 1,
      tracks: [mixed, { ...mixed, group_uuid: "other" }, {
        ...mixed, group_uuid: "root",
        keyframes: [{ time: 0, value: [0, 0, 0] }, { time: 1, value: [10, 0, 0] }],
      }],
    });
    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("expected partial dynamics");
    expect(result.numeric_track_count).toBe(1);
    expect(result.examples.map((entry) => entry.group_uuid)).toEqual(["root"]);
    expect(result.unevaluated_track_count).toBe(2);
    expect(result.unevaluated_examples).toHaveLength(1);
    expect(result.unevaluated_examples_truncated).toBe(true);
  });

  test("shared key timing counts moving bones once and excludes static channels", () => {
    const tracks = Array.from({ length: 4 }, (_, index) => ({
      group_uuid: `bone-${index}`, group_name: `bone-${index}`, channel: "rotation" as const,
      keyframes: [
        { time: 0, value: [0, 0, 0] },
        { time: 0.5, value: [20, 0, 0] },
        { time: 1, value: [0, 0, 0] },
      ],
    }));
    const result = analyzeAnimationMotionDynamics({ loop_mode: "loop", tracks: [
      ...tracks, { ...tracks[0], channel: "position" },
      { ...tracks[0], group_uuid: "static", keyframes: tracks[0].keyframes.map((key) => ({ ...key, value: [0, 0, 0] })) },
    ] });
    if (result.state !== "available") throw new Error("expected dynamics");
    expect(result.key_timing).toMatchObject({
      moving_bone_count: 4, peak_shared_bone_count: 4,
      peak_shared_interior_time: 0.5, peak_shared_bone_ratio: 1, review_secondary_timing: true,
    });
    const staggered = analyzeAnimationMotionDynamics({ loop_mode: "loop", tracks: tracks.map((track, index) => ({
      ...track, keyframes: track.keyframes.map((key, keyIndex) => ({ ...key, time: keyIndex === 1 ? 0.5 + index * 0.00001 : key.time })),
    })) });
    if (staggered.state !== "available") throw new Error("expected dynamics");
    expect(staggered.key_timing.peak_shared_bone_count).toBe(1);
    expect(staggered.key_timing.review_secondary_timing).toBe(false);

    const endpoints = analyzeAnimationMotionDynamics({ loop_mode: "once", tracks: tracks.map((track) => ({
      ...track, keyframes: [{ time: 0, value: [0, 0, 0] }, { time: 1, value: [10, 0, 0] }],
    })) });
    if (endpoints.state !== "available") throw new Error("expected dynamics");
    expect(endpoints.key_timing.peak_shared_interior_time).toBeNull();
    expect(endpoints.key_timing.review_secondary_timing).toBe(false);
  });

  test("K4 declines duplicate and multi-point native keys without hiding clean tracks", async () => {
    const clean = {
      group_uuid: "clean", group_name: "clean", channel: "rotation" as const,
      keyframes: [
        { time: 0, value: [0, 0, 0], data_point_count: 1 },
        { time: 0.5, value: [20, 0, 0], data_point_count: 1 },
        { time: 1, value: [0, 0, 0], data_point_count: 1 },
      ],
    };
    const duplicate = {
      ...clean, group_uuid: "duplicate",
      keyframes: [
        { time: 0, value: [0, 0, 0] },
        { time: 0.5, value: [10, 0, 0] },
        { time: 0.5, value: [-10, 0, 0] },
        { time: 1, value: [0, 0, 0] },
      ],
    };
    const prepost = {
      ...clean, group_uuid: "prepost",
      keyframes: [
        { time: 0, value: [0, 0, 0], data_point_count: 1 },
        { time: 0.5, value: [90, 0, 0], data_point_count: 2 },
        { time: 1, value: [0, 0, 0], data_point_count: 1 },
      ],
    };
    const missing = {
      ...clean, group_uuid: "missing",
      keyframes: [
        { time: 0, value: [0, 0, 0], data_point_count: 0 },
        { time: 1, value: [10, 0, 0], data_point_count: 1 },
      ],
    };
    const result = analyzeAnimationMotionDynamics({
      loop_mode: "loop", tracks: [duplicate, prepost, missing, clean],
      example_limit: 8,
    });
    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("expected partial dynamics");
    expect(result.numeric_track_count).toBe(1);
    expect(result.unevaluated_track_count).toBe(3);
    expect(result.unevaluated_examples.map((entry) => entry.reason)).toEqual([
      "duplicate_keyframe_time",
      "non_single_native_data_point",
      "non_single_native_data_point",
    ]);
    expect(result.examples.map((entry) => entry.group_uuid)).toEqual(["clean"]);
    expect(result.key_timing.moving_bone_count).toBe(1);
    expect(analyzeAnimationMotionDynamics({
      loop_mode: "loop", tracks: [duplicate, prepost],
    }).state).toBe("unavailable");

    // This Runtime function is native-only; check the narrow bridge statically.
    const source = await Bun.file("server/runtime/extensions/animation/nativeIntelligence.ts").text();
    const begin = source.indexOf("function motionDynamicsRuntime(");
    const end = source.indexOf("function clientEntityWiringRuntime(", begin);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(begin);
    const bridge = source.slice(begin, end);
    expect(bridge).toContain("data_point_count: dataPointCount");
    expect(bridge).toContain("dataPointCount === 1 ? keyframe.getArray(0)");
  });

  test("runtime wiring expands capability without adding another MCP tool", async () => {
    const [runtime, bootstrap, server, skill] = await Promise.all([
      Bun.file("server/runtime/extensions/animation/nativeIntelligence.ts").text(),
      Bun.file("server/runtime/extensions.ts").text(),
      Bun.file("server/server.ts").text(),
      Promise.all([Bun.file("../.agents/skills/lazydesigner-animation/SKILL.md").text(), Bun.file("../.agents/skills/lazydesigner-animation/references/fidelity-correction-evidence.md").text()]).then((parts) => parts.join("\n")),
    ]);

    expect(runtime).toContain('operation: z.literal("properties")');
    expect(runtime).toContain("start_delay");
    expect(runtime).toContain("loop_delay");
    expect(runtime).toContain("override_previous_animation");
    expect(runtime).toContain("rotation_global");
    expect(runtime).toContain("diagnostics_cost");
    expect(runtime).not.toContain("createTool(");
    expect(server).toContain("initializeRuntimeCapabilityWiring");
    expect(bootstrap).toContain("wireAnimationNativeIntelligence");
    expect(skill).toContain("operation: properties");
    expect(skill).toContain("math.ease_{in|out|in_out}_");
  });

  test("graph editor preserves continuation evidence for bounded visual verification", async () => {
    const source = await Bun.file("server/tools/animation/keyframes.ts").text();
    const graphStart = source.indexOf("animationGraphEditorToolDoc.name");
    const graphBody = source.slice(graphStart);

    expect(graphStart).toBeGreaterThanOrEqual(0);
    expect(graphBody).toContain("structuredContent: result");
    expect(graphBody).toContain("animation: { uuid: animation.uuid, name: animation.name }");
    expect(graphBody).toContain("bone: { uuid: group.uuid, name: group.name }");
    expect(graphBody).toContain("affected_keyframes: keyframes.map(keyframeContinuationState)");
  });
});
