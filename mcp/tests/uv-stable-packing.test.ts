import { describe, expect, test } from "bun:test";
import { buildUvLayoutSnapshot } from "@/lib/uv/islands";
import { planUvPacking } from "@/lib/uv/packing/planner";
import { requireValidUvLayoutPlan } from "@/lib/uv/validatePlan";

const snapshotFixture = () =>
  buildUvLayoutSnapshot(
    [
      {
        uuid: "body",
        name: "body",
        from: [0, 0, 0],
        to: [8, 8, 8],
        box_uv: false,
        autouv: 0,
        mirror_uv: false,
        faces: [{ face: "north", uv: [0, 0, 8, 8] }],
      },
      {
        uuid: "existing",
        name: "existing",
        from: [0, 0, 0],
        to: [4, 4, 4],
        box_uv: false,
        autouv: 0,
        mirror_uv: false,
        faces: [{ face: "north", uv: [8, 0, 12, 4] }],
      },
      {
        uuid: "new",
        name: "new",
        from: [0, 0, 0],
        to: [2, 2, 2],
        box_uv: false,
        autouv: 0,
        mirror_uv: false,
        faces: [{ face: "north", uv: [20, 20, 22, 22] }],
      },
    ],
    32,
    32,
    (island) =>
      island.source.cube_name === "body"
        ? { locked: true }
        : { padding_pixels: 0 }
  );

describe("UV stable packing modes", () => {
  test("existing shared UV cannot be forked by different packing priorities", () => {
    const snapshot = buildUvLayoutSnapshot([
      { uuid: "left", name: "left", from: [0,0,0], to: [4,4,2],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north", uv: [12,0,16,4] }] },
      { uuid: "right", name: "right", from: [0,0,0], to: [4,4,2],
        box_uv: false, autouv: 0, mirror_uv: true,
        faces: [{ face: "north", uv: [12,0,16,4] }] },
    ], 32, 32, (island) => ({
      padding_pixels: 0, stack_group: "arms",
      priority: island.source.cube_uuid === "right" ? 5 : 0,
    }));
    const plan = planUvPacking(snapshot, { bitmap_width: 32, bitmap_height: 32 });
    requireValidUvLayoutPlan(plan);
    expect(plan.proposed.islands[0].rect).toEqual(plan.proposed.islands[1].rect);
    expect(plan.score.occupancy_ratio).toBe(16 / (32 * 32));
    expect(plan.moved_island_ids).toHaveLength(2);
  });

  test("conflicting constraints refuse to split existing shared UV ownership", () => {
    const snapshot = buildUvLayoutSnapshot([
      { uuid: "left", name: "left", from: [0,0,0], to: [4,4,1],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north", uv: [8,0,12,4] }] },
      { uuid: "right", name: "right", from: [0,0,0], to: [4,4,1],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north", uv: [8,0,12,4] }] },
    ], 32, 32, (island) => ({
      stack_group: "arms", padding_pixels: island.source.cube_uuid === "left" ? 0 : 1,
    }));
    expect(() => planUvPacking(snapshot, { bitmap_width: 32, bitmap_height: 32 }))
      .toThrow("UV_SHARED_STACK_CONSTRAINT_CONFLICT");
  });

  test("fractional logical UV is accepted on the physical pixel grid, not between texels", () => {
    const snapshot = buildUvLayoutSnapshot([
      { uuid: "panel", name: "panel", from: [0,0,0], to: [2,2,1],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north", uv: [8,0,10,2] }] },
    ], 32, 32, () => ({ padding_pixels: 1 }));
    const plan = planUvPacking(snapshot, { bitmap_width: 64, bitmap_height: 64 });
    requireValidUvLayoutPlan(plan);
    expect(plan.proposed.islands[0].rect.x).toBe(0.5);
    expect(plan.proposed.islands[0].rect.y).toBe(0.5);
    expect(() => planUvPacking(snapshot, {
      bitmap_width: 64, bitmap_height: 64,
      size_overrides: { "face:panel:north": [1.25, 2] },
    })).toThrow("UV_NON_INTEGRAL_PIXEL_MAPPING");
  });

  test("ADD_ONLY keeps all existing islands fixed and places only declared additions", () => {
    const snapshot = snapshotFixture();
    const plan = planUvPacking(snapshot, {
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "ADD_ONLY",
      island_ids: ["face:new:north"],
    });

    expect(plan.mode).toBe("ADD_ONLY");
    expect(plan.fixed_island_ids.sort()).toEqual([
      "face:body:north",
      "face:existing:north",
    ]);
    expect(
      plan.proposed.islands.find(
        (island) => island.id === "face:existing:north"
      )?.rect
    ).toEqual(
      snapshot.islands.find(
        (island) => island.id === "face:existing:north"
      )?.rect
    );
    expect(plan.moved_island_ids).toEqual(["face:new:north"]);
  });

  test("ADD_ONLY tolerates exact fixed UV reuse without treating it as illegal occupied overlap", () => {
    const snapshot = buildUvLayoutSnapshot(
      [
        {
          uuid: "left",
          name: "left",
          from: [0,0,0],
          to: [4,4,1],
          box_uv: false,
          autouv: 0,
          mirror_uv: false,
          faces: [{ face: "north", uv: [0,0,4,4] }],
        },
        {
          uuid: "right",
          name: "right",
          from: [0,0,0],
          to: [4,4,1],
          box_uv: false,
          autouv: 0,
          mirror_uv: true,
          faces: [{ face: "north", uv: [0,0,4,4] }],
        },
        {
          uuid: "new",
          name: "new",
          from: [0,0,0],
          to: [2,2,1],
          box_uv: false,
          autouv: 0,
          mirror_uv: false,
          faces: [{ face: "north", uv: [12,0,14,2] }],
        },
      ],
      32,
      32,
      (island) =>
        island.source.cube_name === "new"
          ? { padding_pixels: 0 }
          : { locked: true, stack_group: "arms", padding_pixels: 0 }
    );
    const plan = planUvPacking(snapshot, {
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "ADD_ONLY",
      island_ids: ["face:new:north"],
    });
    expect(plan.score.valid).toBe(true);
    expect(plan.fixed_island_ids).toEqual([
      "face:left:north",
      "face:right:north",
    ]);
  });

  test("REPACK_ALL preserves explicit existing UV reuse without double packing", () => {
    const snapshot = buildUvLayoutSnapshot([
      { uuid: "arm-left", name: "arm-left", from: [0,0,0], to: [4,4,2],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north", uv: [12,0,16,4] }] },
      { uuid: "arm-right", name: "arm-right", from: [0,0,0], to: [4,4,2],
        box_uv: false, autouv: 0, mirror_uv: true,
        faces: [{ face: "north", uv: [12,0,16,4] }] },
      { uuid: "badge", name: "badge", from: [0,0,0], to: [2,2,1],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north", uv: [20,0,22,2] }] },
    ], 32, 32, (island) => ({
      padding_pixels: 0,
      ...(island.source.cube_name.startsWith("arm") ? { stack_group: "paired_arms" } : {}),
    }));
    const plan = planUvPacking(snapshot, { bitmap_width: 32, bitmap_height: 32 });
    requireValidUvLayoutPlan(plan);
    const a = plan.proposed.islands.find((v) => v.id === "face:arm-left:north")!;
    const b = plan.proposed.islands.find((v) => v.id === "face:arm-right:north")!;
    expect(b.rect).toEqual(a.rect);
    expect(plan.moved_island_ids).toEqual(expect.arrayContaining([
      "face:arm-left:north", "face:arm-right:north",
    ]));
    expect(plan.placement_transforms).toHaveLength(3);
    expect(plan.score.occupancy_ratio).toBe(20 / (32 * 32));
  });

  test("partial repack refuses to split previously shared UV ownership", () => {
    const fixture = (lockLeft = false) => buildUvLayoutSnapshot([
      { uuid: "left", name: "left", from: [0,0,0], to: [4,4,2],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north", uv: [12,0,16,4] }] },
      { uuid: "right", name: "right", from: [0,0,0], to: [4,4,2],
        box_uv: false, autouv: 0, mirror_uv: true,
        faces: [{ face: "north", uv: [12,0,16,4] }] },
    ], 32, 32, (island) => ({
      stack_group: "arms", padding_pixels: 0,
      locked: lockLeft && island.source.cube_uuid === "left",
    }));

    const snapshot = fixture();
    expect(() => planUvPacking(snapshot, {
      mode: "REPACK_SELECTED", island_ids: ["face:left:north"],
      bitmap_width: 32, bitmap_height: 32,
    })).toThrow("UV_SHARED_STACK_SCOPE_INCOMPLETE");

    const together = planUvPacking(snapshot, {
      mode: "REPACK_SELECTED",
      island_ids: ["face:left:north", "face:right:north"],
      bitmap_width: 32, bitmap_height: 32,
    });
    requireValidUvLayoutPlan(together);
    expect(together.proposed.islands[0].rect).toEqual(together.proposed.islands[1].rect);

    expect(() => planUvPacking(fixture(true), {
      mode: "REPACK_ALL", bitmap_width: 32, bitmap_height: 32,
    })).toThrow("UV_SHARED_STACK_SCOPE_INCOMPLETE");
  });

  test("equal dimensions alone never authorize newly stacked UVs", () => {
    const snapshot = buildUvLayoutSnapshot([
      { uuid: "a", name: "a", from: [0,0,0], to: [4,4,1],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north", uv: [8,0,12,4] }] },
      { uuid: "b", name: "b", from: [0,0,0], to: [4,4,1],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north", uv: [16,0,20,4] }] },
    ], 32, 32, () => ({ padding_pixels: 0, stack_group: "same_shape" }));
    const plan = planUvPacking(snapshot, { bitmap_width: 32, bitmap_height: 32 });
    requireValidUvLayoutPlan(plan);
    expect(plan.proposed.islands[0].rect).not.toEqual(plan.proposed.islands[1].rect);
    expect(plan.score.occupancy_ratio).toBe(32 / (32 * 32));
  });

  test("AFFECTED_ONLY repacks only explicit affected islands", () => {
    const snapshot = snapshotFixture();
    const plan = planUvPacking(snapshot, {
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "AFFECTED_ONLY",
      island_ids: ["face:existing:north", "face:new:north"],
    });

    expect(plan.fixed_island_ids).toEqual(["face:body:north"]);
    expect(plan.placement_transforms).toHaveLength(2);
  });

  test("locked islands remain fixed even when explicitly requested", () => {
    const snapshot = snapshotFixture();
    const plan = planUvPacking(snapshot, {
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "REPACK_SELECTED",
      island_ids: ["face:body:north", "face:new:north"],
    });

    expect(plan.fixed_island_ids).toContain("face:body:north");
    expect(
      plan.placement_transforms.some(
        (entry) => entry.island_id === "face:body:north"
      )
    ).toBe(false);
  });

  test("targeted modes reject missing or unknown island IDs", () => {
    const snapshot = snapshotFixture();
    expect(() =>
      planUvPacking(snapshot, {
        bitmap_width: 32,
        bitmap_height: 32,
        mode: "ADD_ONLY",
      })
    ).toThrow(/requires at least one explicit island ID/);

    expect(() =>
      planUvPacking(snapshot, {
        bitmap_width: 32,
        bitmap_height: 32,
        mode: "ADD_ONLY",
        island_ids: ["missing"],
      })
    ).toThrow(/was not found/);
  });

  test("proposed metrics are recomputed from planned rectangles", () => {
    const snapshot = snapshotFixture();
    const plan = planUvPacking(snapshot, {
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "ADD_ONLY",
      island_ids: ["face:new:north"],
      size_overrides: {
        "face:new:north": [6, 3],
      },
    });
    expect(plan.proposed.metrics.uv_area).toBe(64 + 16 + 18);
    expect(plan.proposed.metrics.occupied_bounds).not.toEqual(
      snapshot.metrics.occupied_bounds
    );
  });
});
