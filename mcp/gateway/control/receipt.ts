import { getCapabilityMetadata } from "../../lib/capabilities/metadata";
import {
  resolveGatewayCapabilityEffects,
  type GatewayEffectApplication,
} from "../capabilities/effects";
import type { BlockitAuthoringPhaseAffinity } from "../../lib/runtime/affinity";

export function capabilityNeedsPhaseSnapshot(capability: string): boolean {
  return getCapabilityMetadata(capability).effects.phaseAffinity === "update_from_result";
}

export function deriveControlReceipt(
  capability: string,
  structuredContent: unknown,
  succeeded: boolean,
  phaseBefore: BlockitAuthoringPhaseAffinity | null,
  validatedApplication?: GatewayEffectApplication
) {
  // Remote Runtime calls have already validated this receipt at the Backend
  // affinity boundary. Local capability callers use the original path.
  const application = validatedApplication ?? resolveGatewayCapabilityEffects(
    capability,
    structuredContent,
    phaseBefore
  );

  return {
    phaseBefore,
    phaseAfter:
      succeeded && application.effects.phaseAffinity === "update_from_result"
        ? application.authoringPhase
        : phaseBefore,
    projectUuid: succeeded ? application.projectUuid : null,
  };
}