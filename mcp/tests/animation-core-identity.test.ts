import { describe, expect, test } from "bun:test";
import { resolveCoreAnimation } from "@/lib/coreIdentity";

describe("authored Animation identity separation", () => {
  test("controllers never resolve through the authored Animation owner", () => {
    class FakeAnimationController {
      constructor(
        public uuid: string,
        public name: string
      ) {}
    }

    // Identity-only stub: the resolver contract types authored animations as
    // BBAnimation, so the stub must be that shape for identity assertions.
    const authored = { uuid: "anim-1", name: "walk" } as unknown as BBAnimation;
    const controller = new FakeAnimationController("controller-1", "walk_controller");
    const previousAnimationItem = (globalThis as any).AnimationItem;
    const previousAnimationController = (globalThis as any).AnimationController;

    try {
      (globalThis as any).AnimationController = FakeAnimationController;
      (globalThis as any).AnimationItem = {
        all: [authored, controller],
        selected: controller,
      };

      expect(resolveCoreAnimation("anim-1")).toBe(authored);
      expect(resolveCoreAnimation("walk")).toBe(authored);
      expect(() => resolveCoreAnimation("controller-1")).toThrow(
        'Animation "controller-1" not found.'
      );
      expect(() =>
        resolveCoreAnimation(undefined, { allowSelected: true })
      ).toThrow("selected AnimationItem is an AnimationController");

      (globalThis as any).AnimationItem.selected = authored;
      expect(resolveCoreAnimation(undefined, { allowSelected: true })).toBe(authored);
    } finally {
      (globalThis as any).AnimationItem = previousAnimationItem;
      (globalThis as any).AnimationController = previousAnimationController;
    }
  });

  test("resolver stays import-safe while filtering controller items at execution", async () => {
    const source = await Bun.file("lib/core/identity.ts").text();
    expect(source).toContain('typeof AnimationController !== "undefined"');
    expect(source).toContain("currentCoreAuthoredAnimations");
    expect(source).toContain("!isCoreAnimationControllerItem(item)");
    expect(source).not.toContain("resolveUuidOrUniqueName(AnimationItem.all ?? [], reference");
  });
});
