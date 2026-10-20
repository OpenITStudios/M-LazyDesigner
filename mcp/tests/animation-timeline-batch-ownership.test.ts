import { describe, expect, test } from "bun:test";
import { keyframeBelongsToAnimation } from "@/server/tools/animation";

describe("animation timeline and batch ownership", () => {
  test("keyframes are accepted only when their animator owns the target animation", () => {
    const target = { uuid: "animation-target" };
    const other = { uuid: "animation-other" };

    expect(
      keyframeBelongsToAnimation(
        { animator: { animation: target } },
        target
      )
    ).toBe(true);
    expect(
      keyframeBelongsToAnimation(
        { animator: { animation: other } },
        target
      )
    ).toBe(false);
    expect(keyframeBelongsToAnimation({ animator: null }, target)).toBe(false);
  });

  test("timeline and batch owners resolve authored Animation before global Timeline collections", async () => {
    const source = (await Promise.all(["server/tools/animation/batch.ts", "lib/animation/batchPlanning.ts"].map((owner) => Bun.file(owner).text()))).join("\n");

    expect(source).toContain(
      "export function keyframeBelongsToAnimation("
    );
    expect(source).toContain(
      "Object.values(animation.animators).flatMap(animator => animator.keyframes)"
    );
    expect(source).toContain(
      "const targetSelectedKeyframes = (Timeline.selected as BBKeyframe[]).filter("
    );
    expect(source).not.toContain("const animation = AnimationItem.selected;");
    expect(source).not.toContain("AnimationItem.selected!.setLength()");
  });
});
