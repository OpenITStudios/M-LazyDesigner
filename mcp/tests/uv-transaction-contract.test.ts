import { describe, expect, test } from "bun:test";
import { buildUvLayoutSnapshot } from "@/lib/uv/islands";
import { planUvPacking } from "@/lib/uv/packing/planner";
import {
  buildUvNativeSourceSnapshot,
  fingerprintUvNativeSource,
  type UvNativeMutationInstruction,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import {
  applyUvLayoutPlanAtomic,
  UvTransactionOutcomeUnknownError,
} from "@/lib/uv/transaction";
import { invalidationForUvReceipt } from "@/lib/uv/invalidation";

function sourceCubes() {
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

function planned() {
  const cubes = sourceCubes();
  const snapshot = buildUvLayoutSnapshot(
    cubes,
    32,
    32,
    (island) =>
      island.source.cube_name === "fixed"
        ? { locked: true, padding_pixels: 0 }
        : { padding_pixels: 0 }
  );
  return {
    cubes,
    plan: planUvPacking(snapshot, {
      bitmap_width: 32,
      bitmap_height: 32,
      mode: "REPACK_SELECTED",
      island_ids: ["face:move:north"],
    }),
  };
}

describe("UV atomic transaction contracts", () => {
  test("direct transaction refuses zero-delta plans before reading native state", async () => {
    const { plan } = planned();
    const noOp = { ...plan, moved_island_ids: [] };
    let reads = 0;
    let undoCalls = 0;
    await expect(applyUvLayoutPlanAtomic(
      noOp,
      "sha256:" + "a".repeat(64),
      {
        readSource: () => { reads++; throw new Error("unexpected native read"); },
        beginUndo: () => { undoCalls++; },
        apply: () => { throw new Error("unexpected native write"); },
        restore: () => {},
      }
    )).rejects.toThrow(/UV_NO_OP_PLAN/);
    expect(reads).toBe(0);
    expect(undoCalls).toBe(0);
  });


  test("native transaction retains mirrored face winding in committed UV instruction", async () => {
    const cubes = sourceCubes();
    cubes[1].faces[0].uv = [12, 4, 10, 0];
    const snapshot = buildUvLayoutSnapshot(cubes, 32, 32, (island) =>
      island.source.cube_name === "fixed"
        ? { locked: true, padding_pixels: 0 }
        : { padding_pixels: 0, rotation: { allowed: false } }
    );
    const plan = planUvPacking(snapshot, {
      bitmap_width: 32, bitmap_height: 32,
      mode: "REPACK_SELECTED",
      island_ids: ["face:move:north"],
    });
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const original = structuredClone(native);
    let beganUndo = false;
    let writtenUv: number[] | null = null;
    await applyUvLayoutPlanAtomic(plan, fingerprintUvNativeSource(native), {
      readSource: () => native,
      beginUndo: () => { beganUndo = true; },
      apply: (instructions) => {
        const instruction = instructions[0];
        if (!instruction || instruction.kind !== "FACE_UV") throw Error("expected face");
        writtenUv = [...instruction.uv];
        native = structuredClone(native);
        const face = native.cubes[1].faces[0];
        face.uv = [...instruction.uv];
        face.rotation = instruction.rotation;
      },
      restore: (saved) => { native = structuredClone(saved); },
    });
    expect(beganUndo).toBe(true);
    expect(writtenUv).not.toBeNull();
    expect(writtenUv![0]).toBeGreaterThan(writtenUv![2]);
    expect(writtenUv![1]).toBeGreaterThan(writtenUv![3]);
    expect([...native.cubes[1].faces[0].uv]).toEqual(writtenUv!);
    expect(original.cubes[1].faces[0].uv).toEqual([12, 4, 10, 0]);
  });

  test("successful apply produces continuation-ready receipt and precise invalidation", async () => {
    const { cubes, plan } = planned();
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const beforeFingerprint = fingerprintUvNativeSource(native);
    let committed = false;

    const receipt = await applyUvLayoutPlanAtomic(
      plan,
      beforeFingerprint,
      {
        readSource: () => native,
        apply: (instructions) => {
          for (const instruction of instructions) {
            if (instruction.kind !== "FACE_UV") continue;
            native = structuredClone(native);
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
        commitUndo: () => {
          committed = true;
        },
      }
    );

    expect(committed).toBe(true);
    expect(receipt.changed_island_ids).toEqual([
      "face:move:north",
    ]);
    expect(receipt.changed_cube_ids).toEqual(["move"]);
    expect(receipt.changed_faces).toEqual([
      { cube_uuid: "move", face: "north" },
    ]);
    expect(receipt.source_fingerprint_after).not.toBe(
      receipt.source_fingerprint_before
    );

    const invalidation = invalidationForUvReceipt(receipt);
    expect(invalidation.uv_mapping.stale).toBe(true);
    expect(invalidation.texture_appearance).toMatchObject({
      stale: true,
      cube_ids: ["move"],
    });
    expect(invalidation.geometry_structure.stale).toBe(false);
    expect(invalidation.animation_motion.stale).toBe(false);
  });

  test("collateral native face mutation refuses Undo commit and verifies rollback", async () => {
    const { cubes, plan } = planned();
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const original = structuredClone(native);
    const calls: string[] = [];

    await expect(applyUvLayoutPlanAtomic(
      plan,
      fingerprintUvNativeSource(native),
      {
        readSource: () => native,
        beginUndo: () => { calls.push("begin"); },
        apply: (instructions) => {
          calls.push("apply");
          native = structuredClone(native);
          for (const instruction of instructions) {
            if (instruction.kind !== "FACE_UV") continue;
            const face = native.cubes.find((cube) =>
              cube.uuid === instruction.cube_uuid
            )!.faces.find((entry) => entry.face === instruction.face)!;
            face.uv = [...instruction.uv];
            face.rotation = instruction.rotation;
          }
          // The requested face is correct; only an unrelated face is damaged.
          native.cubes.find((cube) => cube.uuid === "fixed")!.faces[0].uv[0] += 1;
        },
        restore: (saved) => {
          calls.push("restore");
          native = structuredClone(saved);
        },
        cancelUndo: () => { calls.push("cancel"); },
        commitUndo: () => { calls.push("commit"); },
      }
    )).rejects.toThrow("UV_APPLY_SCOPE_VIOLATION");

    expect(calls).toEqual(["begin", "apply", "restore", "cancel"]);
    expect(native).toEqual(original);
  });

  test("failed apply restores exact pre-apply snapshot and cancels undo", async () => {
    const { cubes, plan } = planned();
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const original = structuredClone(native);
    const beforeFingerprint = fingerprintUvNativeSource(native);
    let cancelled = false;

    await expect(
      applyUvLayoutPlanAtomic(plan, beforeFingerprint, {
        readSource: () => native,
        apply: (_instructions: readonly UvNativeMutationInstruction[]) => {
          native = structuredClone(native);
          native.cubes[1].faces[0].uv = [1,1,2,2];
          throw new Error("fixture failure");
        },
        restore: (snapshot) => {
          native = structuredClone(snapshot);
        },
        cancelUndo: () => {
          cancelled = true;
        },
      })
    ).rejects.toThrow("fixture failure");

    expect(cancelled).toBe(true);
    expect(native).toEqual(original);
  });

  test("beginUndo rejection cannot trigger foreign restore, cancel or native mutation", async () => {
    const { cubes, plan } = planned();
    const snapshot = buildUvNativeSourceSnapshot(cubes, 32, 32);
    let calls: string[] = [];
    await expect(applyUvLayoutPlanAtomic(plan, fingerprintUvNativeSource(snapshot), {
      readSource: () => snapshot,
      beginUndo: () => { calls.push("begin"); throw new Error("Undo already active"); },
      apply: () => { calls.push("mutate"); },
      restore: () => { calls.push("restore"); },
      cancelUndo: () => { calls.push("cancel"); },
    })).rejects.toThrow("Undo already active");
    expect(calls).toEqual(["begin"]);
  });

  test("failed apply with verified rollback retains the original fault", async () => {
    const { cubes, plan } = planned();
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const original = structuredClone(native);
    const calls: string[] = [];
    const failure = new Error("native update failed");
    try {
      await applyUvLayoutPlanAtomic(plan, fingerprintUvNativeSource(native), {
        readSource: () => native,
        beginUndo: () => { calls.push("begin"); },
        apply: () => {
          calls.push("apply");
          native = structuredClone(native);
          native.cubes[1].faces[0].uv = [7,7,9,9];
          throw failure;
        },
        restore: snapshot => { calls.push("restore"); native = structuredClone(snapshot); },
        cancelUndo: () => { calls.push("cancel"); },
      });
      throw new Error("expected source mutation failure");
    } catch (error) {
      expect(error).toBe(failure);
    }
    expect(native).toEqual(original);
    expect(calls).toEqual(["begin", "apply", "restore", "cancel"]);
  });

  test("rollback mismatch reports outcome unknown and preserves original cause", async () => {
    const { cubes, plan } = planned();
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const initial = fingerprintUvNativeSource(native);
    const failure = new Error("native partial write");
    let cancelled = false;
    try {
      await applyUvLayoutPlanAtomic(plan, initial, {
        readSource: () => native,
        apply: () => {
          native = structuredClone(native);
          native.cubes[1].faces[0].uv = [2,2,5,5];
          throw failure;
        },
        restore: () => {}, // lies: failed to restore despite returning
        cancelUndo: () => { cancelled = true; },
      });
      throw new Error("expected outcome unknown");
    } catch (error) {
      expect(error).toBeInstanceOf(UvTransactionOutcomeUnknownError);
      const unknown = error as UvTransactionOutcomeUnknownError;
      expect(unknown.outcomeUnknown).toBe(true);
      expect(unknown.cause).toBe(failure);
      expect(unknown.recoveryFailures).toHaveLength(1);
      expect(String(unknown.recoveryFailures[0])).toContain("UV_ROLLBACK_MISMATCH");
    }
    expect(cancelled).toBe(true);
  });

  test("Undo cancellation drift after successful restore still reports outcome unknown", async () => {
    const { cubes, plan } = planned();
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const original = structuredClone(native);
    const failure = new Error("native apply fault");
    try {
      await applyUvLayoutPlanAtomic(plan, fingerprintUvNativeSource(native), {
        readSource: () => native,
        apply: () => { throw failure; },
        restore: snapshot => { native = structuredClone(snapshot); },
        cancelUndo: () => {
          // A native cancellation can itself alter already-restored UV bytes.
          native = structuredClone(original);
          native.cubes[1].faces[0].uv = [1, 1, 3, 3];
        },
      });
      throw new Error("expected outcome unknown");
    } catch (error) {
      expect(error).toBeInstanceOf(UvTransactionOutcomeUnknownError);
      const unknown = error as UvTransactionOutcomeUnknownError;
      expect(unknown.cause).toBe(failure);
      expect(String(unknown.recoveryFailures[0])).toContain("UV_ROLLBACK_MISMATCH");
    }
  });

  test("recovery failures cannot conceal original mutation fault", async () => {
    const { cubes, plan } = planned();
    const native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const failure = new Error("original fault");
    const restorationFailure = new Error("rollback fault");
    const cancellationFailure = new Error("cancel fault");
    try {
      await applyUvLayoutPlanAtomic(plan, fingerprintUvNativeSource(native), {
        readSource: () => native,
        apply: () => { throw failure; },
        restore: () => { throw restorationFailure; },
        cancelUndo: () => { throw cancellationFailure; },
      });
      throw new Error("expected outcome unknown");
    } catch (error) {
      expect(error).toBeInstanceOf(UvTransactionOutcomeUnknownError);
      const unknown = error as UvTransactionOutcomeUnknownError;
      expect(unknown.cause).toBe(failure);
      expect(unknown.recoveryFailures).toContain(restorationFailure);
      expect(unknown.recoveryFailures).toContain(cancellationFailure);
    }
  });

  test("uncertain Undo commit refuses automatic rollback or cancellation", async () => {
    const { cubes, plan } = planned();
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const failure = new Error("finishEdit failed after commit");
    const calls: string[] = [];
    try {
      await applyUvLayoutPlanAtomic(plan, fingerprintUvNativeSource(native), {
        readSource: () => native,
        apply: instructions => {
          native = structuredClone(native);
          for (const instruction of instructions) {
            if (instruction.kind !== "FACE_UV") continue;
            const target = native.cubes.find(cube => cube.uuid === instruction.cube_uuid)!;
            const face = target.faces.find(face => face.face === instruction.face)!;
            face.uv = [...instruction.uv];
            face.rotation = instruction.rotation;
          }
        },
        restore: () => { calls.push("restore"); },
        commitUndo: () => { calls.push("commit"); throw failure; },
        cancelUndo: () => { calls.push("cancel"); },
      });
      throw new Error("expected outcome unknown");
    } catch (error) {
      expect(error).toBeInstanceOf(UvTransactionOutcomeUnknownError);
      expect((error as UvTransactionOutcomeUnknownError).cause).toBe(failure);
    }
    expect(calls).toEqual(["commit"]);
  });

  test("stale source rejects before beginUndo/apply", async () => {
    const { cubes, plan } = planned();
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const expected = fingerprintUvNativeSource(native);
    native = structuredClone(native);
    native.cubes[1].faces[0].rotation = 90;
    let began = false;
    let applied = false;

    await expect(
      applyUvLayoutPlanAtomic(plan, expected, {
        readSource: () => native,
        beginUndo: () => {
          began = true;
        },
        apply: () => {
          applied = true;
        },
        restore: () => {},
      })
    ).rejects.toThrow(/STALE_UV_PLAN/);

    expect(began).toBe(false);
    expect(applied).toBe(false);
  });

  test("partial native application fails exact postcondition and rolls back", async () => {
    const { cubes, plan } = planned();
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const original = structuredClone(native);
    const expected = fingerprintUvNativeSource(native);

    await expect(
      applyUvLayoutPlanAtomic(plan, expected, {
        readSource: () => native,
        apply: (instructions) => {
          const instruction = instructions[0];
          if (!instruction || instruction.kind !== "FACE_UV") return;
          native = structuredClone(native);
          const cube = native.cubes.find(
            (entry) => entry.uuid === instruction.cube_uuid
          )!;
          const face = cube.faces.find(
            (entry) => entry.face === instruction.face
          )!;
          // Deliberately mutate only rotation, leaving UV coordinates wrong.
          face.rotation = instruction.rotation;
        },
        restore: (snapshot) => {
          native = structuredClone(snapshot);
        },
      })
    ).rejects.toThrow(/Face UV instruction.*not applied exactly/);

    expect(native).toEqual(original);
  });

  test("postcondition failure rolls back when adapter reports unchanged state", async () => {
    const { cubes, plan } = planned();
    let native = buildUvNativeSourceSnapshot(cubes, 32, 32);
    const original = structuredClone(native);
    const expected = fingerprintUvNativeSource(native);

    await expect(
      applyUvLayoutPlanAtomic(plan, expected, {
        readSource: () => native,
        apply: () => {},
        restore: (snapshot) => {
          native = structuredClone(snapshot);
        },
      })
    ).rejects.toThrow(/POSTCONDITION_FAILED/);

    expect(native).toEqual(original);
  });
});
