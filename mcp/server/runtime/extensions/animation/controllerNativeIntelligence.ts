/// <reference types="blockbench-types" />

import { z } from "zod";
import { recordCurrentSemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { manageAnimationControllerParameters } from "../../../tools/animation/controllerSchema";
import {
  getAllToolDefinitions,
  invalidateToolRegistrationRuntimeCaches,
} from "@/lib/factories";
import {
  normalizeControllerBlendCurve,
  wouldCreateControllerCompositionCycle,
} from "@/lib/animation/controllerComposition";

type RuntimeAnimationItem = BBAnimation | AnimationController;
type RuntimeControllerLink = {
  uuid: string;
  key: string;
  animation: string;
  blend_value: string | number;
};
type RuntimeControllerState = Omit<AnimationControllerState, "animations"> & {
  animations: RuntimeControllerLink[];
  blend_transition_curve?: Record<string, number>;
};

const blendValueSchema = z.union([
  z.number().finite(),
  z.string().refine((value) => value.trim().length > 0, {
    message: "Controller blend value must contain authored Molang.",
  }),
  z.null(),
]);

const blendCurvePointSchema = z
  .object({
    time: z.number().finite().min(0).max(1),
    value: z.number().finite(),
  })
  .strict();

const setStateBlendSchema = z
  .object({
    op: z.literal("set_state_blend"),
    state: z.string().min(1),
    blend_transition: z.number().finite().min(0).max(10000).optional(),
    blend_via_shortest_path: z.boolean().optional(),
    blend_curve: z
      .union([z.array(blendCurvePointSchema).min(2).max(16), z.null()])
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.blend_transition === undefined &&
      value.blend_via_shortest_path === undefined &&
      value.blend_curve === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "set_state_blend requires at least one authored field.",
      });
    }
  });

const addAnimationItemSchema = z
  .object({
    op: z.literal("add_animation_item"),
    state: z.string().min(1),
    item: z.string().min(1).describe("Animation or AnimationController UUID/name."),
    blend_value: blendValueSchema.optional(),
  })
  .strict();

const updateAnimationItemSchema = z
  .object({
    op: z.literal("update_animation_item"),
    state: z.string().min(1),
    id: z.string().min(1).describe("Existing state animation-link UUID."),
    item: z.string().min(1).optional(),
    blend_value: blendValueSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.item === undefined && value.blend_value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "update_animation_item requires item and/or blend_value.",
      });
    }
  });

const removeAnimationItemSchema = z
  .object({
    op: z.literal("remove_animation_item"),
    state: z.string().min(1),
    id: z.string().min(1).describe("Existing state animation-link UUID."),
  })
  .strict();

export const controllerNativeOperationSchema = z.union([
  setStateBlendSchema,
  addAnimationItemSchema,
  updateAnimationItemSchema,
  removeAnimationItemSchema,
]);

export const animationControllerNativeParameters = z
  .object({
    controller_id: z.string().min(1),
    native_operations: z
      .array(controllerNativeOperationSchema)
      .min(1)
      .max(32)
      .describe("Bounded native nested-controller/blend-curve mutations."),
  })
  .strict();

export const nativeAnimationControllerParameters = z.union([manageAnimationControllerParameters, animationControllerNativeParameters]);

let wired = false;

function definition() {
  const value = getAllToolDefinitions()["manage_animation_controller"];
  if (!value) {
    throw new Error(
      "Animation controller native intelligence requires manage_animation_controller."
    );
  }
  return value;
}

function isController(item: RuntimeAnimationItem): item is AnimationController {
  return (
    typeof AnimationController !== "undefined" &&
    item instanceof AnimationController
  );
}

function items(): RuntimeAnimationItem[] {
  return ((AnimationItem.all ?? []) as unknown as RuntimeAnimationItem[]).slice();
}

function controllers(): AnimationController[] {
  return items().filter(isController);
}

function resolveUnique<T extends { uuid: string; name: string }>(
  values: readonly T[],
  reference: string,
  kind: string
): T {
  const uuid = values.find((value) => value.uuid === reference);
  if (uuid) return uuid;
  const matches = values.filter((value) => value.name === reference);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `${kind} name "${reference}" is ambiguous. Use UUID. Candidates: ${matches
        .map((value) => `${value.name} (${value.uuid})`)
        .join(", ")}`
    );
  }
  throw new Error(`${kind} "${reference}" was not found.`);
}

function resolveController(reference: string): AnimationController {
  return resolveUnique(controllers(), reference, "AnimationController");
}

function resolveState(
  controller: AnimationController,
  reference: string
): RuntimeControllerState {
  return resolveUnique(
    controller.states as RuntimeControllerState[],
    reference,
    "AnimationController state"
  );
}

function resolveItem(
  reference: string,
  ownerUuid: string
): RuntimeAnimationItem {
  const item = resolveUnique(items(), reference, "Animation/AnimationController");
  if (item.uuid === ownerUuid) {
    throw new Error("An AnimationController cannot link itself.");
  }
  return item;
}

function shortName(item: RuntimeAnimationItem): string {
  const value = (
    item as RuntimeAnimationItem & { getShortName?: () => string }
  ).getShortName?.();
  if (!value?.trim()) {
    throw new Error(`Animation item "${item.name}" has no Bedrock short name.`);
  }
  return value;
}

function normalizeBlend(value: string | number | null | undefined): string {
  if (value === undefined || value === null) return "";
  return typeof value === "number"
    ? String(value)
    : value.trim().replace(/\n/g, "");
}

function compositionGraph(): Record<string, string[]> {
  const allControllers = controllers();
  const byUuid = new Set(allControllers.map((controller) => controller.uuid));
  const byShort = new Map<string, string[]>();
  for (const controller of allControllers) {
    const key = shortName(controller);
    byShort.set(key, [...(byShort.get(key) ?? []), controller.uuid]);
  }

  return Object.fromEntries(
    allControllers.map((controller) => {
      const targets = new Set<string>();
      for (const state of controller.states as RuntimeControllerState[]) {
        for (const link of state.animations) {
          if (byUuid.has(link.animation)) targets.add(link.animation);
          for (const uuid of byShort.get(link.key) ?? []) {
            if (uuid !== controller.uuid) targets.add(uuid);
          }
        }
      }
      return [controller.uuid, [...targets]];
    })
  );
}

function requireSafeTarget(
  owner: AnimationController,
  target: RuntimeAnimationItem
): void {
  if (!isController(target)) return;
  if (
    wouldCreateControllerCompositionCycle(
      compositionGraph(),
      owner.uuid,
      target.uuid
    )
  ) {
    throw new Error(
      `Linking "${owner.name}" to "${target.name}" would create a controller cycle.`
    );
  }
}

function cloneLinks(links: readonly RuntimeControllerLink[]): RuntimeControllerLink[] {
  return links.map((link) => ({
    uuid: link.uuid,
    key: link.key,
    animation: link.animation,
    blend_value:
      typeof link.blend_value === "number"
        ? link.blend_value
        : String(link.blend_value ?? ""),
  }));
}

type StatePlan = {
  uuid: string;
  name: string;
  animations: RuntimeControllerLink[];
  blend_transition: number;
  blend_via_shortest_path: boolean;
  blend_transition_curve?: Record<string, number>;
};

function findPlanState(states: readonly StatePlan[], reference: string): StatePlan {
  return resolveUnique(states, reference, "AnimationController state");
}

async function executeNative(
  request: z.infer<typeof animationControllerNativeParameters>
) {
  const controller = resolveController(request.controller_id);
  const plans: StatePlan[] = (
    controller.states as RuntimeControllerState[]
  ).map((state) => ({
    uuid: state.uuid,
    name: state.name,
    animations: cloneLinks(state.animations),
    blend_transition: state.blend_transition || 0,
    blend_via_shortest_path: Boolean(state.blend_via_shortest_path),
    blend_transition_curve: state.blend_transition_curve
      ? { ...state.blend_transition_curve }
      : undefined,
  }));
  const affected = new Set<string>();
  const created: Array<{
    uuid: string;
    state_uuid: string;
    key: string;
    target_uuid: string;
    target_kind: "animation" | "controller";
  }> = [];
  const removed: string[] = [];

  for (const operation of request.native_operations) {
    const state = findPlanState(plans, operation.state);

    if (operation.op === "set_state_blend") {
      const transition = operation.blend_transition ?? state.blend_transition;
      const shortest =
        operation.blend_via_shortest_path ?? state.blend_via_shortest_path;
      const curve =
        operation.blend_curve === undefined
          ? state.blend_transition_curve
          : operation.blend_curve === null
            ? undefined
            : normalizeControllerBlendCurve(operation.blend_curve);
      if (transition <= 0 && curve && Object.keys(curve).length) {
        throw new Error(
          `State "${state.name}" needs positive blend_transition for a blend curve.`
        );
      }
      if (transition <= 0 && shortest) {
        throw new Error(
          `State "${state.name}" needs positive blend_transition for shortest-path blending.`
        );
      }
      if (
        transition === state.blend_transition &&
        shortest === state.blend_via_shortest_path &&
        JSON.stringify(curve ?? null) ===
          JSON.stringify(state.blend_transition_curve ?? null)
      ) {
        throw new Error(`set_state_blend would not change state "${state.name}".`);
      }
      state.blend_transition = transition;
      state.blend_via_shortest_path = shortest;
      state.blend_transition_curve = curve;
      affected.add(state.uuid);
      continue;
    }

    const findLink = (uuid: string) => {
      const link = state.animations.find((value) => value.uuid === uuid);
      if (!link) {
        throw new Error(
          `Animation link "${uuid}" was not found in state "${state.name}".`
        );
      }
      return link;
    };

    if (operation.op === "remove_animation_item") {
      const link = findLink(operation.id);
      state.animations = state.animations.filter(
        (value) => value.uuid !== link.uuid
      );
      removed.push(link.uuid);
      affected.add(state.uuid);
      continue;
    }

    if (operation.op === "add_animation_item") {
      const target = resolveItem(operation.item, controller.uuid);
      requireSafeTarget(controller, target);
      const key = shortName(target);
      if (
        state.animations.some(
          (value) => value.key === key || value.animation === target.uuid
        )
      ) {
        throw new Error(`State "${state.name}" already links "${key}".`);
      }
      const link: RuntimeControllerLink = {
        uuid: guid(),
        key,
        animation: target.uuid,
        blend_value: normalizeBlend(operation.blend_value),
      };
      state.animations.push(link);
      created.push({
        uuid: link.uuid,
        state_uuid: state.uuid,
        key,
        target_uuid: target.uuid,
        target_kind: isController(target) ? "controller" : "animation",
      });
      affected.add(state.uuid);
      continue;
    }

    const link = findLink(operation.id);
    let nextKey = link.key;
    let nextAnimation = link.animation;
    if (operation.item !== undefined) {
      const target = resolveItem(operation.item, controller.uuid);
      requireSafeTarget(controller, target);
      nextKey = shortName(target);
      nextAnimation = target.uuid;
    }
    const nextBlend =
      operation.blend_value === undefined
        ? link.blend_value
        : normalizeBlend(operation.blend_value);
    if (
      nextKey === link.key &&
      nextAnimation === link.animation &&
      nextBlend === link.blend_value
    ) {
      throw new Error(`update_animation_item would not change "${link.uuid}".`);
    }
    if (
      state.animations.some(
        (value) =>
          value.uuid !== link.uuid &&
          (value.key === nextKey || value.animation === nextAnimation)
      )
    ) {
      throw new Error(`State "${state.name}" already links "${nextKey}".`);
    }
    link.key = nextKey;
    link.animation = nextAnimation;
    link.blend_value = nextBlend;
    affected.add(state.uuid);
  }

  Undo.initEdit({ animation_controllers: [controller] });
  try {
    for (const uuid of affected) {
      const plan = findPlanState(plans, uuid);
      const state = resolveState(controller, uuid);
      state.animations = cloneLinks(plan.animations);
      state.blend_transition = plan.blend_transition;
      state.blend_via_shortest_path = plan.blend_via_shortest_path;
      state.blend_transition_curve = plan.blend_transition_curve
        ? { ...plan.blend_transition_curve }
        : undefined;
    }
    Undo.finishEdit("Change native animation controller composition");
    recordCurrentSemanticHistoryEffect(["ANIMATION_CONTROLLER"]);
  } catch (error) {
    Undo.cancelEdit(true);
    Animator.preview();
    throw error;
  }
  Animator.preview();

  return {
    content: [
      {
        type: "text" as const,
        text: `Applied ${request.native_operations.length} native controller operation(s) to "${controller.name}" across ${affected.size} state(s).`,
      },
    ],
    structuredContent: {
      execution: "applied" as const,
      action: "native_operations" as const,
      controller: { uuid: controller.uuid, name: controller.name },
      operation_count: request.native_operations.length,
      affected_state_uuids: [...affected],
      created_links: created,
      removed_links: removed,
    },
  };
}

export function wireAnimationControllerNativeIntelligence(): void {
  if (wired) return;
  const tool = definition();
  const originalExecute = tool.execute.bind(tool);
  const operations = tool.inputSchema.operations as z.ZodTypeAny | undefined;

  tool.parameterSchema = nativeAnimationControllerParameters;
  tool.inputSchema = {
    ...tool.inputSchema,
    ...(operations ? { operations: operations.optional() } : {}),
    native_operations: z
      .array(controllerNativeOperationSchema)
      .min(1)
      .max(32)
      .optional()
      .describe("Native nested-controller/blend-curve branch; use instead of operations."),
  };
  tool.execute = async (args, context) => {
    if (args.native_operations !== undefined) {
      return executeNative(animationControllerNativeParameters.parse(args));
    }
    return originalExecute(args, context);
  };

  wired = true;
  invalidateToolRegistrationRuntimeCaches();
}