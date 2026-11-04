import type { ControlVerificationScope } from "./types";
import { textureRevisionSchema } from "../../lib/texture/evidence";

/**
 * Scope-locked get_texture arguments. Advisory ONLY: never auto executes,
 * authorizes a visual PASS or substitutes mapped 3D/reference comparison.
 */
export function planFocusedTextureEvidenceRequest(
  scope: ControlVerificationScope | null
) {
  if (!scope || scope.kind !== "TEXTURE_REGION" ||
      scope.evidence_source !== "follow_up_read") return null;
  const [left, top, right, bottom] = scope.affected_rect;
  const width = right - left, height = bottom - top;
  if (!scope.texture_uuid.trim() ||
      ![left,top,right,bottom,width,height].every(Number.isSafeInteger) ||
      left < 0 || top < 0 || width <= 0 || height <= 0 ||
      !textureRevisionSchema.safeParse(scope.revision).success) return null;
  // The full-atlas revision also declares decoded bitmap dimensions.
  // Never recommend a crop that the native get_texture contract will reject.
  const revisionSize = /^sha256:(\d+)x(\d+):/.exec(scope.revision);
  if (!revisionSize) return null;
  const atlasWidth = Number(revisionSize[1]);
  const atlasHeight = Number(revisionSize[2]);
  if (!Number.isSafeInteger(atlasWidth) || atlasWidth <= 0 ||
      !Number.isSafeInteger(atlasHeight) || atlasHeight <= 0 ||
      right > atlasWidth || bottom > atlasHeight) return null;
  return {
    capability: "get_texture" as const,
    args: {
      texture: scope.texture_uuid,
      region: {x:left,y:top,width,height},
      expected_revision: scope.revision,
    },
    source: "CURRENT_TEXTURE_VERIFICATION_SCOPE" as const,
    automatic_call: false as const,
    authorizes_visual_pass: false as const,
  };
}
