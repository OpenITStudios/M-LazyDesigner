import { describe, expect, test } from "bun:test";
import { mkdtemp, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileMetadataSignature } from "./fileSignature";
import { readWorkspaceProjection } from "./workspace";
import type { GatewayRuntimeStatus } from "../runtime/backend";
import {
  workspaceSemanticFingerprint,
  workspaceSemanticState,
} from "./workspace";

describe("workspace semantic fingerprint", () => {
  const base = [
    "# Chair",
    "Current Stage: Texturing",
    "Geometry: APPROVED",
    "UV Layout: PASS",
    "Texturing: IN_PROGRESS",
    "Animation: NOT_STARTED",
    "Current next step: paint seat",
    "Known blocker(s): none",
  ].join("\n");

  test("ignores unrelated prose and formatting outside lifecycle fields", () => {
    const changedProse = [
      "# Chair",
      "",
      "This paragraph is documentation only and may change freely.",
      "",
      "Current Stage: Texturing",
      "Geometry: APPROVED",
      "UV Layout: PASS",
      "Texturing: IN_PROGRESS",
      "Animation: NOT_STARTED",
      "Current next step: paint seat",
      "Known blocker(s): none",
      "",
      "More notes.",
    ].join("\n");

    expect(workspaceSemanticFingerprint(base)).toBe(
      workspaceSemanticFingerprint(changedProse)
    );
  });

  test("changes when a lifecycle field changes", () => {
    const changed = base.replace(
      "Texturing: IN_PROGRESS",
      "Texturing: APPROVED"
    );
    expect(workspaceSemanticFingerprint(base)).not.toBe(
      workspaceSemanticFingerprint(changed)
    );
  });

  test("preserves bounded blocker recovery and fingerprints a changed hidden blocker", () => {
    const withBlockers = (last: string) => [
      "# Chair",
      "Current Stage: Geometry",
      "Known blocker(s): " +
        [...Array.from({ length: 8 }, (_, i) => `blocker ${i}`), last].join("; "),
    ].join("\n");
    const first = workspaceSemanticState(withBlockers("unverified wing pivot"));
    const updated = workspaceSemanticState(withBlockers("unverified cape contact"));
    expect(first.blockers).toHaveLength(8);
    expect(first.blockers_omitted_count).toBe(1);
    expect(first.blockers_omitted_sha256).toHaveLength(64);
    expect(first.blockers_omitted_sha256).not.toBe(updated.blockers_omitted_sha256);
    expect(workspaceSemanticFingerprint(withBlockers("unverified wing pivot")))
      .not.toBe(workspaceSemanticFingerprint(withBlockers("unverified cape contact")));
    const mixed = workspaceSemanticState(
      "# Chair\nKnown blocker(s): none; critical rig misalignment"
    );
    expect(mixed.blockers).toEqual(["critical rig misalignment"]);
  });

  test("inherited blocker labels are read instead of silently declaring no blockers", () => {
    const legacy = workspaceSemanticState([
      "# Crimson Guardian Turret",
      "Current Stage: TEXTURING",
      "Geometry: APPROVED",
      "UV Layout: PASS",
      "Known blockers: visual acceptance pending; in-game material/glow not verified",
    ].join("\n"));
    expect(legacy.blockers).toEqual([
      "visual acceptance pending", "in-game material/glow not verified",
    ]);
    expect(legacy.workspace_issues).toBeUndefined();
    const changed = workspaceSemanticFingerprint(
      "# Asset\nCurrent Stage: TEXTURING\nKnown blockers: visual acceptance pending"
    );
    expect(changed).not.toBe(workspaceSemanticFingerprint(
      "# Asset\nCurrent Stage: TEXTURING\nKnown blockers: none"
    ));
  });

  test("unstructured or malformed stage data stays visible as an orientation issue", () => {
    const missing = workspaceSemanticState(
      "# Crimson Sentinel — saved asset\nCurrent authority: crimson_sentinel.bbmodel"
    );
    expect(missing.current_stage).toBeNull();
    expect(missing.workspace_issues).toContain("WORKSPACE_CURRENT_STAGE_MISSING");
    const malformed = workspaceSemanticState(
      "# Voidtide Drake\nCurrent stage: GEOMETRY CORRECTION READY_FOR_USER_REVIEW."
    );
    expect(malformed.current_stage).toBe("GEOMETRY CORRECTION READY_FOR_USER_REVIEW.");
    expect(malformed.workspace_issues).toContain("WORKSPACE_CURRENT_STAGE_INVALID");
    // Descriptive "none for the delivered asset" is not silently promoted to
    // canonical "none"; it needs status clarification, not runtime rejection.
    const qualified = workspaceSemanticState(
      "# Lift\nCurrent Stage: COMPLETE\n" +
      "Known blocker(s): None for the delivered asset. Native reopen not verified; " +
      "system proof belongs in current-validation.md"
    );
    expect(qualified.workspace_issues).toContain("WORKSPACE_BLOCKER_STATUS_AMBIGUOUS");
    expect(qualified.blockers.length).toBeGreaterThan(0);
  });

  test("conflicting status declarations cannot hide a revoked gate or blocker", () => {
    const conflicting = workspaceSemanticState([
      "# Chair", "Current Stage: TEXTURING", "Current Stage: COMPLETE",
      "Geometry: APPROVED", "Geometry: INVALIDATED",
      "Known blocker(s): none", "Known blockers: pivot review required",
    ].join("\n"));
    expect(conflicting.workspace_issues).toEqual(expect.arrayContaining([
      "WORKSPACE_LIFECYCLE_FIELD_CONFLICT", "WORKSPACE_BLOCKER_FIELD_CONFLICT",
    ]));
    expect(conflicting.blockers).toContain("pivot review required");
    expect(conflicting.gates.geometry).toBe("APPROVED");
    // Even with the first apparently approved field, the conflict must be
    // available to readiness instead of being dropped by field() extraction.
  });

  test("same-size same-mtime README replacement invalidates cached approval gates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazydesigner-workspace-refresh-"));
    const readme = join(dir, "README.md");
    const replacement = join(dir, "replacement.md");
    const when = new Date("2024-01-01T00:00:00.000Z");
    const approved = "# Chair\nGeometry: APPROVED\nUV Layout: PASS\n";
    const revoked = "# Chair\nGeometry: REJECTED\nUV Layout: FAIL\n";
    const status = {
      affinity: { project_uuid: null },
      runtime: { health: null },
    } as unknown as GatewayRuntimeStatus;

    try {
      expect(Buffer.byteLength(approved)).toBe(Buffer.byteLength(revoked));
      await writeFile(readme, approved);
      await utimes(readme, when, when);
      const firstStat = await stat(readme);
      const first = await readWorkspaceProjection(status, dir);
      expect(first.gates.geometry).toBe("APPROVED");
      expect(first.gates.uv_layout).toBe("PASS");
      expect(await readWorkspaceProjection(status, dir)).toBe(first);

      await writeFile(replacement, revoked);
      await utimes(replacement, when, when);
      await rename(replacement, readme);
      const secondStat = await stat(readme);
      expect(secondStat.size).toBe(firstStat.size);
      expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
      expect(fileMetadataSignature(secondStat)).not.toBe(
        fileMetadataSignature(firstStat)
      );

      const second = await readWorkspaceProjection(status, dir);
      expect(second.gates.geometry).toBe("REJECTED");
      expect(second.gates.uv_layout).toBe("FAIL");
      expect(second.fingerprint).not.toBe(first.fingerprint);
      expect(await readWorkspaceProjection(status, dir)).toBe(second);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("Animation Required continuity preserves explicit YES, NO and UNSPECIFIED", () => {
    const yes = base + "\nAnimation Required: YES";
    const no = base + "\nAnimation Required: NO";
    const unknown = base + "\nAnimation Required: UNSPECIFIED";
    expect(workspaceSemanticState(yes).animation_required).toBe(true);
    expect(workspaceSemanticState(no).animation_required).toBe(false);
    expect(workspaceSemanticState(unknown).animation_required).toBeNull();
    expect(workspaceSemanticState(base).animation_required).toBeUndefined();
    expect(workspaceSemanticFingerprint(yes)).not.toBe(workspaceSemanticFingerprint(no));
    expect(workspaceSemanticFingerprint(no)).not.toBe(workspaceSemanticFingerprint(unknown));
  });

  test("conflicting or invalid Animation Required statements remain orientation issues", () => {
    const samples = [
      { declaration: "Animation Required: MAYBE", reason: "WORKSPACE_ANIMATION_REQUIREMENT_INVALID" },
      { declaration: "Animation Required: YES\nAnimation Required: NO", reason: "WORKSPACE_ANIMATION_REQUIREMENT_CONFLICT" },
      { declaration: "Animation Required: NO\nAnimation Required: LATER", reason: "WORKSPACE_ANIMATION_REQUIREMENT_INVALID" },
    ];
    for (const { declaration, reason } of samples) {
      const state = workspaceSemanticState(base + "\n" + declaration);
      expect(state.animation_required).toBeUndefined();
      expect(state.workspace_issues).toContain(reason);
    }
  });

  test("semantic state owns exactly the Control lifecycle fields", () => {
    expect(workspaceSemanticState(base)).toEqual({
      asset: "Chair",
      current_stage: "Texturing",
      gates: {
        geometry: "APPROVED",
        uv_layout: "PASS",
        texturing: "IN_PROGRESS",
        animation: "NOT_STARTED",
      },
      next_step: "paint seat",
      blockers: [],
    });
  });
});
