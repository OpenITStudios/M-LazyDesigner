/// <reference types="blockbench-types" />

import { z } from "zod";
import {
  deriveMirroredRigName,
  hasCaseInsensitiveRigNameCollision,
  wouldCreateRigHierarchyCycle,
} from "@/lib/rig/planning";
export {
  deriveMirroredRigName,
  hasCaseInsensitiveRigNameCollision,
  wouldCreateRigHierarchyCycle,
} from "@/lib/rig/planning";
import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import {
  applyGroupRename,
  planGroupRename,
  type RenameAnimation,
} from "@/lib/geometry/batchGroupRename";
import { supportsNativeIkControllerLinks } from "@/lib/blockbench/nativeFeatureGates";
import { boneRiggingReceipt } from "@/lib/receipts/boneRigging";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { vector3Schema, axisEnum } from "@/lib/schemas/common";
import {
  resolveAnimationRigGroup,
  toArrayVector3,
} from "./shared";

export const boneRiggingParameters = z.object({
  action: z
    .enum([
      "create",
      "parent",
      "unparent",
      "delete",
      "rename",
      "set_pivot",
      "set_ik",
      "set_ik_controller",
      "mirror",
    ])
    .describe("Action to perform on the bone structure."),
  bone_data: z
    .object({
      name: z
        .string()
        .min(1)
        .optional()
        .describe("Required for every action except set_ik_controller. Create: new name. Other actions: Group UUID or unique name."),
      new_name: z
        .string()
        .min(1)
        .optional()
        .describe("New name for rename."),
      parent: z
        .string()
        .optional()
        .describe("Parent Group UUID or unique name."),
      origin: vector3Schema
        .optional()
        .describe("Pivot/origin for set_pivot."),
      rotation: vector3Schema
        .optional()
        .describe(
          "Initial create rotation; omit for neutral zero rotation."
        ),
      children: z
        .array(z.string())
        .optional()
        .describe(
          "Create-only child UUIDs or unique exact names; all are preflighted."
        ),
      ik_enabled: z
        .boolean()
        .optional()
        .describe("Enable inverse kinematics for this bone."),
      ik_target: z
        .string()
        .optional()
        .describe("Existing target Group UUID or exact unique name for legacy bone IK."),
      controller: z
        .string()
        .optional()
        .describe("Blockbench 5.2+ native IK controller Null Object UUID or unique exact name."),
      controller_target: z
        .string()
        .nullable()
        .optional()
        .describe("Blockbench 5.2+ IK target node UUID/name; null clears the target."),
      controller_source: z
        .string()
        .nullable()
        .optional()
        .describe("Blockbench 5.2+ IK root/source node UUID/name; null clears the source."),
      controller_pole: z
        .string()
        .nullable()
        .optional()
        .describe("Blockbench 5.2+ IK pole Group/Locator/Null Object UUID/name; null clears the pole."),
      lock_ik_target_rotation: z
        .boolean()
        .optional()
        .describe("Blockbench 5.2+ native IK controller target-rotation lock."),
      mirror_axis: axisEnum
        .optional()
        .describe("Axis required by mirror; no implicit mirror axis is assumed."),
    })
    .describe("Bone configuration data."),
}).superRefine((params, ctx) => {
  if (params.action !== "set_ik_controller" && !params.bone_data.name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bone_data", "name"],
      message: `${params.action} requires bone_data.name.`,
    });
  }

  if (
    params.action === "set_ik" &&
    params.bone_data.ik_enabled === undefined &&
    params.bone_data.ik_target === undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bone_data"],
      message:
        "set_ik requires ik_enabled and/or ik_target; an empty IK update is not a mutation."
    });
  }

  if (params.action === "set_ik_controller") {
    if (!params.bone_data.controller) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bone_data", "controller"],
        message: "set_ik_controller requires a native IK controller Null Object."
      });
    }
    if (
      params.bone_data.controller_target === undefined &&
      params.bone_data.controller_source === undefined &&
      params.bone_data.controller_pole === undefined &&
      params.bone_data.lock_ik_target_rotation === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bone_data"],
        message:
          "set_ik_controller requires at least one controller_target/controller_source/controller_pole/lock_ik_target_rotation update."
      });
    }
  }
});


export const boneRiggingToolDoc: ToolSpec = {
  name: "bone_rigging",
  description:
    "Advanced/compatibility rig operations. Normal hierarchy mutation uses add_group, modify_group, reparent_element, rename_element, and remove_element. Prefer bone_rigging only for IK or bone mirroring. Blockbench 5.2+ native IK controller target/root/pole settings are handled by set_ik_controller without adding another capability; legacy overlapping actions remain for compatibility.",
  annotations: {
    title: "Bone Rigging",
    destructiveHint: true,
  },
  parameters: boneRiggingParameters,
  status: STATUS_EXPERIMENTAL,
};

function resolveRigElement(reference: string): OutlinerElement {
  const uuidMatch = Outliner.elements.find(
    (element: OutlinerElement) => element.uuid === reference
  );
  if (uuidMatch) return uuidMatch;

  const nameMatches = Outliner.elements.filter(
    (element: OutlinerElement) => element.name === reference
  );
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `Outliner element name "${reference}" is ambiguous. Use an exact UUID. Candidates: ${nameMatches
        .map((element: OutlinerElement) => `${element.name} (${element.uuid})`)
        .join(", ")}`
    );
  }

  throw new Error(
    `Outliner element "${reference}" not found. Use inspect_elements(mode=outline) to confirm the intended child UUID.`
  );
}

type NativeIkControllerState = {
  uuid: string;
  name: string;
  ik_target: string | null;
  ik_source: string | null;
  ik_pole: string | null;
  lock_ik_target_rotation: boolean;
};

function assertNativeIkControllerRuntime(): void {
  // Feature detection, not a version table: future editors may change this
  // API independently of their release number. Do not touch Undo on failure.
  const properties = typeof NullObject === "undefined"
    ? null
    : (NullObject as typeof NullObject & { properties?: unknown }).properties;
  if (!supportsNativeIkControllerLinks(properties)) {
    throw new Error(
      "Native IK controller source/pole links are unavailable in this Blockbench build. " +
      "Only set_ik_controller is restricted; use the independent legacy set_ik action when appropriate."
    );
  }
}

function resolveNativeIkController(reference: string): NullObject {
  const candidate = resolveRigElement(reference);
  if (!(candidate instanceof NullObject)) {
    throw new Error(
      `IK controller "${reference}" must resolve to a Null Object. Received ${candidate.type} "${candidate.name}".`
    );
  }
  return candidate;
}

function resolveNativeIkTarget(reference: string): OutlinerElement {
  const candidate = resolveRigElement(reference);
  const constructorWithAnimator = candidate.constructor as typeof candidate.constructor & {
    animator?: unknown;
  };
  if (!(candidate instanceof Locator) && !constructorWithAnimator.animator) {
    throw new Error(
      `IK target "${reference}" must be an animatable outliner node or Locator.`
    );
  }
  return candidate;
}

function resolveNativeIkSource(reference: string): OutlinerElement {
  const candidate = resolveRigElement(reference);
  const constructorWithAnimator = candidate.constructor as typeof candidate.constructor & {
    animator?: unknown;
  };
  if (!constructorWithAnimator.animator) {
    throw new Error(
      `IK root/source "${reference}" must be an animatable outliner node.`
    );
  }
  return candidate;
}

function resolveNativeIkPole(
  reference: string,
  controllerUuid: string
): OutlinerElement {
  const candidate = resolveRigElement(reference);
  if (
    candidate.uuid === controllerUuid ||
    !(
      candidate instanceof Group ||
      candidate instanceof Locator ||
      candidate instanceof NullObject
    )
  ) {
    throw new Error(
      `IK pole "${reference}" must be a different Group, Locator, or Null Object.`
    );
  }
  return candidate;
}

function nativeIkControllerState(controller: NullObject): NativeIkControllerState {
  const runtime = controller as NullObject & {
    ik_source?: string;
    ik_pole?: string;
  };
  return {
    uuid: controller.uuid,
    name: controller.name,
    ik_target: controller.ik_target || null,
    ik_source: runtime.ik_source || null,
    ik_pole: runtime.ik_pole || null,
    lock_ik_target_rotation: controller.lock_ik_target_rotation === true,
  };
}

export function registerBoneRiggingTool(): void {
  createTool(
    boneRiggingToolDoc.name,
    {
      ...boneRiggingToolDoc,
      parameters: boneRiggingParameters,
      async execute({ action, bone_data }) {
        const boneName: string = bone_data.name ?? "";
        let targetBone: Group | undefined;
        let parentBone: Group | "root" | undefined;
        let childElements: OutlinerElement[] = [];
        let deleteElements: OutlinerElement[] = [];
        let deleteGroups: Group[] = [];
        let deleteAnimations: BBAnimation[] = [];
        let ikTarget: Group | undefined;
        let ikController: NullObject | undefined;
        let controllerTarget: OutlinerElement | null | undefined;
        let controllerSource: OutlinerElement | null | undefined;
        let controllerPole: OutlinerElement | null | undefined;
        let mirroredBoneName: string | undefined;
        let renamePlan: ReturnType<typeof planGroupRename> | undefined;
        const boneIdentity = (group: Group) => ({
          uuid: group.uuid,
          name: group.name,
          parent: group.parent instanceof Group ? group.parent.uuid : "root",
        });
        const boneState = (group: Group) => ({
          ...boneIdentity(group),
          origin: [...group.origin] as [number, number, number],
          rotation: [...group.rotation] as [number, number, number],
          ik_enabled: group.ik_enabled === true,
          ik_target:
            (group as Group & { ik_target?: string }).ik_target ?? null,
        });
  
        switch (action) {
          case "create":
            if (hasCaseInsensitiveRigNameCollision(Group.all, boneName)) {
              throw new Error(
                `Bone name "${boneName}" collides case-insensitively with an existing Group. Bedrock animation matching is case-insensitive; use a distinct bone name.`
              );
            }
            parentBone = bone_data.parent
              ? resolveAnimationRigGroup(bone_data.parent)
              : "root";
            childElements = (bone_data.children ?? []).map(resolveRigElement);
            if (
              new Set(childElements.map((element) => element.uuid)).size !==
              childElements.length
            ) {
              throw new Error("children contains the same Outliner element more than once.");
            }
            if (parentBone instanceof Group) {
              const createParentBone = parentBone;
              const createParentByUuid = new Map<string, string | null>(
                Group.all.map((group: Group) =>
                  [
                    group.uuid,
                    group.parent instanceof Group ? group.parent.uuid : null,
                  ] as [string, string | null]
                )
              );
              childElements.forEach((child) => {
                if (
                  child instanceof Group &&
                  wouldCreateRigHierarchyCycle(
                    child.uuid,
                    createParentBone.uuid,
                    createParentByUuid
                  )
                ) {
                  throw new Error(
                    `Cannot create bone "${boneName}" under "${createParentBone.name}" while adopting child Group "${child.name}" because that child is the parent itself, an ancestor of the parent, or the parent chain is already cyclic.`
                  );
                }
              });
            }
            if (bone_data.ik_enabled) {
              if (!bone_data.ik_target) {
                throw new Error(
                  "ik_target is required when creating a bone with ik_enabled=true."
                );
              }
              ikTarget = resolveAnimationRigGroup(bone_data.ik_target);
            }
            break;
  
          case "parent":
            targetBone = resolveAnimationRigGroup(boneName);
            if (!bone_data.parent) {
              throw new Error(
                "parent is required for the parent action. Use unparent to move a bone to root."
              );
            }
            parentBone = resolveAnimationRigGroup(bone_data.parent);
            const parentByUuid = new Map<string, string | null>(
              Group.all.map((group: Group) =>
                [
                  group.uuid,
                  group.parent instanceof Group ? group.parent.uuid : null,
                ] as [string, string | null]
              )
            );
            if (
              wouldCreateRigHierarchyCycle(
                targetBone.uuid,
                parentBone.uuid,
                parentByUuid
              )
            ) {
              throw new Error(
                `Cannot parent "${targetBone.name}" under "${parentBone.name}" because the requested hierarchy would create or extend a parent cycle.`
              );
            }
            break;
  
          case "unparent":
            targetBone = resolveAnimationRigGroup(boneName);
            break;
  
          case "delete": {
            targetBone = resolveAnimationRigGroup(boneName);
            deleteGroups = [targetBone];
            targetBone.forEachChild((element: any) => {
              if (element instanceof Group) {
                deleteGroups.push(element);
              } else {
                deleteElements.push(element as OutlinerElement);
              }
            });
            const deleteGroupUuids = new Set(
              deleteGroups.map((group) => group.uuid)
            );
            deleteAnimations = AnimationItem.all.filter((animation) =>
              Object.keys(animation.animators ?? {}).some((animatorUuid) =>
                deleteGroupUuids.has(animatorUuid)
              )
            );
            break;
          }
  
          case "rename":
            targetBone = resolveAnimationRigGroup(boneName);
            if (!bone_data.new_name) {
              throw new Error("new_name is required for the rename action.");
            }
            if (bone_data.new_name === targetBone.name) {
              throw new Error(
                `Bone "${targetBone.name}" already has that exact name; rename requires an authored name change.`
              );
            }
            if (
              hasCaseInsensitiveRigNameCollision(
                Group.all,
                bone_data.new_name,
                targetBone.uuid
              )
            ) {
              throw new Error(
                `Bone name "${bone_data.new_name}" collides case-insensitively with another Group. Bedrock animation matching is case-insensitive; choose a distinct name.`
              );
            }
            // The legacy bone_rigging rename must obey the same complete
            // animation-reference and name-collision contract as rename_element.
            // Plan before opening native Undo; no partial edits on collision.
            renamePlan = planGroupRename(
              Group.all,
              [{ id: targetBone.uuid, new_name: bone_data.new_name }],
              (typeof AnimationItem === "undefined" ? [] : AnimationItem.all)
                as unknown as RenameAnimation[]
            );
            break;
  
          case "set_pivot":
            targetBone = resolveAnimationRigGroup(boneName);
            if (!bone_data.origin) {
              throw new Error(
                "origin is required for set_pivot. Inspect the Group and provide the evidence-backed joint/attachment transform center explicitly."
              );
            }
            break;
  
          case "set_ik":
            targetBone = resolveAnimationRigGroup(boneName);
            if (bone_data.ik_enabled === true && !bone_data.ik_target) {
              throw new Error("ik_target is required when ik_enabled=true.");
            }
            if (bone_data.ik_target) {
              ikTarget = resolveAnimationRigGroup(bone_data.ik_target);
            }
            break;
  
          case "set_ik_controller":
            assertNativeIkControllerRuntime();
            ikController = resolveNativeIkController(bone_data.controller!);
            controllerTarget =
              bone_data.controller_target === null
                ? null
                : bone_data.controller_target
                  ? resolveNativeIkTarget(bone_data.controller_target)
                  : undefined;
            controllerSource =
              bone_data.controller_source === null
                ? null
                : bone_data.controller_source
                  ? resolveNativeIkSource(bone_data.controller_source)
                  : undefined;
            controllerPole =
              bone_data.controller_pole === null
                ? null
                : bone_data.controller_pole
                  ? resolveNativeIkPole(
                      bone_data.controller_pole,
                      ikController.uuid
                    )
                  : undefined;
            break;

          case "mirror":
            targetBone = resolveAnimationRigGroup(boneName);
            if (!bone_data.mirror_axis) {
              throw new Error(
                "mirror_axis is required for mirror. No implicit axis is assumed."
              );
            }
            mirroredBoneName = deriveMirroredRigName(targetBone.name);
            if (
              hasCaseInsensitiveRigNameCollision(
                Group.all,
                mirroredBoneName
              )
            ) {
              throw new Error(
                `Mirroring "${targetBone.name}" would create bone name "${mirroredBoneName}", which collides case-insensitively with an existing Group. Rename the conflicting bone or source before mirroring.`
              );
            }
            break;
        }
  
        const deletionReceipt =
          action === "delete" && targetBone
            ? {
                removed_root: boneIdentity(targetBone),
                removed_counts: {
                  groups: deleteGroups.length,
                  elements: deleteElements.length,
                  total_nodes: deleteGroups.length + deleteElements.length,
                },
                affected_animations: deleteAnimations.length,
              }
            : null;
        const undoElements =
          action === "delete"
            ? deleteElements
            : action === "set_ik_controller" && ikController
              ? [ikController]
              : childElements;
        const undoGroups =
          action === "delete" ? deleteGroups : targetBone ? [targetBone] : [];
        Undo.initEdit({
          outliner: true,
          elements: undoElements,
          groups: undoGroups,
          ...(action === "delete"
            ? { selection: true, animations: deleteAnimations }
            : action === "rename" && renamePlan
              ? { animations: renamePlan.references.map(
                  (reference) => reference.animation
                ) as BBAnimation[] }
              : {}),
        });
  
        let resultText = "";
        let createdGroup: Group | undefined;
        let affectedBone: Group | undefined;
        try {
          switch (action) {
            case "create": {
              const group = new Group({
                name: boneName,
                origin: bone_data.origin ? toArrayVector3(bone_data.origin) : [0, 0, 0],
                rotation: bone_data.rotation ? toArrayVector3(bone_data.rotation) : [0, 0, 0],
              }).init();
              createdGroup = group;
              affectedBone = group;
  
              group.addTo(parentBone ?? "root");
              childElements.forEach((element) => element.addTo(group));
  
              if (bone_data.ik_enabled && ikTarget) {
                group.ik_enabled = true;
                (group as Group & { ik_target?: string }).ik_target = ikTarget.uuid;
              }
  
              resultText = `Created bone "${group.name}" with UUID ${group.uuid}`;
              break;
            }
  
            case "parent": {
              targetBone!.addTo(parentBone as Group);
              affectedBone = targetBone!;
              resultText = `Parented "${targetBone!.name}" to "${(parentBone as Group).name}"`;
              break;
            }
  
            case "unparent": {
              targetBone!.addTo("root");
              affectedBone = targetBone!;
              resultText = `Unparented "${targetBone!.name}"`;
              break;
            }
  
            case "delete": {
              targetBone!.remove(false);
              // Mirror Blockbench's native Group.remove(true) Undo contract:
              // the deleted object lists represent an empty post-edit state.
              deleteElements.length = 0;
              deleteGroups.length = 0;
              resultText = `Deleted bone "${deletionReceipt!.removed_root.name}"`;
              break;
            }
  
            case "rename": {
              applyGroupRename(renamePlan!);
              affectedBone = targetBone!;
              resultText = `Renamed bone to "${bone_data.new_name}"`;
              break;
            }
  
            case "set_pivot": {
              targetBone!.transferOrigin(toArrayVector3(bone_data.origin!));
              affectedBone = targetBone!;
              resultText = `Set pivot point for "${targetBone!.name}"`;
              break;
            }
  
            case "set_ik": {
              if (bone_data.ik_enabled !== undefined) {
                targetBone!.ik_enabled = bone_data.ik_enabled;
              }
              if (ikTarget) {
                (targetBone! as Group & { ik_target?: string }).ik_target = ikTarget.uuid;
              }
              affectedBone = targetBone!;
              resultText = `Updated IK settings for "${targetBone!.name}"`;
              break;
            }
  
            case "set_ik_controller": {
              const controller = ikController!;
              const runtime = controller as NullObject & {
                ik_source?: string;
                ik_pole?: string;
              };
              if (controllerTarget !== undefined) {
                controller.ik_target = controllerTarget?.uuid ?? "";
              }
              if (controllerSource !== undefined) {
                runtime.ik_source = controllerSource?.uuid ?? "";
              }
              if (controllerPole !== undefined) {
                runtime.ik_pole = controllerPole?.uuid ?? "";
              }
              if (bone_data.lock_ik_target_rotation !== undefined) {
                controller.lock_ik_target_rotation =
                  bone_data.lock_ik_target_rotation;
              }
              if (Modes.animate) Animator.preview();
              resultText = `Updated native IK controller "${controller.name}"`;
              break;
            }

            case "mirror": {
              const axis = bone_data.mirror_axis!;
              const mirroredBone = targetBone!.duplicate();
              createdGroup = mirroredBone;
              affectedBone = mirroredBone;
              const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
              mirroredBone.origin[axisIndex] *= -1;
              mirroredBone.name = mirroredBoneName!;
              resultText = `Mirrored bone "${targetBone!.name}" across ${axis} axis`;
              break;
            }
          }
  
          Undo.finishEdit(
            `Bone rigging: ${action}`,
            createdGroup
              ? { outliner: true, groups: [createdGroup], elements: childElements }
              : undefined
          );
          recordCurrentCapabilitySemanticHistoryEffect("bone_rigging");
        } catch (error) {
          Undo.cancelEdit(true);
          Canvas.updateAll();
          throw error;
        }
  
        Canvas.updateAll();
        if (action === "delete") {
          const result = boneRiggingReceipt({
            action,
            ...deletionReceipt!,
          });
          return {
            content: [{ type: "text" as const, text: resultText }],
            structuredContent: result,
          };
        }
        if (action === "set_ik_controller") {
          const result = boneRiggingReceipt({
            action,
            controller: nativeIkControllerState(ikController!),
          });
          return {
            content: [{ type: "text" as const, text: resultText }],
            structuredContent: result,
          };
        }
        if (!affectedBone) {
          throw new Error(`Bone rigging action "${action}" completed without a continuation bone.`);
        }
        const result = boneRiggingReceipt({
          action,
          bone: boneState(affectedBone),
        });
        return {
          content: [{ type: "text" as const, text: resultText }],
          structuredContent: result,
        };
      },
    },
    boneRiggingToolDoc.status
  );
}