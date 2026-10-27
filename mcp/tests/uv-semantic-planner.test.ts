import { describe, expect, test } from "bun:test";
import { planSemanticUv } from "@/lib/uv/semanticPlanner";
import { diffSemanticUv } from "@/lib/uv/semanticDiff";

describe("semantic UV planner", () => {
  test("applies cohort density and symmetry sharing", () => {
    const result = planSemanticUv([
      { id: "body", world_size: [4, 6], cohort: "cloth" },
      { id: "arm_left", world_size: [2, 6], cohort: "cloth" },
      { id: "arm_right", world_size: [2, 6], cohort: "cloth", share_with: "arm_left" },
      { id: "logo", world_size: [2, 2], cohort: "detail", texel_density: 2 },
    ], {
      atlas_width: 32,
      atlas_height: 32,
      default_texel_density: 1,
      cohort_texel_density: { cloth: 2 },
      padding: 1,
    });
    expect(result.complete).toBe(true);
    const left = result.placements.find((p) => p.id === "arm_left")!;
    const right = result.placements.find((p) => p.id === "arm_right")!;
    expect([left.width, left.height].sort()).toEqual([4, 12].sort());
    expect([right.x, right.y, right.width, right.height]).toEqual([left.x, left.y, left.width, left.height]);
    expect(right.shared_with).toBe("arm_left");
  });

  test("retains unaffected islands during affected-only replanning", () => {
    const full = planSemanticUv([
      { id: "a", world_size: [4, 4], cohort: "base" },
      { id: "b", world_size: [4, 4], cohort: "base" },
    ], { atlas_width: 16, atlas_height: 16, default_texel_density: 1 });

    const next = planSemanticUv([
      { id: "a", world_size: [6, 4], cohort: "base" },
      { id: "b", world_size: [4, 4], cohort: "base" },
    ], {
      atlas_width: 16,
      atlas_height: 16,
      default_texel_density: 1,
      previous_placements: full.owner_placements,
      affected_ids: ["a"],
    });
    const beforeB = full.placements.find((p) => p.id === "b")!;
    const afterB = next.placements.find((p) => p.id === "b")!;
    expect([afterB.x, afterB.y, afterB.width, afterB.height]).toEqual([beforeB.x, beforeB.y, beforeB.width, beforeB.height]);

    const diff = diffSemanticUv(full.placements, next.placements);
    expect(diff.unchanged).toContain("b");
    expect(diff.upserts.map((p) => p.id)).toContain("a");
  });


  test("incremental UV refuses stale dimensions or changed density on an untouched island", () => {
    const before = planSemanticUv([
      { id: "a", world_size: [4, 4], cohort: "base" },
      { id: "b", world_size: [2, 2], cohort: "base" },
    ], { atlas_width: 32, atlas_height: 32, default_texel_density: 1 });

    expect(() => planSemanticUv([
      { id: "a", world_size: [6, 4], cohort: "base" },
      { id: "b", world_size: [2, 2], cohort: "base" },
    ], {
      atlas_width: 32, atlas_height: 32, default_texel_density: 1,
      previous_placements: before.owner_placements, affected_ids: ["b"],
    })).toThrow("RETAINED_UV_SOURCE_DRIFT");

    expect(() => planSemanticUv([
      { id: "a", world_size: [4, 4], cohort: "base", texel_density: 2 },
      { id: "b", world_size: [2, 2], cohort: "base" },
    ], {
      atlas_width: 32, atlas_height: 32, default_texel_density: 1,
      previous_placements: before.owner_placements, affected_ids: ["b"],
    })).toThrow("RETAINED_UV_SOURCE_DRIFT");
  });

  test("incremental UV cannot clip stale out-of-atlas placements into a false valid reservation", () => {
    expect(() => planSemanticUv([
      { id: "fixed", world_size: [4, 4], cohort: "base" },
      { id: "changed", world_size: [2, 2], cohort: "base" },
    ], {
      atlas_width: 16, atlas_height: 16, default_texel_density: 1,
      previous_placements: [{
        id: "fixed", x: 14, y: 0, width: 4, height: 4,
        rotated: false, cohort: "base",
      }],
      affected_ids: ["changed"],
      padding: 1,
    })).toThrow("RETAINED_UV_OUT_OF_BOUNDS");
  });

  test("incremental UV rejects malformed and fractional retained coordinates", () => {
    for (const x of [-1, 0.5, Number.NaN]) {
      expect(() => planSemanticUv([
        { id: "fixed", world_size: [4, 4], cohort: "base" },
        { id: "changed", world_size: [2, 2], cohort: "base" },
      ], {
        atlas_width: 16, atlas_height: 16, default_texel_density: 1,
        previous_placements: [{
          id: "fixed", x, y: 0, width: 4, height: 4,
          rotated: false, cohort: "base",
        }],
        affected_ids: ["changed"],
      })).toThrow("RETAINED_UV_INVALID_GEOMETRY");
    }
  });

  test("incremental UV keeps compatible rotated islands and rejects policy drift", () => {
    const islands = [
      { id: "fixed", world_size: [4, 2] as const, cohort: "cloth" },
      { id: "changed", world_size: [2, 2] as const, cohort: "cloth" },
    ];
    const placement = {
      id: "fixed", x: 0, y: 0, width: 2, height: 4,
      rotated: true, cohort: "cloth",
    };
    const valid = planSemanticUv(islands, {
      atlas_width: 16, atlas_height: 16, default_texel_density: 1,
      previous_placements: [placement], affected_ids: ["changed"],
    });
    expect(valid.complete).toBe(true);
    expect(valid.placements.find((p) => p.id === "fixed"))
      .toMatchObject({ x: 0, y: 0, width: 2, height: 4, rotated: true });

    expect(() => planSemanticUv([
      { ...islands[0], allow_rotation: false },
      islands[1],
    ], {
      atlas_width: 16, atlas_height: 16, default_texel_density: 1,
      previous_placements: [placement], affected_ids: ["changed"],
    })).toThrow("RETAINED_UV_SOURCE_DRIFT");

    expect(() => planSemanticUv([
      { ...islands[0], cohort: "metal" },
      islands[1],
    ], {
      atlas_width: 16, atlas_height: 16, default_texel_density: 1,
      previous_placements: [placement], affected_ids: ["changed"],
    })).toThrow("RETAINED_UV_SOURCE_DRIFT");
  });

  test("keeps explicit locked regions fixed", () => {
    const result = planSemanticUv([
      { id: "logo", world_size: [2,2], cohort: "detail", locked: { x: 0, y: 0, width: 4, height: 4 } },
      { id: "body", world_size: [8,8], cohort: "base" },
    ], { atlas_width: 16, atlas_height: 16, default_texel_density: 1 });
    const logo = result.placements.find((p) => p.id === "logo")!;
    expect([logo.x, logo.y, logo.width, logo.height, logo.locked]).toEqual([0,0,4,4,true]);
  });

  test("identity-critical UV islands stay unique while low-priority symmetric regions may reuse", () => {
    const result = planSemanticUv([
      {
        id: "face",
        world_size: [4, 4],
        cohort: "identity",
        texel_density: 2,
        identity_priority: "CRITICAL",
        reuse_policy: "UNIQUE",
        allow_rotation: false,
      },
      {
        id: "shirt_logo",
        world_size: [2, 2],
        cohort: "identity",
        identity_priority: "HIGH",
        reuse_policy: "UNIQUE",
      },
      {
        id: "arm_left",
        world_size: [2, 6],
        cohort: "cloth",
        identity_priority: "LOW",
      },
      {
        id: "arm_right",
        world_size: [2, 6],
        cohort: "cloth",
        identity_priority: "LOW",
        reuse_policy: "REQUIRE_REUSE",
        share_with: "arm_left",
      },
    ], {
      atlas_width: 32,
      atlas_height: 32,
      default_texel_density: 1,
      padding: 1,
    });

    expect(result.complete).toBe(true);
    expect(result.art_direction).toEqual({
      unique_island_ids: ["face", "shirt_logo"],
      required_reuse_island_ids: ["arm_right"],
      high_priority_island_ids: ["face", "shirt_logo"],
    });
    const face = result.placements.find((entry) => entry.id === "face")!;
    expect([face.width, face.height]).toEqual([8, 8]);
    const left = result.placements.find((entry) => entry.id === "arm_left")!;
    const right = result.placements.find((entry) => entry.id === "arm_right")!;
    expect([right.x, right.y, right.width, right.height]).toEqual([
      left.x,
      left.y,
      left.width,
      left.height,
    ]);
  });

  test("identity-unique islands reject accidental UV sharing", () => {
    expect(() =>
      planSemanticUv([
        {
          id: "face",
          world_size: [4, 4],
          cohort: "identity",
          reuse_policy: "UNIQUE",
          share_with: "head_side",
        },
        {
          id: "head_side",
          world_size: [4, 4],
          cohort: "base",
        },
      ], {
        atlas_width: 16,
        atlas_height: 16,
        default_texel_density: 1,
      })
    ).toThrow("identity-unique");
  });

  test("required reuse fails closed without an explicit source island", () => {
    expect(() =>
      planSemanticUv([
        {
          id: "symmetric_arm",
          world_size: [2, 6],
          cohort: "cloth",
          reuse_policy: "REQUIRE_REUSE",
        },
      ], {
        atlas_width: 16,
        atlas_height: 16,
        default_texel_density: 1,
      })
    ).toThrow("requires an explicit share_with owner");
  });

});
