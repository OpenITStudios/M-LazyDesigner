import { z } from "zod";
import { createTool, getAllToolDefinitions, tools, withToolBranch } from "@/lib/factories";
import type { McpRegistrationFamily } from "@/lib/capabilities/registrationProfile";
import {
  animationCopyPasteParameters,
  animationGraphEditorParameters,
  animationTimelineParameters,
  batchKeyframeOperationsParameters,
  manageKeyframesParameters,
} from "../tools/animation";
import {
  findElementsByCriteriaParameters,
  listOutlineParameters,
} from "../tools/element";
import { inspectElementParameters } from "../tools/element/inspection";
import {
  assignTextureChannelParameters,
  configureMaterialParameters,
  createPbrMaterialParameters,
  saveMaterialConfigParameters,
} from "../tools/texture";
import {
  bulkSetMaterialInstancesParametersSchema,
  clearMaterialInstancesParametersSchema,
  getFaceMaterialInstancesParametersSchema,
  listMaterialInstancesParametersSchema,
  setFaceMaterialInstanceParametersSchema,
} from "../tools/texture/materialInstances";
import {
  getConsolidatedExecutor,
  getConsolidatedExecutors,
  getConsolidatedFamily,
  type ConsolidatedCapability,
} from "./consolidatedRoutes";

export type ConsolidatedCatalogUpdate = (
  toolName: string,
  family: McpRegistrationFamily,
  enabled: boolean
) => void;

export const consolidatedInspectionBranches = {
  outline: withToolBranch(listOutlineParameters, "mode", "outline"),
  search: withToolBranch(findElementsByCriteriaParameters, "mode", "search"),
  detail: withToolBranch(inspectElementParameters, "mode", "detail"),
} as const;

const consolidatedInspectionParameters = z.union([
  consolidatedInspectionBranches.outline,
  consolidatedInspectionBranches.search,
  consolidatedInspectionBranches.detail,
]);

export const consolidatedInspectionToolDocs = {
  name: "inspect_elements",
  description:
    "Inspects Bedrock elements through outline, search, or detail. Detail can opt in to read-only Recipe-owned Cube optimization review without changing Geometry.",
  annotations: { title: "Inspect Elements", readOnlyHint: true },
  parameters: consolidatedInspectionParameters,
  branches: {
    discriminator: "mode",
    schemas: consolidatedInspectionBranches,
  },
  status: "stable" as const,
};

export const consolidatedMaterialBranches = {
  create: withToolBranch(createPbrMaterialParameters, "operation", "create"),
  configure: withToolBranch(configureMaterialParameters, "operation", "configure"),
  assign_channel: withToolBranch(
    assignTextureChannelParameters,
    "operation",
    "assign_channel"
  ),
  save: withToolBranch(saveMaterialConfigParameters, "operation", "save"),
} as const;

const consolidatedMaterialParameters = z.union([
  consolidatedMaterialBranches.create,
  consolidatedMaterialBranches.configure,
  consolidatedMaterialBranches.assign_channel,
  consolidatedMaterialBranches.save,
]);

export const consolidatedMaterialToolDocs = {
  name: "manage_material",
  description:
    "Creates, configures, assigns channels, or saves one Bedrock PBR material through one focused boundary.",
  annotations: { title: "Manage Material", destructiveHint: true },
  parameters: consolidatedMaterialParameters,
  branches: {
    discriminator: "operation",
    schemas: consolidatedMaterialBranches,
  },
  status: "stable" as const,
};

export const consolidatedAnimationTimelineBranches = {
  keyframes: withToolBranch(manageKeyframesParameters, "operation", "keyframes"),
  graph: withToolBranch(animationGraphEditorParameters, "operation", "graph"),
  timeline: withToolBranch(animationTimelineParameters, "operation", "timeline"),
  batch: withToolBranch(batchKeyframeOperationsParameters, "operation", "batch"),
  copy_paste: withToolBranch(
    animationCopyPasteParameters,
    "operation",
    "copy_paste"
  ),
} as const;

const consolidatedAnimationTimelineParameters = z.union([
  consolidatedAnimationTimelineBranches.keyframes,
  consolidatedAnimationTimelineBranches.graph,
  consolidatedAnimationTimelineBranches.timeline,
  consolidatedAnimationTimelineBranches.batch,
  consolidatedAnimationTimelineBranches.copy_paste,
]);

export const consolidatedAnimationTimelineToolDocs = {
  name: "manage_animation_timeline",
  description:
    "Authors one Bedrock Animation through keyframes, graph/easing, timeline, coherent batch/copy operations, or a one-call native property cohort.",
  annotations: { title: "Manage Bedrock Animation Timeline", destructiveHint: true },
  parameters: consolidatedAnimationTimelineParameters,
  branches: {
    discriminator: "operation",
    schemas: consolidatedAnimationTimelineBranches,
  },
  status: "stable" as const,
};

export const consolidatedMaterialInstanceBranches = {
  list: withToolBranch(listMaterialInstancesParametersSchema, "operation", "list"),
  get: withToolBranch(getFaceMaterialInstancesParametersSchema, "operation", "get"),
  set: withToolBranch(setFaceMaterialInstanceParametersSchema, "operation", "set"),
  bulk_set: withToolBranch(
    bulkSetMaterialInstancesParametersSchema,
    "operation",
    "bulk_set"
  ),
  clear: withToolBranch(
    clearMaterialInstancesParametersSchema,
    "operation",
    "clear"
  ),
} as const;

const consolidatedMaterialInstancesParameters = z.union([
  consolidatedMaterialInstanceBranches.list,
  consolidatedMaterialInstanceBranches.get,
  consolidatedMaterialInstanceBranches.set,
  consolidatedMaterialInstanceBranches.bulk_set,
  consolidatedMaterialInstanceBranches.clear,
]);

export const consolidatedMaterialInstancesToolDocs = {
  name: "manage_material_instances",
  description:
    "Lists, reads, assigns, bulk-assigns, or clears Bedrock face material instances through one focused boundary.",
  annotations: { title: "Manage Material Instances", destructiveHint: true },
  parameters: consolidatedMaterialInstancesParameters,
  branches: {
    discriminator: "operation",
    schemas: consolidatedMaterialInstanceBranches,
  },
  status: "stable" as const,
};

/**
 * Retain every original executor definition in the canonical registry while
 * removing duplicate public exposure. Consolidation is routing-only: it must
 * never replace, simplify, or delete the original implementation.
 */
function retainExecutorsBehindConsolidatedSurface(
  capability: ConsolidatedCapability,
  updateCatalog: ConsolidatedCatalogUpdate
): void {
  const definitions = getAllToolDefinitions();
  const family = getConsolidatedFamily(capability);
  for (const name of getConsolidatedExecutors(capability)) {
    if (!definitions[name]) {
      throw new Error(
        `Consolidated capability ${capability} requires retained executor ${name}.`
      );
    }
    if (tools[name]) tools[name].enabled = false;
    updateCatalog(name, family, false);
  }
}

async function executeConsolidated(
  capability: ConsolidatedCapability,
  discriminatorValue: string,
  args: Record<string, unknown>
) {
  const target = getConsolidatedExecutor(capability, discriminatorValue);
  const definition = getAllToolDefinitions()[target];
  if (!definition) {
    throw new Error(
      `Consolidated capability ${capability} executor ${target} is unavailable.`
    );
  }
  return definition.execute(args);
}

function exposeConsolidatedCapability(
  capability: ConsolidatedCapability,
  updateCatalog: ConsolidatedCatalogUpdate
): void {
  updateCatalog(capability, getConsolidatedFamily(capability), true);
}

export function registerConsolidatedTools(
  updateCatalog: ConsolidatedCatalogUpdate
): void {
  if (!tools.inspect_elements) {
    createTool(
      "inspect_elements",
      {
        ...consolidatedInspectionToolDocs,
        async execute(request) {
          const { mode, ...args } = request;
          return executeConsolidated("inspect_elements", mode, args);
        },
      },
      "stable"
    );
    retainExecutorsBehindConsolidatedSurface(
      "inspect_elements",
      updateCatalog
    );
    exposeConsolidatedCapability("inspect_elements", updateCatalog);
  }

  if (!tools.manage_material) {
    createTool(
      "manage_material",
      {
        ...consolidatedMaterialToolDocs,
        async execute(request) {
          const { operation, ...args } = request;
          return executeConsolidated("manage_material", operation, args);
        },
      },
      "stable"
    );
    retainExecutorsBehindConsolidatedSurface(
      "manage_material",
      updateCatalog
    );
    exposeConsolidatedCapability("manage_material", updateCatalog);
  }

  if (!tools.manage_animation_timeline) {
    createTool(
      "manage_animation_timeline",
      {
        ...consolidatedAnimationTimelineToolDocs,
        async execute(request) {
          const operation = String(request.operation);
          const { operation: _operation, ...args } = request;
          return executeConsolidated(
            "manage_animation_timeline",
            operation,
            args
          );
        },
      },
      "stable"
    );
    retainExecutorsBehindConsolidatedSurface(
      "manage_animation_timeline",
      updateCatalog
    );
    exposeConsolidatedCapability("manage_animation_timeline", updateCatalog);
  }

  if (!tools.manage_material_instances) {
    createTool(
      "manage_material_instances",
      {
        ...consolidatedMaterialInstancesToolDocs,
        async execute(request) {
          const { operation, ...args } = request;
          return executeConsolidated(
            "manage_material_instances",
            operation,
            args
          );
        },
      },
      "stable"
    );
    retainExecutorsBehindConsolidatedSurface(
      "manage_material_instances",
      updateCatalog
    );
    exposeConsolidatedCapability("manage_material_instances", updateCatalog);
  }
}
