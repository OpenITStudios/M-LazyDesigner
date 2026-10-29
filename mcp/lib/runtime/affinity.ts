export const LAZYDESIGNER_PROJECT_AFFINITY_HEADER = "x-lazydesigner-project-uuid";
export const LAZYDESIGNER_AUTHORING_STAGE_AFFINITY_HEADER = "x-lazydesigner-authoring-stage";
/** @deprecated Source-only alias. Emits the canonical LazyDesigner header. */
export const BLOCKIT_PROJECT_AFFINITY_HEADER = LAZYDESIGNER_PROJECT_AFFINITY_HEADER;
/** @deprecated Source-only alias. Emits the canonical LazyDesigner header. */
export const BLOCKIT_AUTHORING_PHASE_AFFINITY_HEADER = LAZYDESIGNER_AUTHORING_STAGE_AFFINITY_HEADER;

export const BLOCKIT_AUTHORING_PHASES = [
  "geometry",
  "texturing",
  "animation",
] as const;

export type BlockitAuthoringPhaseAffinity =
  (typeof BLOCKIT_AUTHORING_PHASES)[number];

export type RuntimeProjectHealth = {
  active_project_uuid: string | null;
  requested_project_uuid: string | null;
  /** true = unique tab, false = absent UUID, null = unbound or ambiguous. */
  requested_project_available: boolean | null;
  open_project_count: number;
  /** Current bound tab's saved native project identity; not acceptance proof. */
  requested_project?: {
    uuid: string;
    save_path: string | null;
    saved: boolean | null;
  };
};

export function normalizeProjectAffinityUuid(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("LazyDesigner project affinity must be a string project UUID.");
  }

  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("LazyDesigner project affinity contains an invalid project UUID.");
  }
  return normalized;
}

export function normalizeAuthoringPhaseAffinity(
  value: unknown
): BlockitAuthoringPhaseAffinity | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !BLOCKIT_AUTHORING_PHASES.includes(value as BlockitAuthoringPhaseAffinity)
  ) {
    throw new Error(
      "LazyDesigner authoring phase affinity must be geometry, texturing, or animation."
    );
  }
  return value as BlockitAuthoringPhaseAffinity;
}

export function readRuntimeProjectHealth(value: unknown): RuntimeProjectHealth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = (value as { project_context?: unknown }).project_context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;

  const record = context as Record<string, unknown>;
  const active =
    typeof record.active_project_uuid === "string"
      ? record.active_project_uuid
      : record.active_project_uuid === null
        ? null
        : undefined;
  const requested =
    typeof record.requested_project_uuid === "string"
      ? record.requested_project_uuid
      : record.requested_project_uuid === null
        ? null
        : undefined;
  const available =
    typeof record.requested_project_available === "boolean"
      ? record.requested_project_available
      : record.requested_project_available === null
        ? null
        : undefined;
  const openCount = record.open_project_count;

  if (
    active === undefined ||
    requested === undefined ||
    available === undefined ||
    typeof openCount !== "number" ||
    !Number.isInteger(openCount) ||
    openCount < 0
  ) {
    return null;
  }

  return {
    active_project_uuid: active,
    requested_project_uuid: requested,
    requested_project_available: available,
    open_project_count: openCount,
    ...(record.requested_project !== undefined &&
       record.requested_project !== null &&
       typeof record.requested_project === "object" &&
       !Array.isArray(record.requested_project) &&
       typeof (record.requested_project as Record<string, unknown>).uuid === "string"
      ? { requested_project: {
          uuid: (record.requested_project as { uuid: string }).uuid,
          save_path: typeof (record.requested_project as { save_path?: unknown }).save_path === "string"
            ? (record.requested_project as { save_path: string }).save_path : null,
          saved: typeof (record.requested_project as { saved?: unknown }).saved === "boolean"
            ? (record.requested_project as { saved: boolean }).saved : null,
        } }
      : {}),
  };
}

export function readRuntimeAuthoringPhase(
  value: unknown
): BlockitAuthoringPhaseAffinity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const product = (value as { product?: unknown }).product;
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;

  const phase = (product as { authoring_phase?: unknown }).authoring_phase;
  try {
    return normalizeAuthoringPhaseAffinity(phase);
  } catch {
    return null;
  }
}
