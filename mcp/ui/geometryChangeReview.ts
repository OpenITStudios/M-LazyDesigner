/// <reference types="blockbench-types" />
import { requireBedrockEditorProject } from "@/ui/authoringTools";

const MAX_UNDO_CUBES = 2500;
const MAX_VISIBLE_CUBES = 8;
const FIELDS = [
  "name", "from", "to", "origin", "rotation", "inflate",
  "box_uv", "uv_offset", "mirror_uv", "autouv",
  "visibility",
] as const;

type CubeField = (typeof FIELDS)[number] | "faces";
export type GeometryEditFieldDiff = {
  field: CubeField;
  before: string;
  after: string;
};
export type GeometryEditCubeDiff = {
  uuid: string;
  name: string;
  kind: "added" | "removed" | "modified";
  fields: GeometryEditFieldDiff[];
  canLocate: boolean;
};
export type GeometryEditReview = {
  heading: string;
  action: string;
  summary: string;
  historyIndex: number;
  /** Exact read signature for revalidation; never an approval or persistence token. */
  sourceSignature: string;
  cubes: GeometryEditCubeDiff[];
  affectedCount: number;
  truncated: boolean;
  note: string;
};

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : null;
}
function copyMap(value: unknown): RecordValue | null {
  const data = record(value);
  if (!data) return null;
  return data;
}
function finiteVector(value: unknown, size: number): value is number[] {
  return Array.isArray(value) && value.length === size &&
    value.every(part => typeof part === "number" && Number.isFinite(part));
}
function safeField(value: unknown, field: CubeField): string | null {
  if (field === "faces") {
    const faces = record(value);
    if (!faces) return null;
    const compact: Record<string, unknown> = {};
    for (const face of ["north", "south", "east", "west", "up", "down"]) {
      const entry = record(faces[face]);
      if (!entry) continue;
      compact[face] = {
        uv: finiteVector(entry.uv, 4) ? entry.uv : null,
        texture: typeof entry.texture === "string" ? entry.texture : null,
        enabled: typeof entry.enabled === "boolean" ? entry.enabled : null,
        rotation: typeof entry.rotation === "number" && Number.isFinite(entry.rotation)
          ? entry.rotation : null,
      };
    }
    return Object.keys(compact).length ? JSON.stringify(compact) : null;
  }
  if (field === "name") {
    return typeof value === "string" && value.length > 0 && value.length <= 160 ? value : null;
  }
  if (field === "from" || field === "to" || field === "origin" ||
      field === "rotation") {
    return finiteVector(value, 3) ? JSON.stringify(value) : null;
  }
  if (field === "uv_offset") {
    return finiteVector(value, 2) ? JSON.stringify(value) : null;
  }
  if (field === "inflate" || field === "autouv") {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
  }
  return typeof value === "boolean" ? String(value) : null;
}
function modifiedFields(before: RecordValue, after: RecordValue): GeometryEditFieldDiff[] {
  const diffs: GeometryEditFieldDiff[] = [];
  for (const field of [...FIELDS, "faces"] as CubeField[]) {
    const prior = safeField(before[field], field);
    const next = safeField(after[field], field);
    // A partial native Undo snapshot is not proof a field was changed.
    if (prior === null || next === null || prior === next) continue;
    diffs.push({
      field,
      before: prior,
      after: next,
    });
  }
  return diffs;
}
function captureCubes(entry: RecordValue): {
  changes: GeometryEditCubeDiff[];
  signature: string;
} {
  const before = copyMap(record(entry.before)?.elements);
  const after = copyMap(record(entry.post)?.elements);
  if (!before || !after) return { changes: [], signature: "no-element-snapshots" };
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  if (ids.length > MAX_UNDO_CUBES) {
    throw new Error("The latest edit has too many Cube snapshots for a bounded review.");
  }
  const changes: GeometryEditCubeDiff[] = [];
  const facts: unknown[] = [];
  for (const uuid of ids) {
    const original = record(before[uuid]);
    const modified = record(after[uuid]);
    if (!original && !modified) continue;
    const name =
      typeof modified?.name === "string" ? modified.name
      : typeof original?.name === "string" ? original.name : uuid;
    const kind: GeometryEditCubeDiff["kind"] =
      original && modified ? "modified" : original ? "removed" : "added";
    const fields = original && modified ? modifiedFields(original, modified) : [];
    if (kind === "modified" && fields.length === 0) continue;
    changes.push({ uuid, name, kind, fields, canLocate: kind !== "removed" });
    // Include all supported native source fields in the revalidation identity,
    // not only the 8 visible targets or human-readable shortened face detail.
    facts.push([
      uuid, kind, name,
      ...([...FIELDS, "faces"] as CubeField[]).map(field =>
        [field, safeField(original?.[field], field), safeField(modified?.[field], field)])
    ]);
  }
  return { changes, signature: JSON.stringify(facts) };
}

/** Read-only summary of one native applied edit, not a fabricated AI operation receipt. */
export function summarizeAppliedGeometryEdit(
  history: readonly unknown[],
  appliedIndex: number
): GeometryEditReview {
  if (!Array.isArray(history) || !Number.isInteger(appliedIndex) ||
      appliedIndex < 0 || appliedIndex > history.length) {
    throw new Error("Undo history state is unavailable or invalid.");
  }
  // Native selection entries are not geometry changes. Skip only selection,
  // never a later actual edit from a different authoring domain.
  let index = appliedIndex - 1;
  while (index >= 0 && record(history[index])?.type === "selection") index--;
  if (index < 0) {
    throw new Error("There is no applied model edit in Blockbench Undo history.");
  }
  const entry = record(history[index]);
  if (!entry || entry.type !== "edit" || typeof entry.action !== "string") {
    throw new Error("The latest applied Undo entry is not an inspectable model edit.");
  }
  const raw = captureCubes(entry);
  const cubeCount = raw.changes.length;
  const signature = JSON.stringify([index, entry.action, entry.time ?? null, raw.signature]);
  return {
    heading: "Latest Geometry Edit",
    action: entry.action,
    summary: cubeCount
      ? `${cubeCount} Cube(s) changed in the latest native Undo edit.`
      : "The latest edit has no inspectable Cube changes. It may affect another domain.",
    historyIndex: index,
    sourceSignature: signature,
    cubes: raw.changes.slice(0, MAX_VISIBLE_CUBES),
    affectedCount: cubeCount,
    truncated: cubeCount > MAX_VISIBLE_CUBES,
    note: "Native Undo evidence only. It does not identify AI versus manual origin, prove visual fidelity, or authorize a correction.",
  };
}

export function reviewCurrentGeometryEdit(): GeometryEditReview {
  requireBedrockEditorProject();
  if (typeof Undo === "undefined" || !Array.isArray(Undo.history) ||
      Undo.current_save) {
    throw new Error("Finish any active Blockbench edit before reviewing the Undo history.");
  }
  return summarizeAppliedGeometryEdit(Undo.history, Undo.index);
}

export function requireCurrentGeometryEditReview(review: GeometryEditReview): void {
  const current = reviewCurrentGeometryEdit();
  if (current.sourceSignature !== review.sourceSignature ||
      current.historyIndex !== review.historyIndex) {
    throw new Error("The native edit history changed. Review the latest edit again.");
  }
}
