import { describe, expect, test } from "bun:test";
import { buildUvLayoutSnapshot } from "@/lib/uv/islands";
import { planUvPacking } from "@/lib/uv/packing/planner";
import {
  assertUvPlanSnapshotCompatible,
  buildUvNativeSourceSnapshot,
  fingerprintUvNativeSource,
  translateUvPlanToNativeInstructions,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import {
  requireValidUvLayoutPlan,
  validateUvLayoutPlan,
} from "@/lib/uv/validatePlan";
import { buildUvDryRunReport } from "@/lib/uv/dryRun";

function cubes() {
  return [
    {
      uuid: "fixed",
      name: "fixed",
      from: [0,0,0],
      to: [4,4,4],
      box_uv: false,
      autouv: 0,
      mirror_uv: false,
      faces: [{
        face: "north" as const,
        uv: [0,0,4,4],
        rotation: 0,
      }],
    },
    {
      uuid: "move",
      name: "move",
      from: [0,0,0],
      to: [2,4,1],
      box_uv: false,
      autouv: 0,
      mirror_uv: false,
      faces: [{
        face: "north" as const,
        uv: [10,0,12,4],
        rotation: 0,
      }],
    },
  ];
}

describe("UV U7 apply contracts", () => {
  test("native source fingerprint is deterministic and sensitive to UV state", () => {
    const first = buildUvNativeSourceSnapshot(cubes(), 32, 32);
    const second = buildUvNativeSourceSnapshot(
      [...cubes()].reverse(),
      32,
      32
    );
    expect(fingerprintUvNativeSource(second)).toBe(
      fingerprintUvNativeSource(first)
    );

    const changed = cubes();
    changed[1].faces[0] = {
      ...changed[1].faces[0],
      rotation: 90,
    };
    expect(
      fingerprintUvNativeSource(
        buildUvNativeSourceSnapshot(changed, 32, 32)
      )
    ).not.toBe(fingerprintUvNativeSource(first));
  });

  test("identical UV bytes from different Blockbench projects have distinct source fingerprints", () => {
    const a = buildUvNativeSourceSnapshot(cubes(), 32, 32, "project-A");
    const b = buildUvNativeSourceSnapshot(cubes(), 32, 32, "project-B");
    expect(fingerprintUvNativeSource(a)).not.toBe(fingerprintUvNativeSource(b));
    expect(fingerprintUvNativeSource(
      buildUvNativeSourceSnapshot([...cubes()].reverse(), 32, 32, "project-A")
    )).toBe(fingerprintUvNativeSource(a));
    expect(() => buildUvNativeSourceSnapshot(cubes(), 32, 32, ""))
      .toThrow("non-empty project UUID");
  });

  test("core native snapshot builder refuses ambiguous Cube and face identities", () => {
    const duplicated = [...cubes(), { ...cubes()[0] }];
    expect(() => buildUvNativeSourceSnapshot(duplicated, 32, 32))
      .toThrow(/UV_NATIVE_DUPLICATE_CUBE_UUID/);

    const unnamed = cubes();
    unnamed[0].uuid = "";
    expect(() => buildUvNativeSourceSnapshot(unnamed, 32, 32))
      .toThrow(/UV_NATIVE_CUBE_ID_REQUIRED/);

    const duplicateFace = cubes();
    duplicateFace[0].faces.push({ ...duplicateFace[0].faces[0] });
    expect(() => buildUvNativeSourceSnapshot(duplicateFace, 32, 32))
      .toThrow(/UV_NATIVE_DUPLICATE_FACE/);
  });

  test("native snapshots reject non-finite geometry, auto UV and face rotation before hashing", () => {
    const invalidFrom = cubes();
    invalidFrom[0].from[0] = Number.NaN;
    expect(() => buildUvNativeSourceSnapshot(invalidFrom, 32, 32))
      .toThrow(/UV_NATIVE_INVALID_GEOMETRY/);

    const invalidTo = cubes();
    invalidTo[0].to[1] = Number.POSITIVE_INFINITY;
    expect(() => buildUvNativeSourceSnapshot(invalidTo, 32, 32))
      .toThrow(/UV_NATIVE_INVALID_GEOMETRY/);

    const invalidAutoUv = cubes();
    invalidAutoUv[0].autouv = Number.NaN;
    expect(() => buildUvNativeSourceSnapshot(invalidAutoUv, 32, 32))
      .toThrow(/UV_NATIVE_INVALID_AUTOUV/);

    const invalidRotation = cubes();
    invalidRotation[0].faces[0].rotation = Number.NaN;
    expect(() => buildUvNativeSourceSnapshot(invalidRotation, 32, 32))
      .toThrow(/UV_NATIVE_INVALID_ROTATION/);
  });

  test("planner never rotates Box-UV islands because native offset cannot represent it", () => {
    const snapshot = buildUvLayoutSnapshot(
      [{
        uuid: "box",
        name: "box",
        from: [0,0,0],
        to: [9,4,1],
        box_uv: true,
        uv_offset: [0,0],
        autouv: 0,
        mirror_uv: false,
        faces: [],
      }],
      16,
      16
    );
    expect(() =>
      planUvPacking(snapshot, {
        bitmap_width: 16,
        bitmap_height: 16,
        size_overrides: { "box:box": [9,4] },
      })
    ).not.toThrow();
    const plan = planUvPacking(snapshot, {
      bitmap_width: 16,
      bitmap_height: 16,
      size_overrides: { "box:box": [9,4] },
    });
    expect(plan.placement_transforms[0].rotated_90).toBe(false);
  });

  test("valid per-face plan translates to native UV + face rotation instructions", () => {
    const source = cubes();
    const snapshot = buildUvLayoutSnapshot(
      source,
      32,
      32,
      (island) =>
        island.source.cube_name === "fixed"
          ? { locked: true, padding_pixels: 0 }
          : { padding_pixels: 0 }
    );
    const plan = planUvPacking(snapshot, {
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "REPACK_SELECTED",
      island_ids: ["face:move:north"],
    });
    requireValidUvLayoutPlan(plan);
    assertUvPlanSnapshotCompatible(plan, snapshot);
    const instructions =
      translateUvPlanToNativeInstructions(plan);
    expect(instructions).toEqual([
      expect.objectContaining({
        kind: "FACE_UV",
        island_id: "face:move:north",
        cube_uuid: "move",
        face: "north",
      }),
    ]);
  });

  test("validator rejects fixed movement and undeclared overlap", () => {
    const source = cubes();
    const snapshot = buildUvLayoutSnapshot(
      source,
      32,
      32,
      (island) =>
        island.source.cube_name === "fixed"
          ? { locked: true, padding_pixels: 0 }
          : { padding_pixels: 0 }
    );
    const plan = planUvPacking(snapshot, {
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "REPACK_SELECTED",
      island_ids: ["face:move:north"],
    });
    const broken = structuredClone(plan);
    broken.proposed.islands[0].rect.x += 1;
    broken.proposed.islands[1].rect = {
      ...broken.proposed.islands[0].rect,
    };
    const validation = validateUvLayoutPlan(broken);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      "FIXED_ISLAND_MOVED:face:fixed:north"
    );
    expect(
      validation.errors.some((error) =>
        error.startsWith("UNDECLARED_OVERLAP:")
      )
    ).toBe(true);
  });

  test("shared UV overlap must honor real shape, uniqueness, and mirror policy", () => {
    const matching = cubes();
    matching[1].to = [4, 4, 1];
    matching[1].faces[0].uv = [8, 0, 12, 4];
    const proposedPlan = (constraints: { unique_detail?: boolean; mirror_policy?: "FORBID" } = {},
      inputs = matching) => {
      const snapshot = buildUvLayoutSnapshot(inputs, 32, 32, (island) => ({
        stack_group: "pair",
        padding_pixels: 0,
        ...(island.source.cube_name === "fixed" ? constraints : {}),
      }));
      const plan = structuredClone(planUvPacking(snapshot, {
        bitmap_width: 32, bitmap_height: 32,
      }));
      plan.proposed.islands[1].rect = { ...plan.proposed.islands[0].rect };
      // The packer's original score was valid, but is not a semantic verdict.
      expect(plan.score.valid).toBe(true);
      return plan;
    };

    const legal = proposedPlan();
    expect(validateUvLayoutPlan(legal).valid).toBe(true);
    for (const unsafe of [
      proposedPlan({ unique_detail: true }),
      proposedPlan({ mirror_policy: "FORBID" }),
      proposedPlan({}, cubes()), // original second Cube is physically narrower
    ]) {
      const validation = validateUvLayoutPlan(unsafe);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((reason) => reason.startsWith("UNSAFE_SHARED_UV:")))
        .toBe(true);
      const report = buildUvDryRunReport(unsafe);
      expect(report.apply_allowed).toBe(false);
      expect(report.hard_violations.some((reason) => reason.startsWith("UNSAFE_SHARED_UV:")))
        .toBe(true);
    }
  });

  test("locked movement cannot bypass validation by omitting fixed IDs", () => {
    const snapshot = buildUvLayoutSnapshot(cubes(), 32, 32, (island) =>
      island.source.cube_name === "fixed"
        ? { locked: true, padding_pixels: 0 }
        : { padding_pixels: 0 }
    );
    const plan = structuredClone(planUvPacking(snapshot, {
      mode: "REPACK_SELECTED", island_ids: ["face:move:north"],
      bitmap_width: 32, bitmap_height: 32,
    }));
    plan.fixed_island_ids = [];
    plan.proposed.islands[0].rect.x += 1;
    const verdict = validateUvLayoutPlan(plan);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain("LOCKED_ISLAND_MOVED:face:fixed:north");
    expect(verdict.errors).toContain("UNDECLARED_MOVEMENT:face:fixed:north");
  });

  test("stale snapshot compatibility rejects post-plan UV changes", () => {
    const source = cubes();
    const snapshot = buildUvLayoutSnapshot(source, 32, 32);
    const plan = planUvPacking(snapshot, {
      bitmap_width: 32,
      bitmap_height: 32,
    });
    const changed = structuredClone(snapshot);
    changed.islands[0].rect.x += 1;
    expect(() =>
      assertUvPlanSnapshotCompatible(plan, changed)
    ).toThrow(/STALE_UV_PLAN/);
  });
});
