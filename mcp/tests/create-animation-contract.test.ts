import { describe, expect, test } from "bun:test";
import {
  createAnimationParameters,
  normalizeBedrockAnimationName,
} from "@/server/tools/animation";

describe("create_animation contract", () => {
  test("accepts explicit zero animation length", () => {
    const result = createAnimationParameters.parse({
      name: "idle",
      animation_length: 0,
      bones: {},
    });
    expect(result.animation_length).toBe(0);
  });

  test("Bedrock animation prefix is applied exactly once", async () => {
    expect(normalizeBedrockAnimationName("walk")).toBe("animation.walk");
    expect(normalizeBedrockAnimationName("animation.walk")).toBe("animation.walk");

    const source = await Bun.file(new URL("../server/tools/animation/create.ts", import.meta.url)).text();
    expect(source).toContain("normalizeBedrockAnimationName(name)");
    expect(source).not.toContain("const requestedAnimationName = `animation.${name}`");
  });

  test("serializer preserves accepted zero instead of treating it as omitted", async () => {
    const source = await Bun.file(new URL("../server/tools/animation/create.ts", import.meta.url)).text();
    expect(source).toContain("animation_length !== undefined && { animation_length }");
    expect(source).not.toContain("animation_length && { animation_length }");
  });

  test("accepts bounded Bedrock sound effect maps without a new tool", async () => {
    expect(createAnimationParameters.safeParse({
      name: "sound_test",
      bones: {},
      sound_effects: {
        "0": { effect: "start" },
        "0.5": [{ effect: "loop" }, { effect: "accent", locator: "mouth" }],
      },
    }).success).toBe(true);
    expect(createAnimationParameters.safeParse({
      name: "bad_sound",
      bones: {},
      sound_effects: { "0": { effect: "" } },
    }).success).toBe(false);
    expect(createAnimationParameters.safeParse({
      name: "bad_time",
      bones: {},
      sound_effects: { "0": { effect: "a" }, "0.0": { effect: "b" } },
    }).success).toBe(false);

    const source = await Bun.file("server/tools/animation/create.ts").text();
    expect(source).toContain("...(sound_effects && { sound_effects })");
    expect(source).toContain("requested_sound_effect_count");
    expect(source).not.toContain("manage_sound_keyframes");
  });

  test("real create_animation serializer consumes compacted linear keys before native codec load", async () => {
    const source = await Bun.file("server/tools/animation/create.ts").text();
    const plan = source.indexOf("const compactedBoneEntries =");
    const write = source.indexOf("compactedBoneEntries.map(({ group, compaction })");
    const undo = source.indexOf("Undo.initEdit({ animations: [] })");
    expect(plan).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThan(plan);
    expect(undo).toBeGreaterThan(write);
    expect(source).toContain("protectedEventTimes");
    expect(source).toContain("linear_key_compaction");
  });

  test("selects the created animation before completing the Undo edit", async () => {
    const source = await Bun.file(new URL("../server/tools/animation/create.ts", import.meta.url)).text();
    expect(source).toContain("createdAnimation.select()");
    expect(source).toContain("AnimationItem.selected !== createdAnimation");
    expect(source.indexOf("createdAnimation.select()")).toBeLessThan(
      source.indexOf('Undo.finishEdit("Create animation"')
    );
  });
});
