/// <reference types="blockbench-types" />
import { geometryHygieneRuntime, rigGraphRuntime } from "@/server/tools/validation/qualityIntelligence";
import { generateTexturePalette, texturePaletteParameters } from "@/lib/texture/palette";

export type AuthoringCategory = "geometry" | "texture" | "animation";
export type ReviewRow = { label: string; value: string };
export type AuthoringReview = {
  heading: string;
  summary: string;
  rows: ReviewRow[];
  note: string;
  swatches?: string[];
};

export function requireBedrockEditorProject(): void {
  if (typeof Project === "undefined" || !Project) {
    throw new Error("Open a Bedrock Model project to use these tools.");
  }
  if (Project.format?.id !== "bedrock") {
    throw new Error("LazyDesigner authoring tools currently support Bedrock Model projects only.");
  }
}

/** Three human-oriented views of the native state; none mutates a project or changes the AI Stage. */
export function inspectAuthoringCategory(category: AuthoringCategory): AuthoringReview {
  requireBedrockEditorProject();
  if (category === "geometry") {
    // The same native adapters and pure analyzers that enrich MCP quality receipts.
    const geometry = geometryHygieneRuntime();
    const rig = rigGraphRuntime();
    if (geometry.state === "unavailable" || rig.state === "unavailable") {
      throw new Error("The Blockbench geometry or Group inventory is not available.");
    }
    const findings =
      geometry.precision.affected_cube_count +
      geometry.degenerate_cubes.count +
      geometry.box_uv_subunit.count +
      geometry.duplicate_bone_names.group_count;
    const graphInvalid = rig.state === "invalid_graph";
    return {
      heading: "Model Inspector",
      summary: findings > 0 || graphInvalid
        ? "Technical findings need review."
        : "No issues in the bounded geometry and rig checks.",
      rows: [
        { label: "Cubes", value: String(Cube.all?.length ?? 0) },
        { label: "Groups", value: String(rig.group_count) },
        { label: "Precision candidates", value: String(geometry.precision.affected_cube_count) },
        { label: "Degenerate cubes", value: String(geometry.degenerate_cubes.count) },
        { label: "Box UV risks", value: String(geometry.box_uv_subunit.count) },
        { label: "Duplicate group names", value: String(geometry.duplicate_bone_names.group_count) },
        { label: "Rig graph", value: rig.state === "invalid_graph" ? "Needs review" : rig.state === "empty" ? "No groups" : "Structurally valid" },
      ],
      note: "Diagnostics are bounded technical evidence, not a visual-quality PASS or automatic approval.",
    };
  }

  if (category === "texture") {
    const textures = typeof Texture !== "undefined" && Array.isArray(Texture.all) ? Texture.all : [];
    const groups = typeof TextureGroup !== "undefined" && Array.isArray(TextureGroup.all) ? TextureGroup.all : [];
    return {
      heading: "Texture Inventory",
      summary: textures.length ? "Current project texture overview." : "No textures are present in this project.",
      rows: [
        { label: "Textures", value: String(textures.length) },
        { label: "Material groups", value: String(groups.length) },
        { label: "Logical atlas size", value: Number.isFinite(Project.texture_width) && Number.isFinite(Project.texture_height)
          ? `${Project.texture_width} × ${Project.texture_height}` : "Unknown" },
        { label: "Texture names", value: textures.slice(0, 4).map((texture) => String(texture.name)).join(", ") || "None" },
      ],
      note: "Inventory only. Pixel accuracy, UV seams, and material quality have not been evaluated.",
    };
  }

  const items = typeof AnimationItem !== "undefined" && Array.isArray(AnimationItem.all) ? AnimationItem.all : [];
  const controllers = typeof AnimationController === "undefined"
    ? 0
    : items.filter((item) => item instanceof AnimationController).length;
  const selected = typeof AnimationItem === "undefined" ? null : AnimationItem.selected;
  return {
    heading: "Animation Inventory",
    summary: items.length ? "Current clips and controllers." : "No authored animations are present.",
    rows: [
      { label: "Animation clips", value: String(items.length - controllers) },
      { label: "Controllers", value: String(controllers) },
      { label: "Selected", value: selected ? String(selected.name) : "None" },
      { label: "Names", value: items.slice(0, 4).map((item) => String(item.name)).join(", ") || "None" },
    ],
    note: "Inventory only. Motion continuity, native playback, and exported behavior have not been evaluated.",
  };
}

export function previewAuthoringPalette(base: string): AuthoringReview {
  // Preview-only: never use append/replace from this surface.
  const request = texturePaletteParameters.parse({ base, count: 7, mode: "preview" });
  const palette = generateTexturePalette(request);
  return {
    heading: "Palette Preview",
    summary: "Seven shades derived from one base color.",
    rows: [
      { label: "Base", value: request.base.toLowerCase() },
      { label: "Distinct colors", value: String(palette.unique_colors) },
    ],
    swatches: palette.colors,
    note: "Color planning only. No palette, texture bitmap, or material was changed.",
  };
}
