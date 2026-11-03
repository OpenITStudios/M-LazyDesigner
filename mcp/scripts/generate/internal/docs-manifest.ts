import { z } from "zod";
import { particleToolDocs } from "../../../server/tools/particle";
import { particleReferenceResourceDocs } from "../../../server/resources/particle";
import { paintTextureTransactionToolDocs } from "../../../server/tools/paint-texture-transaction";
import { wiredCreateTextureParameters } from "../../../server/runtime/textureRuntimeContracts";
import { focusedGetTextureParameters } from "../../../lib/textureEvidence";
import { animationAwareCaptureModelViewsParameters, focusedInspectAnimationParameters } from "../../../server/runtime/animationRuntimeContracts";
import { completeAnimationTimelineParameters, animationNativePropertiesParameters } from "../../../server/tools/animation-native-intelligence";
import { completeAnimationControllerParameters } from "../../../server/tools/animation-runtime-resource-intelligence";
import type { ToolSpec, PromptSpec, ResourceSpec } from "../../../lib/factories";

// Tool docs imports — each file exports schemas at module level with zero Blockbench deps
import { cameraToolDocs } from "../../../server/tools/camera";
import { publicationRenderToolDoc } from "../../../server/tools/inspection/publication";
import { cubeToolDocs } from "../../../server/tools/cubes";
import { elementToolDocs } from "../../../server/tools/element";
import { elementInspectionToolDocs } from "../../../server/tools/element-inspection";
import { locatorToolDocs } from "../../../server/tools/locators";
import { importToolDocs } from "../../../server/tools/import";
import { paintToolDocs } from "../../../server/tools/paint";
import { projectToolDocs } from "../../../server/tools/project";
import { textureToolDocs } from "../../../server/tools/texture";
import { renderProfileToolDocs } from "../../../server/tools/render-profile";
import { animationToolDocs } from "../../../server/tools/animation";
import { animationEffectToolDocs } from "../../../server/tools/animation-effects";
import { animationControllerToolDocs } from "../../../server/tools/animation/controllerSchema";
import { animationInspectionToolDocs } from "../../../server/tools/animation-inspection";
import { uiToolDocs } from "../../../server/tools/ui";
import { materialInstanceToolDocs } from "../../../server/tools/material-instances";
import { historyToolDocs } from "../../../server/tools/history";
import { exportToolDocs } from "../../../server/tools/export";
import { textureAuthoringKnowledgeResourceDocs } from "../../../server/resources/texture-authoring-knowledge";
import { consolidatedInspectionToolDocs, consolidatedMaterialToolDocs, consolidatedAnimationTimelineToolDocs, consolidatedMaterialInstancesToolDocs, phaseControlToolDocs } from "../../../server/tools";

export interface CategoryGroup {
  category: string;
  tools: ToolSpec[];
}

export const toolManifest: CategoryGroup[] = [
  { category: "Cubes", tools: cubeToolDocs },
  { category: "Camera & Screenshots", tools: cameraToolDocs.map((tool) => tool.name === "capture_model_views" ? { ...tool, parameters: animationAwareCaptureModelViewsParameters } : tool) },
  {
    category: "Animation",
    tools: [
      {
        ...consolidatedAnimationTimelineToolDocs,
        parameters: completeAnimationTimelineParameters,
        branches: {
          ...consolidatedAnimationTimelineToolDocs.branches,
          schemas: {
            ...consolidatedAnimationTimelineToolDocs.branches.schemas,
            properties: animationNativePropertiesParameters,
          },
        },
      },
      ...animationToolDocs.filter((tool) => !["manage_keyframes", "animation_graph_editor", "animation_timeline", "batch_keyframe_operations", "animation_copy_paste"].includes(tool.name)),
      ...animationEffectToolDocs,
      ...animationControllerToolDocs.map((tool) => ({ ...tool, parameters: completeAnimationControllerParameters })),
      ...particleToolDocs,
      ...animationInspectionToolDocs.map((tool) => tool.name === "inspect_animation" ? { ...tool, parameters: focusedInspectAnimationParameters } : tool),
    ],
  },
  { category: "Elements", tools: [consolidatedInspectionToolDocs, ...elementToolDocs.filter((tool) => !["list_outline", "find_elements_by_criteria"].includes(tool.name)), ...elementInspectionToolDocs.filter((tool) => tool.name !== "inspect_element"), ...locatorToolDocs] },
  { category: "Export", tools: [...exportToolDocs, publicationRenderToolDoc] },
  { category: "History", tools: historyToolDocs },
  { category: "Import/Export", tools: importToolDocs },
  { category: "Material Instances", tools: [consolidatedMaterialInstancesToolDocs, ...materialInstanceToolDocs.filter((tool) => !["get_face_material_instances", "set_face_material_instance", "list_material_instances", "bulk_set_material_instances", "clear_material_instances"].includes(tool.name))] },
  { category: "Paint Tools", tools: [...paintToolDocs, paintTextureTransactionToolDocs] },
  { category: "Project", tools: [...projectToolDocs, phaseControlToolDocs] },
  { category: "Textures", tools: [renderProfileToolDocs, consolidatedMaterialToolDocs, ...textureToolDocs.map((tool) => tool.name === "create_texture" ? { ...tool, parameters: wiredCreateTextureParameters } : tool.name === "get_texture" ? { ...tool, parameters: focusedGetTextureParameters } : tool).filter((tool) => !["create_pbr_material", "configure_material", "assign_texture_channel", "save_material_config"].includes(tool.name))] },
  { category: "UI Interaction", tools: uiToolDocs },
];

// Only runtime-callable prompts belong in generated MCP API docs.
// Maintainer/reference markdown under prompts/ remains source documentation.
export const promptDocs: PromptSpec[] = [
  {
    name: "bedrock_entity_workflow",
    title: "Minecraft Bedrock Entity Workflow",
    description:
      "Compact LazyDesigner workflow for Bedrock Entity authoring: minimum evidence, visual gates, bounded correction, downstream readiness, protected native gaps, and Bedrock/.bbmodel export.",
    argsSchema: z.object({}),
    status: "stable",
  },
];

// Resource specs defined inline or imported from resource owners that are free of Blockbench-global execution.
export const resourceDocs: ResourceSpec[] = [
  ...particleReferenceResourceDocs,
  {
    name: "projects",
    uriTemplate: "projects://{id}",
    title: "Blockbench Projects",
    description:
      "Browse Blockbench project metadata by stable resource URI. Use focused project tools when a modelling decision needs current operational state rather than browsing context.",
  },
  {
    name: "nodes",
    uriTemplate: "nodes://{id}",
    title: "Blockbench Nodes",
    description:
      "Broad read-only Blockbench node observability retained for native gaps such as TextureMesh. It is not a focused authored-state owner; prefer dedicated inspection tools when available.",
  },
  {
    name: "textures",
    uriTemplate: "textures://{id}",
    title: "Blockbench Textures",
    description:
      "Browse Texture metadata by URI. This resource does not return raw image/source payload; use `get_texture` when image data is actually needed.",
  },
  {
    name: "reference_models",
    uriTemplate: "reference-models://{id}",
    title: "Reference Models",
    description:
      "Returns information about reference models in the current Blockbench project. Requires the Reference Models plugin. List URIs use the slugified name (e.g. `reference-models://turntable`) when unique, with a `~<uuid-prefix>` suffix on collision. Reads also accept the raw UUID or exact name.",
  },
  {
    name: "validator-status",
    uriTemplate: "validator://status",
    title: "Validator Status",
    description:
      "Returns the current validation status. Any elementRefs are best-effort message-text inferences and are explicitly marked non-authoritative.",
  },
  {
    name: "validator-checks",
    uriTemplate: "validator://checks/{id}",
    title: "Validator Checks",
    description:
      "Returns information about registered validator checks. Use without an ID to list all checks, or provide a check ID to get details about a specific check.",
  },
  {
    name: "validator-warnings",
    uriTemplate: "validator://warnings",
    title: "Validator Warnings",
    description:
      "Returns current validation warnings. Any elementRefs are best-effort message-text inferences and are explicitly marked non-authoritative.",
  },
  {
    name: "validator-errors",
    uriTemplate: "validator://errors",
    title: "Validator Errors",
    description:
      "Returns current validation errors. Any elementRefs are best-effort message-text inferences and are explicitly marked non-authoritative.",
  },
  textureAuthoringKnowledgeResourceDocs,
];