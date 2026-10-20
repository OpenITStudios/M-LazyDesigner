/// <reference types="blockbench-types" />
import { animationControllerReceipt } from "@/lib/receipts/animationController";
import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { createTool } from "@/lib/factories";
import { resolveUuidOrUniqueName } from "@/lib/core/identity";
import {
  manageAnimationControllerParameters,
  animationControllerToolDocs,
} from "./controllerSchema";
import {
  controllerStateContinuation,
  snapshotController,
  validateFinalControllerPlan,
  type ControllerPlan,
  type ControllerStatePlan,
} from "./controllerState";
import { applyOperationToPlan } from "./controllerPlanner";
export { manageAnimationControllerParameters } from "./controllerSchema";



function requireBedrockControllerProject(): void {
  if (!Project) {
    throw new Error(
      "No project is open. Open the intended Minecraft Bedrock Entity project first."
    );
  }
  const format = Format as { id?: string; animation_controllers?: boolean } | undefined;
  if (format?.id !== "bedrock" || !format.animation_controllers) {
    throw new Error(
      `manage_animation_controller requires a Bedrock Entity project with animation controllers; current format is ${format?.id ?? "unknown"}.`
    );
  }
}

function isAnimationControllerItem(
  item: BBAnimation | AnimationController
): item is AnimationController {
  return (
    typeof AnimationController !== "undefined" &&
    item instanceof AnimationController
  );
}

function currentControllers(): AnimationController[] {
  return ((AnimationItem.all ?? []) as Array<BBAnimation | AnimationController>).filter(
    isAnimationControllerItem
  );
}

function resolveController(reference: string): AnimationController {
  return resolveUuidOrUniqueName(currentControllers(), reference, {
    kind: "AnimationController",
    notFoundHint:
      "Use inspect_animation to confirm the intended controller UUID.",
  });
}

function resolveAuthoredAnimation(reference: string): BBAnimation {
  const items = (AnimationItem.all ?? []) as Array<BBAnimation | AnimationController>;
  const animations = items.filter(
    (item): item is BBAnimation => !isAnimationControllerItem(item)
  );
  return resolveUuidOrUniqueName(animations, reference, {
    kind: "Animation",
    notFoundHint:
      "Pass an exact authored Animation UUID or unique exact Animation name; controller targets are not animation links.",
  });
}

function ensureControllerNameAvailable(
  requestedName: string,
  path: string,
  excludeUuid?: string
): void {
  const collision = currentControllers().find(
    (candidate) =>
      candidate.uuid !== excludeUuid &&
      (candidate.path || "") === path &&
      candidate.name === requestedName
  );
  if (collision) {
    throw new Error(
      `AnimationController name "${requestedName}" already exists for the same file scope (${collision.uuid}). Use a unique exact name.`
    );
  }
}

export function registerAnimationControllerTools(): void {
  createTool(
    animationControllerToolDocs[0].name,
    {
      ...animationControllerToolDocs[0],
      parameters: manageAnimationControllerParameters,
      async execute({ controller_id, create_name, operations }) {
        requireBedrockControllerProject();

        const creating = create_name !== undefined;
        const existingController = controller_id
          ? resolveController(controller_id)
          : undefined;
        if (create_name) {
          ensureControllerNameAvailable(create_name, "");
        }

        const plan: ControllerPlan = existingController
          ? snapshotController(existingController)
          : {
              uuid: undefined,
              name: create_name!,
              path: "",
              initial_state: "",
              states: [],
            };
        const affectedStateUuids = new Set<string>();
        const created = {
          states: [] as Array<{ uuid: string; name: string }>,
          transitions: [] as Array<{ uuid: string; state_uuid: string; target_uuid: string }>,
          animation_links: [] as Array<{ uuid: string; state_uuid: string; animation_key: string; animation_uuid: string | null }>,
          sounds: [] as Array<{ uuid: string; state_uuid: string; effect: string }>,
          particles: [] as Array<{ uuid: string; state_uuid: string; effect: string }>,
        };
        const removed = {
          states: [] as Array<{ uuid: string; name: string }>,
          transitions: [] as string[],
          animation_links: [] as string[],
          sounds: [] as string[],
          particles: [] as string[],
        };

        for (const operation of operations) {
          applyOperationToPlan(
            plan,
            operation,
            affectedStateUuids,
            created,
            removed,
            {
              createId: () => guid(),
              resolveAnimation: resolveAuthoredAnimation,
              ensureControllerNameAvailable,
            }
          );
        }
        validateFinalControllerPlan(plan);

        const controller =
          existingController ?? new AnimationController({ name: plan.name });

        let editOpen = false;
        try {
          if (creating) {
            Undo.initEdit({ animation_controllers: [] });
          } else {
            Undo.initEdit({ animation_controllers: [controller] });
          }
          editOpen = true;

          (
            controller.extend as (data: {
              name?: string;
              states?: ControllerStatePlan[];
              initial_state?: string;
            }) => AnimationController
          )({
            name: plan.name,
            states: plan.states,
            initial_state: plan.initial_state,
          });
          if (
            controller.selected_state &&
            !plan.states.some(
              (state) => state.uuid === controller.selected_state?.uuid
            )
          ) {
            controller.selected_state = null;
          }
          if (creating) {
            controller.saved = false;
            controller.add(false);
            Undo.finishEdit("Create animation controller", {
              animation_controllers: [controller],
            });
            recordCurrentCapabilitySemanticHistoryEffect("manage_animation_controller");
          } else {
            Undo.finishEdit("Manage animation controller");
            recordCurrentCapabilitySemanticHistoryEffect("manage_animation_controller");
          }
          editOpen = false;
        } catch (error) {
          if (editOpen) Undo.cancelEdit(true);
          throw error;
        }

        const finalPlan = snapshotController(controller);
        const initial = finalPlan.states.find(
          (state) => state.uuid === finalPlan.initial_state
        );
        const result = animationControllerReceipt({
          execution: "applied",
          action: creating ? "created" : "updated",
          operation_count: operations.length,
          controller: {
            uuid: controller.uuid,
            name: controller.name,
            initial_state: initial
              ? { uuid: initial.uuid, name: initial.name }
              : null,
            state_count: finalPlan.states.length,
          },
          affected_states: finalPlan.states
            .filter((state) => affectedStateUuids.has(state.uuid))
            .map(controllerStateContinuation),
          created,
          removed,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `${creating ? "Created" : "Updated"} controller "${finalPlan.name}" (${controller.uuid}); ${operations.length} operation(s) applied across ${affectedStateUuids.size} state(s).`,
            },
          ],
          structuredContent: result,
        };
      },
    },
    animationControllerToolDocs[0].status
  );
}