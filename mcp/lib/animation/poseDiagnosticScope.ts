import type { VisualEvidenceTarget } from "@/lib/reference/visualEvidence";

/** Evidence routing only. Skipped optional samplers never produce PASS. */
export type NativePoseDiagnosticRoute = Readonly<{
  mode:"NOT_REQUESTED"|"UNSCOPED_LEGACY"|"TARGETED";
  geometry:boolean;locators:boolean;joints:boolean;
  reason:string;visual_verdict:"NOT_EVALUATED";
}>;
const geometryClaims=new Set<VisualEvidenceTarget>([
  "attachment","negative_space","layering","orientation","depth","rear_topology","underside"
]);
const locatorClaims=new Set<VisualEvidenceTarget>(["attachment"]);
/**
 * Pure selector for preexisting Animation Runtime readers. A request with
 * explicit views but no evidence_targets intentionally retains legacy full
 * native coverage. Appearance-only targets skip unneeded optional scanners.
 */
export function selectNativePoseDiagnosticRoute(
  poseCount:number,targets:readonly VisualEvidenceTarget[]|undefined
):NativePoseDiagnosticRoute {
  if(!Number.isInteger(poseCount)||poseCount<1||poseCount>5)
    throw new Error("NATIVE_POSE_DIAGNOSTIC_SAMPLE_COUNT_INVALID");
  const base={visual_verdict:"NOT_EVALUATED" as const};
  if(poseCount<2)return {...base,mode:"NOT_REQUESTED",geometry:false,
    locators:false,joints:false,reason:"ONE_POSE_NO_TRAJECTORY"} as const;
  if(!targets?.length)return {...base,mode:"UNSCOPED_LEGACY",geometry:true,
    locators:true,joints:true,reason:"UNSCOPED_NATIVE_COVERAGE"} as const;
  const geometry=targets.some(target=>geometryClaims.has(target));
  const locators=targets.some(target=>locatorClaims.has(target));
  return {...base,mode:"TARGETED",geometry,locators,joints:locators,
    reason:geometry?"NATIVE_GEOMETRY_RELEVANT":"APPEARANCE_ONLY"} as const;
}
