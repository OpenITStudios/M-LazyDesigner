import { analyzeTextureColorProfile } from "./colorProfile";
import { analyzeTexturePixelCraft } from "./pixelCraft";

/**
 * Candidate-only evidence on the EXACT changed atlas crop after an atomic Paint.
 * This is not a quality score, material classifier, reference match or a
 * full-face status. Legitimate INTENTIONAL_FLAT and tiny identity corrections
 * remain possible; only an independent mapped-model review grants acceptance.
 */
export function inspectPaintStylingEvidence(
  rgba: ArrayLike<number>, width: number, height: number
) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 ||
      !Number.isSafeInteger(width * height) ||
      rgba.length !== width * height * 4) {
    throw new Error("TEXTURE_STYLING_EVIDENCE_BITMAP_INVALID");
  }
  if (width * height > 1_048_576) {
    // Optional quality evidence must NEVER break a valid large-atlas
    // native Paint. The writer owns the actual atlas-size admission.
    return {
      scope:"affected_atlas_crop_only" as const,
      status:"NOT_EVALUATED" as const,
      reason:"REGION_TOO_LARGE_FOR_STYLING_DIAGNOSTIC" as const,
      sampled_visible_pixels:null,
      color_bucket_count:null,
      dominant_visible_ratio:null,
      luminance_span:null,
      review_hints:[],
      visual_verdict:"UNVERIFIED" as const,
      texture_completion_attested:false as const,
      note:"Diagnostic skipped for a large changed atlas crop; actual mapped-model visual review is still required.",
    };
  }
  const profile = analyzeTextureColorProfile(rgba, width, height, {
    maxSamples: 4096, paletteSize: 4,
  });
  const pixels = profile.sampling.sampled_pixels;
  const visible = Math.round(profile.alpha.visible_coverage * pixels);
  const hints: string[] = [];
  // Samples under 16 visible pixels cannot distinguish a purposeful
  // single-color identity mark from an unfinished material surface.
  if (visible >= 16) {
    if (profile.color_bucket_count <= 1) {
      hints.push("UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE");
    } else if (profile.dominant_visible_ratio >= .92 &&
               (profile.luma?.span ?? 0) < .08) {
      hints.push("LOW_FORM_VALUE_VARIATION_CANDIDATE");
    }
    // Exact row signatures catch horizontal color bands that can have
    // large numeric luma contrast but no form-following shade structure.
    // Restrict to fully opaque, sufficiently large rectangular regions.
    if (width >= 4 && height >= 4 && width * height <= 16384 &&
        profile.alpha.opaque_ratio === 1) {
      const rows: string[] = [];
      for (let y = 0; y < height; y++) {
        const start = (y * width) * 4;
        const first = [rgba[start],rgba[start+1],rgba[start+2]].join(",");
        let uniform = true;
        for (let x = 1; x < width; x++) {
          const idx = (y * width + x) * 4;
          if ([rgba[idx],rgba[idx+1],rgba[idx+2]].join(",") !== first) {
            uniform = false;
            break;
          }
        }
        rows.push(uniform ? first : "");
      }
      const fullRows = rows.filter(Boolean);
      if (fullRows.length / height >= .875 &&
          new Set(fullRows).size >= 2 &&
          rows.slice(1).some((row,i)=>row!==rows[i])) {
        hints.push("UNIFORM_HORIZONTAL_BANDS_REVIEW");
      }
    }
    const craft = analyzeTexturePixelCraft(rgba,width,height);
    if (craft.state === "available") {
      if (craft.review_hints.includes("HIGH_TINY_CLUSTER_FRAGMENTATION") ||
          craft.review_hints.includes("HIGH_LOCAL_COLOR_TRANSITION_DENSITY")) {
        hints.push("FRAGMENTED_OR_NOISE_FIRST_REVIEW");
      }
    }
  }
  return {
    scope:"affected_atlas_crop_only" as const,
    status: hints.includes("UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE")
      ? "BASE_ONLY_CANDIDATE" as const
      : hints.length > 0 ? "REVIEW_REQUIRED" as const
      : "NOT_EVALUATED" as const,
    sampled_visible_pixels:visible,
    color_bucket_count:profile.color_bucket_count,
    dominant_visible_ratio:profile.dominant_visible_ratio,
    luminance_span:profile.luma?.span ?? null,
    review_hints:hints,
    visual_verdict:"UNVERIFIED" as const,
    texture_completion_attested:false as const,
    note:"This reads only the mutated atlas crop. It cannot prove that visible clusters follow 3D form. INTENTIONAL_FLAT or small identity edits may be correct. Inspect the actual shaded mapped model and approved reference before any STYLED/complete claim.",
  };
}
