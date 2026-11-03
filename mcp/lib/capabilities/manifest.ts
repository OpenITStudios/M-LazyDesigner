import type { McpToolStageCategory } from "./authoringStage";

export type CapabilityTier =
  | "primary"
  | "support"
  | "experimental"
  | "maintenance";

export type CapabilityExecutionClass = "fast" | "normal" | "heavy";
export type CapabilityDiscoveryMode = "intent" | "exact_only";
export type CapabilityOperationClass =
  | "QUERY"
  | "MUTATION"
  | "PREVIEW"
  | "EXPORT"
  | "CONTROL"
  | "VALIDATION"
  | "UNKNOWN";
export type CapabilityVerificationClass =
  | "not_applicable"
  | "receipt_only"
  | "focused_read"
  | "visual";

export const CAPABILITY_SEMANTIC_SCOPES = [
  "GEOMETRY_STRUCTURE",
  "UV_MAPPING",
  "TEXTURE_APPEARANCE",
  "MATERIAL_RENDER",
  "ANIMATION_MOTION",
  "ANIMATION_CONTROLLER",
  "ANIMATION_EFFECTS",
  "PARTICLE_SYSTEM",
] as const;

export type CapabilitySemanticScope =
  (typeof CAPABILITY_SEMANTIC_SCOPES)[number];

export type CapabilityStateClass =
  | "cross_authoring"
  | "geometry"
  | "uv"
  | "texture_appearance"
  | "texture_material"
  | "material_render"
  | "animation_motion"
  | "animation_controller"
  | "animation_effects"
  | "particle"
  | "persistence";

export type CapabilityLifecycleStage = "active" | "deprecated";
export type CapabilityLifecycle = {
  stage: CapabilityLifecycleStage;
  replacement: string | null;
};

export type CapabilityEffects = {
  projectAffinity: "preserve" | "adopt_created_project";
  phaseAffinity: "preserve" | "update_from_result";
  invalidateCatalog: boolean;
};

export type CapabilityCoreManifestEntry = {
  tier?: CapabilityTier;
  aliases?: readonly string[];
  stage?: McpToolStageCategory;
  executionClass?: CapabilityExecutionClass;
  discoveryMode?: CapabilityDiscoveryMode;
  operationClass?: Exclude<CapabilityOperationClass, "UNKNOWN">;
  verificationClass?: CapabilityVerificationClass;
  stateClass?: CapabilityStateClass;
  defaultStaleScopes?: readonly CapabilitySemanticScope[];
  lifecycle?: CapabilityLifecycle;
  effects?: CapabilityEffects;
};

/**
 * Canonical capability metadata declaration.
 *
 * Each capability is declared once. Search/routing, stage, semantic-state,
 * verification, execution-cost and lifecycle projections read from this table
 * instead of maintaining parallel membership lists.
 *
 * Omitted properties intentionally use the public defaults in
 * capabilityMetadata.ts.
 */
export const CAPABILITY_DEFINITIONS = {
  "activate_texture": { stage: "texturing", operationClass: "CONTROL" },
  "add_group": { tier: "primary", stage: "geometry", stateClass: "geometry", defaultStaleScopes: ["GEOMETRY_STRUCTURE","ANIMATION_MOTION"], verificationClass: "focused_read", aliases: ["create bone","create bones","add bone","add bones","group batch","bone batch"] },
  "add_texture_group": { stage: "texturing", stateClass: "texture_material", defaultStaleScopes: ["TEXTURE_APPEARANCE","MATERIAL_RENDER"], verificationClass: "focused_read" },
  "animation_copy_paste": { discoveryMode: "exact_only", stage: "animation", stateClass: "animation_motion", defaultStaleScopes: ["ANIMATION_MOTION"], verificationClass: "visual" },
  "animation_graph_editor": { discoveryMode: "exact_only", stage: "animation", stateClass: "animation_motion", defaultStaleScopes: ["ANIMATION_MOTION"], verificationClass: "visual" },
  "animation_timeline": { discoveryMode: "exact_only", stage: "animation", stateClass: "animation_motion", defaultStaleScopes: ["ANIMATION_MOTION"], verificationClass: "visual" },
  "apply_texture": { discoveryMode: "exact_only", stage: "texturing", stateClass: "texture_appearance", defaultStaleScopes: ["TEXTURE_APPEARANCE"], verificationClass: "visual", aliases: ["assign texture","texture cube","texture face","map texture"] },
  "assign_texture_channel": { discoveryMode: "exact_only", stage: "texturing", stateClass: "material_render", defaultStaleScopes: ["MATERIAL_RENDER"], verificationClass: "focused_read" },
  "batch_keyframe_operations": { discoveryMode: "exact_only", stage: "animation", stateClass: "animation_motion", defaultStaleScopes: ["ANIMATION_MOTION"], verificationClass: "visual" },
  "bone_rigging": { stage: "geometry", stateClass: "geometry", defaultStaleScopes: ["GEOMETRY_STRUCTURE","ANIMATION_MOTION"], verificationClass: "focused_read", aliases: ["inverse kinematics","ik target","ik controller","ik root","ik source","ik pole","pole vector","mirror bone","rig mirror"] },
  "bulk_set_material_instances": { discoveryMode: "exact_only", stage: "texturing", stateClass: "material_render", defaultStaleScopes: ["MATERIAL_RENDER"], verificationClass: "focused_read" },
  "capture_model_views": { tier: "primary", stage: "core", operationClass: "PREVIEW", executionClass: "heavy", verificationClass: "visual" },
  "clear_material_instances": { discoveryMode: "exact_only", stage: "texturing", stateClass: "material_render", defaultStaleScopes: ["MATERIAL_RENDER"], verificationClass: "focused_read" },
  "color_picker_tool": { stage: "texturing", operationClass: "CONTROL" },
  "configure_material": { discoveryMode: "exact_only", stage: "texturing", stateClass: "material_render", defaultStaleScopes: ["MATERIAL_RENDER"], verificationClass: "focused_read" },
  "copy_brush_tool": { tier: "primary", stage: "texturing", stateClass: "texture_appearance", defaultStaleScopes: ["TEXTURE_APPEARANCE"], verificationClass: "visual" },
  "create_animation": { tier: "primary", stage: "animation", stateClass: "animation_motion", defaultStaleScopes: ["ANIMATION_MOTION"], verificationClass: "visual" },
  "create_brush_preset": { stage: "texturing", operationClass: "CONTROL" },
  "create_pbr_material": { discoveryMode: "exact_only", stage: "texturing", stateClass: "material_render", defaultStaleScopes: ["MATERIAL_RENDER"], verificationClass: "focused_read" },
  "create_project": { stage: "core", stateClass: "cross_authoring", defaultStaleScopes: ["GEOMETRY_STRUCTURE","UV_MAPPING","TEXTURE_APPEARANCE","MATERIAL_RENDER","ANIMATION_MOTION","ANIMATION_CONTROLLER","ANIMATION_EFFECTS","PARTICLE_SYSTEM"], verificationClass: "focused_read", effects: {projectAffinity: "adopt_created_project",phaseAffinity: "preserve",invalidateCatalog: true} },
  "create_texture": { tier: "primary", stage: "texturing", stateClass: "texture_appearance", defaultStaleScopes: ["TEXTURE_APPEARANCE"], verificationClass: "visual" },
  "draw_shape_tool": { tier: "primary", stage: "texturing", stateClass: "texture_appearance", defaultStaleScopes: ["TEXTURE_APPEARANCE"], verificationClass: "visual" },
  "duplicate_element": { stage: "geometry", stateClass: "geometry", defaultStaleScopes: ["GEOMETRY_STRUCTURE","UV_MAPPING","TEXTURE_APPEARANCE","ANIMATION_MOTION"], verificationClass: "visual" },
  "emulate_clicks": { tier: "maintenance", operationClass: "CONTROL" },
  "eraser_tool": { tier: "primary", stage: "texturing", stateClass: "texture_appearance", defaultStaleScopes: ["TEXTURE_APPEARANCE"], verificationClass: "visual" },
  "export_model": { tier: "primary", stage: "core", operationClass: "EXPORT", executionClass: "heavy" },
  "fill_dialog": { tier: "maintenance", operationClass: "CONTROL" },
  "filter_by_material": { stage: "texturing" },
  "from_geo_json": { tier: "maintenance", operationClass: "MUTATION" },
  "get_face_material_instances": { discoveryMode: "exact_only", stage: "texturing" },
  "get_material_info": { stage: "texturing" },
  "get_project_info": { tier: "primary", stage: "core", executionClass: "fast" },
  "get_selection": { stage: "geometry" },
  "get_texture": { tier: "primary", stage: "texturing", executionClass: "fast" },
  "get_undo_stack": { stage: "core", executionClass: "fast" },
  "gradient_tool": { tier: "primary", stage: "texturing", stateClass: "texture_appearance", defaultStaleScopes: ["TEXTURE_APPEARANCE"], verificationClass: "visual" },
  "import_texture_set": { stage: "texturing", stateClass: "texture_material", defaultStaleScopes: ["TEXTURE_APPEARANCE","MATERIAL_RENDER"], verificationClass: "focused_read" },
  "inspect_animation": { tier: "primary", stage: "animation", executionClass: "fast" },
  "inspect_elements": { tier: "primary", stage: "core", executionClass: "fast" },
  "inspect_model_bounds": { stage: "core" },
  "inspect_particle": { tier: "primary", stage: "animation", executionClass: "fast", aliases: ["inspect particle","inspect particle emitter","inspect snowstorm particle","inspect particle molang"] },
  "list_material_instances": { discoveryMode: "exact_only", stage: "texturing" },
  "list_materials": { stage: "texturing" },
  "list_textures": { tier: "primary", stage: "core", executionClass: "fast" },
  "load_brush_preset": { stage: "texturing", operationClass: "CONTROL" },
  "manage_animation_controller": { tier: "primary", stage: "animation", stateClass: "animation_controller", defaultStaleScopes: ["ANIMATION_CONTROLLER"], verificationClass: "focused_read", aliases: ["state machine","nested controller","blend curve","transition curve","controller animasi","state animasi","transisi animasi"] },
  "manage_animation_effects": { tier: "primary", stage: "animation", stateClass: "animation_effects", defaultStaleScopes: ["ANIMATION_EFFECTS"], verificationClass: "focused_read", aliases: ["animation sound","animation particle","animation timeline event","suara animasi","particle animasi","efek animasi"] },
  "manage_animation_timeline": { tier: "primary", stage: "animation", stateClass: "animation_motion", defaultStaleScopes: ["ANIMATION_MOTION"], verificationClass: "visual", aliases: ["animation properties","native animation properties","animation molang","rotation space","tambah keyframe","ubah keyframe","atur timeline animasi"] },
  "manage_cubes": { tier: "primary", stage: "geometry", stateClass: "geometry", defaultStaleScopes: ["GEOMETRY_STRUCTURE","UV_MAPPING","TEXTURE_APPEARANCE","ANIMATION_MOTION"], verificationClass: "visual", aliases: ["geometry create","create cube","create cubes","cube batch","bedrock geometry","geometry batch","buat kubus","ubah ukuran kubus","geser kubus"] },
  "manage_keyframes": { discoveryMode: "exact_only", stage: "animation", stateClass: "animation_motion", defaultStaleScopes: ["ANIMATION_MOTION"], verificationClass: "visual" },
  "manage_locator": { tier: "primary", stage: "geometry", stateClass: "geometry", defaultStaleScopes: ["GEOMETRY_STRUCTURE","ANIMATION_EFFECTS"], verificationClass: "focused_read", aliases: ["locator","attachment point","socket","anchor point","titik attachment","titik pegangan"] },
  "manage_material": { tier: "primary", stage: "texturing", stateClass: "material_render", defaultStaleScopes: ["MATERIAL_RENDER"], verificationClass: "focused_read" },
  "manage_material_instances": { tier: "primary", stage: "texturing", stateClass: "material_render", defaultStaleScopes: ["MATERIAL_RENDER"], verificationClass: "focused_read" },
  "manage_null_object": { stage: "geometry", stateClass: "geometry", defaultStaleScopes: ["GEOMETRY_STRUCTURE","ANIMATION_MOTION"], verificationClass: "focused_read" },
  "manage_particle": { tier: "primary", stage: "animation", stateClass: "particle", defaultStaleScopes: ["PARTICLE_SYSTEM"], verificationClass: "focused_read", aliases: ["author particle emitter","bedrock particle","snowstorm","author particle molang","buat particle","ubah particle","asap particle"] },
  "manage_render_profile": { tier: "primary", stage: "texturing", stateClass: "material_render", defaultStaleScopes: ["MATERIAL_RENDER"], verificationClass: "focused_read", aliases: ["alpha cutout translucent","render material","entity alphatest alphablend emissive"] },
  "manage_uv_layout": { tier: "primary", stage: "geometry", stateClass: "uv", defaultStaleScopes: ["UV_MAPPING","TEXTURE_APPEARANCE"], verificationClass: "visual", aliases: ["uv layout","uv pack","uv mapping","texel density","repack uv","pack islands","atur uv","rapikan uv"] },
  "modify_group": { tier: "primary", stage: "geometry", stateClass: "geometry", defaultStaleScopes: ["GEOMETRY_STRUCTURE","ANIMATION_MOTION"], verificationClass: "focused_read", aliases: ["set pivot","bone pivot","group pivot","move group","translate group","ubah pivot","geser tulang","ubah posisi bone"] },
  "paint_fill_tool": { tier: "primary", stage: "texturing", stateClass: "texture_appearance", defaultStaleScopes: ["TEXTURE_APPEARANCE"], verificationClass: "visual" },
  "paint_settings": { stage: "texturing", operationClass: "CONTROL" },
  "paint_texture_transaction": { tier: "primary", stage: "texturing", stateClass: "texture_appearance", defaultStaleScopes: ["TEXTURE_APPEARANCE"], executionClass: "heavy", verificationClass: "visual", aliases: ["atomic paint","exact pixel","exact pixels","revision protected paint","cat pixel tepat","ubah pixel persis","edit pixel presisi"] },
  "paint_with_brush": { tier: "primary", stage: "texturing", stateClass: "texture_appearance", defaultStaleScopes: ["TEXTURE_APPEARANCE"], verificationClass: "visual" },
  "render_publication": { tier: "support", stage: "core", operationClass: "EXPORT", executionClass: "heavy", verificationClass: "receipt_only", aliases: ["blender cycles", "beauty render", "studio render", "publication PNG", "render final 3d model"] },
  "redo": { tier: "primary", stage: "core", stateClass: "cross_authoring", defaultStaleScopes: ["GEOMETRY_STRUCTURE","UV_MAPPING","TEXTURE_APPEARANCE","MATERIAL_RENDER","ANIMATION_MOTION","ANIMATION_CONTROLLER","ANIMATION_EFFECTS","PARTICLE_SYSTEM"], verificationClass: "visual" },
  "remove_element": { tier: "primary", stage: "geometry", stateClass: "geometry", defaultStaleScopes: ["GEOMETRY_STRUCTURE","UV_MAPPING","TEXTURE_APPEARANCE","ANIMATION_MOTION"], verificationClass: "focused_read" },
  "rename_element": { tier: "primary", stage: "geometry", stateClass: "geometry", defaultStaleScopes: ["GEOMETRY_STRUCTURE","ANIMATION_MOTION"], verificationClass: "focused_read" },
  "reparent_element": { tier: "primary", stage: "geometry", stateClass: "geometry", defaultStaleScopes: ["GEOMETRY_STRUCTURE","ANIMATION_MOTION"], verificationClass: "focused_read", aliases: ["parent bone","unparent bone","reparent bone","move parent","change parent"] },
  "risky_eval": { tier: "maintenance", operationClass: "CONTROL" },
  "save_material_config": { discoveryMode: "exact_only", stage: "texturing", stateClass: "persistence", defaultStaleScopes: [], verificationClass: "focused_read" },
  "select_all_of_type": { stage: "geometry", operationClass: "CONTROL" },
  "set_face_material_instance": { discoveryMode: "exact_only", stage: "texturing", stateClass: "material_render", defaultStaleScopes: ["MATERIAL_RENDER"], verificationClass: "focused_read" },
  "switch_authoring_phase": { tier: "primary", stage: "core", operationClass: "CONTROL", verificationClass: "focused_read", effects: {projectAffinity: "preserve",phaseAffinity: "update_from_result",invalidateCatalog: true} },
  "texture_layer_management": { tier: "primary", stage: "texturing", stateClass: "texture_appearance", defaultStaleScopes: ["TEXTURE_APPEARANCE"], verificationClass: "visual" },
  "texture_selection": { stage: "texturing", operationClass: "CONTROL" },
  "trigger_action": { tier: "maintenance", operationClass: "CONTROL" },
  "undo": { tier: "primary", stage: "core", stateClass: "cross_authoring", defaultStaleScopes: ["GEOMETRY_STRUCTURE","UV_MAPPING","TEXTURE_APPEARANCE","MATERIAL_RENDER","ANIMATION_MOTION","ANIMATION_CONTROLLER","ANIMATION_EFFECTS","PARTICLE_SYSTEM"], verificationClass: "visual" },
} as const satisfies Readonly<Record<string, CapabilityCoreManifestEntry>>;

export const CAPABILITY_CORE_MANIFEST: ReadonlyMap<
  string,
  CapabilityCoreManifestEntry
> = new Map(Object.entries(CAPABILITY_DEFINITIONS));

export function getCapabilityCoreManifestEntry(
  name: string
): CapabilityCoreManifestEntry | null {
  return CAPABILITY_CORE_MANIFEST.get(name) ?? null;
}

export function capabilityStageByName(
  name: string
): McpToolStageCategory | null {
  return CAPABILITY_CORE_MANIFEST.get(name)?.stage ?? null;
}

export function capabilitiesByStateClass(
  ...classes: readonly CapabilityStateClass[]
): string[] {
  const wanted = new Set(classes);
  return [...CAPABILITY_CORE_MANIFEST.entries()]
    .filter(([, entry]) => entry.stateClass && wanted.has(entry.stateClass))
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

export function capabilityDefaultStaleScopes(
  name: string
): CapabilitySemanticScope[] {
  return [...(CAPABILITY_CORE_MANIFEST.get(name)?.defaultStaleScopes ?? [])];
}

export function capabilityOperationClassByName(
  name: string
): CapabilityOperationClass {
  const entry = CAPABILITY_CORE_MANIFEST.get(name);
  if (!entry) return "UNKNOWN";
  if (entry.operationClass) return entry.operationClass;
  if (entry.stateClass) return "MUTATION";
  return "QUERY";
}

// Compatibility alias for older internal callers.
export const capabilityPhaseByName = capabilityStageByName;
