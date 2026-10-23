import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe, CompiledCubePlacement } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import {
  applyAuthoringRecipeIncrementalAtomic,
  revertLastAuthoringRecipeApply,
} from "@/lib/authoringRecipe/transaction";
import {
  fingerprintAuthoringRecipeNativeSnapshot,
  snapshotRecipeNativeParentHierarchy,
  type AuthoringRecipeNativeSnapshot,
  type RecipeNativeParentGroup,
} from "@/lib/authoringRecipe/nativeState";
import { requireBoxUvRepresentableSpan } from "@/lib/geometry/cubeSpan";

function recipe(spacing = 2, count = 4): AuthoringRecipe {
  return { schema: 1, compiler_version: 1, id: "fixture", name: "Fixture", prototypes: [{ id: "cube", name: "cube", size: [1,1,1] }], patterns: [{ kind: "LINEAR", id: "line", prototype_id: "cube", count, axis: "X", spacing }] };
}

function snapshotFromRecipe(value: AuthoringRecipe): AuthoringRecipeNativeSnapshot {
  return { schema: 1, recipe_id: value.id, cubes: compileAuthoringRecipe(value).placements.map((placement,index) => ({ uuid: "uuid-" + placement.id + "-" + index, recipe_id: value.id, instance_id: placement.id, name: placement.name, from: [...placement.from], to: [...placement.to], origin: [...placement.origin], rotation: [...placement.rotation], inflate: placement.inflate })) };
}

function fakeAdapter(initial: AuthoringRecipeNativeSnapshot) {
  let native = structuredClone(initial);
  let committed = false;
  let cancelled = false;
  return {
    adapter: {
      readOwned: () => structuredClone(native),
      beginUndo: (_ids: readonly string[]) => {},
      remove: (instanceId: string) => { native.cubes = native.cubes.filter((cube) => cube.instance_id !== instanceId); },
      upsert: (placement: CompiledCubePlacement, existingUuid: string | null, recipeId: string) => {
        const state = { uuid: existingUuid ?? "created-" + placement.id, recipe_id: recipeId, instance_id: placement.id, name: placement.name, from: [...placement.from] as [number,number,number], to: [...placement.to] as [number,number,number], origin: [...placement.origin] as [number,number,number], rotation: [...placement.rotation] as [number,number,number], inflate: placement.inflate };
        const index = native.cubes.findIndex((cube) => cube.instance_id === placement.id);
        if (index >= 0) native.cubes[index] = state; else native.cubes.push(state);
        return state.uuid;
      },
      restore: (snapshot: AuthoringRecipeNativeSnapshot) => { native = structuredClone(snapshot); },
      commitUndo: () => { committed = true; },
      cancelUndo: () => { cancelled = true; },
    },
    get state() { return native; },
    get committed() { return committed; },
    get cancelled() { return cancelled; },
  };
}

describe("Parametric authoring atomic affected-only transaction", () => {
  test("updates only changed instances and preserves UUID ownership", async () => {
    const previous = recipe(2,4);
    const next = recipe(3,4);
    const initial = snapshotFromRecipe(previous);
    const fake = fakeAdapter(initial);
    const receipt = await applyAuthoringRecipeIncrementalAtomic(previous,next,fingerprintAuthoringRecipeNativeSnapshot(initial),fake.adapter);
    expect(receipt.execution).toBe("applied");
    expect(receipt.updated_instance_ids).toEqual(["line:1","line:2","line:3"]);
    expect(receipt.created_instance_ids).toEqual([]);
    expect(receipt.preserved_instance_ids).toEqual(["line:0"]);
    expect(fake.committed).toBe(true);
    expect(fake.state.cubes.find((cube) => cube.instance_id === "line:2")?.uuid).toContain("uuid-line:2");
  });

  test("recipe-owned Box UV micro Cubes are preflighted before Undo", async () => {
    const before = recipe(2, 4);
    const after = structuredClone(before);
    after.prototypes[0].size = [0.25, 1, 1];
    const baseline = snapshotFromRecipe(before);
    const fake = fakeAdapter(baseline);
    let beganUndo = false;
    let preflighted = false;
    await expect(applyAuthoringRecipeIncrementalAtomic(
      before, after, fingerprintAuthoringRecipeNativeSnapshot(baseline), {
        ...fake.adapter,
        preflightUpserts(placements) {
          preflighted = true;
          for (const placement of placements) {
            requireBoxUvRepresentableSpan(placement.from, placement.to, "recipe");
          }
        },
        beginUndo() { beganUndo = true; },
      }
    )).rejects.toThrow("sub-unit Box UV size on x");
    expect(preflighted).toBe(true);
    expect(beganUndo).toBe(false);
    expect(fake.state).toEqual(baseline);
  });

  test("read-only pre-commit gate vetoes mutation and restores exact native baseline", async () => {
    const previous = recipe(2,4);
    const next = recipe(3,4);
    const baseline = snapshotFromRecipe(previous);
    const fake = fakeAdapter(baseline);
    let checked = 0;
    await expect(applyAuthoringRecipeIncrementalAtomic(
      previous, next, fingerprintAuthoringRecipeNativeSnapshot(baseline),
      {
        ...fake.adapter,
        verifyBeforeCommit({ before, after, affectedInstanceIds }) {
          checked++;
          expect(before).toEqual(baseline);
          expect(after).toEqual(snapshotFromRecipe(next));
          expect(affectedInstanceIds).toEqual(["line:1", "line:2", "line:3"]);
          expect(fake.committed).toBe(false);
          throw new Error("LANDMARK_PRECOMMIT_REGRESSED: measured point worsened.");
        },
      }
    )).rejects.toThrow("LANDMARK_PRECOMMIT_REGRESSED");
    expect(checked).toBe(1);
    expect(fake.cancelled).toBe(true);
    expect(fake.committed).toBe(false);
    expect(fake.state).toEqual(baseline);
  });

  test("successful pre-commit evidence check runs before native commit", async () => {
    const previous = recipe(2,4);
    const next = recipe(3,4);
    const baseline = snapshotFromRecipe(previous);
    const fake = fakeAdapter(baseline);
    const operations: string[] = [];
    const receipt = await applyAuthoringRecipeIncrementalAtomic(
      previous, next, fingerprintAuthoringRecipeNativeSnapshot(baseline),
      {
        ...fake.adapter,
        verifyBeforeCommit() {
          operations.push("verify");
          expect(fake.committed).toBe(false);
        },
        commitUndo() {
          operations.push("commit");
        },
      }
    );
    expect(receipt.execution).toBe("applied");
    expect(operations).toEqual(["verify", "commit"]);
  });

  test("verification hook cannot modify native Cube state before Undo is committed", async () => {
    const previous = recipe(2,4);
    const next = recipe(3,4);
    const baseline = snapshotFromRecipe(previous);
    const fake = fakeAdapter(baseline);
    await expect(applyAuthoringRecipeIncrementalAtomic(
      previous, next, fingerprintAuthoringRecipeNativeSnapshot(baseline),
      {
        ...fake.adapter,
        verifyBeforeCommit({ before, after }) {
          // A buggy inspector tries to change both its snapshot and native.
          before.cubes[0]!.from = [77, 0, 0];
          after.cubes[0]!.from = [88, 0, 0];
          fake.state.cubes[1]!.from = [99, 0, 0];
        },
      }
    )).rejects.toThrow("RECIPE_PRECOMMIT_STATE_CHANGED");
    expect(fake.committed).toBe(false);
    expect(fake.cancelled).toBe(true);
    expect(fake.state).toEqual(baseline);
  });

  test("native cancel is attempted even when a custom restore hook fails", async () => {
    const previous = recipe(2,4);
    const next = recipe(3,4);
    const baseline = snapshotFromRecipe(previous);
    const fake = fakeAdapter(baseline);
    await expect(applyAuthoringRecipeIncrementalAtomic(
      previous, next, fingerprintAuthoringRecipeNativeSnapshot(baseline),
      {
        ...fake.adapter,
        restore: () => { throw new Error("restore cannot run"); },
        verifyBeforeCommit: () => { throw new Error("check rejected"); },
      }
    )).rejects.toThrow("RECIPE_APPLY_ROLLBACK_UNVERIFIED");
    expect(fake.cancelled).toBe(true);
    expect(fake.committed).toBe(false);
  });

  test("a failed edit with unverified rollback never reports atomic recovery", async () => {
    const previous = recipe(2,4);
    const next = recipe(3,4);
    const baseline = snapshotFromRecipe(previous);
    const fake = fakeAdapter(baseline);
    await expect(applyAuthoringRecipeIncrementalAtomic(
      previous, next, fingerprintAuthoringRecipeNativeSnapshot(baseline),
      {
        ...fake.adapter,
        restore: () => {}, // intentionally defective recovery adapter
        verifyBeforeCommit: () => { throw new Error("precommit rejected"); },
      }
    )).rejects.toThrow("RECIPE_APPLY_ROLLBACK_UNVERIFIED");
    expect(fake.committed).toBe(false);
    expect(fake.cancelled).toBe(true);
    expect(fake.state).not.toEqual(baseline);
  });

  test("reverts a receipt-bound last native edit and verifies original fingerprint", async () => {
    const previous = recipe(2, 4), next = recipe(3, 4);
    const baseline = snapshotFromRecipe(previous);
    const fake = fakeAdapter(baseline);
    const provenance = {
      token: "owned-undo-1",
      project_uuid: "project-uuid-1",
      undo_index: 1,
    };
    const adapter = {
      ...fake.adapter,
      commitUndo(binding: { recipe_id: string;
        native_source_fingerprint_before: string;
        native_source_fingerprint_after: string }) {
        expect(binding.recipe_id).toBe("fixture");
        expect(binding.native_source_fingerprint_before)
          .toBe(fingerprintAuthoringRecipeNativeSnapshot(baseline));
        expect(binding.native_source_fingerprint_after)
          .toBe(fingerprintAuthoringRecipeNativeSnapshot(fake.state));
        return provenance;
      },
      revertCommittedUndo(binding: {recipe_id: string;
        provenance: typeof provenance;
        native_source_fingerprint_before: string;
        native_source_fingerprint_after: string }) {
        expect(binding.recipe_id).toBe("fixture");
        expect(binding.provenance).toEqual(provenance);
        expect(binding.native_source_fingerprint_after)
          .toBe(fingerprintAuthoringRecipeNativeSnapshot(fake.state));
        fake.adapter.restore(baseline);
      },
    };
    const receipt = await applyAuthoringRecipeIncrementalAtomic(
      previous, next, fingerprintAuthoringRecipeNativeSnapshot(baseline), adapter
    );
    expect(receipt.native_undo_provenance).toEqual(provenance);
    const result = await revertLastAuthoringRecipeApply(
      receipt, receipt.native_source_fingerprint_after, adapter
    );
    expect(result).toEqual({
      execution: "reverted", recipe_id: "fixture",
      native_source_fingerprint_after_revert:
        fingerprintAuthoringRecipeNativeSnapshot(baseline),
    });
    expect(fake.state).toEqual(baseline);
  });

  test("post-commit revert fails closed on absent provenance and changed native state", async () => {
    const previous = recipe(2, 4), next = recipe(3, 4);
    const baseline = snapshotFromRecipe(previous);
    const fake = fakeAdapter(baseline);
    let nativeUndoCalls = 0;
    const adapter = {
      ...fake.adapter,
      revertCommittedUndo: () => { nativeUndoCalls++; },
    };
    const receipt = await applyAuthoringRecipeIncrementalAtomic(
      previous, next, fingerprintAuthoringRecipeNativeSnapshot(baseline), adapter
    );
    await expect(revertLastAuthoringRecipeApply(
      receipt, receipt.native_source_fingerprint_after, adapter
    )).rejects.toThrow("RECIPE_POSTCOMMIT_UNDO_UNAVAILABLE");
    const marked = {
      ...receipt,
      native_undo_provenance: { token: "t", project_uuid: "p", undo_index: 1 },
    };
    await expect(revertLastAuthoringRecipeApply(
      marked, "sha256:wrong", adapter
    )).rejects.toThrow("RECIPE_POSTCOMMIT_FINGERPRINT_MISMATCH");
    fake.state.cubes[1]!.from = [77, 0, 0];
    await expect(revertLastAuthoringRecipeApply(
      marked, receipt.native_source_fingerprint_after, adapter
    )).rejects.toThrow("RECIPE_POSTCOMMIT_STATE_CHANGED");
    expect(nativeUndoCalls).toBe(0);
  });

  test("native Undo errors and incomplete restoration are never treated as successful recovery", async () => {
    const previous = recipe(2, 4), next = recipe(3, 4);
    const baseline = snapshotFromRecipe(previous);
    const fake = fakeAdapter(baseline);
    const provenance = { token: "owned-undo", project_uuid: "p", undo_index: 1 };
    const shared = {
      ...fake.adapter,
      commitUndo: () => provenance,
    };
    const receipt = await applyAuthoringRecipeIncrementalAtomic(
      previous, next, fingerprintAuthoringRecipeNativeSnapshot(baseline), shared
    );
    await expect(revertLastAuthoringRecipeApply(
      receipt, receipt.native_source_fingerprint_after,
      { ...shared, revertCommittedUndo: () => { throw new Error("native Undo interrupted"); } }
    )).rejects.toThrow("RECIPE_POSTCOMMIT_UNDO_UNVERIFIED");
    await expect(revertLastAuthoringRecipeApply(
      receipt, receipt.native_source_fingerprint_after,
      { ...shared, revertCommittedUndo: () => {} }
    )).rejects.toThrow("RECIPE_POSTCOMMIT_UNDO_UNVERIFIED");
    let reads = 0;
    await expect(revertLastAuthoringRecipeApply(
      receipt, receipt.native_source_fingerprint_after,
      {
        ...shared,
        readOwned: () => {
          reads++;
          if (reads === 2) throw new Error("native readback unavailable");
          return structuredClone(fake.state);
        },
        revertCommittedUndo: () => {},
      }
    )).rejects.toThrow("RECIPE_POSTCOMMIT_UNDO_UNVERIFIED");
    expect(reads).toBe(2);
  });

  test("count increase creates only new instances; count reduction removes only deleted instances", async () => {
    const base = recipe(2,3);
    const larger = recipe(2,5);
    let fake = fakeAdapter(snapshotFromRecipe(base));
    let beforeFingerprint = fingerprintAuthoringRecipeNativeSnapshot(fake.state);
    const grow = await applyAuthoringRecipeIncrementalAtomic(base,larger,beforeFingerprint,fake.adapter);
    expect(grow.created_instance_ids).toEqual(["line:3","line:4"]);
    expect(grow.updated_instance_ids).toEqual([]);
    const grownState = structuredClone(fake.state);
    fake = fakeAdapter(grownState);
    beforeFingerprint = fingerprintAuthoringRecipeNativeSnapshot(grownState);
    const shrink = await applyAuthoringRecipeIncrementalAtomic(larger,base,beforeFingerprint,fake.adapter);
    expect(shrink.removed_instance_ids).toEqual(["line:3","line:4"]);
    expect(shrink.updated_instance_ids).toEqual([]);
  });

  test("native parent ancestry changes invalidate an otherwise identical recipe fingerprint", async () => {
    const previous = recipe(2, 4);
    const next = recipe(3, 4);
    const baseline = snapshotFromRecipe(previous);
    const rooted: AuthoringRecipeNativeSnapshot = {
      ...baseline,
      cubes: baseline.cubes.map((cube) => ({ ...cube, parent_path: [] })),
    };
    const changed: AuthoringRecipeNativeSnapshot = structuredClone(rooted);
    changed.cubes[1]!.parent_path = ["torso", "arm"];

    // The local Cube geometry and identity do not change.
    expect(changed.cubes[1]!.from).toEqual(rooted.cubes[1]!.from);
    expect(changed.cubes[1]!.rotation).toEqual(rooted.cubes[1]!.rotation);
    expect(fingerprintAuthoringRecipeNativeSnapshot(changed))
      .not.toBe(fingerprintAuthoringRecipeNativeSnapshot(rooted));

    const reparentedGroup = structuredClone(changed);
    reparentedGroup.cubes[1]!.parent_path = ["chest", "arm"];
    // Moving the parent Bone changes ancestry even with the same immediate
    // parent Group ("arm"), so root-to-leaf paths must be compared.
    expect(fingerprintAuthoringRecipeNativeSnapshot(reparentedGroup))
      .not.toBe(fingerprintAuthoringRecipeNativeSnapshot(changed));

    const fake = fakeAdapter(changed);
    let beganUndo = false;
    await expect(applyAuthoringRecipeIncrementalAtomic(
      previous, next, fingerprintAuthoringRecipeNativeSnapshot(rooted), {
        ...fake.adapter,
        beginUndo() { beganUndo = true; },
      }
    )).rejects.toThrow("STALE_RECIPE_PLAN");
    expect(beganUndo).toBe(false);
    expect(fake.committed).toBe(false);
    expect(fake.state).toEqual(changed);

    // Legacy pure fixtures lacking native ancestry remain representable.
    expect(fingerprintAuthoringRecipeNativeSnapshot(baseline))
      .toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("authored ancestor state changes reject stale plans even with unchanged Cube transforms", async () => {
    const isGroup = (value: unknown): value is RecipeNativeParentGroup =>
      value !== null && typeof value === "object" && "uuid" in value;
    const root: RecipeNativeParentGroup = {
      uuid: "torso", name: "torso", parent: "root",
      origin: [0, 8, 0], rotation: [0, 0, 0],
      visibility: true, export: true,
    };
    const arm: RecipeNativeParentGroup = {
      uuid: "arm", name: "arm", parent: root,
      origin: [4, 7, 0], rotation: [0, 0, 0],
    };
    const owner = snapshotRecipeNativeParentHierarchy("cube", arm, isGroup);
    expect(owner.parent_path).toEqual(["torso", "arm"]);
    expect(owner.parent_authored_state.map((g) => g.name)).toEqual(["torso", "arm"]);
    const baseline = snapshotFromRecipe(recipe());
    const initial: AuthoringRecipeNativeSnapshot = {
      ...baseline,
      cubes: baseline.cubes.map((cube) => ({ ...cube, ...owner })),
    };
    const hash = fingerprintAuthoringRecipeNativeSnapshot(initial);
    const modifiers: Array<(group: (typeof owner.parent_authored_state)[number]) => void> = [
      (group) => { group.origin[0] += 1; },
      (group) => { group.rotation[2] = 30; },
      (group) => { group.name = "renamed_arm"; },
      (group) => { group.visibility = false; },
      (group) => { group.export = false; },
      (group) => { group.bedrock_binding = "query.body_y_rotation"; },
      (group) => { group.mirror_uv = true; },
      (group) => { group.reset = true; },
    ];
    for (const modify of modifiers) {
      const changed = structuredClone(initial);
      modify(changed.cubes[1]!.parent_authored_state![1]!);
      expect(changed.cubes[1]!.parent_path).toEqual(initial.cubes[1]!.parent_path);
      expect(changed.cubes[1]!.from).toEqual(initial.cubes[1]!.from);
      expect(fingerprintAuthoringRecipeNativeSnapshot(changed)).not.toBe(hash);
    }
    const changed = structuredClone(initial);
    changed.cubes[1]!.parent_authored_state![0]!.rotation = [0, 45, 0];
    const fake = fakeAdapter(changed);
    let beganUndo = false;
    await expect(applyAuthoringRecipeIncrementalAtomic(
      recipe(), recipe(3), hash,
      { ...fake.adapter, beginUndo() { beganUndo = true; } }
    )).rejects.toThrow("STALE_RECIPE_PLAN");
    expect(beganUndo).toBe(false);
    expect(fake.committed).toBe(false);
    expect(fake.state).toEqual(changed);
  });

  test("native parent authoring reader copies, bounds and validates hierarchy", () => {
    const isGroup = (value: unknown): value is RecipeNativeParentGroup =>
      value !== null && typeof value === "object" && "uuid" in value;
    expect(snapshotRecipeNativeParentHierarchy("cube", "root", isGroup))
      .toEqual({ parent_path: [], parent_authored_state: [] });
    const group: RecipeNativeParentGroup = {
      uuid: "a", name: "bone", origin: [0, 0, 0],
      rotation: [0, 0, 0], parent: "root",
    };
    const state = snapshotRecipeNativeParentHierarchy("cube", group, isGroup);
    group.rotation = [0, 90, 0];
    expect(state.parent_authored_state[0]!.rotation).toEqual([0, 0, 0]);
    expect(state.parent_authored_state[0]!.visibility).toBe(true);
    expect(state.parent_authored_state[0]!.bedrock_binding).toBe(null);
    group.parent = group;
    expect(() => snapshotRecipeNativeParentHierarchy("cube", group, isGroup))
      .toThrow("RECIPE_NATIVE_PARENT_UNKNOWN");
    group.parent = "root";
    group.origin = [NaN, 0, 0];
    expect(() => snapshotRecipeNativeParentHierarchy("cube", group, isGroup))
      .toThrow("RECIPE_NATIVE_PARENT_TRANSFORM_INVALID");
    group.origin = [0, 0, 0];
    group.rotation = [0, Infinity, 0];
    expect(() => snapshotRecipeNativeParentHierarchy("cube", group, isGroup))
      .toThrow("RECIPE_NATIVE_PARENT_TRANSFORM_INVALID");
    group.rotation = [0, 0, 0];
    expect(() => snapshotRecipeNativeParentHierarchy("cube",
      { ...group, parent: group }, isGroup))
      .toThrow("RECIPE_NATIVE_PARENT_UNKNOWN");
    let deep: unknown = "root";
    for (let i = 0; i < 65; i++) {
      deep = { uuid: "g" + i, name: "group" + i,
        origin: [0, 0, 0], rotation: [0, 0, 0], parent: deep };
    }
    expect(() => snapshotRecipeNativeParentHierarchy("cube", deep, isGroup))
      .toThrow("RECIPE_NATIVE_PARENT_UNKNOWN");
  });

  test("stale or manually edited native state is rejected before Undo", async () => {
    const previous = recipe();
    const next = recipe(3);
    const initial = snapshotFromRecipe(previous);
    const fake = fakeAdapter(initial);
    const expected = fingerprintAuthoringRecipeNativeSnapshot(initial);
    fake.state.cubes[1].from = [99,0,0];
    let began = false;
    const adapter = { ...fake.adapter, beginUndo: () => { began = true; } };
    await expect(applyAuthoringRecipeIncrementalAtomic(previous,next,expected,adapter)).rejects.toThrow(/STALE_RECIPE_PLAN/);
    expect(began).toBe(false);
  });

  test("partial failure restores exact before-state and cancels transaction", async () => {
    const previous = recipe();
    const next = recipe(3);
    const initial = snapshotFromRecipe(previous);
    let native = structuredClone(initial);
    let cancelled = false;
    await expect(applyAuthoringRecipeIncrementalAtomic(previous,next,fingerprintAuthoringRecipeNativeSnapshot(initial),{
      readOwned: () => structuredClone(native),
      beginUndo: () => {},
      remove: () => {},
      upsert: (placement) => { native.cubes[0].from = [...placement.from]; throw new Error("fixture failure"); },
      restore: (snapshot) => { native = structuredClone(snapshot); },
      cancelUndo: () => { cancelled = true; },
    })).rejects.toThrow("fixture failure");
    expect(cancelled).toBe(true);
    expect(native).toEqual(initial);
  });

  test("semantic-only recipe change avoids Undo while invalidating dependent intelligence", async () => {
    const previous: AuthoringRecipe = {
      schema: 1,
      compiler_version: 1,
      id: "semantic",
      name: "Semantic",
      prototypes: [{
        id: "part",
        name: "part",
        size: [1,1,1],
        semantic_group: "BODY",
      }],
      patterns: [{
        kind: "LINEAR",
        id: "part",
        prototype_id: "part",
        count: 1,
        axis: "X",
        spacing: 0,
      }],
    };
    const next = structuredClone(previous);
    next.prototypes[0].semantic_group = "IDENTITY";
    const initial = snapshotFromRecipe(previous);
    let began = false;
    const fake = fakeAdapter(initial);
    const receipt = await applyAuthoringRecipeIncrementalAtomic(
      previous,
      next,
      fingerprintAuthoringRecipeNativeSnapshot(initial),
      {
        ...fake.adapter,
        beginUndo: () => { began = true; },
      }
    );
    expect(receipt.execution).toBe("metadata_only");
    expect(receipt.affected_count).toBe(0);
    expect(receipt.recipe_affected_count).toBe(1);
    expect(receipt.metadata_only_instance_ids).toEqual(["part:0"]);
    expect(receipt.invalidates).toEqual({
      geometry_structure: false,
      uv_mapping: true,
      texture_appearance: true,
      animation_motion: true,
    });
    expect(began).toBe(false);
  });

  test("no-op recipe update avoids Undo and all invalidation", async () => {
    const same = recipe();
    const initial = snapshotFromRecipe(same);
    let began = false;
    const fake = fakeAdapter(initial);
    const receipt = await applyAuthoringRecipeIncrementalAtomic(same,structuredClone(same),fingerprintAuthoringRecipeNativeSnapshot(initial),{ ...fake.adapter, beginUndo: () => { began = true; } });
    expect(receipt.execution).toBe("unchanged");
    expect(receipt.affected_count).toBe(0);
    expect(receipt.recipe_affected_count).toBe(0);
    expect(Object.values(receipt.invalidates).every((value) => value === false)).toBe(true);
    expect(began).toBe(false);
  });
});
