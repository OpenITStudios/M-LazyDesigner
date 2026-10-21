import { describe, expect, test } from "bun:test";
import { UvPlanRegistry } from "@/lib/uv/planRegistry";
import type { UvLayoutPlan } from "@/lib/uv/contracts";
import type { UvDryRunReport } from "@/lib/uv/dryRun";
import { createUvLayoutService } from "@/lib/uv/service";
import {
  buildUvNativeSourceSnapshot,
  type UvNativeSourceSnapshot,
} from "@/lib/uv/adapters/blockbenchCubeUv";

function nativeFixture(): UvNativeSourceSnapshot {
  return buildUvNativeSourceSnapshot(
    [
      {
        uuid: "a",
        name: "a",
        from: [0,0,0],
        to: [4,4,1],
        box_uv: false,
        autouv: 0,
        mirror_uv: false,
        faces: [{
          face: "north",
          uv: [0,0,4,4],
          rotation: 0,
        }],
      },
      {
        uuid: "b",
        name: "b",
        from: [0,0,0],
        to: [2,2,1],
        box_uv: false,
        autouv: 0,
        mirror_uv: false,
        faces: [{
          face: "north",
          uv: [8,0,10,2],
          rotation: 0,
        }],
      },
    ],
    32,
    32
  );
}

describe("UV plan registry and service", () => {
  test("registry uses content-addressed bounded handles", () => {
    const registry = new UvPlanRegistry(2);
    const fakePlan = {
      schema: 1,
      planner_version: 1,
      backend: "maxrects_v1",
      backend_version: 1,
      mode: "REPACK_ALL",
      before: { schema: 1, planner_version: 1, logical_width: 1, logical_height: 1, islands: [], metrics: { island_count: 0, face_count: 0, physical_area: 0, uv_area: 0, occupied_bounds: null } },
      proposed: { schema: 1, planner_version: 1, logical_width: 1, logical_height: 1, islands: [], metrics: { island_count: 0, face_count: 0, physical_area: 0, uv_area: 0, occupied_bounds: null } },
      score: { valid: true, hard_violations: [], occupancy_ratio: 0, density_error: null, movement_cost: 0, fragmentation: 0, semantic_spread: null },
      moved_island_ids: [],
      fixed_island_ids: [],
      placement_transforms: [],
    } as unknown as UvLayoutPlan;
    const fakeReport = {
      schema: 1,
      execution: "planned",
      backend: "maxrects_v1",
      mode: "REPACK_ALL",
      summary: { island_count: 0, moved_islands: 0, fixed_islands: 0, occupancy_ratio: 0, movement_cost: 0, fragmentation: 0, density_changes: 0, ready_stack_groups: 0, review_stack_candidates: 0, blocked_stack_proposals: 0 },
      moved_island_ids: [],
      fixed_island_ids: [],
      density_changed_island_ids: [],
      stack_proposals: [],
      hard_violations: [],
      apply_allowed: true,
    } as unknown as UvDryRunReport;

    const first = registry.put(fakePlan, "sha256:a", fakeReport);
    const same = registry.put(fakePlan, "sha256:a", fakeReport);
    expect(same.plan_id).toBe(first.plan_id);
    registry.put(fakePlan, "sha256:b", fakeReport);
    registry.put(fakePlan, "sha256:c", fakeReport);
    expect(registry.size()).toBe(2);
    expect(() => registry.get(first.plan_id)).toThrow(/UV_PLAN_NOT_FOUND/);
    const claimed = registry.put(fakePlan, "sha256:one-shot", fakeReport);
    expect(registry.consume(claimed.plan_id)).toBe(claimed);
    expect(() => registry.consume(claimed.plan_id)).toThrow(/UV_PLAN_NOT_FOUND/);
  });

  test("consuming one UV plan revokes competing plans from the same source only", () => {
    const registry = new UvPlanRegistry();
    const sourceA = "sha256:" + "a".repeat(64);
    const sourceB = "sha256:" + "b".repeat(64);
    const base = {
      backend: "maxrects_v1",
      mode: "REPACK_SELECTED",
      moved_island_ids: ["face:a:north"],
    } as unknown as UvLayoutPlan;
    const report = { apply_allowed: true } as UvDryRunReport;
    const chosen = registry.put(base, sourceA, report);
    const competing = registry.put({ ...base, mode: "REPACK_ALL" }, sourceA, report);
    const otherProject = registry.put(base, sourceB, report);
    expect(chosen.plan_id).not.toBe(competing.plan_id);
    expect(registry.size()).toBe(3);

    expect(registry.consume(chosen.plan_id)).toBe(chosen);
    expect(() => registry.get(chosen.plan_id)).toThrow(/UV_PLAN_NOT_FOUND/);
    expect(() => registry.get(competing.plan_id)).toThrow(/UV_PLAN_NOT_FOUND/);
    expect(registry.get(otherProject.plan_id)).toBe(otherProject);
    expect(registry.size()).toBe(1);
  });

  test("no-op UV plan rejects before constructing a native mutation adapter", async () => {
    const registry = new UvPlanRegistry();
    const fingerprint = "sha256:" + "a".repeat(64);
    const stored = registry.put(
      { moved_island_ids: [] } as unknown as UvLayoutPlan,
      fingerprint,
      { apply_allowed: true } as UvDryRunReport
    );
    let nativeAdapterCreated = 0;
    const service = createUvLayoutService({
      readSource: () => { throw new Error("native source must not be read for no-op apply"); },
      createApplyAdapter: () => {
        nativeAdapterCreated++;
        throw new Error("no-op plan must not reach the native adapter");
      },
    }, registry);
    await expect(service.apply({
      plan_id: stored.plan_id,
      expected_source_fingerprint: fingerprint,
    })).rejects.toThrow(/UV_NO_OP_PLAN/);
    expect(nativeAdapterCreated).toBe(0);
  });

  test("service keeps AI payload compact by applying through plan handle", async () => {
    let native = nativeFixture();
    const service = createUvLayoutService({
      readSource: () => native,
      createApplyAdapter: () => ({
        readSource: () => native,
        apply: (instructions) => {
          native = structuredClone(native);
          for (const instruction of instructions) {
            if (instruction.kind !== "FACE_UV") continue;
            const cube = native.cubes.find(
              (entry) => entry.uuid === instruction.cube_uuid
            )!;
            const face = cube.faces.find(
              (entry) => entry.face === instruction.face
            )!;
            face.uv = [...instruction.uv];
            face.rotation = instruction.rotation;
          }
        },
        restore: (snapshot) => {
          native = structuredClone(snapshot);
        },
      }),
    });

    const planned = await service.plan({
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
      constraints: [{
        id: "no-padding",
        selector: { cube_uuids: ["b"] },
        constraints: { padding_pixels: 0 },
      }],
    });

    expect(planned.plan_id).toMatch(/^uvplan:[0-9a-f]{64}$/);
    expect(planned.report.execution).toBe("planned");
    expect(planned).not.toHaveProperty("plan");

    // A second plan from the same snapshot must be invalidated when any one
    // plan enters native mutation, even if a different handle was chosen.
    const competing = await service.plan({
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "REPACK_ALL",
    });
    expect(competing.plan_id).not.toBe(planned.plan_id);
    expect(service.registrySize()).toBe(2);

    const applied = await service.apply({
      plan_id: planned.plan_id,
      expected_source_fingerprint:
        planned.source_fingerprint,
    });
    expect(applied.receipt.changed_cube_ids).toEqual(["b"]);
    expect(applied.invalidation.geometry_structure.stale).toBe(false);
    await expect(service.apply({
      plan_id: competing.plan_id,
      expected_source_fingerprint: competing.source_fingerprint,
    })).rejects.toThrow(/UV_PLAN_NOT_FOUND/);
    await expect(service.apply({
      plan_id: planned.plan_id,
      expected_source_fingerprint: planned.source_fingerprint,
    })).rejects.toThrow(/UV_PLAN_NOT_FOUND/);
  });

  test("unknown mutation outcome permanently consumes its plan handle", async () => {
    let native = nativeFixture();
    let nativeCalls = 0;
    const service = createUvLayoutService({
      readSource: () => native,
      createApplyAdapter: () => ({
        readSource: () => native,
        apply: () => {
          nativeCalls++;
          native = structuredClone(native);
          native.cubes[1].faces[0].uv = [2, 2, 4, 4];
          throw new Error("native write interrupted");
        },
        restore: () => { throw new Error("native restore failed"); },
        cancelUndo: () => {},
      }),
    });
    const planned = await service.plan({
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
      constraints: [{
        id: "no-padding",
        selector: { cube_uuids: ["b"] },
        constraints: { padding_pixels: 0 },
      }],
    });
    const competing = await service.plan({
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "REPACK_ALL",
    });
    const apply = {
      plan_id: planned.plan_id,
      expected_source_fingerprint: planned.source_fingerprint,
    };
    await expect(service.apply(apply)).rejects.toThrow(/UV_OUTCOME_UNKNOWN/);
    expect(nativeCalls).toBe(1);
    await expect(service.apply(apply)).rejects.toThrow(/UV_PLAN_NOT_FOUND/);
    await expect(service.apply({
      plan_id: competing.plan_id,
      expected_source_fingerprint: competing.source_fingerprint,
    })).rejects.toThrow(/UV_PLAN_NOT_FOUND/);
    expect(nativeCalls).toBe(1);
  });

  test("service automatically derives bitmap dimensions when the runtime provides one base atlas", async () => {
    let native = nativeFixture();
    const service = createUvLayoutService({
      readSource: () => native,
      readBitmapDimensions: () => ({
        width: 64,
        height: 64,
      }),
      createApplyAdapter: () => ({
        readSource: () => native,
        apply: (instructions) => {
          native = structuredClone(native);
          for (const instruction of instructions) {
            if (instruction.kind !== "FACE_UV") continue;
            const cube = native.cubes.find(
              (entry) => entry.uuid === instruction.cube_uuid
            )!;
            const face = cube.faces.find(
              (entry) => entry.face === instruction.face
            )!;
            face.uv = [...instruction.uv];
            face.rotation = instruction.rotation;
          }
        },
        restore: (snapshot) => {
          native = structuredClone(snapshot);
        },
      }),
    });

    const planned = await service.plan({
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
      constraints: [{
        id: "no-padding",
        selector: { cube_uuids: ["b"] },
        constraints: { padding_pixels: 0 },
      }],
    });
    expect(planned.report.execution).toBe("planned");
  });

  test("service fails closed when neither base-atlas dimensions nor an explicit pre-atlas scale exists", async () => {
    const native = nativeFixture();
    const service = createUvLayoutService({
      readSource: () => native,
      readBitmapDimensions: () => null,
      createApplyAdapter: () => ({
        readSource: () => native,
        apply: () => {},
        restore: () => {},
      }),
    });
    await expect(
      service.plan({
        mode: "REPACK_SELECTED",
        island_ids: ["face:b:north"],
      })
    ).rejects.toThrow(/UV_BITMAP_SCALE_REQUIRED/);
  });

  test("plan cannot mutate a different project with byte-identical geometry and UV", async () => {
    let native = {
      ...nativeFixture(),
      project_uuid: "project-A",
    };
    let beganUndo = false;
    let mutated = false;
    const service = createUvLayoutService({
      readSource: () => native,
      createApplyAdapter: () => ({
        readSource: () => native,
        beginUndo: () => { beganUndo = true; },
        apply: () => { mutated = true; },
        restore: () => {},
      }),
    });
    const planned = await service.plan({
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
      constraints: [{
        id: "no-padding",
        selector: { cube_uuids: ["b"] },
        constraints: { padding_pixels: 0 },
      }],
    });
    native = { ...native, project_uuid: "project-B" };
    await expect(service.apply({
      plan_id: planned.plan_id,
      expected_source_fingerprint: planned.source_fingerprint,
    })).rejects.toThrow(/STALE_UV_PLAN/);
    expect(beganUndo).toBe(false);
    expect(mutated).toBe(false);
  });

  test("explicit bitmap dimensions bypass optional atlas discovery", async () => {
    const native = nativeFixture();
    let lookups = 0;
    const service = createUvLayoutService({
      readSource: () => native,
      readBitmapDimensions: () => {
        lookups++;
        throw new Error("UV_AUTO_BITMAP_AMBIGUOUS");
      },
      createApplyAdapter: () => ({
        readSource: () => native,
        apply: () => {},
        restore: () => {},
      }),
    });
    const plan = await service.plan({
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
      bitmap_width: 32,
      bitmap_height: 32,
    });
    expect(plan.plan_id).toMatch(/^uvplan:[0-9a-f]{64}$/);
    expect(lookups).toBe(0);
    await expect(service.plan({
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
      bitmap_width: 32,
    })).rejects.toThrow("bitmap_width and bitmap_height together");
    expect(lookups).toBe(0);
  });

  test("asynchronous atlas read cannot publish a plan for a different project", async () => {
    let native = { ...nativeFixture(), project_uuid: "project-A" };
    const registry = new UvPlanRegistry();
    const service = createUvLayoutService({
      readSource: () => native,
      readBitmapDimensions: async () => {
        native = { ...native, project_uuid: "project-B" };
        return { width: 32, height: 32 };
      },
      createApplyAdapter: () => ({
        readSource: () => native,
        apply: () => {},
        restore: () => {},
      }),
    }, registry);
    await expect(service.plan({
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
    })).rejects.toThrow(/STALE_UV_PLAN/);
    expect(registry.size()).toBe(0);
  });

  test("asynchronous atlas read cannot publish a plan for modified UV state", async () => {
    let native = nativeFixture();
    const registry = new UvPlanRegistry();
    const service = createUvLayoutService({
      readSource: () => native,
      readBitmapDimensions: async () => {
        native = structuredClone(native);
        native.cubes[1].faces[0].uv = [13, 0, 15, 2];
        return { width: 32, height: 32 };
      },
      createApplyAdapter: () => ({
        readSource: () => native,
        apply: () => {},
        restore: () => {},
      }),
    }, registry);
    await expect(service.plan({
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
    })).rejects.toThrow(/STALE_UV_PLAN/);
    expect(registry.size()).toBe(0);
  });

  test("geometry bounds participate in stale source fingerprint", async () => {
    const initial = nativeFixture();
    let native = initial;
    const service = createUvLayoutService({
      readSource: () => native,
      createApplyAdapter: () => ({
        readSource: () => native,
        apply: () => {},
        restore: () => {},
      }),
    });
    const planned = await service.plan({
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
    });
    native = structuredClone(native);
    native.cubes[1].to = [4,2,1];

    await expect(
      service.apply({
        plan_id: planned.plan_id,
        expected_source_fingerprint:
          planned.source_fingerprint,
      })
    ).rejects.toThrow(/STALE_UV_PLAN/);
  });
});
