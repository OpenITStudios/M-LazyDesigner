/// <reference types="blockbench-types" />

import { z } from "zod";
import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import {
  addGroupReceipt,
  modifyGroupReceipt,
  reparentElementReceipt,
} from "@/lib/receipts/groupMutation";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { resolveCoreGroup } from "@/lib/core/identity";
import { elementIdSchema } from "@/lib/schemas/ids";
import { requireOpenProject } from "@/lib/core/project";
import {
  assertBatchGroupNamesAvailable,
  finiteElementVector3Schema,
  isDescendantOf,
  planGroupBatchParents,
  preflightDuplicateTranslation,
  resolveParentGroup,
  resolveUniqueDestructiveElement,
  translateDuplicatedSubtree,
  vector3Equals,
} from "./shared";

export const addGroupParameters = z
  .object({
    name: z
      .string()
      .min(1)
      .optional()
      .describe("Non-empty Bedrock Group/bone name."),
    origin: finiteElementVector3Schema
      .optional()
      .default([0, 0, 0])
      .describe(
        "Finite Bedrock bone pivot/origin; omit for organizational Groups unless a joint/attachment needs it."
      ),
    rotation: finiteElementVector3Schema
      .optional()
      .default([0, 0, 0])
      .describe("Finite initial Bedrock bone rotation; omit for neutral zero rotation."),
    parent: z
      .string()
      .optional()
      .default("root")
      .describe(
        "Parent Group UUID or unique exact name; omit/use `root` for intentional root."
      ),
    groups: z
      .array(
        z.object({
          name: z.string().min(1).describe("Non-empty unique bone name."),
          origin: finiteElementVector3Schema
            .optional()
            .describe("Finite pivot; omit for [0,0,0]."),
          rotation: finiteElementVector3Schema
            .optional()
            .describe("Finite initial rotation; omit for zero."),
          parent: z
            .string()
            .optional()
            .describe("Parent Group UUID/name or `root`; may reference an earlier batch entry."),
        })
      )
      .min(1)
      .optional()
      .describe("Coherent non-empty Group/bone batch; ordered, one Undo unit."),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.groups && value.name !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Pass either `name` or `groups`, not both.",
        path: ["groups"],
      });
    }
    if (!value.groups && value.name === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Provide `name` or `groups`.",
        path: ["name"],
      });
    }
  });

export const modifyGroupParameters = z
  .object({
    id: z.string().min(1).describe("Exact Group UUID or unique exact name."),
    origin: finiteElementVector3Schema.optional().describe("New Group pivot/origin."),
    rotation: finiteElementVector3Schema.optional().describe("New Group rotation [x,y,z]."),
    visibility: z.boolean().optional().describe("New Group visibility."),
    offset: finiteElementVector3Schema.optional().describe("Translate Group subtree in authored model coordinates, including bounds/pivots/anchors. Use alone; preserves UV and animation keys. Not a camera-relative drag."),
  })
  .strict()
  .refine(
    (update) =>
      update.offset !== undefined || update.origin !== undefined ||
      update.rotation !== undefined ||
      update.visibility !== undefined,
    { message: "modify_group requires an origin, rotation, or visibility change." }
  ).refine(update => update.offset === undefined ||
    (update.origin === undefined && update.rotation === undefined && update.visibility === undefined),
    {message:"offset cannot be combined with pivot, rotation or visibility edits."});

export const reparentElementParameters = z.object({
  id: elementIdSchema.describe("Exact Cube or Group UUID or unique exact name."),
  parent: z
    .string()
    .min(1)
    .describe("New parent Group UUID or unique exact name; use `root` for root placement."),
});


function groupContinuationState(group: Group) {
  return {
    uuid: group.uuid,
    name: group.name,
    origin: [...group.origin] as [number, number, number],
    rotation: [...group.rotation] as [number, number, number],
    visibility: group.visibility !== false,
    parent: group.parent instanceof Group ? group.parent.uuid : "root",
  };
}

export const elementHierarchyToolDocs: ToolSpec[] = [
  {
      name: "add_group",
      description:
        "Adds one or more Bedrock Groups/bones with optional parent, pivot, and rotation.",
      annotations: {
        title: "Add Group",
        destructiveHint: true,
      },
      parameters: addGroupParameters,
      status: STATUS_STABLE,
    },
  {
      name: "modify_group",
      description:
        "Modifies one explicit Bedrock Group pivot, rotation, visibility, or translates its subtree using offset. Use rename_element for names.",
      annotations: { title: "Modify Group", destructiveHint: true },
      parameters: modifyGroupParameters,
      status: STATUS_STABLE,
    },
  {
      name: "reparent_element",
      description:
        "Moves one explicit Cube or Group to a new parent. Rejects self/circular hierarchy; local transform is preserved.",
      annotations: { title: "Reparent Element", destructiveHint: true },
      parameters: reparentElementParameters,
      status: STATUS_EXPERIMENTAL,
    }
];

export function registerAddGroupTool(): void {
  createTool(elementHierarchyToolDocs[0].name, {
        ...elementHierarchyToolDocs[0],
        async execute({ name, origin, rotation, parent, groups }) {
          requireOpenProject("adding a Group");
          const batch =
            groups ??
            [
              {
                name: name ?? "",
                origin,
                rotation,
                parent,
              },
            ];
    
          assertBatchGroupNamesAvailable(batch);
          const parentPlan = planGroupBatchParents(batch);
    
          Undo.initEdit({
            elements: [],
            outliner: true,
            groups: [],
            collections: [],
          });
    
          const created: Group[] = [];
          try {
            for (const [index, entry] of batch.entries()) {
              const plannedParent = parentPlan[index];
              const parentGroup =
                typeof plannedParent === "number"
                  ? created[plannedParent]
                  : plannedParent;
              if (!parentGroup) {
                throw new Error(
                  `Internal Group batch parent plan ${plannedParent} was not available for entry ${index}.`
                );
              }
              const group = new Group({
                name: entry.name,
                origin: entry.origin ?? [0, 0, 0],
                rotation: entry.rotation ?? [0, 0, 0],
              }).init();
              group.addTo(parentGroup);
              created.push(group);
            }
            Undo.finishEdit(
              created.length > 1 ? "Agent added groups" : "Agent added group",
              { outliner: true, groups: created }
            );
            recordCurrentCapabilitySemanticHistoryEffect("add_group");
          } catch (error) {
            Undo.cancelEdit(true);
            Canvas.updateAll();
            throw error;
          }
    
          Canvas.updateAll();
          const result = addGroupReceipt({
            execution: "applied" as const,
            groups: created.map(groupContinuationState),
            ...(groups ? {} : { group: groupContinuationState(created[0]) }),
          });
          return {
            content: [
              {
                type: "text" as const,
                text:
                  created.length > 1
                    ? `Added ${created.length} Groups: ${created
                        .map((group) => group.name)
                        .join(", ")}.`
                    : `Added Group ${created[0].name} (${created[0].uuid}).`,
              },
            ],
            structuredContent: result,
          };
        },
      }, elementHierarchyToolDocs[0].status);
}

export function registerElementHierarchyTools(): void {
  createTool("modify_group", {
        description:
          "Modifies one explicit Bedrock Group pivot, rotation, visibility, or translates its subtree using offset. Use rename_element for names.",
        annotations: { title: "Modify Group", destructiveHint: true },
        parameters: modifyGroupParameters,
        async execute({ id, origin, rotation, visibility, offset }) {
          requireOpenProject("modifying a Group");
          const group = resolveCoreGroup(
            id,
            "Use inspect_elements(mode=search), then inspect_elements(mode=detail) to confirm the intended Group UUID."
          );
          if (offset !== undefined) {
            if (offset.every(value => value === 0)) throw new Error("Translation offset has no authored effect.");
            preflightDuplicateTranslation(group, offset);
            const groups: Group[] = [];
            const elements: OutlinerElement[] = [];
            const collect = (node: Group | OutlinerElement) => {
              if (node instanceof Group) {
                groups.push(node);
                node.children.forEach(child => collect(child as Group | OutlinerElement));
              } else elements.push(node);
            };
            collect(group);
            Undo.initEdit({groups, elements, outliner:true});
            try {
              translateDuplicatedSubtree(group, offset);
              Undo.finishEdit("Agent translated Group subtree");
              recordCurrentCapabilitySemanticHistoryEffect("modify_group");
            } catch (error) {
              Undo.cancelEdit(true);
              Canvas.updateAll();
              throw error;
            }
            Canvas.updateAll();
            return {
              content:[{type:"text" as const,text:`Translated ${groups.length} Group(s) and ${elements.length} element(s).`}],
              structuredContent:{execution:"applied" as const,id:group.uuid,offset,origin:[...group.origin],groups:groups.length,elements:elements.length,coordinate_space:"authored_model"},
            };
          }
          const sameOrigin =
            origin === undefined || vector3Equals(origin, group.origin);
          const sameRotation =
            rotation === undefined || vector3Equals(rotation, group.rotation);
          const sameVisibility =
            visibility === undefined || visibility === group.visibility;
          if (sameOrigin && sameRotation && sameVisibility) {
            throw new Error(
              `modify_group request for Group ${group.name} (${group.uuid}) has no authored effect.`
            );
          }
          if (origin !== undefined && !sameOrigin && !group.mesh) {
            throw new Error(
              `Group ${group.name} (${group.uuid}) has no preview mesh, so transferOrigin() cannot safely preserve descendant visual placement. No mutation was applied.`
            );
          }
    
          const changedFields = [
            origin !== undefined && !sameOrigin ? "origin" : null,
            rotation !== undefined && !sameRotation ? "rotation" : null,
            visibility !== undefined && !sameVisibility ? "visibility" : null,
          ].filter((field): field is string => field !== null);
    
          Undo.initEdit({
            elements: [],
            groups: [group],
            outliner: true,
            collections: [],
          });
          try {
            if (origin !== undefined && !sameOrigin) {
              group.transferOrigin(origin as [number, number, number]);
              if (!vector3Equals(group.origin, origin)) {
                throw new Error(
                  `Group ${group.name} (${group.uuid}) pivot readback did not match the requested origin.`
                );
              }
            }
            group.extend({
              ...(rotation !== undefined && !sameRotation
                ? { rotation: rotation as [number, number, number] }
                : {}),
              ...(visibility !== undefined && !sameVisibility ? { visibility } : {}),
            });
            Undo.finishEdit("Agent modified group");
            recordCurrentCapabilitySemanticHistoryEffect("modify_group");
          } catch (error) {
            Undo.cancelEdit(true);
            Canvas.updateAll();
            throw error;
          }
    
          Canvas.updateAll();
          return {
            content: [
              {
                type: "text" as const,
                text: `Modified Group ${group.name} (${group.uuid}); changed: ${changedFields.join(", ")}.`,
              },
            ],
            structuredContent: modifyGroupReceipt({
              execution: "applied" as const,
              id: group.uuid,
              name: group.name,
              changed_fields: changedFields,
              group: groupContinuationState(group),
            }),
          };
        },
      }, STATUS_STABLE);
    
      createTool("reparent_element", {
        description:
          "Moves one explicit Cube or Group to a new parent. Rejects self/circular hierarchy; local transform is preserved.",
        annotations: { title: "Reparent Element", destructiveHint: true },
        parameters: reparentElementParameters,
        async execute({ id, parent }) {
          requireOpenProject("reparenting an element");
          const element = resolveUniqueDestructiveElement(id);
          const nextParent = resolveParentGroup(parent);
          const previousParent =
            element.parent instanceof Group ? element.parent : "root";
    
          if (nextParent !== "root") {
            if (nextParent === element) {
              throw new Error("An element cannot be parented to itself.");
            }
            if (element instanceof Group && isDescendantOf(nextParent, element)) {
              throw new Error("A Group cannot be reparented into its own descendant.");
            }
          }
          if (previousParent === nextParent) {
            throw new Error(
              `reparent_element request for ${element.name} (${element.uuid}) has no authored effect.`
            );
          }
    
          Undo.initEdit({
            elements: element instanceof Group ? [] : [element],
            groups: element instanceof Group ? [element] : [],
            outliner: true,
            collections: [],
          });
          try {
            element.addTo(nextParent);
            // Reject silent no-op or partial native outliner mutations before
            // committing Undo or claiming an authoritative applied receipt.
            const observedParent =
              element.parent instanceof Group ? element.parent : "root";
            if (
              observedParent !== nextParent ||
              (nextParent instanceof Group && !nextParent.children.includes(element)) ||
              (previousParent instanceof Group && previousParent.children.includes(element))
            ) {
              throw new Error(
                `Reparent postcondition mismatch for ${element.name} (${element.uuid}): native parent/children did not match requested destination.`
              );
            }
            Undo.finishEdit("Agent reparented element");
            recordCurrentCapabilitySemanticHistoryEffect("reparent_element");
          } catch (error) {
            Undo.cancelEdit(true);
            Canvas.updateAll();
            throw error;
          }
    
          Canvas.updateAll();
          const currentParent =
            element.parent instanceof Group ? element.parent.uuid : "root";
          return {
            content: [
              {
                type: "text" as const,
                text: `Reparented ${element.name} (${element.uuid}): ${previousParent === "root" ? "root" : previousParent.uuid} -> ${currentParent}. Local transform preserved.`,
              },
            ],
            structuredContent: reparentElementReceipt({
              execution: "applied" as const,
              id: element.uuid,
              name: element.name,
              previous_parent:
                previousParent === "root" ? "root" : previousParent.uuid,
              parent: currentParent,
              transform_policy: "preserve_local",
            }),
          };
        },
      }, STATUS_EXPERIMENTAL);
}