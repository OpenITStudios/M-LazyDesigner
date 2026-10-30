import {
  faceLocalPixelSize,
  mapFaceLocalPixelToAtlasPixel,
  mapFaceUvToTexturePixels,
  type TexturePixelMetrics,
} from "../uv/facePixelMapping";
import { facePhysicalSize, type UvPhysicalFaceInput } from "../uv/physicalEvidence";

export const TEXTURE_SURFACE_PATTERN_NAMES = [
  "wood_grain",
  "painted_wood",
  "brushed_metal",
  "bare_metal",
  "painted_metal",
  "stone_cluster",
  "concrete_speckle",
  "cloth_weave",
  "leather_wear",
  "clean_glass",
  "dirty_glass",
  "plastic_clean",
  "rubber_matte",
  "organic_skin",
  "fur_cluster",
  "emissive_panel",
  "energy_surface",
] as const;

export type TextureSurfacePattern =
  (typeof TEXTURE_SURFACE_PATTERN_NAMES)[number];

export type TextureSurfacePatternRecipe = {
  domain: "surface_pattern";
  pattern: TextureSurfacePattern;
  directionality: "none" | "weak" | "directional" | "form_driven";
  cluster_language: string;
  value_behavior: string;
  edge_behavior: string;
  secondary_detail: string;
  avoid: readonly string[];
  render_profile_inference: "forbidden";
};

const recipe = (
  pattern: TextureSurfacePattern,
  directionality: TextureSurfacePatternRecipe["directionality"],
  cluster_language: string,
  value_behavior: string,
  edge_behavior: string,
  secondary_detail: string,
  avoid: readonly string[]
): TextureSurfacePatternRecipe => ({
  domain: "surface_pattern",
  pattern,
  directionality,
  cluster_language,
  value_behavior,
  edge_behavior,
  secondary_detail,
  avoid,
  render_profile_inference: "forbidden",
});

export const TEXTURE_SURFACE_PATTERN_RECIPES: Readonly<
  Record<TextureSurfacePattern, TextureSurfacePatternRecipe>
> = Object.freeze({
  wood_grain: recipe("wood_grain", "directional", "irregular elongated pixel runs following construction grain", "moderate stepped hue/value movement", "subdued except exposed cut edges", "sparse knots or grain interruptions", ["uniform stripes", "noise-first grain"]),
  painted_wood: recipe("painted_wood", "directional", "broad paint clusters with faint underlying grain", "paint color owns the ramp", "small exposed-edge contrast where reference supports wear", "rare chips or seams", ["bare-wood grain dominating paint", "random chipping"]),
  brushed_metal: recipe("brushed_metal", "weak", "clean hard clusters with restrained directional streaks", "controlled narrow-to-moderate value range", "crisp sparse highlight breaks", "rare brush marks or panel seams", ["stone-like speckle", "full-edge outlining"]),
  bare_metal: recipe("bare_metal", "form_driven", "clean hard clusters and deliberate value breaks", "stronger specular-style contrast where form supports it", "selective bright edge accents", "sparse seams, fasteners, or wear", ["random bright noise", "soft airbrush shading"]),
  painted_metal: recipe("painted_metal", "form_driven", "paint-dominant hard clusters", "paint hue/value ramp first", "metal exposure only at justified chips/edges", "panel seams and sparse wear", ["making every edge bare metal", "uniform scratch noise"]),
  stone_cluster: recipe("stone_cluster", "none", "irregular medium pixel islands", "broad local value variation", "broken rather than uniformly highlighted", "sparse inclusions or cracks", ["directional wood-like bands", "single-pixel salt-and-pepper noise"]),
  concrete_speckle: recipe("concrete_speckle", "none", "large quiet fields with sparse clustered inclusions", "low-to-moderate contrast", "mostly quiet", "controlled aggregate marks", ["dense uniform speckle", "high-frequency noise"]),
  cloth_weave: recipe("cloth_weave", "form_driven", "soft stepped clusters with subtle repeated cues", "restrained contrast following folds", "soft/subdued", "minimal weave hints at sufficient texel density", ["sharp metallic edge highlights", "checkerboard microtexture"]),
  leather_wear: recipe("leather_wear", "form_driven", "broad organic clusters", "moderate warm/cool or value variation", "selective crease/edge wear", "sparse creases and worn patches", ["even scratches", "stone-like mottling"]),
  clean_glass: recipe("clean_glass", "form_driven", "mostly quiet field with sparse reflection clusters", "value kept subordinate to transparency intent", "border/structural emphasis only when reference supports it", "few highlights/reflections", ["opaque-looking noise", "automatic translucency inference"]),
  dirty_glass: recipe("dirty_glass", "none", "quiet transparent field plus sparse dirt clusters", "low contrast contamination", "structural edge remains readable", "smudges/dust in grouped patches", ["uniform fog", "dense opaque dirt"]),
  plastic_clean: recipe("plastic_clean", "form_driven", "broad clean clusters", "simple controlled ramp", "small selective highlights", "very sparse manufacturing seams", ["metallic scratches", "grain/noise blanket"]),
  rubber_matte: recipe("rubber_matte", "form_driven", "broad dark clusters", "compressed low-value range", "subdued highlights", "sparse grooves or molded marks", ["bright sharp specular edges", "random grain"]),
  organic_skin: recipe("organic_skin", "form_driven", "organic clustered transitions", "form-led hue/value changes", "softened but pixel-crisp", "identity marks before microvariation", ["mechanical panel language", "uniform procedural spots"]),
  fur_cluster: recipe("fur_cluster", "directional", "layered tuft-like pixel clusters following growth direction", "moderate grouped value shifts", "broken tuft tips rather than outlines", "sparse tuft accents", ["single-pixel hair noise", "uniform stripes"]),
  emissive_panel: recipe("emissive_panel", "form_driven", "clean luminous core clusters with readable casing separation", "bright identity core with controlled surrounding values", "hard boundary between source and housing", "small internal segmentation", ["automatic glow from RGB alone", "full-surface white clipping"]),
  energy_surface: recipe("energy_surface", "directional", "purposeful flow/arc clusters", "high contrast concentrated in focal paths", "broken energetic accents", "sparse pulses/branches", ["random electric noise", "uniform glow"]),
});

export function getTextureSurfacePatternRecipe(
  pattern: TextureSurfacePattern
): TextureSurfacePatternRecipe {
  return TEXTURE_SURFACE_PATTERN_RECIPES[pattern];
}


/**
 * Caller-chosen pattern direction, expressed in atlas and face-local pixel
 * coordinates. Signed axes preserve meaningful mirrored/rotated marks.
 * A caller's intent is not proof of the actual source image's motif axis.
 */
export type TexturePatternAxis = Readonly<{
  axis: "u" | "v";
  sign: 1 | -1;
}>;
export type TexturePatternOrientationIntent = Readonly<{
  atlas: TexturePatternAxis;
  expected_face: TexturePatternAxis;
}>;
export type TexturePatternDetailIntent = Readonly<{
  cube_uuid: string;
  face: UvPhysicalFaceInput["face"];
  expected_texture_uuid: string;
  /** Explicit required physical-pixel density; never inferred from pattern name. */
  minimum_pixels_per_model_unit: number;
  orientation?: TexturePatternOrientationIntent;
}>;

export type TexturePatternPhysicalInput = Readonly<{
  pattern: TextureSurfacePattern;
  face: UvPhysicalFaceInput["face"];
  cube_size: readonly number[];
  uv: readonly number[];
  rotation: number;
  texture_metrics: TexturePixelMetrics;
  detail_intent: Pick<TexturePatternDetailIntent,
    "minimum_pixels_per_model_unit" | "orientation">;
}>;

const AXES = ["u", "v"] as const;
function validAxis(value: unknown): value is TexturePatternAxis {
  if (!value || typeof value !== "object") return false;
  const axis = value as Record<string, unknown>;
  return AXES.includes(axis.axis as "u" | "v") &&
    (axis.sign === 1 || axis.sign === -1);
}

function roundMeasured(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Exact face-UV-grid capacity and signed direction preflight, not a paint or
 * material decision. Uses canonical face-local pixel→atlas mapping, so signed
 * UV corners and 90/180/270 face rotation are not silently normalized.
 */
export function reviewTexturePatternPhysicalFit(input: TexturePatternPhysicalInput) {
  if (!TEXTURE_SURFACE_PATTERN_NAMES.includes(input.pattern)) {
    throw new Error("TEXTURE_PATTERN_UNKNOWN");
  }
  const recipe = getTextureSurfacePatternRecipe(input.pattern);
  const minDensity = input.detail_intent.minimum_pixels_per_model_unit;
  if (!Number.isFinite(minDensity) || minDensity <= 0 || minDensity > 4096) {
    throw new Error("TEXTURE_PATTERN_DENSITY_TARGET_INVALID: require an explicit positive physical-pixel target.");
  }
  const direction = input.detail_intent.orientation;
  if (direction !== undefined &&
      (!direction || !validAxis(direction.atlas) || !validAxis(direction.expected_face))) {
    throw new Error("TEXTURE_PATTERN_DIRECTION_INTENT_INVALID");
  }

  const reasons: string[] = [];
  const physical = facePhysicalSize(input.face, input.cube_size);
  if (!physical || physical[0] <= 0 || physical[1] <= 0) {
    reasons.push("TEXTURE_PATTERN_PHYSICAL_FACE_UNVERIFIED");
  }
  let pixels: [number, number] | null = null;
  let density: [number, number] | null = null;
  let orientation: {
    expected_face: TexturePatternAxis;
    actual_face: TexturePatternAxis | null;
    atlas: TexturePatternAxis;
    face_rotation: number;
    uv_flip_u: boolean;
    uv_flip_v: boolean;
    state: "consistent_with_declared_mapping" | "review_required";
  } | null = null;

  try {
    const mapping = mapFaceUvToTexturePixels(
      input.uv, input.texture_metrics, "texture pattern physical review"
    );
    pixels = faceLocalPixelSize(
      mapping, input.rotation, "texture pattern physical review"
    );
    if (physical && physical[0] > 0 && physical[1] > 0) {
      density = [
        roundMeasured(pixels[0] / physical[0]),
        roundMeasured(pixels[1] / physical[1]),
      ];
      // Do not silently downsample source detail when one Cube face axis
      // cannot support the caller's density target.
      if (density.some(value => value + 1e-6 < minDensity)) {
        reasons.push("TEXTURE_PATTERN_TEXEL_DENSITY_INSUFFICIENT");
      }
    }

    if (direction) {
      const origin = mapFaceLocalPixelToAtlasPixel(
        mapping, input.rotation, 0, 0, "texture pattern direction"
      );
      const along: Array<{
        face_axis: "u" | "v";
        atlas_axis: "u" | "v";
        atlas_sign: 1 | -1;
      }> = [];
      for (const axis of AXES) {
        const supported = axis === "u" ? pixels[0] >= 2 : pixels[1] >= 2;
        if (!supported) continue;
        const advanced = mapFaceLocalPixelToAtlasPixel(
          mapping, input.rotation,
          axis === "u" ? 1 : 0, axis === "v" ? 1 : 0,
          "texture pattern direction"
        );
        const dx = advanced.x - origin.x, dy = advanced.y - origin.y;
        if (Math.abs(dx) + Math.abs(dy) !== 1) {
          throw new Error("TEXTURE_PATTERN_DIRECTION_TRANSFORM_UNVERIFIED");
        }
        along.push({
          face_axis: axis,
          atlas_axis: dx !== 0 ? "u" : "v",
          atlas_sign: (dx !== 0 ? Math.sign(dx) : Math.sign(dy)) as 1 | -1,
        });
      }
      const match = along.find(entry =>
        entry.atlas_axis === direction.atlas.axis
      );
      const actual = match ? {
        axis: match.face_axis,
        sign: (match.atlas_sign === direction.atlas.sign ? 1 : -1) as 1 | -1,
      } : null;
      orientation = {
        expected_face: { ...direction.expected_face },
        actual_face: actual,
        atlas: { ...direction.atlas },
        face_rotation: input.rotation,
        uv_flip_u: mapping.flip_u,
        uv_flip_v: mapping.flip_v,
        state: actual &&
          actual.axis === direction.expected_face.axis &&
          actual.sign === direction.expected_face.sign
          ? "consistent_with_declared_mapping" : "review_required",
      };
      if (!actual) {
        reasons.push("TEXTURE_PATTERN_DIRECTION_TEXELS_INSUFFICIENT");
      } else if (orientation.state === "review_required") {
        reasons.push("TEXTURE_PATTERN_DIRECTION_MISMATCH");
      }
    }
  } catch {
    reasons.push("TEXTURE_PATTERN_FACE_PIXEL_GRID_UNVERIFIED");
  }

  // Texture pattern words cannot reveal source image stroke orientation.
  // Directional recipes demand an explicit atlas→face claim; a form-driven
  // recipe may have no one-dimensional motif axis at all.
  if (recipe.directionality === "directional" && !direction) {
    reasons.push("TEXTURE_PATTERN_DIRECTION_INTENT_REQUIRED");
  }

  return {
    source: "canonical_face_uv_pixel_mapping" as const,
    state: reasons.length ? ("review_required" as const)
      : ("metrics_consistent" as const),
    surface_pattern: recipe.pattern,
    pattern_directionality: recipe.directionality,
    physical_face_model_units: physical,
    face_local_physical_pixels: pixels,
    pixels_per_model_unit: density,
    explicit_minimum_pixels_per_model_unit: minDensity,
    orientation,
    reasons,
    source_pattern_axis_attested: false as const,
    reference_face_correspondence_attested: false as const,
    native_scene_revision_attested: false as const,
    painting_authorized: false as const,
    uv_mutation_authorized: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}
