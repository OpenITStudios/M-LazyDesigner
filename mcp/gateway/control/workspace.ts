import { createHash } from "node:crypto";
import { canonicalJson } from "../../lib/semantic/canonical";
import { dirname, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileMetadataSignature } from "./fileSignature";
import type { GatewayRuntimeStatus } from "../runtime/backend";

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
    if (cached?.signature === signature) return cached.projection;

    const text = await readFile(readmePath, "utf8");
    const semantic = workspaceSemanticState(text);
    const projection: ControlWorkspaceProjection = {
      available: true,
      source_path: readmePath,
      fingerprint: workspaceSemanticFingerprint(text),
      ...semantic,
    };
    cache.set(readmePath, { signature, projection });
    return projection;
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
