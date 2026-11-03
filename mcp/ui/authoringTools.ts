/// <reference types="blockbench-types" />
import {
  geometryHygieneRuntime,
  rigGraphRuntime,
} from "@/server/tools/validation/qualityIntelligence";

export type AuthoringCategory = "geometry" | "texture" | "animation";

export type GeometryIssue = {
  kind: "cube" | "group";
  uuid: string;
  name: string;
  code: "degenerate_cube" | "box_uv_subunit" | "duplicate_group_name";
  description: string;
};

export type GeometryIssueReview = {
  heading: string;
  summary: string;
  rows: Array<{ label: string; value: string }>;
  issues: GeometryIssue[];
  truncated: boolean;
  note: string;
};

const MAX_VISIBLE_ISSUES = 8;

export function requireBedrockEditorProject(): void {
  if (typeof Project === "undefined" || !Project) {
    throw new Error("Open a Bedrock Model project to use these tools.");
  }
  if (Project.format?.id !== "bedrock") {
    throw new Error("LazyDesigner authoring tools currently support Bedrock Model projects only.");
  }
}

/**
 * One actual workflow: native Geometry diagnostics -> UUID-specific review.
 * Never present a count without explaining the diagnostic's limited scope.
 * No guessed corrections, arbitrary selection, or visual-quality certification.
 */
export function inspectGeometryIssues(): GeometryIssueReview {
  requireBedrockEditorProject();
  const hygiene = geometryHygieneRuntime();
  const rig = rigGraphRuntime();
  if (hygiene.state === "unavailable" || rig.state === "unavailable") {
    throw new Error("The Blockbench Cube/Group inventory is not available.");
  }

  const candidates: GeometryIssue[] = [];
  for (const item of hygiene.degenerate_cubes.examples) {
    candidates.push({
      kind: "cube", uuid: item.cube_uuid, name: item.cube_name,
      code: "degenerate_cube",
      description: `Invalid or collapsed extent on ${item.invalid_axes.join(", ")}. Inspect the Cube before repairing it.`,
    });
  }
  for (const duplicate of hygiene.duplicate_bone_names.examples) {
    for (const group of duplicate.groups) {
      candidates.push({
        kind: "group", uuid: group.uuid, name: group.name,
        code: "duplicate_group_name",
        description: `Name "${duplicate.name}" is shared by ${duplicate.count} Groups. Use UUIDs to avoid ambiguous bone targets.`,
      });
    }
  }
  for (const item of hygiene.box_uv_subunit.examples) {
    candidates.push({
      kind: "cube", uuid: item.cube_uuid, name: item.cube_name,
      code: "box_uv_subunit",
      description: `Box UV has sub-unit dimensions on ${item.axes.join(", ")}. Check the UV mapping; small geometry can be intentional.`,
    });
  }

  const unique = new Set<string>();
  const issues = candidates.filter((issue) => {
    const key = issue.code + ":" + issue.uuid;
    if (!issue.uuid || unique.has(key)) return false;
    unique.add(key);
    return true;
  }).slice(0, MAX_VISIBLE_ISSUES);

  const needsReview =
    hygiene.state === "review_required" || rig.state === "invalid_graph";
  const truncated =
    candidates.length > MAX_VISIBLE_ISSUES ||
    hygiene.degenerate_cubes.examples_truncated ||
    hygiene.box_uv_subunit.examples_truncated ||
    hygiene.duplicate_bone_names.examples_truncated ||
    hygiene.duplicate_bone_names.examples.some((item) => item.groups_truncated);

  return {
    heading: "Geometry Issues",
    summary: needsReview
      ? issues.length
        ? "Select a finding to locate the affected object in the native Outliner."
        : "Technical findings exist, but no directly locatable issue is included in this bounded review."
      : "No findings in the checks shown. This does not certify visual quality.",
    rows: [
      { label: "Degenerate Cubes", value: String(hygiene.degenerate_cubes.count) },
      { label: "Duplicate Group names", value: String(hygiene.duplicate_bone_names.name_count) },
      { label: "Box UV sub-unit risks", value: String(hygiene.box_uv_subunit.count) },
      { label: "Precision hints", value: String(hygiene.precision.drift_count) },
      { label: "Rig graph", value: rig.state === "invalid_graph" ? "Structural review required" : "No structural error detected" },
    ],
    issues,
    truncated,
    note:
      "Read-only native diagnostics. Precision hints and rig-graph aggregates are not automatic fixes; missing issues are not proof of model quality.",
  };
}

/**
 * Shared exact native Outliner navigator. Only caller-verified UUIDs enter here.
 * This changes selection, never authored geometry or Undo history.
 */
export function locateExactGeometryTarget(
  kind: "cube" | "group",
  uuid: string,
  project: object
): string {
  requireBedrockEditorProject();
  if (Project !== project) {
    throw new Error("The project changed. Run the review again.");
  }
  const nodes = kind === "cube"
    ? (typeof Cube === "undefined" ? [] : Cube.all)
    : (typeof Group === "undefined" ? [] : Group.all);
  const matches = nodes.filter((node) => node.uuid === uuid);
  if (matches.length !== 1) {
    throw new Error("The reviewed object no longer has a unique UUID in this project.");
  }
  const node = matches[0];
  if (typeof node.select !== "function" ||
      typeof node.showInOutliner !== "function") {
    throw new Error("Native Outliner navigation is unavailable for this object.");
  }
  if (node.select(undefined, false) === false || node.selected !== true) {
    throw new Error("Blockbench could not select this object. Check whether it is locked.");
  }
  node.showInOutliner();
  return node.name;
}

/** Navigate to a current canonical diagnostic, not an inferred Cube. */
export function locateGeometryIssue(issue: GeometryIssue, project: object): string {
  return locateExactGeometryTarget(issue.kind, issue.uuid, project);
}
