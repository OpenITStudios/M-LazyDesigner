import {z} from "zod";
import tinycolor from "tinycolor2";

export const texturePaletteParameters = z.object({
  base: z.string().regex(/^#[0-9a-f]{6}$/i, "Opaque #RRGGBB base color required."),
  count: z.number().int().min(3).max(31).refine(count=>count%2===1,"Use an odd count to retain the exact base in the middle.").default(7),
  shadow_lightness: z.number().min(0).max(1).default(.25).describe("HSL lightness decrease from base."),
  highlight_lightness: z.number().min(0).max(1).default(.25).describe("HSL lightness increase from base."),
  shadow_hue_shift: z.number().min(-180).max(180).default(-15),
  highlight_hue_shift: z.number().min(-180).max(180).default(15),
  saturation_falloff: z.number().min(0).max(1).default(.15),
  mode: z.enum(["preview","append","replace"]).default("preview").describe("Preview returns colors only; append/replace changes the native palette, never texture pixels."),
}).strict();

export function generateTexturePalette(input:z.infer<typeof texturePaletteParameters>){
  const {h,s,l}=tinycolor(input.base).toHsl();
  const middle=(input.count-1)/2;
  const colors=Array.from({length:input.count},(_,index)=>{
    if(index===middle)return input.base.toLowerCase();
    const shadow=index<middle, weight=Math.abs(index-middle)/middle;
    return tinycolor({
      h:((h+weight*(shadow?input.shadow_hue_shift:input.highlight_hue_shift))%360+360)%360,
      s:s*(1-input.saturation_falloff*weight),
      l:Math.max(0,Math.min(1,l+weight*(shadow?-input.shadow_lightness:input.highlight_lightness))),
    }).toHexString();
  });
  return {colors,base_index:middle,unique_colors:new Set(colors).size};
}


/**
 * Advisory review of explicitly observed reference swatches. A material name,
 * RGB value or generated HSL shade is never evidence for a Texture pattern.
 * The caller owns image-byte SHA validation; this pure owner only checks
 * single-source roles, display-value order and declared identity conflicts.
 */
export type ReferencePaletteSwatch = Readonly<{
  treatment_region: string;
  image_id: string;
  image_sha256: string;
  image_region_id: string;
  part_id: string;
  face: Readonly<{
    cube_uuid: string;
    face: "north" | "south" | "east" | "west" | "up" | "down";
  }>;
  palette_role: "base" | "shadow" | "highlight" | "identity";
  observed_hex: string;
  observed_rgba: readonly [number, number, number, number];
}>;

export type ReferencePaletteRegion = Readonly<{
  region: string;
  identity_colors: readonly string[];
  surface_pattern: Pick<
    import("./surfacePattern").TextureSurfacePatternRecipe,
    "pattern" | "directionality"
  > | null;
}>;

const SOURCE_PALETTE_HEX = /^#[0-9a-f]{6}$/i;
const SOURCE_PALETTE_SHA = /^[0-9a-f]{64}$/i;
const SOURCE_PALETTE_ROLES = ["shadow", "base", "highlight", "identity"] as const;

function sourcePaletteHex(rgba: readonly [number, number, number, number]): string {
  return "#" + rgba.slice(0, 3).map(v => v.toString(16).padStart(2, "0")).join("");
}

function sourcePaletteLuminance(hex: string): number {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function reviewReferencePaletteRoles(
  samples: readonly ReferencePaletteSwatch[],
  regions: readonly ReferencePaletteRegion[]
) {
  if (!Array.isArray(samples) || samples.length > 16 || !Array.isArray(regions)) {
    throw new Error("REFERENCE_PALETTE_SAMPLE_BUDGET: at most 16 source samples.");
  }
  if (!samples.length) {
    return {
      state: "not_requested" as const,
      scope_count: 0,
      scopes: [],
      palette_selected: false as const,
      material_inferred: false as const,
      painting_authorized: false as const,
      visual_verdict: "not_evaluated" as const,
    };
  }

  const byRegion = new Map(regions.map(region => [region.region, region]));
  const grouped = new Map<string, ReferencePaletteSwatch[]>();
  for (const sample of samples) {
    const fields = [
      sample?.treatment_region, sample?.image_id, sample?.image_sha256,
      sample?.image_region_id, sample?.part_id, sample?.face?.cube_uuid,
    ];
    if (!sample || !sample.face || fields.some(v =>
        typeof v !== "string" || !v.trim() || v.length > 128) ||
        !SOURCE_PALETTE_SHA.test(sample.image_sha256) ||
        !["north", "south", "east", "west", "up", "down"].includes(sample.face.face) ||
        !SOURCE_PALETTE_ROLES.includes(sample.palette_role) ||
        !SOURCE_PALETTE_HEX.test(sample.observed_hex) ||
        !Array.isArray(sample.observed_rgba) || sample.observed_rgba.length !== 4 ||
        sample.observed_rgba.some(v => !Number.isInteger(v) || v < 0 || v > 255)) {
      throw new Error("REFERENCE_PALETTE_SAMPLE_INVALID: exact source, face, role and RGBA required.");
    }
    if (sourcePaletteHex(sample.observed_rgba) !== sample.observed_hex.toLowerCase()) {
      throw new Error("REFERENCE_PALETTE_COLOR_MISMATCH: observed RGB and hex disagree.");
    }
    if (!byRegion.has(sample.treatment_region)) {
      throw new Error("REFERENCE_PALETTE_REGION_UNDECLARED");
    }
    // Never combine light/shadow colors from different images, revisions,
    // annotated regions, semantic parts or actual Cube/face identities.
    const key = JSON.stringify([
      sample.treatment_region, sample.image_id, sample.image_sha256,
      sample.image_region_id, sample.part_id, sample.face.cube_uuid,
      sample.face.face,
    ]);
    const entries = grouped.get(key) ?? [];
    entries.push(sample);
    grouped.set(key, entries);
  }

  const scopes = [...grouped.entries()].sort(([a], [b]) =>
    a.localeCompare(b)).map(([, entries]) => {
    const first = entries[0];
    const declared = byRegion.get(first.treatment_region)!;
    const values = (role: ReferencePaletteSwatch["palette_role"]) =>
      [...new Set(entries.filter(item => item.palette_role === role)
        .map(item => item.observed_hex.toLowerCase()))].sort();
    const shadow = values("shadow"), base = values("base"),
      highlight = values("highlight"), identity = values("identity");
    const rampReasons: string[] = [];
    if (shadow.length !== 1 || base.length !== 1 || highlight.length !== 1) {
      rampReasons.push("REFERENCE_RAMP_ANCHORS_INCOMPLETE_OR_AMBIGUOUS");
    }
    if (entries.some(item => item.observed_rgba[3] !== 255)) {
      // PNG transparency may blend with a background or use non-opacity
      // semantics. Never offer those pixels as an opaque shade ladder.
      rampReasons.push("REFERENCE_RAMP_ALPHA_UNVERIFIED");
    }
    let luminance: { shadow: number; base: number; highlight: number } | null = null;
    if (shadow.length === 1 && base.length === 1 && highlight.length === 1) {
      const measured = {
        shadow: sourcePaletteLuminance(shadow[0]),
        base: sourcePaletteLuminance(base[0]),
        highlight: sourcePaletteLuminance(highlight[0]),
      };
      luminance = Object.fromEntries(Object.entries(measured).map(([k, v]) =>
        [k, Number(v.toFixed(4))]
      )) as typeof measured;
      if (!(measured.shadow < measured.base && measured.base < measured.highlight)) {
        rampReasons.push("REFERENCE_RAMP_VALUE_ORDER_UNVERIFIED");
      }
    }

    // Preserve, but do not silently recolor, separately authored identity
    // marks. Descriptive labels such as "orange" cannot be equated to RGB.
    const labels = declared.identity_colors.map(label => label.trim().toLowerCase());
    const identityReasons: string[] = [];
    if (labels.some(label => !SOURCE_PALETTE_HEX.test(label))) {
      identityReasons.push("REFERENCE_IDENTITY_DECLARATION_NOT_EXACT_HEX");
    } else if (labels.length || identity.length) {
      if (labels.length === 0 || identity.length === 0) {
        identityReasons.push("REFERENCE_IDENTITY_ANCHORS_INCOMPLETE");
      } else if (JSON.stringify([...new Set(labels)].sort()) !== JSON.stringify(identity)) {
        identityReasons.push("REFERENCE_IDENTITY_COLOR_CONFLICT");
      }
    }
    const observedRamp = rampReasons.length === 0
      ? [shadow[0], base[0], highlight[0]]
      : null;
    return {
      scope: {
        treatment_region: first.treatment_region,
        image_id: first.image_id,
        image_sha256: first.image_sha256,
        image_region_id: first.image_region_id,
        part_id: first.part_id,
        face: { ...first.face },
      },
      roles: {
        shadow_hex: shadow.length === 1 ? shadow[0] : null,
        base_hex: base.length === 1 ? base[0] : null,
        highlight_hex: highlight.length === 1 ? highlight[0] : null,
        identity_hex: identity,
      },
      ramp: {
        state: observedRamp ? ("source_anchor_candidate" as const)
          : ("review_required" as const),
        exact_observed_colors: observedRamp,
        relative_luminance: luminance,
        reasons: rampReasons,
      },
      identity: {
        declared_colors: [...declared.identity_colors],
        source_colors: identity,
        state: identityReasons.length ? ("review_required" as const)
          : ("declared_colors_consistent" as const),
        reasons: identityReasons,
      },
      // Pattern names are caller-declared choices, never RGB classification.
      surface_pattern: {
        declared: declared.surface_pattern?.pattern ?? null,
        directionality: declared.surface_pattern?.directionality ?? null,
        source_material_verified: false as const,
        direction_verified: false as const,
        physical_texel_density_verified: false as const,
      },
      source_role_labels: "CALLER_SELECTED" as const,
      visual_verdict: "not_evaluated" as const,
      painting_authorized: false as const,
    };
  });
  return {
    state: scopes.every(item =>
      item.ramp.state === "source_anchor_candidate" &&
      item.identity.state !== "review_required")
      ? ("source_anchors_for_review" as const)
      : ("review_required" as const),
    scope_count: scopes.length,
    scopes,
    palette_selected: false as const,
    material_inferred: false as const,
    painting_authorized: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}
