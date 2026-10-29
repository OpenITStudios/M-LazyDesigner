import { createHash } from "node:crypto";
import { canonicalJson } from "../../lib/semantic/canonical";
import { dirname, join } from "node:path";
import { isAbsoluteFilesystemPath } from "../../lib/core/path";
import { lstat, readFile, stat } from "node:fs/promises";
import { fileMetadataSignature } from "./fileSignature";
import type { GatewayRuntimeStatus } from "../runtime/backend";

export type FinalizationNativeRevisionEvidence = {
  state: "MATCHED" | "STALE" | "UNVERIFIED";
  reason: string;
  accepted_sha256: string | null;
  observed_sha256: string | null;
};

/** A stored accepted checkpoint is compared only at Finalization/Complete. */
const FINALIZATION_CHECKPOINT_SHA256 = /^sha256:[0-9a-f]{64}$/;
const FINALIZATION_NATIVE_MAX_BYTES = 64 * 1024 * 1024;

export type ControlWorkspaceProjection = {
  available: boolean;
  source_path: string | null;
  fingerprint: string | null;
  asset: string | null;
  current_stage: string | null;
  gates: {
    geometry: string | null;
    uv_layout: string | null;
    texturing: string | null;
    animation: string | null;
  };
  next_step: string | null;
  blockers: string[];
  /** Optional README continuity declaration, compared against Reference authority. */
  animation_required?: boolean | null;
  /** Explicit approval checkpoint hash; not a substitute for approval. */
  finalization_checkpoint_sha256?: string;
  /** Dynamic current saved-file check, never cached as README semantics. */
  finalization_native_revision?: FinalizationNativeRevisionEvidence;
  /** Format/identity ambiguity is orientation-only, not implicit approval. */
  workspace_issues?: string[];
  /** Bounded display omitted additional blocker entries; read the current README. */
  blockers_omitted_count?: number;
  blockers_omitted_sha256?: string;
  unavailable_reason?: "PROJECT_PATH_UNAVAILABLE" | "README_NOT_FOUND" | "README_UNREADABLE";
};

type CachedWorkspace = {
  signature: string;
  projection: ControlWorkspaceProjection;
};

const MAX_WORKSPACE_README_BYTES = 1024 * 1024;
const cache = new Map<string, CachedWorkspace>();
const workspaceHintByProject = new Map<string, string>();

function fieldValues(text: string, label: string): string[] {
  // Restrict to literal README field labels. Preserve every declaration so a
  // conflicting second approval cannot disappear behind the first match.
  const escaped = label.replace(/[^a-z0-9 ]/gi, (character) => "\\" + character);
  const pattern = new RegExp("^" + escaped + ":\\s*(.+)$", "gim");
  return [...text.matchAll(pattern)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function field(text: string, label: string): string | null {
  return fieldValues(text, label)[0] ?? null;
}

function parseBlockers(text: string): { blockers: string[]; issues: string[] } {
  // Inherited asset READMEs use both labels. New READMEs still use the
  // canonical "Known blocker(s)" label required by workspace/README.md.
  const raw = ["Known blocker(s)", "Known blockers"]
    .flatMap((label) => fieldValues(text, label));
  const distinct = [...new Set(raw.map((value) => value.trim()))];
  const issues: string[] = [];
  if (distinct.length > 1) {
    issues.push("WORKSPACE_BLOCKER_FIELD_CONFLICT");
  }
  const blockers: string[] = [];
  for (const value of distinct) {
    for (const candidate of value.split(/[;,]/)) {
      const entry = candidate.trim();
      if (!entry || /^none$/i.test(entry)) continue;
      // "none for ...; ..." is ambiguous prose, not a trustworthy empty
      // blocker ledger. Retain the text for review instead of guessing.
      if (/^none\b/i.test(entry)) {
        issues.push("WORKSPACE_BLOCKER_STATUS_AMBIGUOUS");
      }
      blockers.push(entry);
    }
  }
  return { blockers: [...new Set(blockers)], issues };
}

const WORKSPACE_STAGES = new Set([
  "INTAKE", "GEOMETRY", "TEXTURING", "ANIMATION", "FINALIZATION", "COMPLETE",
]);

export type WorkspaceSemanticState = {
  asset: string | null;
  current_stage: string | null;
  gates: ControlWorkspaceProjection["gates"];
  next_step: string | null;
  blockers: string[];
  animation_required?: boolean | null;
  finalization_checkpoint_sha256?: string;
  workspace_issues?: string[];
  blockers_omitted_count?: number;
  blockers_omitted_sha256?: string;
};

export function workspaceSemanticState(text: string): WorkspaceSemanticState {
  const parsed = parseBlockers(text);
  const allBlockers = parsed.blockers;
  const omitted = allBlockers.slice(8);
  const currentStage = field(text, "Current Stage");
  const issues = [...parsed.issues];
  if (!currentStage) {
    issues.push("WORKSPACE_CURRENT_STAGE_MISSING");
  } else if (!WORKSPACE_STAGES.has(currentStage.toUpperCase())) {
    issues.push("WORKSPACE_CURRENT_STAGE_INVALID");
  }
  const animationDeclarations = fieldValues(text, "Animation Required")
    .map((value) => value.toUpperCase());
  let animationRequired: boolean | null | undefined;
  if (animationDeclarations.length > 0) {
    if (animationDeclarations.some(
      (value) => !["YES", "NO", "UNSPECIFIED"].includes(value)
    )) {
      issues.push("WORKSPACE_ANIMATION_REQUIREMENT_INVALID");
    } else if (new Set(animationDeclarations).size > 1) {
      issues.push("WORKSPACE_ANIMATION_REQUIREMENT_CONFLICT");
    } else {
      animationRequired = animationDeclarations[0] === "YES"
        ? true : animationDeclarations[0] === "NO" ? false : null;
    }
  }
  const checkpointDeclarations = fieldValues(text, "Finalization Checkpoint SHA256");
  let acceptedCheckpoint: string | undefined;
  if (checkpointDeclarations.length > 0) {
    if (checkpointDeclarations.length !== 1) {
      issues.push("WORKSPACE_FINALIZATION_CHECKPOINT_CONFLICT");
    } else if (!FINALIZATION_CHECKPOINT_SHA256.test(checkpointDeclarations[0])) {
      issues.push("WORKSPACE_FINALIZATION_CHECKPOINT_INVALID");
    } else {
      acceptedCheckpoint = checkpointDeclarations[0];
    }
  }
  // An existing APPROVED/PASS line must not mask a conflicting second line.
  for (const label of ["Current Stage", "Geometry", "UV Layout", "Texturing", "Animation"]) {
    const values = fieldValues(text, label).map((value) => value.toUpperCase());
    if (new Set(values).size > 1) {
      issues.push("WORKSPACE_LIFECYCLE_FIELD_CONFLICT");
    }
  }
  return {
    asset: text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null,
    current_stage: currentStage,
    gates: {
      geometry: field(text, "Geometry"),
      uv_layout: field(text, "UV Layout"),
      texturing: field(text, "Texturing"),
      animation: field(text, "Animation"),
    },
    next_step: field(text, "Current next step"),
    ...(animationRequired !== undefined
      ? { animation_required: animationRequired }
      : {}),
    ...(acceptedCheckpoint
      ? { finalization_checkpoint_sha256: acceptedCheckpoint }
      : {}),
    blockers: allBlockers.slice(0, 8),
    ...(issues.length > 0 ? { workspace_issues: [...new Set(issues)].sort() } : {}),
    ...(omitted.length > 0 ? {
      blockers_omitted_count: omitted.length,
      blockers_omitted_sha256: createHash("sha256")
        .update(canonicalJson(omitted)).digest("hex"),
    } : {}),
  };
}

export function workspaceSemanticFingerprint(text: string): string {
  return createHash("sha256")
    .update(canonicalJson(workspaceSemanticState(text)))
    .digest("hex");
}

function projectSavePath(status: GatewayRuntimeStatus): string | null {
  const health = status.runtime.health as Record<string, unknown> | null;
  const context = health?.project_context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const record = context as Record<string, unknown>;
  for (const key of ["requested_project", "active_project"]) {
    const descriptor = record[key];
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) continue;
    const savePath = (descriptor as Record<string, unknown>).save_path;
    if (typeof savePath === "string" && savePath.length > 0) return savePath;
  }
  return null;
}

function resolveWorkspaceReadme(
  status: GatewayRuntimeStatus,
  workspacePath?: string | null
): string | null {
  const projectUuid = status.affinity.project_uuid;
  if (workspacePath && projectUuid) workspaceHintByProject.set(projectUuid, workspacePath);
  const hint = workspacePath ?? (projectUuid ? workspaceHintByProject.get(projectUuid) : undefined);
  if (hint) return /README\.md$/i.test(hint) ? hint : join(hint, "README.md");
  const savePath = projectSavePath(status);
  return savePath ? join(dirname(savePath), "README.md") : null;
}

/**
 * Native checkpoint proof is FINALIZATION-only and derived from the already
 * bound project. It is never a general authoring read, another state store,
 * or a user-approval assertion. A missing/malformed file fails closed.
 */
async function withFinalizationNativeRevision(
  status: GatewayRuntimeStatus,
  projection: ControlWorkspaceProjection
): Promise<ControlWorkspaceProjection> {
  const stage = projection.current_stage?.trim().toUpperCase();
  if (!projection.available ||
      (stage !== "FINALIZATION" && stage !== "COMPLETE")) return projection;

  const accepted = projection.finalization_checkpoint_sha256 ?? null;
  const failed = (state: FinalizationNativeRevisionEvidence["state"], reason: string,
    observed: string | null = null): ControlWorkspaceProjection => {
    const evidence: FinalizationNativeRevisionEvidence = {
      state, reason, accepted_sha256: accepted, observed_sha256: observed,
    };
    return {
      ...projection,
      finalization_native_revision: evidence,
      fingerprint: createHash("sha256")
        .update(canonicalJson({
          workspace: projection.fingerprint,
          finalization_native_revision: evidence,
        }))
        .digest("hex"),
    };
  };

  const health = status.runtime.health as Record<string, unknown> | null;
  const context = health?.project_context;
  const source = context && typeof context === "object" &&
    !Array.isArray(context) ? context as Record<string, unknown> : null;
  const requested = source?.requested_project;
  const target = requested && typeof requested === "object" &&
    !Array.isArray(requested) ? requested as Record<string, unknown> : null;
  if (!status.runtime.online || !status.runtime.mcp_client_ready ||
      !status.affinity.project_uuid ||
      source?.requested_project_uuid !== status.affinity.project_uuid ||
      source?.requested_project_available !== true ||
      target?.uuid !== status.affinity.project_uuid) {
    return failed("UNVERIFIED", "FINALIZATION_PROJECT_BINDING_UNVERIFIED");
  }
  if (target.saved === false) return failed("STALE", "FINALIZATION_NATIVE_PROJECT_UNSAVED");
  if (target.saved !== true) return failed("UNVERIFIED", "FINALIZATION_NATIVE_SAVED_STATE_UNKNOWN");
  const nativePath = target.save_path;
  if (typeof nativePath !== "string" ||
      !isAbsoluteFilesystemPath(nativePath) ||
      !/\.bbmodel$/i.test(nativePath)) {
    return failed("UNVERIFIED", "FINALIZATION_NATIVE_CHECKPOINT_PATH_UNAVAILABLE");
  }
  // Workspace identity is the approval source. Do not hash a different
  // native model elsewhere merely because a bound tab supplied its path.
  // Native project and active asset README must share the current asset folder.
  if (!projection.source_path ||
      dirname(nativePath).replace(/\\/g, "/").toLowerCase() !==
      dirname(projection.source_path).replace(/\\/g, "/").toLowerCase()) {
    return failed("UNVERIFIED", "FINALIZATION_NATIVE_CHECKPOINT_WORKSPACE_MISMATCH");
  }
  try {
    const first = await lstat(nativePath);
    if (!first.isFile() || first.isSymbolicLink() ||
        first.size <= 0 || first.size > FINALIZATION_NATIVE_MAX_BYTES) {
      return failed("UNVERIFIED", "FINALIZATION_NATIVE_CHECKPOINT_FILE_UNSUPPORTED");
    }
    const bytes = await readFile(nativePath);
    const last = await lstat(nativePath);
    if (!last.isFile() || last.isSymbolicLink() ||
        bytes.byteLength !== first.size ||
        fileMetadataSignature(first) !== fileMetadataSignature(last)) {
      return failed("UNVERIFIED", "FINALIZATION_NATIVE_CHECKPOINT_CHANGED_DURING_READ");
    }
    const observed = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    if (!accepted) return failed("UNVERIFIED", "FINALIZATION_ACCEPTED_CHECKPOINT_MISSING", observed);
    return accepted === observed
      ? failed("MATCHED", "FINALIZATION_NATIVE_CHECKPOINT_MATCHED", observed)
      : failed("STALE", "FINALIZATION_NATIVE_CHECKPOINT_MISMATCH", observed);
  } catch {
    return failed("UNVERIFIED", "FINALIZATION_NATIVE_CHECKPOINT_READ_UNAVAILABLE");
  }
}

export async function readWorkspaceProjection(
  status: GatewayRuntimeStatus,
  workspacePath?: string | null
): Promise<ControlWorkspaceProjection> {
  const readmePath = resolveWorkspaceReadme(status, workspacePath);
  if (!readmePath) {
    return {
      available: false,
      source_path: null,
      fingerprint: null,
      asset: null,
      current_stage: null,
      gates: { geometry: null, uv_layout: null, texturing: null, animation: null },
      next_step: null,
      blockers: [],
      unavailable_reason: "PROJECT_PATH_UNAVAILABLE",
    };
  }

  try {
    const info = await stat(readmePath);
    if (!info.isFile() || info.size > MAX_WORKSPACE_README_BYTES) {
      return {
        available: false,
        source_path: readmePath,
        fingerprint: null,
        asset: null,
        current_stage: null,
        gates: { geometry: null, uv_layout: null, texturing: null, animation: null },
        next_step: null,
        blockers: [],
        unavailable_reason: "README_UNREADABLE",
      };
    }
    const signature = fileMetadataSignature(info);
    const cached = cache.get(readmePath);
    if (cached?.signature === signature)
      return withFinalizationNativeRevision(status, cached.projection);

    const text = await readFile(readmePath, "utf8");
    const semantic = workspaceSemanticState(text);
    const projection: ControlWorkspaceProjection = {
      available: true,
      source_path: readmePath,
      fingerprint: workspaceSemanticFingerprint(text),
      ...semantic,
    };
    cache.set(readmePath, { signature, projection });
    return withFinalizationNativeRevision(status, projection);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return {
      available: false,
      source_path: readmePath,
      fingerprint: null,
      asset: null,
      current_stage: null,
      gates: { geometry: null, uv_layout: null, texturing: null, animation: null },
      next_step: null,
      blockers: [],
      unavailable_reason: code === "ENOENT" ? "README_NOT_FOUND" : "README_UNREADABLE",
    };
  }
}
