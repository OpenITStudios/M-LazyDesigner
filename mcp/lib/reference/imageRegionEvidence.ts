import type { ModelView } from "./visualEvidence";

/** A human/AI-proposed region claim, not a detected mask or validated 3D part. */
export type ReferenceImageRegion = {
  id: string;
  part_id: string;
  evidence_role: "PRIMARY_VOLUME" | "SURFACE_DETAIL" | "CONTACT" | "NEGATIVE_SPACE";
  visibility: "DIRECT" | "PARTIAL" | "OCCLUDED";
  /** Normalized [left, top, right, bottom]; null when entirely occluded. */
  box_uv: [number, number, number, number] | null;
  related_part_id: string | null;
};

const MAX_REGIONS = 16;
const MAX_ID_LENGTH = 96;
const ROLES = new Set(["PRIMARY_VOLUME", "SURFACE_DETAIL", "CONTACT", "NEGATIVE_SPACE"]);
const VISIBILITY = new Set(["DIRECT", "PARTIAL", "OCCLUDED"]);

function identifier(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() ||
      value.trim().length > MAX_ID_LENGTH) return null;
  return value.trim();
}

function normalizedBox(value: unknown): ReferenceImageRegion["box_uv"] | undefined {
  if (!Array.isArray(value) || value.length !== 4 ||
      value.some((x) => typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1) ||
      value[2] <= value[0] || value[3] <= value[1]) return undefined;
  return [value[0], value[1], value[2], value[3]];
}

/**
 * Source-side annotations only; no pixels are scanned, no masks are inferred.
 * A fully occluded part cannot be assigned a made-up bounding box.
 */
export function parseReferenceImageRegions(input: unknown): ReferenceImageRegion[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_REGIONS) return null;
  const ids = new Set<string>();
  const output: ReferenceImageRegion[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).some((key) =>
      !["id", "part_id", "evidence_role", "visibility", "box_uv", "related_part_id"].includes(key)
    )) return null;
    const id = identifier(row.id), part = identifier(row.part_id);
    const related = row.related_part_id == null ? null : identifier(row.related_part_id);
    if (!id || !part || ids.has(id) || (row.related_part_id != null && !related) ||
        related === part || !ROLES.has(String(row.evidence_role)) ||
        !VISIBILITY.has(String(row.visibility))) return null;
    const visibility = row.visibility as ReferenceImageRegion["visibility"];
    const box = row.box_uv == null ? null : normalizedBox(row.box_uv);
    if (visibility === "OCCLUDED" ? box !== null : box === null || box === undefined) {
      return null;
    }
    // A related part is meaningful only for attachment/contact/openings.
    if (related && row.evidence_role !== "CONTACT" && row.evidence_role !== "NEGATIVE_SPACE") {
      return null;
    }
    ids.add(id);
    output.push({
      id, part_id: part,
      evidence_role: row.evidence_role as ReferenceImageRegion["evidence_role"],
      visibility,
      box_uv: box ?? null,
      related_part_id: related,
    });
  }
  return output;
}

export type ReferenceRegionImage = {
  id: string;
  /** When supplied by an actual package, only APPROVED authorizes coverage. */
  status?: string | null;
  view?: ModelView | null;
  sha256?: string | null;
  regions?: readonly ReferenceImageRegion[];
};

export type ReferencePartRole = { id: string; role: string | null };

export type ReferencePartGrounding = {
  part_id: string;
  /** Multiple boxes from one view still count as one independently observed view. */
  directly_visible_views: ModelView[];
  partially_visible_views: ModelView[];
  occluded_views: ModelView[];
  geometry_region_ids: string[];
  texture_region_ids: string[];
  /** Source annotation is evidence, not permission to create unseen shapes. */
  hidden_shape_status: "UNVERIFIED";
};

/**
 * Read-only semantic-part index for multimodal review. Based solely on
 * explicitly authored annotation. No automatic mask, classification, depth,
 * absence, or camera-calibration claim.
 */
export function summarizeReferencePartRegions(
  images: readonly ReferenceRegionImage[],
  declaredParts: readonly ReferencePartRole[] = []
): {
  state: "ANNOTATED" | "NO_ANNOTATIONS";
  visual_verdict: "NOT_EVALUATED";
  part_count: number;
  region_count: number;
  ownership_issues: Array<{
    part_id: string;
    image_region_id: string;
    reason: "DECLARED_TEXTURE_BUT_VISIBLE_VOLUME" | "DECLARED_OMIT_BUT_VISIBLE" | "OWNER_UNRESOLVED";
  }>;
  parts: ReferencePartGrounding[];
} {
  const parts = new Map<string, ReferencePartGrounding>();
  const roleById = new Map(declaredParts.map((row) => [row.id, row.role?.toUpperCase() ?? null]));
  const ownershipIssues: Array<{
    part_id: string;
    image_region_id: string;
    reason: "DECLARED_TEXTURE_BUT_VISIBLE_VOLUME" | "DECLARED_OMIT_BUT_VISIBLE" | "OWNER_UNRESOLVED";
  }> = [];
  let regionCount = 0;
  for (const image of images) {
    // Legacy metadata-only callers may omit status; a supplied DRAFT/null is
    // never approved coverage. Approval still does not prove pixel similarity.
    if (!image.view || !image.sha256 ||
        (image.status !== undefined && image.status !== "APPROVED")) continue;
    for (const region of image.regions ?? []) {
      regionCount++;
      let row = parts.get(region.part_id);
      if (!row) {
        row = {
          part_id: region.part_id, directly_visible_views: [],
          partially_visible_views: [], occluded_views: [],
          geometry_region_ids: [], texture_region_ids: [],
          hidden_shape_status: "UNVERIFIED",
        };
        parts.set(region.part_id, row);
      }
      const views = region.visibility === "DIRECT"
        ? row.directly_visible_views
        : region.visibility === "PARTIAL" ? row.partially_visible_views : row.occluded_views;
      if (!views.includes(image.view)) views.push(image.view);
      if (region.visibility === "OCCLUDED") continue;
      const evidenceId = image.id + ":" + region.id;
      const owner = roleById.get(region.part_id);
      if (owner === "TEXTURE" && region.evidence_role === "PRIMARY_VOLUME") {
        ownershipIssues.push({
          part_id: region.part_id, image_region_id: evidenceId,
          reason: "DECLARED_TEXTURE_BUT_VISIBLE_VOLUME",
        });
      } else if (owner === "OMIT") {
        ownershipIssues.push({
          part_id: region.part_id, image_region_id: evidenceId,
          reason: "DECLARED_OMIT_BUT_VISIBLE",
        });
      } else if (owner === "UNRESOLVED") {
        ownershipIssues.push({
          part_id: region.part_id, image_region_id: evidenceId,
          reason: "OWNER_UNRESOLVED",
        });
      }
      if (region.evidence_role === "SURFACE_DETAIL") row.texture_region_ids.push(evidenceId);
      else row.geometry_region_ids.push(evidenceId);
    }
  }
  const sorted = [...parts.values()].sort((a, b) => a.part_id.localeCompare(b.part_id));
  return {
    state: regionCount ? "ANNOTATED" : "NO_ANNOTATIONS",
    visual_verdict: "NOT_EVALUATED",
    part_count: sorted.length,
    region_count: regionCount,
    ownership_issues: ownershipIssues,
    parts: sorted,
  };
}
