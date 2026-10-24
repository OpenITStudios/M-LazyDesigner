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

    const atlasA = registry.put(fakePlan, "sha256:atlas", fakeReport,
      { width: 32, height: 32, atlas_uuid: "atlas-A" });
    const repeated = registry.put(fakePlan, "sha256:atlas", fakeReport,
      { width: 32, height: 32, atlas_uuid: "atlas-A" });
    const atlasB = registry.put(fakePlan, "sha256:atlas", fakeReport,
      { width: 32, height: 32, atlas_uuid: "atlas-B" });
    expect(repeated.plan_id).toBe(atlasA.plan_id);
    expect(atlasB.plan_id).not.toBe(atlasA.plan_id);
    expect(repeated.auto_bitmap_source).toEqual(
      { width: 32, height: 32, atlas_uuid: "atlas-A" }
    );
    const revised = registry.put(fakePlan, "sha256:atlas", fakeReport, {
      width: 32, height: 32, atlas_uuid: "atlas-A",
      logical_width: 32, logical_height: 32,
      atlas_revision: "sha256:32x32:" + "a".repeat(64),
    });
    const repainted = registry.put(fakePlan, "sha256:atlas", fakeReport, {
      width: 32, height: 32, atlas_uuid: "atlas-A",
      logical_width: 32, logical_height: 32,
      atlas_revision: "sha256:32x32:" + "b".repeat(64),
    });
    expect(revised.plan_id).not.toBe(atlasA.plan_id);
    expect(repainted.plan_id).not.toBe(revised.plan_id);
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
    let autoAtlasReads = 0;
    const service = createUvLayoutService({
      readSource: () => native,
      readBitmapDimensions: () => {
        autoAtlasReads++;
        throw new Error("explicit bitmap planning must bypass native atlas discovery");
      },
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
    expect(autoAtlasReads).toBe(0);
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

  test("service automatically derives bitmap dimensions and accepts unchanged atlas at apply", async () => {
    let native = nativeFixture();
    let atlasReads = 0;
    const service = createUvLayoutService({
      readSource: () => native,
      readBitmapDimensions: () => {
        atlasReads++;
        return { width: 32, height: 32, atlas_uuid: "native-base-atlas" };
      },
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
    expect(planned.report.apply_allowed).toBe(true);
    expect(atlasReads).toBe(2); // discovery + end-of-planning freshness
    const applied = await service.apply({
      plan_id: planned.plan_id,
      expected_source_fingerprint: planned.source_fingerprint,
    });
    expect(applied.receipt.changed_cube_ids).toEqual(["b"]);
    expect(atlasReads).toBe(3); // one pre-Undo apply preflight
  });

  test("auto atlas changes invalidate old UV plans before native mutation", async () => {
    const initial = { width: 32, height: 32, atlas_uuid: "original-atlas" };
    for (const changed of [
      { width: 64, height: 64, atlas_uuid: "original-atlas" },
      { width: 32, height: 32, atlas_uuid: "replacement-atlas" },
      null,
    ]) {
      let atlas: typeof initial | null = initial;
      let createdAdapters = 0;
      const service = createUvLayoutService({
        readSource: nativeFixture,
        readBitmapDimensions: () => atlas,
        createApplyAdapter: () => {
          createdAdapters++;
          throw new Error("stale atlas plan must not allocate a native adapter");
        },
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
      expect(planned.report.apply_allowed).toBe(true);
      atlas = changed;
      await expect(service.apply({
        plan_id: planned.plan_id,
        expected_source_fingerprint: planned.source_fingerprint,
      })).rejects.toThrow("STALE_UV_PLAN");
      expect(createdAdapters).toBe(0);
    }
  });

  test("automatic atlas change during planning cannot publish a stale handle", async () => {
    const registry = new UvPlanRegistry();
    let atlasReads = 0;
    const service = createUvLayoutService({
      readSource: nativeFixture,
      readBitmapDimensions: () => {
        atlasReads++;
        return atlasReads === 1
          ? { width: 32, height: 32, atlas_uuid: "original-atlas" }
          : { width: 64, height: 64, atlas_uuid: "original-atlas" };
      },
      createApplyAdapter: () => {
        throw new Error("planning must never construct a mutation adapter");
      },
    }, registry);
    await expect(service.plan({
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
      constraints: [{
        id: "no-padding",
        selector: { cube_uuids: ["b"] },
        constraints: { padding_pixels: 0 },
      }],
    })).rejects.toThrow("STALE_UV_PLAN");
    expect(atlasReads).toBe(2);
    expect(registry.size()).toBe(0);
  });

  test("same UUID and bitmap size with changed decoded RGBA revision invalidates UV plan before Undo", async () => {
    const a = "sha256:32x32:" + "a".repeat(64);
    const b = "sha256:32x32:" + "b".repeat(64);
    const original = {
      width: 32, height: 32,
      logical_width: 32, logical_height: 32,
      atlas_uuid: "same-uuid", atlas_revision: a,
    };
    let bitmap = original;
    let adapters = 0;
    const service = createUvLayoutService({
      readSource: nativeFixture,
      readBitmapDimensions: () => bitmap,
      createApplyAdapter: () => {
        adapters++;
        throw new Error("stale pixel revision must be rejected before native Undo");
      },
    });
    const planned = await service.plan({
      mode: "REPACK_SELECTED",
      island_ids: ["face:b:north"],
      constraints: [{ id: "no-padding", selector: { cube_uuids: ["b"] },
        constraints: { padding_pixels: 0 } }],
    });
    expect(planned.report.apply_allowed).toBe(true);
    bitmap = { ...original, atlas_revision: b };
    await expect(service.apply({
      plan_id: planned.plan_id,
      expected_source_fingerprint: planned.source_fingerprint,
    })).rejects.toThrow("STALE_UV_PLAN");
    expect(adapters).toBe(0);
  });

  test("same-UUID RGBA change while asynchronously planning never publishes stale UV handles", async () => {
    const registry = new UvPlanRegistry();
    let reads = 0;
    const service = createUvLayoutService({
      readSource: nativeFixture,
      readBitmapDimensions: () => ({
        width: 32, height: 32,
        logical_width: 32, logical_height: 32,
        atlas_uuid: "same-uuid",
        atlas_revision: "sha256:32x32:" + (reads++ === 0 ? "a" : "b").repeat(64),
      }),
      createApplyAdapter: () => {
        throw new Error("plan discovery cannot start a native Undo");
      },
    }, registry);
    await expect(service.plan({
      mode: "REPACK_SELECTED", island_ids: ["face:b:north"],
      constraints: [{ id: "no-padding", selector: { cube_uuids: ["b"] },
        constraints: { padding_pixels: 0 } }],
    })).rejects.toThrow("STALE_UV_PLAN");
    expect(reads).toBe(2);
    expect(registry.size()).toBe(0);
  });

  test("native logical atlas mismatch and malformed pixel revisions are refused before planning", async () => {
    let atlas = {
      width: 32, height: 32, logical_width: 16, logical_height: 32,
      atlas_uuid: "base", atlas_revision: "sha256:32x32:" + "a".repeat(64),
    };
    let adapters = 0;
    const service = createUvLayoutService({
      readSource: nativeFixture,
      readBitmapDimensions: () => atlas,
      createApplyAdapter: () => {
        adapters++;
        throw new Error("invalid atlas must not allocate a native adapter");
      },
    });
    await expect(service.plan({
      mode: "REPACK_SELECTED", island_ids: ["face:b:north"],
    })).rejects.toThrow("UV_BITMAP_LOGICAL_MISMATCH");
    atlas = { ...atlas, logical_width: 32, atlas_revision: "not-a-decoded-rgba-revision" };
    await expect(service.plan({
      mode: "REPACK_SELECTED", island_ids: ["face:b:north"],
    })).rejects.toThrow("UV_BITMAP_SOURCE_INVALID");
    expect(adapters).toBe(0);
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

  test("service recognizes non-actionable UV plans before adapter/Undo allocation", async () => {
    const native = buildUvNativeSourceSnapshot([{
      uuid: "still", name: "still", from: [0, 0, 0], to: [4, 4, 1],
      box_uv: false, autouv: 0, mirror_uv: false,
      faces: [{ face: "north", uv: [0, 0, 4, 4] }],
    }], 16, 16);
    let adapters = 0;
    const service = createUvLayoutService({
      readSource: () => native,
      createApplyAdapter: () => { adapters++; throw new Error("unexpected adapter"); },
    });
    const planned = await service.plan({
      mode: "REPACK_ALL", bitmap_width: 16, bitmap_height: 16,
      constraints: [{
        id: "no-padding", selector: { cube_uuids: ["still"] },
        constraints: { padding_pixels: 0 },
      }],
    });
    expect(planned.report.summary.moved_islands).toBe(0);
    expect(planned.report.apply_allowed).toBe(false);
    expect(planned.report.hard_violations).toContain("UV_NO_OP_PLAN");
    await expect(service.apply({
      plan_id: planned.plan_id,
      expected_source_fingerprint: planned.source_fingerprint,
    })).rejects.toThrow(/UV_NO_OP_PLAN/);
    expect(adapters).toBe(0);
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
