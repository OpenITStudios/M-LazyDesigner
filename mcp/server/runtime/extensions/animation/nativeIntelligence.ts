/// <reference types="three" />
/// <reference types="blockbench-types" />

import { z } from "zod";
import { recordCurrentSemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { optimizedAnimationTimelineParameters } from "../../animationRuntimeContracts";
import {
  getAllToolDefinitions,
  invalidateToolRegistrationRuntimeCaches,
} from "@/lib/factories";
import { resolveCoreAnimation, resolveCoreGroup } from "@/lib/core/identity";
import { loopModeEnum } from "@/lib/schemas/animation";
import { animationIdOptionalSchema } from "@/lib/schemas/ids";
import {
  analyzeAnimationMolangExpressions,
  type AnimationMolangExpressionInput,
} from "@/lib/animation/molangSemantics";
import {
  analyzeAnimationMotionDynamics,
  type AnimationMotionTrackInput,
} from "@/lib/animation/motionDynamics";
import { captureNativeIkBakeReadiness } from "@/server/tools/animation/ikBakeNativeSamples";

type JsonRecord = Record<string, unknown>;
type RuntimeAnimationItem = BBAnimation | AnimationController;

const authoredMolangValueSchema = z.union([
  z.number().finite(),
  z
    .string()
    .refine((value) => value.trim().replace(/\n/g, "").length > 0, {
      message: "Molang text must contain a non-whitespace authored value.",
    }),
  z.null(),
]);

const rotationSpaceSchema = z
  .object({
    bone_name: z.string().min(1).describe("Group UUID or unique Group name."),
    relative_to: z
      .enum(["parent", "entity"])
      .describe("Bedrock rotation space. entity exports relative_to.rotation=entity."),
  })
  .strict();

export const animationNativePropertiesParameters = z
  .object({
    operation: z.literal("properties"),
    animation_id: animationIdOptionalSchema,
    length: z.number().finite().min(0).max(10000).optional(),
    fps: z.number().finite().min(10).max(500).optional(),
    loop_mode: loopModeEnum.optional(),
    anim_time_update: authoredMolangValueSchema.optional(),
    blend_weight: authoredMolangValueSchema.optional(),
    start_delay: authoredMolangValueSchema.optional(),
    loop_delay: authoredMolangValueSchema.optional(),
    override_previous_animation: z.boolean().optional(),
    rotation_spaces: z
      .array(rotationSpaceSchema)
      .min(1)
      .max(32)
      .optional()
      .describe("Bounded per-bone Bedrock rotation-space updates."),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasChange =
      value.length !== undefined ||
      value.fps !== undefined ||
      value.loop_mode !== undefined ||
      value.anim_time_update !== undefined ||
      value.blend_weight !== undefined ||
      value.start_delay !== undefined ||
      value.loop_delay !== undefined ||
      value.override_previous_animation !== undefined ||
      value.rotation_spaces !== undefined;
    if (!hasChange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "properties requires at least one authored property change.",
      });
    }
  });

export const completeAnimationTimelineParameters = z.union([optimizedAnimationTimelineParameters, animationNativePropertiesParameters]);

let animationNativeIntelligenceWired = false;

function objectRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function runtimeDefinition(name: string) {
  const definition = getAllToolDefinitions()[name];
  if (!definition) {
    throw new Error(`Animation runtime augmentation requires ${name}.`);
  }
  return definition;
}

function isAnimationControllerRuntime(
  item: RuntimeAnimationItem
): item is AnimationController {
  return (
    typeof AnimationController !== "undefined" &&
    item instanceof AnimationController
  );
}

function normalizeMolangStorage(
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\n/g, "");
}

function resolveRotationSpaces(
  animation: BBAnimation,
  updates: readonly z.infer<typeof rotationSpaceSchema>[]
) {
  const seen = new Set<string>();
  return updates.map((update) => {
    const group = resolveCoreGroup(
      update.bone_name,
      "Use inspect_elements(mode=outline) to confirm the intended Group UUID."
    );
    if (seen.has(group.uuid)) {
      throw new Error(
        `rotation_spaces resolves more than one entry to Group "${group.name}" (${group.uuid}).`
      );
    }
    seen.add(group.uuid);
    const animator = animation.animators[group.uuid];
    if (!(animator instanceof BoneAnimator)) {
      throw new Error(
        `Animation "${animation.name}" has no BoneAnimator for "${group.name}" (${group.uuid}); author at least one channel for that bone before setting rotation space.`
      );
    }
    return { update, group, animator };
  });
}

async function executeNativeProperties(
  request: z.infer<typeof animationNativePropertiesParameters>
) {
  const animation = resolveCoreAnimation(request.animation_id, {
    allowSelected: true,
    notFoundHint: "Pass an exact Animation UUID or unique exact Animation name.",
  });
  const native = animation as BBAnimation & {
    anim_time_update?: string | number;
    blend_weight?: string | number;
    start_delay?: string | number;
    loop_delay?: string | number;
    override?: boolean;
  };
  const rotationUpdates = resolveRotationSpaces(
    animation,
    request.rotation_spaces ?? []
  );
  const changedFields: string[] = [];
  const nextMolang: Partial<
    Record<
      "anim_time_update" | "blend_weight" | "start_delay" | "loop_delay",
      string
    >
  > = {};

  for (const property of [
    "anim_time_update",
    "blend_weight",
    "start_delay",
    "loop_delay",
  ] as const) {
    if (request[property] === undefined) continue;
    const next = normalizeMolangStorage(request[property]);
    nextMolang[property] = next;
    if (normalizeMolangStorage(native[property]) !== next) {
      changedFields.push(property);
    }
  }

  if (request.length !== undefined && request.length !== animation.length) {
    changedFields.push("length");
  }
  if (request.fps !== undefined && request.fps !== animation.snapping) {
    changedFields.push("fps");
  }
  if (request.loop_mode !== undefined && request.loop_mode !== animation.loop) {
    changedFields.push("loop_mode");
  }
  if (
    request.override_previous_animation !== undefined &&
    request.override_previous_animation !== Boolean(native.override)
  ) {
    changedFields.push("override_previous_animation");
  }

  for (const { update, group, animator } of rotationUpdates) {
    const next = update.relative_to === "entity";
    if (
      Boolean(
        (animator as BoneAnimator & { rotation_global?: boolean }).rotation_global
      ) !== next
    ) {
      changedFields.push(`rotation_space:${group.name}`);
    }
  }

  if (changedFields.length === 0) {
    throw new Error(
      `properties would not change animation "${animation.name}".`
    );
  }

  Undo.initEdit({ animations: [animation] });
  try {
    if (request.length !== undefined && request.length !== animation.length) {
      animation.setLength(request.length);
    }
    if (request.fps !== undefined && request.fps !== animation.snapping) {
      animation.extend({ snapping: request.fps });
      Timeline.setTimecode(Timeline.time);
    }
    if (
      request.loop_mode !== undefined &&
      request.loop_mode !== animation.loop
    ) {
      animation.setLoop(request.loop_mode, false);
    }
    for (const [property, value] of Object.entries(nextMolang)) {
      animation.extend({ [property]: value });
    }
    if (request.override_previous_animation !== undefined) {
      animation.extend({ override: request.override_previous_animation });
    }
    for (const { update, animator } of rotationUpdates) {
      (animator as BoneAnimator & { rotation_global?: boolean }).rotation_global =
        update.relative_to === "entity";
    }
    Undo.finishEdit("Change Bedrock animation properties");
    recordCurrentSemanticHistoryEffect(["ANIMATION_MOTION"]);
  } catch (error) {
    Undo.cancelEdit(true);
    Animator.preview();
    throw error;
  }

  Animator.preview();

  const entityRelativeBones = rotationUpdates
    .filter(({ animator }) =>
      Boolean(
        (animator as BoneAnimator & { rotation_global?: boolean }).rotation_global
      )
    )
    .map(({ group }) => ({ uuid: group.uuid, name: group.name }));

  return {
    content: [
      {
        type: "text" as const,
        text: `Updated ${changedFields.length} Bedrock animation property field(s) for "${animation.name}".`,
      },
    ],
    structuredContent: {
      action: "properties" as const,
      animation: { uuid: animation.uuid, name: animation.name },
      changed_fields: changedFields,
      native_properties: {
        length: animation.length,
        snapping: animation.snapping,
        loop: animation.loop,
        anim_time_update: normalizeMolangStorage(native.anim_time_update) || null,
        blend_weight: normalizeMolangStorage(native.blend_weight) || null,
        start_delay: normalizeMolangStorage(native.start_delay) || null,
        loop_delay: normalizeMolangStorage(native.loop_delay) || null,
        override_previous_animation: Boolean(native.override),
        entity_relative_rotation_bones: entityRelativeBones,
      },
    },
  };
}

function pushExpression(
  target: AnimationMolangExpressionInput[],
  source: string,
  value: unknown,
  expectsValue = true
): void {
  if (typeof value !== "string" || !value.trim()) return;
  target.push({ source, expression: value, expects_value: expectsValue });
}

function collectAnimationExpressions(
  item: RuntimeAnimationItem
): AnimationMolangExpressionInput[] {
  const expressions: AnimationMolangExpressionInput[] = [];

  if (isAnimationControllerRuntime(item)) {
    for (const state of item.states) {
      pushExpression(expressions, `state:${state.name}:on_entry`, state.on_entry, false);
      pushExpression(expressions, `state:${state.name}:on_exit`, state.on_exit, false);
      for (const transition of state.transitions) {
        pushExpression(
          expressions,
          `state:${state.name}:transition`,
          transition.condition,
          true
        );
      }
      for (const link of state.animations) {
        pushExpression(
          expressions,
          `state:${state.name}:blend`,
          link.blend_value,
          true
        );
      }
      for (const particle of state.particles) {
        pushExpression(
          expressions,
          `state:${state.name}:particle`,
          particle.pre_effect_script,
          false
        );
      }
    }
    return expressions;
  }

  const native = item as BBAnimation & {
    anim_time_update?: string | number;
    blend_weight?: string | number;
    start_delay?: string | number;
    loop_delay?: string | number;
  };
  for (const property of [
    "anim_time_update",
    "blend_weight",
    "start_delay",
    "loop_delay",
  ] as const) {
    pushExpression(expressions, `animation:${property}`, native[property], true);
  }

  for (const animator of Object.values(item.animators ?? {})) {
    if (animator instanceof BoneAnimator) {
      for (const channel of ["rotation", "position", "scale"] as const) {
        for (const keyframe of ((animator[channel] as BBKeyframe[] | undefined) ?? [])) {
          keyframe.data_points.forEach((_, pointIndex) => {
            for (const value of keyframe.getArray(pointIndex)) {
              pushExpression(
                expressions,
                `${animator.name}:${channel}@${keyframe.time}`,
                value,
                true
              );
            }
          });
        }
      }
      continue;
    }

    if (
      typeof EffectAnimator !== "undefined" &&
      animator instanceof EffectAnimator
    ) {
      for (const channel of ["particle", "timeline"] as const) {
        for (const keyframe of ((animator[channel] as BBKeyframe[] | undefined) ?? [])) {
          for (const point of keyframe.data_points) {
            pushExpression(
              expressions,
              `effect:${channel}@${keyframe.time}`,
              (point as KeyframeDataPoint & { script?: string }).script,
              false
            );
          }
        }
      }
    }
  }
  return expressions;
}

function resolveRuntimeItem(
  structuredContent: JsonRecord
): RuntimeAnimationItem | null {
  if (typeof AnimationItem === "undefined") return null;
  const info =
    objectRecord(structuredContent.animation) ??
    objectRecord(structuredContent.controller);
  const uuid = typeof info?.uuid === "string" ? info.uuid : null;
  if (!uuid) return null;
  return (
    ((AnimationItem.all ?? []) as unknown as RuntimeAnimationItem[]).find(
      (item) => item.uuid === uuid
    ) ?? null
  );
}

function nativePropertySummary(item: RuntimeAnimationItem) {
  if (isAnimationControllerRuntime(item)) {
    return {
      state: "not_applicable" as const,
      reason: "animation_controller" as const,
    };
  }

  const native = item as BBAnimation & {
    anim_time_update?: string | number;
    blend_weight?: string | number;
    start_delay?: string | number;
    loop_delay?: string | number;
    override?: boolean;
  };
  const entityRelative: Array<{ uuid: string; name: string }> = [];
  for (const animator of Object.values(item.animators ?? {})) {
    if (!(animator instanceof BoneAnimator)) continue;
    if (
      !(animator as BoneAnimator & { rotation_global?: boolean }).rotation_global
    ) {
      continue;
    }
    const group =
      typeof Group !== "undefined"
        ? Group.all.find((candidate: Group) => candidate.uuid === animator.uuid)
        : undefined;
    entityRelative.push({
      uuid: animator.uuid,
      name: group?.name ?? animator.name,
    });
  }

  return {
    state: "available" as const,
    loop: item.loop,
    length: item.length,
    snapping: item.snapping,
    anim_time_update: normalizeMolangStorage(native.anim_time_update) || null,
    blend_weight: normalizeMolangStorage(native.blend_weight) || null,
    start_delay: normalizeMolangStorage(native.start_delay) || null,
    loop_delay: normalizeMolangStorage(native.loop_delay) || null,
    override_previous_animation: Boolean(native.override),
    entity_relative_rotation_count: entityRelative.length,
    entity_relative_rotation_bones: entityRelative.slice(0, 8),
    entity_relative_rotation_bones_truncated: entityRelative.length > 8,
  };
}

function motionDynamicsRuntime(item: RuntimeAnimationItem) {
  if (
    isAnimationControllerRuntime(item) ||
    typeof BoneAnimator === "undefined" ||
    typeof Group === "undefined"
  ) {
    return {
      state: "unavailable" as const,
      reason: isAnimationControllerRuntime(item)
        ? ("animation_controller" as const)
        : ("authored_animation_runtime_unavailable" as const),
    };
  }

  const tracks: AnimationMotionTrackInput[] = [];
  for (const animator of Object.values(item.animators ?? {})) {
    if (!(animator instanceof BoneAnimator)) continue;
    const group = Group.all.find(
      (candidate: Group) => candidate.uuid === animator.uuid
    );
    for (const channel of ["position", "rotation", "scale"] as const) {
      const keyframes = ((animator[channel] as BBKeyframe[] | undefined) ?? []).map(
        (keyframe) => {
          const dataPointCount = Array.isArray(keyframe.data_points)
            ? keyframe.data_points.length : 0;
          return {
            time: keyframe.time,
            data_point_count: dataPointCount,
            // No fabricated first-point curve for pre/post or absent data.
            value: dataPointCount === 1 ? keyframe.getArray(0) as unknown[] : [],
          };
        }
      );
      if (!keyframes.length) continue;
      tracks.push({
        group_uuid: animator.uuid,
        group_name: group?.name ?? animator.name,
        channel,
        keyframes,
      });
    }
  }
  return analyzeAnimationMotionDynamics({
    loop_mode: String(item.loop),
    tracks,
  });
}

function clientEntityWiringRuntime(
  item: RuntimeAnimationItem,
  variableDependencies: readonly string[]
) {
  if (typeof Project === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "blockbench_project_runtime_unavailable" as const,
    };
  }

  const manager = (
    Project as unknown as {
      BedrockEntityManager?: {
        client_entity?: unknown;
      };
    }
  ).BedrockEntityManager;
  const clientEntity = objectRecord(manager?.client_entity);
  const description = objectRecord(clientEntity?.description);
  if (!description) {
    return {
      state: "unavailable" as const,
      reason: "client_entity_not_loaded" as const,
    };
  }

  const mappings = objectRecord(description.animations) ?? {};
  const aliases = Object.entries(mappings)
    .filter(([, value]) => value === item.name)
    .map(([key]) => key)
    .sort();

  const scripts = objectRecord(description.scripts) ?? {};
  const animate = Array.isArray(scripts.animate) ? scripts.animate : [];
  const rootRefs = animate.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const record = objectRecord(entry);
    return record ? Object.keys(record) : [];
  });
  const preAnimation = Array.isArray(scripts.pre_animation)
    ? scripts.pre_animation.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : typeof scripts.pre_animation === "string"
      ? [scripts.pre_animation]
      : [];

  const assigned = new Set<string>();
  const assignmentPattern = /\b(v|variable)\.([a-z_][a-z0-9_]*)\s*=/gi;
  for (const line of preAnimation) {
    for (const match of line.matchAll(assignmentPattern)) {
      assigned.add(`variable.${match[2].toLowerCase()}`);
    }
  }

  const directRoot = aliases.filter((alias) => rootRefs.includes(alias));
  const unresolvedVariableCandidates = variableDependencies
    .filter((name) => !assigned.has(name))
    .slice(0, 12);

  return {
    state: "available" as const,
    mapping_aliases: aliases.slice(0, 12),
    mapping_aliases_truncated: aliases.length > 12,
    scripts_animate_count: animate.length,
    direct_root_matches: directRoot.slice(0, 12),
    pre_animation_statement_count: preAnimation.length,
    pre_animation_assigned_variables: [...assigned].sort().slice(0, 12),
    unresolved_variable_candidates: unresolvedVariableCandidates,
    note:
      "This is loaded client-entity wiring evidence only. A clip can be valid when reached indirectly through a controller; variables may also be authored outside pre_animation.",
  };
}

function wireTimelineNativeProperties(): void {
  const definition = runtimeDefinition("manage_animation_timeline");
  const originalExecute = definition.execute.bind(definition);
  definition.parameterSchema = completeAnimationTimelineParameters;
  definition.inputSchema = {
    ...definition.inputSchema,
    operation: z
      .enum([
        "keyframes",
        "graph",
        "timeline",
        "batch",
        "copy_paste",
        "properties",
      ])
      .describe("Animation timeline/native-property branch."),
    anim_time_update: authoredMolangValueSchema.optional(),
    blend_weight: authoredMolangValueSchema.optional(),
    start_delay: authoredMolangValueSchema.optional(),
    loop_delay: authoredMolangValueSchema.optional(),
    override_previous_animation: z.boolean().optional(),
    rotation_spaces: z.array(rotationSpaceSchema).min(1).max(32).optional(),
  };
  definition.execute = async (args, context) => {
    if (args.operation === "properties") {
      return executeNativeProperties(
        animationNativePropertiesParameters.parse(args)
      );
    }
    return originalExecute(args, context);
  };
}


function wireInspectDiagnostics(): void {
  const definition = runtimeDefinition("inspect_animation");
  const originalExecute = definition.execute.bind(definition);
  definition.execute = async (args, context) => {
    const result = await originalExecute(args, context);
    if (args.diagnostics !== true) return result;

    const record = objectRecord(result);
    const structured = record ? objectRecord(record.structuredContent) : null;
    if (!record || !structured) return result;

    const item = resolveRuntimeItem(structured);
    if (!item) return result;

    const molang = analyzeAnimationMolangExpressions(
      collectAnimationExpressions(item)
    );
    return {
      ...record,
      structuredContent: {
        ...structured,
        native_properties: nativePropertySummary(item),
        native_ik_bake_source: isAnimationControllerRuntime(item)
          ? { state: "not_applicable" as const, reason: "animation_controller" as const }
          : captureNativeIkBakeReadiness(item),
        molang_analysis: molang,
        motion_dynamics: motionDynamicsRuntime(item),
        client_entity_wiring: clientEntityWiringRuntime(
          item,
          molang.dependencies.variable
        ),
        diagnostics_cost: {
          extra_tool_calls: 0,
          catalog_expansion: 0,
        },
      },
    } as typeof result;
  };
}

/**
 * Extends the existing Animation surface without adding MCP tools.
 * Native property authoring is one batched Undo operation; rich analysis is
 * piggy-backed only on inspect_animation(diagnostics=true).
 */
export function wireAnimationNativeIntelligence(): void {
  if (animationNativeIntelligenceWired) return;
  wireTimelineNativeProperties();
  wireInspectDiagnostics();
  animationNativeIntelligenceWired = true;
  invalidateToolRegistrationRuntimeCaches();
}