import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe, CompiledCubePlacement } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { createAuthoringRecipeService } from "@/lib/authoringRecipe/service";
import { AuthoringRecipePlanRegistry } from "@/lib/authoringRecipe/planRegistry";
import {
  emptyAuthoringRecipeStore,
  findAuthoringRecipeInStore,
  upsertAuthoringRecipeStore,
} from "@/lib/authoringRecipe/store";
import type { AuthoringRecipeNativeSnapshot } from "@/lib/authoringRecipe/nativeState";

function recipe(spacing = 2, count = 40): AuthoringRecipe {
  return { schema: 1, compiler_version: 1, id: "fixture", name: "Fixture", prototypes: [{ id: "cube", name: "cube", size: [1,1,1] }], patterns: [{ kind: "LINEAR", id: "line", prototype_id: "cube", count, axis: "X", spacing }] };
}

function snapshot(value: AuthoringRecipe): AuthoringRecipeNativeSnapshot {
  return { schema: 1, recipe_id: value.id, cubes: compileAuthoringRecipe(value).placements.map((placement,index) => ({ uuid: "uuid-" + index, recipe_id: value.id, instance_id: placement.id, name: placement.name, from: [...placement.from], to: [...placement.to], origin: [...placement.origin], rotation: [...placement.rotation], inflate: placement.inflate })) };
}

describe("Parametric authoring plan-handle service", () => {
  test("plan response stays compact and does not mirror full recipes or Cube payloads", async () => {
    const previous = recipe(2,40);
    const next = recipe(3,40);
    let native = snapshot(previous);
    const service = createAuthoringRecipeService({
      readOwned: () => native,
      createApplyAdapter: () => ({
        readOwned: () => native,
        upsert: (placement: CompiledCubePlacement, existingUuid: string | null, recipeId: string) => {
          const index = native.cubes.findIndex((cube) => cube.instance_id === placement.id);
          const state = { uuid: existingUuid ?? "new-" + placement.id, recipe_id: recipeId, instance_id: placement.id, name: placement.name, from: [...placement.from] as [number,number,number], to: [...placement.to] as [number,number,number], origin: [...placement.origin] as [number,number,number], rotation: [...placement.rotation] as [number,number,number], inflate: placement.inflate };
          if (index >= 0) native.cubes[index] = state; else native.cubes.push(state);
          return state.uuid;
        },
        remove: (instanceId) => { native.cubes = native.cubes.filter((cube) => cube.instance_id !== instanceId); },
      }),
    });
    const planned = await service.plan(previous,next);
    expect(planned.plan_id).toMatch(/^recipeplan:[0-9a-f]{64}$/);
    expect(planned.summary.upserts.count).toBe(39);
    expect(planned.summary.upserts.examples).toHaveLength(12);
    expect(planned.summary.upserts.examples_truncated).toBe(true);
    expect(planned).not.toHaveProperty("previous_recipe");
    expect(planned).not.toHaveProperty("next_recipe");
    const responseBytes = new TextEncoder().encode(JSON.stringify(planned)).length;
    const explicitBytes = new TextEncoder().encode(JSON.stringify(compileAuthoringRecipe(next).placements)).length;
    expect(responseBytes).toBeLessThan(explicitBytes * 0.2);
  });

  test("plan response includes bounded texture handoff without inventing painting or visual PASS", async () => {
    const previous = recipe(2, 1);
    const next = structuredClone(previous);
    next.feature_intents = [
      { id: "frame", label: "support frame", visual_role: "THREE_DIMENSIONAL",
        evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"], geometry_reasons: ["CONTACT"] },
      { id: "seam", label: "painted seam", visual_role: "SURFACE_DETAIL",
        evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"] },
    ];
    next.patterns[0].feature_id = "frame";
    const native = snapshot(previous);
    const service = createAuthoringRecipeService({
      readOwned: () => native,
      createApplyAdapter: () => ({
        readOwned: () => native,
        upsert: () => { throw Error("must not modify native state"); },
        remove: () => { throw Error("must not remove native geometry"); },
      }),
    });
    const plan = await service.plan(previous, next);
    expect(plan.feature_plan?.geometry.count).toBe(1);
    expect(plan.feature_plan?.texture_handoff.examples).toEqual([
      expect.objectContaining({ id: "seam" }),
    ]);
    expect(plan.feature_plan?.visual_verdict).toBe("not_evaluated");
    expect(plan.summary.native_affected_count).toBe(0);
  });

  test("stored-source planning needs only the next recipe after save/reopen", async () => {
    const previous = recipe(2,40);
    const next = recipe(3,40);
    const native = snapshot(previous);
    const store = upsertAuthoringRecipeStore(
      emptyAuthoringRecipeStore(),
      previous
    );
    const service = createAuthoringRecipeService({
      readOwned: () => native,
      readStoredRecipe: (recipeId) =>
        findAuthoringRecipeInStore(store, recipeId),
      createApplyAdapter: () => ({
        readOwned: () => native,
        upsert: () => {
          throw new Error("not used");
        },
        remove: () => {
          throw new Error("not used");
        },
      }),
    });

    const planned = await service.planStored(next);
    expect(planned.plan_id).toMatch(/^recipeplan:[0-9a-f]{64}$/);
    const nextOnlyBytes = new TextEncoder().encode(
      JSON.stringify(next)
    ).length;
    const pairBytes = new TextEncoder().encode(
      JSON.stringify({ previous, next })
    ).length;
    expect(nextOnlyBytes).toBeLessThan(pairBytes);
    expect(planned.summary.native_affected_count).toBe(39);
  });

  test("stored-source planning fails closed when recipe source is absent", async () => {
    const next = recipe(3,4);
    const service = createAuthoringRecipeService({
      readOwned: () => snapshot(recipe(2,4)),
      readStoredRecipe: () => null,
      createApplyAdapter: () => ({
        readOwned: () => snapshot(recipe(2,4)),
        upsert: () => "unused",
        remove: () => {},
      }),
    });
    await expect(service.planStored(next)).rejects.toThrow(
      /RECIPE_NOT_STORED/
    );
  });

  test("apply reuses stored plan and only requires handle plus fingerprint", async () => {
    const previous = recipe(2,4);
    const next = recipe(3,4);
    let native = snapshot(previous);
    const service = createAuthoringRecipeService({
      readOwned: () => structuredClone(native),
      createApplyAdapter: () => ({
        readOwned: () => structuredClone(native),
        upsert: (placement, existingUuid, recipeId) => {
          const index = native.cubes.findIndex((cube) => cube.instance_id === placement.id);
          const state = { uuid: existingUuid ?? "new-" + placement.id, recipe_id: recipeId, instance_id: placement.id, name: placement.name, from: [...placement.from] as [number,number,number], to: [...placement.to] as [number,number,number], origin: [...placement.origin] as [number,number,number], rotation: [...placement.rotation] as [number,number,number], inflate: placement.inflate };
          if (index >= 0) native.cubes[index] = state; else native.cubes.push(state);
          return state.uuid;
        },
        remove: (instanceId) => { native.cubes = native.cubes.filter((cube) => cube.instance_id !== instanceId); },
      }),
    });
    const planned = await service.plan(previous,next);
    const receipt = await service.apply({ plan_id: planned.plan_id, expected_native_source_fingerprint: planned.native_source_fingerprint });
    expect(receipt.execution).toBe("applied");
    expect(receipt.updated_instance_ids).toEqual(["line:1","line:2","line:3"]);
  });

  test("compact apply evidence authorizes one exact last-edit recovery through the same service", async () => {
    const previous = recipe(2, 4), next = recipe(3, 4);
    let native = snapshot(previous);
    const baseline = structuredClone(native);
    let topIsOurUndo = true;
    let nativeUndoCalls = 0;
    const service = createAuthoringRecipeService({
      readOwned: () => structuredClone(native),
      createApplyAdapter: () => ({
        readOwned: () => structuredClone(native),
        upsert(placement, existingUuid, recipeId) {
          const index = native.cubes.findIndex((item) => item.instance_id === placement.id);
          const nextCube = {
            uuid: existingUuid ?? "new-" + placement.id,
            recipe_id: recipeId,
            instance_id: placement.id,
            name: placement.name,
            from: [...placement.from] as [number, number, number],
            to: [...placement.to] as [number, number, number],
            origin: [...placement.origin] as [number, number, number],
            rotation: [...placement.rotation] as [number, number, number],
            inflate: placement.inflate,
          };
          if (index >= 0) native.cubes[index] = nextCube;
          else native.cubes.push(nextCube);
          return nextCube.uuid;
        },
        remove(instanceId) {
          native.cubes = native.cubes.filter((item) => item.instance_id !== instanceId);
        },
        commitUndo: () => ({
          token: "native-history-owned",
          project_uuid: "bound-project",
          undo_index: 1,
        }),
        revertCommittedUndo(binding) {
          nativeUndoCalls++;
          if (!topIsOurUndo || binding.provenance.token !== "native-history-owned") {
            throw new Error("RECIPE_NATIVE_UNDO_NOT_TOP");
          }
          native = structuredClone(baseline);
          topIsOurUndo = false;
        },
      }),
    });
    const plan = await service.plan(previous, next);
    const applied = await service.applyCompact({
      plan_id: plan.plan_id,
      expected_native_source_fingerprint: plan.native_source_fingerprint,
    });
    expect(applied.execution).toBe("applied");
    expect(applied.evidence_handle).toMatch(/^authoringevidence:/);
    expect(applied).not.toHaveProperty("native_undo_provenance");
    topIsOurUndo = false;
    await expect(service.revertApplied({
      evidence_handle: applied.evidence_handle,
      expected_native_source_fingerprint_after: applied.native_source_fingerprint_after,
    })).rejects.toThrow("RECIPE_POSTCOMMIT_UNDO_UNVERIFIED");
    expect(native).not.toEqual(baseline);
    topIsOurUndo = true;
    const restored = await service.revertApplied({
      evidence_handle: applied.evidence_handle,
      expected_native_source_fingerprint_after: applied.native_source_fingerprint_after,
    });
    expect(restored.execution).toBe("reverted");
    expect(native).toEqual(baseline);
    expect(nativeUndoCalls).toBe(2);
    await expect(service.revertApplied({
      evidence_handle: applied.evidence_handle,
      expected_native_source_fingerprint_after: applied.native_source_fingerprint_after,
    })).rejects.toThrow("RECIPE_POSTCOMMIT_STATE_CHANGED");
  });

  test("registry is bounded and evicts old handles", () => {
    const registry = new AuthoringRecipePlanRegistry(2);
    const previous = recipe(2,1);
    const next = recipe(3,1);
    const rebuild = { schema: 1 } as any;
    const a = registry.put({ native_source_fingerprint: "sha256:a", previous_recipe: previous, next_recipe: next, rebuild });
    registry.put({ native_source_fingerprint: "sha256:b", previous_recipe: previous, next_recipe: next, rebuild });
    registry.put({ native_source_fingerprint: "sha256:c", previous_recipe: previous, next_recipe: next, rebuild });
    expect(registry.size()).toBe(2);
    expect(() => registry.get(a.plan_id)).toThrow(/RECIPE_PLAN_NOT_FOUND/);
  });
});
