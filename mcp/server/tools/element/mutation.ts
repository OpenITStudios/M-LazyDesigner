/// <reference types="blockbench-types" />

import { z } from "zod";
import {
  recordCurrentCapabilitySemanticHistoryEffect,
  recordCurrentSemanticHistoryEffect,
} from "@/lib/authoring/semanticHistory";
import { removeElementReceipt } from "@/lib/receipts/removeElement";
import { renameElementReceipt } from "@/lib/receipts/renameElement";
import {
  removedElementSemanticScopes,
  renamedElementSemanticScopes,
} from "@/lib/authoring/elementSemanticScopes";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { elementIdSchema } from "@/lib/schemas/ids";
import { requireOpenProject } from "@/lib/core/project";
import { planGroupRename, applyGroupRename, type RenameAnimation } from "@/lib/geometry/batchGroupRename";
import {
  continuationElementType,
  duplicateFaithfully,
  elementContinuationState,
  finiteElementVector3Schema,
  preflightFaithfulDuplicate,
  resolveUniqueDestructiveElement,
  assertAnchorRenameAvailable,
} from "./shared";

export const removeElementParameters = z.object({
  id: elementIdSchema.describe(
    "Exact element UUID or exact unique name. Ambiguous names are rejected before removal."
  ),
});

export const duplicateElementParameters = z.object({
  id: elementIdSchema.describe(
    "Exact Cube or Group UUID, or exact unique name. Ambiguous names are rejected before duplication."
  ),
  offset: finiteElementVector3Schema.optional().default([0, 0, 0]).describe("Finite translation offset [x,y,z] applied to the duplicated Cube/Group subtree."),
  newName: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Name for the duplicated root only; descendants keep `<name>_copy` names."
    ),
});

export const renameElementParameters = z.union([z.object({
  id: elementIdSchema.describe(
    "Exact element/Group UUID or unique name; ambiguous names are rejected before rename."
  ),
  new_name: z
    .string()
    .min(1)
    .describe("Non-empty new name to assign."),
}).strict(), z.object({
  updates: z.array(z.object({id: z.string().min(1), new_name: z.string().trim().min(1)}).strict()).min(1).max(128),
  dry_run: z.boolean().default(true).describe("Preview Group batch rename; false applies names and animation references in one Undo."),
}).strict()]);


export const elementMutationToolDocs: ToolSpec[] = [
  {
      name: "remove_element",
      description:
        "Removes one explicit Cube, Group, or outliner target with Undo support.",
      annotations: {
        title: "Remove Element",
        destructiveHint: true,
      },
      parameters: removeElementParameters,
      status: STATUS_EXPERIMENTAL,
    },
  {
      name: "duplicate_element",
      description:
        "Duplicates one explicit Cube/Group with optional offset and root name.",
      annotations: { title: "Duplicate Element", destructiveHint: true },
      parameters: duplicateElementParameters,
      status: STATUS_EXPERIMENTAL,
    },
  {
      name: "rename_element",
      description:
        "Renames one explicit outliner target via id/new_name, or up to 128 Groups via updates of UUID/new_name. Group batches preview by default (dry_run); false applies one Undo and synchronizes animation references. Final names must be unique case-insensitively.",
      annotations: { title: "Rename Element", destructiveHint: true },
      parameters: renameElementParameters,
      status: STATUS_EXPERIMENTAL,
    }
];

export function registerRemoveElementTool(): void {
  createTool(elementMutationToolDocs[0].name, {
        ...elementMutationToolDocs[0],
        async execute({ id }) {
          requireOpenProject("removing an element");
          const element = resolveUniqueDestructiveElement(id);
          const removedRoot = elementContinuationState(element);
          const deleteElements: OutlinerElement[] = [];
          const deleteGroups: Group[] = [];
    
          if (element instanceof Group) {
            deleteGroups.push(element);
            element.forEachChild((child: any) => {
              if (child instanceof Group) {
                deleteGroups.push(child);
              } else {
                deleteElements.push(child as OutlinerElement);
              }
            });
          } else {
            deleteElements.push(element);
          }
    
          const deletedNodeUuids = new Set([
            ...deleteGroups.map((group) => group.uuid),
            ...deleteElements.map((deletedElement) => deletedElement.uuid),
          ]);
          const deleteAnimations: BBAnimation[] = AnimationItem.all.filter(
            (animation) =>
              Object.keys(animation.animators ?? {}).some((animatorUuid) =>
                deletedNodeUuids.has(animatorUuid)
              )
          );
          const deletionCounts = {
            groups: deleteGroups.length,
            elements: deleteElements.length,
            total_nodes: deleteGroups.length + deleteElements.length,
          };
          const affectedAnimationCount = deleteAnimations.length;
    
          Undo.initEdit({
            elements: deleteElements,
            groups: deleteGroups,
            outliner: true,
            selection: true,
            animations: deleteAnimations,
            collections: [],
          });
    
          try {
            if (element instanceof Group) {
              element.remove(false);
              deleteGroups.length = 0;
            } else {
              element.remove();
            }
            deleteElements.length = 0;
            Undo.finishEdit("Agent removed element");
            recordCurrentSemanticHistoryEffect(
              removedElementSemanticScopes(removedRoot.type)
            );
          } catch (error) {
            Undo.cancelEdit(true);
            Canvas.updateAll();
            throw error;
          }
    
          Canvas.updateAll();
          const result = removeElementReceipt({
            removed_root: removedRoot,
            removed_counts: deletionCounts,
            affected_animations: affectedAnimationCount,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Removed ${removedRoot.type} ${removedRoot.name} (${removedRoot.uuid}); ${deletionCounts.total_nodes} outliner node(s) removed and ${affectedAnimationCount} affected animation(s) included in Undo.`,
              },
            ],
            structuredContent: result,
          };
        },
      }, elementMutationToolDocs[0].status);
}

export function registerElementMutationTools(): void {
  createTool(elementMutationToolDocs[1].name, {
        ...elementMutationToolDocs[1],
        async execute({ id, offset, newName }) {
          requireOpenProject("duplicating an element");
          const element = resolveUniqueDestructiveElement(id);
          if (!(element instanceof Cube) && !(element instanceof Group)) {
            throw new Error(
              `Element "${id}" cannot be duplicated by the Bedrock Cuboid workflow. Use an explicit Cube or Group target.`
            );
          }
    
          preflightFaithfulDuplicate(element, offset, newName);
    
          Undo.initEdit({
            elements: [],
            groups: [],
            outliner: true,
            selection: true,
            collections: [],
          });
          let dup: Cube | Group;
          try {
            dup = duplicateFaithfully(element, offset, newName);
            Undo.finishEdit("Agent duplicated element");
            recordCurrentCapabilitySemanticHistoryEffect("duplicate_element");
          } catch (error) {
            Undo.cancelEdit(true);
            Canvas.updateAll();
            throw error;
          }
    
          Canvas.updateAll();
          const result = { element: elementContinuationState(dup) };
          return {
            content: [
              {
                type: "text" as const,
                text: `Duplicated "${element.name}" as "${dup.name}" (${dup.uuid}).`,
              },
            ],
            structuredContent: result,
          };
        },
      }, elementMutationToolDocs[1].status);
    
      createTool(elementMutationToolDocs[2].name, {
        ...elementMutationToolDocs[2],
        async execute(request) {
          requireOpenProject("renaming an element");
          const singleElement = "updates" in request ? undefined : resolveUniqueDestructiveElement(request.id);
          if (!("updates" in request) && singleElement?.name === request.new_name) throw new Error("Rename has no authored effect.");
          if ("updates" in request || singleElement instanceof Group) {
            const batch = "updates" in request ? request : {updates:[{id: singleElement!.uuid, new_name: request.new_name}], dry_run:false};
            const animations = (typeof AnimationItem === "undefined" ? [] : AnimationItem.all) as unknown as RenameAnimation[];
            const plan = planGroupRename(Group.all, batch.updates, animations);
            const changes = plan.rows.map(row => ({id: row.group.uuid, old_name: row.old_name, new_name: row.new_name}));
            if (batch.dry_run || !changes.length) return {
              content: [{type: "text" as const, text: `${changes.length} Group rename(s) planned; no mutation.`}],
              structuredContent: renameElementReceipt({
                execution: batch.dry_run ? "planned" : "unchanged",
                changes,
                affected_animations: plan.references.length,
              }),
            };
            Undo.initEdit({groups: plan.rows.map(row => row.group) as Group[], animations: plan.references.map(ref => ref.animation) as unknown as BBAnimation[], outliner: true});
            try {
              applyGroupRename(plan);
              Undo.finishEdit("Batch rename Groups");
              recordCurrentSemanticHistoryEffect(
                renamedElementSemanticScopes("group")
              );
            } catch(error) {Undo.cancelEdit(true); Canvas.updateAll(); throw error;}
            Canvas.updateAll();
            return {
              content:[{type:"text" as const,text:`Renamed ${changes.length} Groups and synchronized ${plan.references.length} animation(s).`}],
              structuredContent: renameElementReceipt({
                execution:"applied",
                changes,
                affected_animations:plan.references.length,
                ...(singleElement ? {element: elementContinuationState(singleElement)} : {}),
              }),
            };
          }
          const {new_name} = request;
          const element = singleElement!;
    
          if (element.name === new_name) {
            throw new Error(
              `rename_element request for ${continuationElementType(element)} ${element.name} (${element.uuid}) has no authored effect.`
            );
          }
          if (element instanceof Locator || element instanceof NullObject) {
            assertAnchorRenameAvailable(element, new_name);
          }
    
          Undo.initEdit({
            elements: element instanceof Group ? [] : [element],
            groups: element instanceof Group ? [element] : [],
            outliner: true,
            collections: [],
          });
    
          try {
            element.name = new_name;
            Undo.finishEdit("Agent renamed element");
            recordCurrentSemanticHistoryEffect(
              renamedElementSemanticScopes(continuationElementType(element))
            );
          } catch (error) {
            Undo.cancelEdit(true);
            Canvas.updateAll();
            throw error;
          }
    
          Canvas.updateAll();
          const result = renameElementReceipt({
            execution: "applied",
            element: elementContinuationState(element),
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Renamed ${result.element.type} ${result.element.name} (${result.element.uuid}).`,
              },
            ],
            structuredContent: result,
          };
        },
      }, elementMutationToolDocs[2].status);
}