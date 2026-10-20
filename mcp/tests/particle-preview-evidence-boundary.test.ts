import { describe, expect, test } from "bun:test";
import { getAllToolDefinitions } from "../lib/factories";
import "../server/tools";
import { inspectAnimationParameters } from "../server/tools/animation-inspection";
import { effectPointSnapshot, animationEffectContinuationState } from "../server/tools/animation/effectState";

describe("R01 particle preview proof boundaries", () => {
  test("native particle preview file is retained in authored snapshot", () => {
    const point = {
      effect: "example:spark", locator: "hand", file: "/tmp/spark.particle.json",
      bind_to_actor: true, script: "",
    } as unknown as KeyframeDataPoint;
    expect(effectPointSnapshot(point).file).toBe("/tmp/spark.particle.json");
    const keyframe = {
      uuid: "keyframe-1", time: 1, data_points: [point],
    } as unknown as BBKeyframe;
    const continued = animationEffectContinuationState("particle", keyframe, 0);
    expect(continued).toMatchObject({
      channel: "particle", preview_file: "/tmp/spark.particle.json",
      locator: "hand", effect: "example:spark",
    });
  });

  test("bounded animation inspection reveals file only with authored keyframe details", async () => {
    expect(inspectAnimationParameters.safeParse({
      animation_id: "fixture-anim", include_effect_keyframes: true,
    }).success).toBe(true);
    const src = await Bun.file("server/tools/animation/inspection.ts").text();
    expect(src).toContain('preview_file: typeof particle.file === "string"');
    expect(src).toContain('...(includeKeyframes ? { keyframes: inspectedKeyframes } : {})');
  });

  test("particle receipt does not confuse loader invocation with rendering proof", async () => {
    const src = await Bun.file("server/tools/particle/manage.ts").text();
    expect(src).toContain('preview_load_call:');
    expect(src).toContain('emitter_trigger: "UNVERIFIED"');
    expect(src).toContain('render_visibility: "UNVERIFIED"');
    expect(src).not.toContain('"; native preview loaded"');
    expect(getAllToolDefinitions().manage_particle).toBeDefined();
  });
});
