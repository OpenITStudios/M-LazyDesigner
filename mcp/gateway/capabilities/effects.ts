import {
  getCapabilityMetadata,
  type CapabilityEffects,
} from "../../lib/capabilities/metadata";
import type { BlockitAuthoringPhaseAffinity } from "../../lib/runtime/affinity";
import { getMcpRuntimeSurface } from "../../lib/capabilities/authoringStage";
import {
  createProjectReceiptSchema,
  phaseTransitionReceiptSchema,
} from "../../lib/receipts/authorityTransition";

export type GatewayEffectApplication = {
  effects: CapabilityEffects;
  projectUuid: string | null;
  authoringPhase: BlockitAuthoringPhaseAffinity | null;
  surfaceChanged: boolean | null;
  /** Values supplied by the original Runtime receipt, never Gateway guesses. */
  reportedRuntimeSurface: string | null;
  reportedSurfaceChanged: boolean | null;
};

export type GatewayEffectReceiptIssue = {
  code:
    | "MISSING_PROJECT_UUID"
    | "MISSING_AUTHORING_PHASE"
    | "RUNTIME_SURFACE_MISMATCH"
    | "SURFACE_CHANGE_MISMATCH"
    | "AUTHORING_TARGET_MISMATCH";
  message: string;
};

function createdProjectUuid(value: unknown): string | null {
  const parsed = createProjectReceiptSchema.safeParse(value);
  return parsed.success ? parsed.data.project.uuid : null;
}

function resultAuthoringPhase(value: unknown): {
  phase: BlockitAuthoringPhaseAffinity;
  runtimeSurface: string;
  surfaceChanged: boolean;
} | null {
  const parsed = phaseTransitionReceiptSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    phase: parsed.data.phase,
    runtimeSurface: parsed.data.runtime_surface,
    surfaceChanged: parsed.data.surface_changed,
  };
}

export function resolveGatewayCapabilityEffects(
  capability: string,
  structuredContent: unknown,
  previousPhase: BlockitAuthoringPhaseAffinity | null
): GatewayEffectApplication {
  const effects = getCapabilityMetadata(capability).effects;
  const projectUuid = effects.projectAffinity === "adopt_created_project"
    ? createdProjectUuid(structuredContent)
    : null;
  const phaseReceipt = effects.phaseAffinity === "update_from_result"
    ? resultAuthoringPhase(structuredContent)
    : null;
  const authoringPhase = phaseReceipt?.phase ?? null;
  const surfaceChanged = authoringPhase
    ? previousPhase === null
      ? phaseReceipt!.surfaceChanged
      : getMcpRuntimeSurface(previousPhase) !== getMcpRuntimeSurface(authoringPhase)
    : null;

  return {
    effects,
    projectUuid,
    authoringPhase,
    surfaceChanged,
    reportedRuntimeSurface: phaseReceipt?.runtimeSurface ?? null,
    reportedSurfaceChanged: phaseReceipt?.surfaceChanged ?? null,
  };
}


export function validateGatewayCapabilityEffectReceipt(
  application: GatewayEffectApplication,
  succeeded: boolean,
  requestedArgs?: Readonly<Record<string, unknown>>
): GatewayEffectReceiptIssue | null {
  if (!succeeded) return null;

  if (
    application.effects.projectAffinity === "adopt_created_project" &&
    !application.projectUuid
  ) {
    return {
      code: "MISSING_PROJECT_UUID",
      message:
        "LazyDesigner Runtime returned a successful project-creation result without the project UUID required by Gateway affinity metadata.",
    };
  }

  if (application.effects.phaseAffinity === "update_from_result") {
    if (!application.authoringPhase) {
      return {
        code: "MISSING_AUTHORING_PHASE",
        message:
          "LazyDesigner Runtime returned a successful authoring-phase transition without the phase required by Gateway affinity metadata.",
      };
    }
    // One canonical Stage→Surface owner. A syntactically valid native
    // receipt must not change Gateway affinity on contradictory semantics.
    if (application.reportedRuntimeSurface !==
        getMcpRuntimeSurface(application.authoringPhase)) {
      return {
        code: "RUNTIME_SURFACE_MISMATCH",
        message: "Runtime handoff receipt surface contradicts its authoring Stage.",
      };
    }
    if (application.reportedSurfaceChanged !== application.surfaceChanged) {
      return {
        code: "SURFACE_CHANGE_MISMATCH",
        message: "Runtime handoff receipt surface_changed contradicts the verified Stage transition.",
      };
    }
    // The backend owns the requested target; Control must not trust a
    // different successful Stage merely because its receipt is well-formed.
    if (requestedArgs && requestedArgs.target_phase !== application.authoringPhase) {
      return {
        code: "AUTHORING_TARGET_MISMATCH",
        message: "Runtime handoff receipt Stage does not match the requested target_phase.",
      };
    }
  }

  return null;
}