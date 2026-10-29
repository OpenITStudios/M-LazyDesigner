import { createHash } from "node:crypto";
import { MODEL_VIEWS, type ModelView } from "../../lib/reference/visualEvidence";
import { parseReferenceImageLandmarks } from "../../lib/reference/landmarkEvidence";
import { parseReferenceImageRegions } from "../../lib/reference/imageRegionEvidence";
import type { ReferencePartObservation, WorldAxis } from "../../lib/reference/crossViewEvidence";
import { canonicalJson } from "../../lib/semantic/canonical";
import type {
  ControlProfile,
  ControlReferenceAssetKind,
  ControlReferenceProjection,
  ControlReferenceStage,
  ControlReferenceStructuredFact,
} from "./referenceTypes";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringList(value: unknown, limit = 16): string[] {
  return Array.isArray(value)
    ? value
        .filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.trim().length > 0
        )
        .map((entry) => entry.trim())
        .slice(0, limit)
    : [];
}

function structuredFactList(
  value: unknown,
  entryLimit = 24,
  fieldLimit = 16
): ControlReferenceStructuredFact[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, entryLimit).flatMap((entry) => {
    const source = record(entry);
    if (!source) return [];

    const fact: ControlReferenceStructuredFact = {};
    for (const [key, rawValue] of Object.entries(source).slice(0, fieldLimit)) {
      const text = stringValue(rawValue);
      if (text !== null) {
        fact[key] = text;
        continue;
      }
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        fact[key] = rawValue;
        continue;
      }
      if (typeof rawValue === "boolean") {
        fact[key] = rawValue;
        continue;
      }
      const list = stringList(rawValue, 12);
      if (list.length > 0) fact[key] = list;
    }

    return Object.keys(fact).length > 0 ? [fact] : [];
  });
}

/** Strict optional per-image world facts; reject omissions that could manufacture agreement. */
function parseImagePartWorldConstraints(
  value: unknown,
  declaredParts: ReadonlySet<string>,
  view: ModelView | null,
  usedBy: readonly ControlReferenceStage[]
): Array<Omit<ReferencePartObservation, "view">> | null {
  if (value === undefined) return [];
  if (!view || !usedBy.includes("GEOMETRY") || !Array.isArray(value) ||
      value.length < 1 || value.length > 16) return null;
  const seen = new Set<string>();
  const parsed: Array<Omit<ReferencePartObservation, "view">> = [];
  for (const item of value) {
    const source = record(item);
    const partId = stringValue(source?.part_id);
    if (!source || !partId || !declaredParts.has(partId) || seen.has(partId) ||
        Object.keys(source).some(key => ![
          "part_id", "dimensions", "attachment_parent", "required"
        ].includes(key)) ||
        (source.required !== undefined && typeof source.required !== "boolean") ||
        (source.attachment_parent !== undefined &&
          source.attachment_parent !== null &&
          (typeof source.attachment_parent !== "string" ||
            stringValue(source.attachment_parent) === null))) return null;
    const dimensions = source.dimensions === undefined
      ? null : record(source.dimensions);
    if (source.dimensions !== undefined &&
        (!dimensions || Object.keys(dimensions).length === 0 ||
          Object.entries(dimensions).some(([axis, number]) =>
            !["x", "y", "z"].includes(axis) ||
            typeof number !== "number" || !Number.isFinite(number) || number < 0
          ))) return null;
    if (!dimensions && source.attachment_parent === undefined) return null;
    seen.add(partId);
    parsed.push({
      part_id: partId,
      ...(dimensions
        ? { dimensions: dimensions as Partial<Record<WorldAxis, number>> }
        : {}),
      ...(source.attachment_parent !== undefined
        ? { attachment_parent: source.attachment_parent === null
          ? null : stringValue(source.attachment_parent)! }
        : {}),
      ...(source.required !== undefined
        ? { required: source.required as boolean }
        : {}),
    });
  }
  return parsed;
}

function profileValue(value: unknown): ControlProfile | null {
  const candidate = stringValue(value);
  return candidate &&
    [
      "PROP_FURNITURE",
      "VEHICLE",
      "HUMANOID",
      "CREATURE",
      "MECHANICAL",
      "PLANT_FOLIAGE",
      "GENERIC",
    ].includes(candidate)
    ? (candidate as ControlProfile)
    : null;
}

function assetKindValue(value: unknown): ControlReferenceAssetKind | null {
  const candidate = stringValue(value)?.toUpperCase();
  return candidate === "MODEL" || candidate === "PARTICLE" ? candidate : null;
}

function normalizeStage(value: unknown): ControlReferenceStage | null {
  const candidate = stringValue(value)?.toUpperCase();
  if (
    candidate === "GEOMETRY" ||
    candidate === "TEXTURE" ||
    candidate === "ANIMATION"
  ) {
    return candidate;
  }
  return null;
}

export function emptyReference(
  unavailableReason: NonNullable<
    ControlReferenceProjection["unavailable_reason"]
  >
): ControlReferenceProjection {
  return {
    available: false,
    source_path: null,
    package_root: null,
    fingerprint: null,
    schema: null,
    asset_name: null,
    asset_kind: null,
    intent: null,
    selected_profile: null,
    requirements: {
      dimensions_blocks: null,
      player_relative_scale: null,
      animation_required: null,
    },
    readiness: {
      overall: null,
      geometry: null,
      texture: null,
      animation: null,
    },
    particle: null,
    blocking_unknowns: [],
    non_blocking_unknowns: [],
    documents: {},
    images: [],
    semantic_facts: {
      parts: [],
      articulation: [],
      materials: [],
      animation_guidance: [],
      constraints: [],
    },
    truncated_sections: [],
    unavailable_reason: unavailableReason,
  };
}

export function parseReferencePackage(
  raw: string,
  sourcePath: string,
  packageRoot: string
): ControlReferenceProjection | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  const root = record(parsed);
  if (!root || stringValue(root.schema) !== "lazydesigner-reference-v1" ||
      (root.images !== undefined && !Array.isArray(root.images)) ||
      (root.parts !== undefined && !Array.isArray(root.parts)) ||
      (root.articulation !== undefined && !Array.isArray(root.articulation)) ||
      (root.materials !== undefined && !Array.isArray(root.materials)) ||
      (root.animation_guidance !== undefined && !Array.isArray(root.animation_guidance)) ||
      (root.constraints !== undefined && !Array.isArray(root.constraints))) {
    return null;
  }

  // An invalid manifest row must not disappear from the projected inventory.
  for (const section of ["parts", "articulation", "materials", "animation_guidance"] as const) {
    const entries = root[section];
    if (Array.isArray(entries) && entries.some((entry) => record(entry) === null)) return null;
  }
  if (Array.isArray(root.constraints) &&
      root.constraints.some((entry) => typeof entry !== "string" || !entry.trim())) {
    return null;
  }

  const asset = record(root.asset);
  const requirements = record(root.requirements);
  const dimensions = record(requirements?.dimensions_blocks);
  const readiness = record(root.readiness);
  const unknowns = record(root.unknowns);
  const documents = record(root.documents);
  const particle = record(root.particle);
  const particleTrigger = record(particle?.trigger);
  const selectedProfile = profileValue(asset?.profile);
  const assetKind =
    assetKindValue(asset?.kind) ?? (selectedProfile ? "MODEL" : null);
  const imageEntries = Array.isArray(root.images) ? root.images : [];
  // Validate the complete source identity set, not just the bounded context projection.
  const declaredPartIdsList = (Array.isArray(root.parts) ? root.parts : [])
    .map((part) => stringValue(record(part)?.id));
  const declaredPartIds = new Set(declaredPartIdsList.filter((id): id is string => id !== null));
  const ambiguousParts = declaredPartIdsList.some((id) => id === null) ||
    declaredPartIds.size !== declaredPartIdsList.length;
  if (ambiguousParts) return null;
  const unknownLists = [unknowns?.blocking, unknowns?.non_blocking];
  if (unknownLists.some((value) => value !== undefined &&
      (!Array.isArray(value) ||
        value.some((entry) => typeof entry !== "string" || !entry.trim())))) {
    return null;
  }
  let invalidImageEvidence = false;
  const images = imageEntries.flatMap((entry) => {
    const item = record(entry);
    if (!item) {
      invalidImageEvidence = true;
      return [];
    }
    const id = stringValue(item.id);
    const file = stringValue(item.file);
    if (!id || !file) {
      invalidImageEvidence = true;
      return [];
    }
    const landmarks = parseReferenceImageLandmarks(item.landmarks);
    const regions = parseReferenceImageRegions(item.regions);
    const viewCandidate = stringValue(item.view)?.toLowerCase();
    const view: ModelView | null =
      viewCandidate && MODEL_VIEWS.includes(viewCandidate as ModelView)
        ? viewCandidate as ModelView
        : null;
    const usedBy = (Array.isArray(item.used_by) ? item.used_by : [])
      .map(normalizeStage)
      .filter((stage): stage is ControlReferenceStage => stage !== null);
    const partWorldConstraints = parseImagePartWorldConstraints(
      item.part_world_constraints, declaredPartIds, view, usedBy
    );
    // A point/claim on an unregistered composite sheet has no canonical view.
    if (landmarks === null || regions === null || partWorldConstraints === null ||
        ((landmarks.length > 0 || regions.length > 0) && !view) ||
        (regions.length > 0 && (
          ambiguousParts || !declaredPartIds.size ||
          regions.some((region) => !declaredPartIds.has(region.part_id) ||
            (region.related_part_id !== null &&
              !declaredPartIds.has(region.related_part_id)))
        ))) {
      invalidImageEvidence = true;
      return [];
    }
    return [{
      id,
      file,
      role: stringValue(item.role),
      used_by: [...new Set(usedBy)],
      status: stringValue(item.status),
      ...(item.landmarks !== undefined ? { landmarks } : {}),
      ...(item.regions !== undefined ? { regions } : {}),
      ...(item.part_world_constraints !== undefined
        ? { part_world_constraints: partWorldConstraints! }
        : {}),
      view,
    }];
  });
  // Never represent a malformed source as a smaller, apparently complete reference.
  if (invalidImageEvidence ||
      new Set(images.map((image) => image.id)).size !== images.length) return null;

  const truncatedSections: NonNullable<ControlReferenceProjection["truncated_sections"]> = [];
  const projectionCaps = [
    ["parts", root.parts, 24],
    ["articulation", root.articulation, 24],
    ["materials", root.materials, 24],
    ["animation_guidance", root.animation_guidance, 24],
    ["constraints", root.constraints, 24],
    ["unknowns.blocking", unknowns?.blocking, 16],
    ["unknowns.non_blocking", unknowns?.non_blocking, 16],
  ] as const;
  for (const [section, values, cap] of projectionCaps) {
    if (Array.isArray(values) && values.length > cap) truncatedSections.push(section);
  }

  // Row caps are not the only source of incomplete context. A structured fact
  // can also lose its 17th field or 13th string-list member. Keep the bounded
  // projection, but never present such a partial projection as complete.
  for (const section of ["parts", "articulation", "materials", "animation_guidance"] as const) {
    const entries = root[section];
    if (!Array.isArray(entries)) continue;
    const innerOmission = entries.slice(0, 24).some((entry) => {
      const fact = record(entry);
      if (!fact) return false;
      const fields = Object.entries(fact);
      return fields.length > 16 ||
        fields.slice(0, 16).some(([, value]) => {
          if (Array.isArray(value)) {
            // The projection accepts only nonempty strings, up to 12 per
            // field. A mixed, malformed or oversized list is incomplete.
            return stringList(value, 12).length !== value.length;
          }
          // A nonempty nested object cannot be represented by the flat
          // structured-fact projection. Do not mistake omission for absence.
          const nested = record(value);
          if (nested) return Object.keys(nested).length > 0;
          return false;
        });
    });
    if (innerOmission && !truncatedSections.includes(section)) {
      truncatedSections.push(section);
    }
  }

  return {
    available: true,
    source_path: sourcePath,
    package_root: packageRoot,
    fingerprint: createHash("sha256")
      .update(canonicalJson(parsed))
      .digest("hex"),
    schema: "lazydesigner-reference-v1",
    asset_name: stringValue(asset?.name),
    asset_kind: assetKind,
    intent: stringValue(asset?.intent),
    selected_profile: selectedProfile,
    requirements: {
      dimensions_blocks: dimensions
        ? {
            width: numberOrNull(dimensions.width),
            height: numberOrNull(dimensions.height),
            length: numberOrNull(dimensions.length),
          }
        : null,
      player_relative_scale: stringValue(
        requirements?.player_relative_scale
      ),
      animation_required: boolOrNull(requirements?.animation_required),
    },
    readiness: {
      overall: stringValue(readiness?.overall),
      geometry: stringValue(readiness?.geometry),
      texture: stringValue(readiness?.texture),
      animation: stringValue(readiness?.animation),
    },
    particle:
      assetKind === "PARTICLE"
        ? {
            identifier: stringValue(particle?.identifier),
            particle_json: stringValue(particle?.particle_json),
            texture_reference: stringValue(particle?.texture_reference),
            texture_png: stringValue(particle?.texture_png),
            texture_state: stringValue(particle?.texture_state),
            recommended_locator: stringValue(
              particle?.recommended_locator
            ),
            recommended_animation: stringValue(
              particle?.recommended_animation
            ),
            trigger_intent: stringValue(particleTrigger?.intent),
            trigger_time_seconds: numberOrNull(
              particleTrigger?.time_seconds
            ),
            bind_to_actor: boolOrNull(particle?.bind_to_actor),
            review_state: stringValue(particle?.review_state),
          }
        : null,
    blocking_unknowns: stringList(unknowns?.blocking),
    non_blocking_unknowns: stringList(unknowns?.non_blocking),
    truncated_sections: truncatedSections,
    documents: {
      ...(stringValue(documents?.geometry)
        ? { GEOMETRY: stringValue(documents?.geometry)! }
        : {}),
      ...(stringValue(documents?.texture)
        ? { TEXTURE: stringValue(documents?.texture)! }
        : {}),
      ...(stringValue(documents?.animation)
        ? { ANIMATION: stringValue(documents?.animation)! }
        : {}),
    },
    images,
    semantic_facts: {
      parts: structuredFactList(root.parts),
      articulation: structuredFactList(root.articulation),
      materials: structuredFactList(root.materials),
      animation_guidance: structuredFactList(root.animation_guidance),
      constraints: stringList(root.constraints, 24),
    },
  };
}
