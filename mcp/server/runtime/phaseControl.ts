import { z } from "zod";
import {
  phaseTransitionReceipt,
  phaseTransitionReceiptSchema,
} from "@/lib/receipts/authorityTransition";
import { createTool } from "@/lib/factories";
import {
  getActiveMcpAuthoringStage,
  getMcpRuntimeSurface,
  type McpAuthoringStage,
} from "@/lib/capabilities/authoringStage";
import {
  ANIMATION_HANDOFF_READINESS_RULE,
  animationHandoffReadinessSchema,
  assertAnimationCheckpointCurrent,
  summarizeAnimationHandoffReadiness,
} from "@/lib/authoring/authoringReadiness";

let stageSwitchHandler:
  | ((stage: McpAuthoringStage) => void)
  | undefined;

// Tool calls are serialized by Runtime's native operation queue. Only a
// Gateway affinity header scopes the current call; direct Runtime clients
// continue using the Blockbench-global Stage. No second Stage registry.
let requestStage: { stage: McpAuthoringStage; scoped: boolean } | null = null;

/** Must be called INSIDE runRuntimeOperationExclusive, never on /health or tools/list. */
export async function runWithMcpStageRequest<T>(
  stage: McpAuthoringStage,
  scoped: boolean,
  operation: () => Promise<T>
): Promise<T> {
  const prior = requestStage;
  requestStage = { stage, scoped };
  try {
    return await operation();
  } finally {
    requestStage = prior;
  }
}

export function setMcpStageSwitchHandler(
  handler: ((stage: McpAuthoringStage) => void) | undefined
): void {
  stageSwitchHandler = handler;
}

export function requestMcpStageSwitch(stage: McpAuthoringStage): void {
  if (!stageSwitchHandler) {
    throw new Error("Runtime Stage/Surface switching is unavailable; reload LazyDesigner.");
  }
  stageSwitchHandler(stage);
}

export const phaseControlOutputSchema = phaseTransitionReceiptSchema;

export const phaseControlToolDocs = {
  name: "switch_authoring_phase",
  description:
    `Changes the Authoring Stage in the same task. Geometry↔Texturing stays on the shared AUTHORING Runtime Surface; AUTHORING↔Animation is the only Runtime Surface handoff. ${ANIMATION_HANDOFF_READINESS_RULE}`,
  parameters: z.object({
    target_phase: z.enum(["geometry", "texturing", "animation"]),
    reason: z.string().min(1),
    resume_from: z.string().min(1),
    readiness: animationHandoffReadinessSchema.optional(),
  }).refine(value => value.target_phase !== "animation" || value.readiness !== undefined, {
    message:
      "Animation handoff requires user-approved or authorized-autonomous readiness, UV Layout PASS, and a saved checkpoint.",
    path: ["readiness"],
  }),
  status: "stable" as const,
};

export function registerPhaseControlTool(): void {
  createTool(
    "switch_authoring_phase",
    {
      ...phaseControlToolDocs,
      outputSchema: phaseControlOutputSchema,
      async execute({ target_phase, reason, resume_from, readiness }) {
        if (!stageSwitchHandler) {
          throw new Error("Runtime Stage/Surface switching is unavailable; reload LazyDesigner.");
        }
        const previousStage = requestStage?.scoped
          ? requestStage.stage
          : getActiveMcpAuthoringStage();
        const previousSurface = getMcpRuntimeSurface(previousStage);
        const targetSurface = getMcpRuntimeSurface(target_phase);
        const surfaceChanged = previousSurface !== targetSurface;
        const readinessSummary = readiness
          ? summarizeAnimationHandoffReadiness(readiness)
          : null;
        let nativeCheckpointChecked = false;

        // Verify actual saved-project state, not only caller-supplied flags.
        // One native stat at AUTHORING→Animation; other stages incur no I/O.
        if (target_phase === "animation" && previousSurface !== targetSurface) {
          if (!readiness) throw new Error("Animation readiness is required.");
          const project = typeof Project === "undefined" ? null : Project;
          const format = typeof Format === "undefined"
            ? null : (Format as { id?: string } | null);
          assertAnimationCheckpointCurrent(readiness, project, format?.id, (checkpoint) => {
            // @ts-ignore - Blockbench permission-scoped native module.
            const fs = requireNativeModule("fs", {
              message: "LazyDesigner verifies the saved .bbmodel before Animation.",
              optional: false,
            }) as Pick<typeof import("node:fs"), "statSync"> | null;
            if (!fs) throw new Error("Native checkpoint filesystem access unavailable.");
            return fs.statSync(checkpoint);
          });
          nativeCheckpointChecked = true;
        }

        // An affinity-scoped Gateway owns its own Stage and will adopt this
        // receipt before its next request. Changing the Blockbench-global
        // Stage here would silently change direct clients and other Gateways.
        // Direct Runtime requests retain the existing native Stage mutation.
        if (!requestStage?.scoped) requestMcpStageSwitch(target_phase);

        return {
          content: [
            {
              type: "text" as const,
              text: nativeCheckpointChecked
                ? `Authoring Stage switched to ${target_phase}; Runtime Surface is ${targetSurface}. Saved-project path and file metadata checked; approval and authorization are caller-declared, not independently verified. Continue through Gateway.`
                : `Authoring Stage switched to ${target_phase}; Runtime Surface is ${targetSurface}. Continue this task through Gateway.`,
            },
          ],
          structuredContent: phaseTransitionReceipt({
            phase: target_phase,
            runtime_surface: targetSurface,
            reason,
            resume_from,
            readiness,
            readiness_summary: readinessSummary
              ? {
                  ...readinessSummary,
                  checkpoint_evidence: nativeCheckpointChecked
                    ? "NATIVE_SAVED_FILE_METADATA_CHECKED"
                    : "NOT_CHECKED",
                }
              : null,
            surface_changed: surfaceChanged,
            reload_required: false,
            action: surfaceChanged
              ? "continue through Gateway in the same task; Runtime surface changes automatically"
              : "continue through Gateway in the same task; shared AUTHORING surface is unchanged",
          }),
        };
      },
    },
    "stable",
    true
  );
}


// Compatibility aliases for the serialized/public phase terminology.
export const setMcpPhaseSwitchHandler = setMcpStageSwitchHandler;
export const requestMcpPhaseSwitch = requestMcpStageSwitch;
