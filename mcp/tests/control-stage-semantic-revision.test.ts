import { describe, expect, test } from "bun:test";
import { emptyReference } from "../gateway/control/referenceParser";
import {
  buildControlStageContext,
  stageReferenceSemanticFingerprint,
} from "../gateway/control/contextProjection";
import { taskContextId } from "../gateway/control/packetContext";
import type { ControlSnapshot } from "../gateway/control/types";
import {
  CAPABILITY_SEMANTIC_CATALOG_REVISIONS,
  semanticFingerprint,
} from "../gateway/capabilities/semanticRegistry";
import { semanticRevisionForDependencies } from "../gateway/development/semanticDependencies";
import { semanticDependenciesForSurface } from "../gateway/development/semanticDependencyMatrix";

const reference = {
  ...emptyReference("REFERENCE_PATH_UNAVAILABLE"),
  version: 1,
  fingerprint: "ref",
  intent: "test",
  selected_profile: null,
  requirements: {},
  images: [],
  documents: {},
  readiness: {
    overall: "READY",
    geometry: "READY",
    texture: "READY",
    animation: "READY",
  },
  blocking_unknowns: [],
  non_blocking_unknowns: [],
} as any;

const workspace = {
  available: false,
  source_path: null,
  blockers: [],
  fingerprint: "workspace",
  asset: null,
  current_stage: null,
  gates: {},
  next_step: null,
} as any;

const scopedSemanticRevision = semanticRevisionForDependencies(
  semanticDependenciesForSurface("AI_STAGE_CONTEXT")
);

describe("control stage semantic revision", () => {
  test("AI stage context carries the canonical semantic revision", () => {
    const context = buildControlStageContext({
      domain: "GEOMETRY",
      currentUserDelta: null,
      reference,
      workspace,
    });

    expect(context.semantic.artifact_kind).toBe("AI_STAGE_CONTEXT");
    expect(context.semantic.revisions).toEqual(
      CAPABILITY_SEMANTIC_CATALOG_REVISIONS
    );
  });

  test("Stage Context hash includes routing and graph revision, not just source bytes", () => {
    const context = buildControlStageContext({
      domain: "GEOMETRY",
      currentUserDelta: null,
      reference,
      workspace,
    });
    const payload = {
      type: context.context_type,
      delta: null,
      stage_reference: stageReferenceSemanticFingerprint("GEOMETRY", reference),
      workspace: workspace.fingerprint,
    };
    const withoutSemantics = semanticFingerprint(payload);
    const current = semanticFingerprint({
      ...payload,
      semantic_revision: scopedSemanticRevision,
    });

    expect(context.context_hash).toBe(current);
    expect(context.context_hash).not.toBe(withoutSemantics);
    expect(semanticDependenciesForSurface("AI_STAGE_CONTEXT")).toEqual([
      "routing", "graph",
    ]);
  });

  test("asset task cohort carries exactly the Stage Context semantic dependency", () => {
    const snapshot = {
      project: { affinity_uuid: "same-project" },
      authoring: { phase: "geometry", domain: "GEOMETRY" },
      runtime: { runtime_signature: "same-runtime", build_identity: "same-build" },
    } as ControlSnapshot;
    const taskId = taskContextId(
      snapshot, workspace, reference, "ASSET_AUTHORING", null, null
    );
    const base = {
      mode: "ASSET_AUTHORING",
      project_affinity: "same-project",
      authoring_phase: "geometry",
      runtime: "same-runtime",
      workspace: workspace.fingerprint,
      reference: stageReferenceSemanticFingerprint("GEOMETRY", reference),
      user_delta: "no-user-delta",
    };
    const expected = semanticFingerprint({
      ...base,
      semantic_revision: scopedSemanticRevision,
    });

    expect(taskId).toBe(`task:${expected.slice(0, 20)}`);
    expect(taskId).not.toBe(`task:${semanticFingerprint(base).slice(0, 20)}`);
  });
});
