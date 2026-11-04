import type {
  CapabilityBranchHint,
  CapabilityFact,
} from "./types";
import type { CapabilityOperationClass } from "../../lib/capabilities/manifest";
import {
  capabilitySemanticId,
  type CapabilitySemanticId,
} from "../../lib/semantic/identity";

export type {
  CapabilityBranchHint,
  CapabilityFact,
} from "./types";

export type CapabilitySemanticSpec = {
  intents: readonly string[];
  nouns?: readonly string[];
  verbs?: readonly string[];
  excludes?: readonly string[];
  examples?: readonly string[];
};

export type CapabilityGraphSpec = {
  requires?: readonly CapabilityFact[];
  produces?: readonly CapabilityFact[];
  invalidates?: readonly CapabilityFact[];
  predecessor?: {
    capability: string;
    branch?: CapabilityBranchHint;
  };
};

export type CapabilityBranchManifestEntry = {
  id: CapabilitySemanticId;
  capability: string;
  branch?: CapabilityBranchHint;
  schemaFields?: readonly string[];
  semantic?: CapabilitySemanticSpec;
  operationClass?: CapabilityOperationClass;
  executionClass?: "fast" | "normal" | "heavy";
  verificationClass?: "not_applicable" | "receipt_only" | "focused_read" | "visual";
  nestedActions?: Readonly<Record<string, CapabilityOperationClass>>;
  graph?: CapabilityGraphSpec;
};

/**
 * Canonical branch-level capability semantics.
 *
 * This owns branch identity once and projects it into:
 * - Gateway semantic retrieval;
 * - precondition/effect graph;
 * - deferred schema projection.
 *
 * Runtime executor schemas remain authoritative for validation.
 */
// One readiness contract for every native timeline editing branch. Branch
// input schemas and the nested action manifest remain the execution authority.
const ANIMATION_TIMELINE_GRAPH: CapabilityGraphSpec = {
  requires: ["project_bound", "animation_available"],
  produces: ["animation_available"],
  invalidates: ["visual_evidence_current"],
};

const CAPABILITY_BRANCH_SPECS: readonly Omit<
  CapabilityBranchManifestEntry,
  "id"
>[] = [
  {
    capability: "blender_render",
    branch: { field: "operation", value: "auto" },
    schemaFields: ["operation", "options"],
    operationClass: "EXPORT",
    executionClass: "heavy",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["render the current Blockbench model automatically with Blender Cycles in one request"],
      nouns: ["render", "model", "Blockbench", "asset", "Blender", "Cycles"],
      verbs: ["render", "start", "create"],
      excludes: ["generate AI image", "edit geometry", "skip fidelity checks"],
      examples: ["render the current Blockbench model automatically", "render objek ini"],
    },
  },
  {
    capability: "blender_render",
    branch: { field: "operation", value: "start" },
    schemaFields: ["operation", "handoff_path", "request"],
    operationClass: "EXPORT",
    executionClass: "heavy",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["start independent Blender Cycles rendering from verified Blockbench GLB handoff"],
      nouns: ["Blender", "Cycles", "MCP", "GLB", "handoff", "renderer"],
      verbs: ["start", "render", "control"],
      excludes: ["modify native Blockbench model", "generate AI image", "execute arbitrary Blender Python"],
      examples: ["render this GLB handoff with Blender MCP", "start the independent Blender Cycles renderer"],
    },
  },
  {
    capability: "blender_render",
    branch: { field: "operation", value: "status" },
    schemaFields: ["operation", "job_id"],
    operationClass: "QUERY",
    executionClass: "fast",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["check an independent Blender MCP render job"],
      nouns: ["Blender", "render", "status", "job"],
      verbs: ["check", "status", "inspect"],
      examples: ["check Blender MCP job status"],
    },
  },
  {
    capability: "blender_render",
    branch: { field: "operation", value: "preview" },
    schemaFields: ["operation", "job_id"],
    operationClass: "QUERY",
    executionClass: "fast",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["show the actual Cycles PNG preview from Blender MCP"],
      nouns: ["Blender", "Cycles", "PNG", "preview"],
      verbs: ["show", "preview", "inspect"],
      examples: ["show the Blender MCP output preview"],
    },
  },
  {
    capability: "blender_render",
    branch: { field: "operation", value: "cancel" },
    schemaFields: ["operation", "job_id"],
    operationClass: "CONTROL",
    executionClass: "fast",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["cancel the independent Blender MCP Cycles render job"],
      nouns: ["Blender", "job", "cancel"],
      verbs: ["cancel", "stop"],
      examples: ["cancel the current Blender MCP job"],
    },
  },
  {
    capability: "blender_render",
    branch: { field: "operation", value: "recover" },
    schemaFields: ["operation", "receipt_path"],
    operationClass: "CONTROL",
    executionClass: "fast",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["recover completed Blender Cycles job status after Gateway restart"],
      nouns: ["Blender", "render", "recovery", "completed", "receipt"],
      verbs: ["recover", "restore", "inspect"],
      excludes: ["restart failed Cycles job", "resume crashed Blender subprocess"],
      examples: ["recover completed Blender render receipt after Gateway restart"],
    },
  },
  {
    capability: "blender_render",
    branch: { field: "operation", value: "release" },
    schemaFields: ["operation", "handoff_path"],
    operationClass: "CONTROL",
    executionClass: "fast",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["release an unused verified Blockbench GLB handoff after rendering"],
      nouns: ["Blender", "Blockbench", "handoff", "GLB", "cleanup"],
      verbs: ["release", "clean", "remove"],
      excludes: ["delete project", "delete final PNG", "delete unrelated folder"],
      examples: ["release the verified Blockbench GLB handoff I finished using"],
    },
  },
  {
    capability: "render_publication",
    branch: { field: "operation", value: "handoff" },
    schemaFields: ["operation", "request"],
    operationClass: "EXPORT",
    executionClass: "heavy",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["prepare Blockbench GLB handoff for independent Blender MCP rendering"],
      nouns: ["Blockbench", "GLB", "Blender", "handoff", "model", "snapshot"],
      verbs: ["prepare", "export", "handoff"],
      excludes: ["render final PNG", "import Blender scene", "generate AI image"],
      examples: ["prepare a GLB handoff for Blender renderer", "export the current authored model to the Blender MCP"],
    },
  },
  {
    capability: "render_publication",
    branch: { field: "operation", value: "start" },
    schemaFields: ["operation", "request"],
    operationClass: "EXPORT",
    executionClass: "heavy",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["start actual 3D Blender render", "render publication-quality model PNG", "create beauty render from Blockbench"],
      nouns: ["render", "cycles", "blender", "PNG", "studio", "publication"],
      verbs: ["render", "start", "export", "produce"],
      excludes: ["generate AI image", "screenshot QA evidence", "repair geometry"],
      examples: ["start rendering my current real model as a studio PNG", "render this model with Blender Cycles"],
    },
  },
  {
    capability: "render_publication",
    branch: { field: "operation", value: "status" },
    schemaFields: ["operation", "job_id"],
    operationClass: "QUERY",
    executionClass: "fast",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["check publication render job progress", "get finished Blender render output"],
      nouns: ["render", "job", "PNG", "status", "progress"],
      verbs: ["check", "inspect", "status", "retrieve"],
      examples: ["check render job status", "is the Blender publication render finished"],
    },
  },
  {
    capability: "render_publication",
    branch: { field: "operation", value: "preview" },
    schemaFields: ["operation", "job_id"],
    operationClass: "QUERY",
    executionClass: "fast",
    verificationClass: "receipt_only",
    semantic: {
      intents: [
        "show actual Blender render preview for visual review",
        "inspect completed Cycles beauty render image",
        "look at rendered model lighting, shadows and materials",
      ],
      nouns: ["preview", "render", "image", "Cycles", "lighting", "materials", "composition"],
      verbs: ["preview", "inspect", "show", "review"],
      excludes: ["generate a new reference image", "capture editor viewport screenshot"],
      examples: [
        "show me the finished Blender render preview",
        "inspect the Cycles PNG visually before deciding if lighting needs adjustment",
      ],
    },
  },
  {
    capability: "render_publication",
    branch: { field: "operation", value: "cancel" },
    schemaFields: ["operation", "job_id"],
    operationClass: "CONTROL",
    executionClass: "fast",
    verificationClass: "receipt_only",
    semantic: {
      intents: ["cancel publication render job", "stop running Cycles render"],
      nouns: ["render", "job", "cancel", "Blender"],
      verbs: ["cancel", "stop", "terminate"],
      examples: ["stop my active render job"],
    },
  },
  {
    capability: "manage_cubes",
    branch: { field: "operation", value: "create" },
    schemaFields: ["operation"],
    semantic: {
      intents: ["create cube geometry", "build model part", "add cuboid"],
      nouns: ["cube", "geometry", "body", "part", "limb", "block"],
      verbs: ["create", "add", "build", "make"],
      excludes: ["texture", "uv", "animation"],
      examples: ["make four table legs", "add a cube for the head"],
    },
    graph: {
      requires: ["project_bound"],
      produces: ["geometry_available"],
      invalidates: [
        "uv_plan_available",
        "uv_layout_current",
        "texture_alignment_current",
        "visual_evidence_current",
      ],
    },
  },
  {
    capability: "manage_cubes",
    branch: { field: "operation", value: "update" },
    schemaFields: ["operation"],
    semantic: {
      intents: [
        "adjust proportions",
        "resize existing geometry",
        "move cube",
        "rotate cube",
        "correct model shape",
      ],
      nouns: ["cube", "geometry", "part", "body", "limb", "leg", "head"],
      verbs: [
        "resize",
        "adjust",
        "lengthen",
        "shorten",
        "move",
        "rotate",
        "scale",
        "thicken",
        "narrow",
      ],
      excludes: ["reparent", "rename", "uv", "texture"],
      examples: ["make the chair leg taller", "reduce the head width"],
    },
    graph: {
      requires: ["project_bound", "geometry_available"],
      produces: ["geometry_available"],
      invalidates: [
        "uv_plan_available",
        "uv_layout_current",
        "texture_alignment_current",
        "visual_evidence_current",
      ],
    },
  },
  {
    capability: "manage_cubes",
    branch: { field: "operation", value: "batch_update" },
    schemaFields: ["operation"],
    semantic: {
      intents: ["edit many cubes", "batch geometry correction", "repeat geometry changes"],
      nouns: ["cubes", "geometry", "parts"],
      verbs: ["batch", "multiple", "all", "several", "repeat"],
    },
    graph: {
      requires: ["project_bound", "geometry_available"],
      produces: ["geometry_available"],
      invalidates: [
        "uv_plan_available",
        "uv_layout_current",
        "texture_alignment_current",
        "visual_evidence_current",
      ],
    },
  },
  {
    capability: "manage_cubes",
    branch: { field: "operation", value: "simplify" },
    schemaFields: ["operation"],
    semantic: {
      intents: ["simplify geometry", "reduce cube complexity", "clean geometry"],
      nouns: ["geometry", "cube", "model"],
      verbs: ["simplify", "reduce", "clean", "optimize"],
    },
    graph: {
      requires: ["project_bound", "geometry_available"],
      produces: ["geometry_available"],
      invalidates: [
        "uv_plan_available",
        "uv_layout_current",
        "texture_alignment_current",
        "visual_evidence_current",
      ],
    },
  },

  {
    capability: "inspect_elements",
    branch: { field: "mode", value: "outline" },
    schemaFields: ["mode", "include_cubes", "max_depth", "max_nodes"],
    operationClass: "QUERY",
    semantic: {
      intents: ["list model hierarchy", "show outliner tree", "inspect model outline"],
      nouns: ["hierarchy", "outliner", "group", "bone", "cube"],
      verbs: ["list", "show", "inspect", "outline"],
    },
  },
  {
    capability: "inspect_elements",
    branch: { field: "mode", value: "search" },
    schemaFields: [
      "mode",
      "name_pattern",
      "name_contains",
      "type",
      "parent_group",
      "min_size",
      "max_size",
      "selected_only",
      "limit",
    ],
    semantic: {
      intents: ["find model element", "locate cube or group", "search hierarchy"],
      nouns: ["cube", "group", "bone", "element", "part"],
      verbs: ["find", "search", "locate", "identify"],
    },
  },
  {
    capability: "inspect_elements",
    branch: { field: "mode", value: "detail" },
    schemaFields: ["mode", "id", "detail"],
    semantic: {
      intents: ["inspect exact element", "read element dimensions", "inspect cube state"],
      nouns: ["cube", "group", "bone", "element", "part"],
      verbs: ["inspect", "check", "read", "measure"],
    },
  },

  {
    capability: "manage_uv_layout",
    branch: { field: "operation", value: "plan" },
    schemaFields: [
      "operation",
      "bitmap_width",
      "bitmap_height",
      "mode",
      "island_ids",
      "default_target_pixels_per_model_unit",
      "constraints",
      "include_implicit_stack_candidates",
    ],
    operationClass: "CONTROL",
    verificationClass: "not_applicable",
    semantic: {
      intents: ["plan uv layout", "pack uv islands", "fix uv overlap", "set texel density"],
      nouns: ["uv", "island", "atlas", "texel", "padding"],
      verbs: ["plan", "pack", "repack", "arrange", "layout"],
      examples: ["pack the UV islands without overlap"],
    },
    graph: {
      requires: ["project_bound", "geometry_available"],
      produces: ["uv_plan_available"],
    },
  },
  {
    capability: "manage_uv_layout",
    branch: { field: "operation", value: "apply" },
    schemaFields: ["operation", "plan_id", "expected_source_fingerprint"],
    operationClass: "MUTATION",
    verificationClass: "visual",
    semantic: {
      intents: ["apply uv plan", "commit uv layout"],
      nouns: ["uv", "layout", "plan"],
      verbs: ["apply", "commit", "use"],
    },
    graph: {
      requires: ["project_bound", "geometry_available", "uv_plan_available"],
      produces: ["uv_layout_current"],
      // The applied plan describes pre-mutation UV state; require a fresh
      // plan before a subsequent apply. Runtime fingerprint remains authority.
      invalidates: ["uv_plan_available", "texture_alignment_current", "visual_evidence_current"],
      predecessor: {
        capability: "manage_uv_layout",
        branch: { field: "operation", value: "plan" },
      },
    },
  },

  {
    capability: "create_texture",
    branch: { field: "type", value: "blank" },
    schemaFields: [
      "type", "name", "width", "height", "data", "group", "fill_color",
      "layer_name", "pbr_channel", "render_mode", "render_sides",
    ],
    semantic: {
      intents: ["create blank texture", "new empty texture"],
      nouns: ["texture", "image", "atlas"],
      verbs: ["create", "new", "blank"],
    },
    graph: {
      requires: ["project_bound"],
      produces: ["texture_available"],
      invalidates: ["visual_evidence_current"],
    },
  },
  {
    capability: "create_texture",
    branch: { field: "type", value: "template" },
    schemaFields: [
      "type", "name", "texture_id", "width", "height", "pixel_density",
      "rearrange_uv", "power_of_two", "keep_multi_texture_occupancy",
      "padding", "group", "fill_color", "layer_name", "pbr_channel",
      "render_mode", "render_sides",
    ],
    semantic: {
      intents: ["create texture from template", "generate texture atlas from model"],
      nouns: ["texture", "template", "atlas"],
      verbs: ["create", "generate", "template"],
    },
    graph: {
      requires: ["project_bound", "geometry_available"],
      produces: ["texture_available"],
      invalidates: ["visual_evidence_current"],
    },
  },
  {
    capability: "create_texture",
    branch: { field: "type", value: "variant" },
    schemaFields: ["type", "name", "source_texture_id", "group"],
    semantic: {
      intents: ["create texture variant", "duplicate texture variant"],
      nouns: ["texture", "variant"],
      verbs: ["variant", "duplicate", "derive"],
    },
    graph: {
      requires: ["project_bound", "texture_available"],
      produces: ["texture_available"],
      invalidates: ["visual_evidence_current"],
    },
  },

  {
    capability: "manage_material",
    branch: { field: "operation", value: "create" },
    schemaFields: [
      "operation", "name", "color_texture", "normal_texture", "height_texture",
      "mer_texture", "color_value", "mer_value", "subsurface_value",
    ],
    verificationClass: "focused_read",
    semantic: {
      intents: ["create pbr material", "new material"],
      nouns: ["material", "pbr", "normal", "mer", "height"],
      verbs: ["create", "new"],
    },
    graph: {
      requires: ["project_bound"],
      produces: ["material_available"],
    },
  },
  {
    capability: "manage_material",
    branch: { field: "operation", value: "configure" },
    schemaFields: [
      "operation", "material", "color_texture", "normal_texture", "height_texture",
      "mer_texture", "color_value", "mer_value", "subsurface_value",
    ],
    verificationClass: "focused_read",
    semantic: {
      intents: ["configure material", "change pbr channels", "edit material"],
      nouns: ["material", "pbr", "normal", "mer", "height"],
      verbs: ["configure", "edit", "change", "adjust"],
    },
    graph: {
      requires: ["project_bound", "material_available"],
      produces: ["material_available"],
    },
  },
  {
    capability: "manage_material",
    branch: { field: "operation", value: "assign_channel" },
    schemaFields: ["operation", "material", "texture", "channel"],
    verificationClass: "focused_read",
    operationClass: "MUTATION",
    semantic: {
      intents: ["assign texture channel", "set material texture channel"],
      nouns: ["material", "texture", "channel", "normal", "mer", "height"],
      verbs: ["assign", "set", "bind"],
    },
  },
  {
    capability: "manage_material",
    branch: { field: "operation", value: "save" },
    schemaFields: ["operation", "material"],
    verificationClass: "focused_read",
    operationClass: "MUTATION",
    semantic: {
      intents: ["save material config", "write texture set material"],
      nouns: ["material", "config", "texture set", "file"],
      verbs: ["save", "write", "persist"],
    },
  },

  {
    capability: "manage_material_instances",
    branch: { field: "operation", value: "list" },
    schemaFields: ["operation", "include_usages", "usage_limit_per_instance"],
    operationClass: "QUERY",
    executionClass: "fast",
    verificationClass: "not_applicable",
    semantic: {
      intents: ["list material instances", "show material instance usage"],
      nouns: ["material", "instance", "usage"],
      verbs: ["list", "show", "inspect"],
    },
  },
  {
    capability: "manage_material_instances",
    branch: { field: "operation", value: "get" },
    schemaFields: ["operation", "cube_id", "faces"],
    operationClass: "QUERY",
    executionClass: "fast",
    verificationClass: "not_applicable",
    semantic: {
      intents: ["get face material instance", "inspect cube material assignment"],
      nouns: ["material", "instance", "cube", "face"],
      verbs: ["get", "inspect", "read", "check"],
    },
  },
  {
    capability: "manage_material_instances",
    branch: { field: "operation", value: "set" },
    schemaFields: ["operation", "cube_id", "material_name", "faces"],
    operationClass: "MUTATION",
    verificationClass: "focused_read",
    semantic: {
      intents: ["set face material instance", "assign material instance to faces"],
      nouns: ["material", "instance", "cube", "face"],
      verbs: ["set", "assign", "apply"],
    },
  },
  {
    capability: "manage_material_instances",
    branch: { field: "operation", value: "bulk_set" },
    schemaFields: ["operation", "assignments"],
    operationClass: "MUTATION",
    verificationClass: "focused_read",
    semantic: {
      intents: ["bulk set material instances", "assign material instances to many cubes"],
      nouns: ["material", "instance", "cubes", "faces", "assignments"],
      verbs: ["bulk", "assign", "set"],
    },
  },
  {
    capability: "manage_material_instances",
    branch: { field: "operation", value: "clear" },
    schemaFields: ["operation", "cube_id", "faces", "all_cubes"],
    operationClass: "MUTATION",
    verificationClass: "focused_read",
    semantic: {
      intents: ["clear material instances", "remove face material assignments"],
      nouns: ["material", "instance", "cube", "face"],
      verbs: ["clear", "remove", "reset"],
    },
  },

  {
    capability: "manage_render_profile",
    branch: { field: "operation", value: "inspect" },
    schemaFields: ["operation"],
    operationClass: "QUERY",
    executionClass: "fast",
    verificationClass: "not_applicable",
    semantic: {
      intents: ["inspect render profile bindings", "read render material assignments"],
      nouns: ["render", "profile", "material", "binding", "assignment"],
      verbs: ["inspect", "read", "show", "check"],
    },
  },
  {
    capability: "manage_render_profile",
    branch: { field: "operation", value: "bind" },
    schemaFields: ["operation"],
    operationClass: "MUTATION",
    verificationClass: "focused_read",
    semantic: {
      intents: ["bind render profile", "set render material profile"],
      nouns: ["render", "profile", "material", "alpha"],
      verbs: ["bind", "set", "configure"],
    },
  },
  {
    capability: "manage_render_profile",
    branch: { field: "operation", value: "set_slot" },
    schemaFields: ["operation"],
    operationClass: "MUTATION",
    verificationClass: "focused_read",
    semantic: {
      intents: ["set render profile material slot", "configure client entity render slot"],
      nouns: ["render", "profile", "material", "slot", "client entity"],
      verbs: ["set", "configure", "assign"],
    },
  },
  {
    capability: "manage_render_profile",
    branch: { field: "operation", value: "assign" },
    schemaFields: ["operation"],
    operationClass: "MUTATION",
    verificationClass: "focused_read",
    semantic: {
      intents: ["assign render controller material", "assign render slot to bone pattern"],
      nouns: ["render", "controller", "material", "slot", "bone"],
      verbs: ["assign", "bind", "set"],
    },
  },
  {
    capability: "manage_render_profile",
    branch: { field: "operation", value: "unassign" },
    schemaFields: ["operation"],
    operationClass: "MUTATION",
    verificationClass: "focused_read",
    semantic: {
      intents: ["remove render controller material assignment", "unassign render slot"],
      nouns: ["render", "controller", "material", "slot", "assignment"],
      verbs: ["remove", "unassign", "clear"],
    },
  },

  {
    capability: "manage_animation_timeline",
    branch: { field: "operation", value: "keyframes" },
    graph: ANIMATION_TIMELINE_GRAPH,
    schemaFields: ["operation", "animation_id", "action", "bone_name", "channel", "keyframes"],
    operationClass: "MUTATION",
    nestedActions: {
      select: "CONTROL",
      create: "MUTATION",
      edit: "MUTATION",
      delete: "MUTATION",
    },
    semantic: {
      intents: ["edit animation keyframes", "add or remove keyframes"],
      nouns: ["animation", "keyframe", "bone", "channel"],
      verbs: ["edit", "add", "remove", "change"],
    },
  },
  {
    capability: "manage_animation_timeline",
    branch: { field: "operation", value: "graph" },
    graph: ANIMATION_TIMELINE_GRAPH,
    schemaFields: ["operation", "animation_id", "bone_name", "channel", "axis", "action", "keyframe_range", "custom_curve"],
    operationClass: "MUTATION",
    semantic: {
      intents: ["edit animation graph", "change keyframe easing", "edit bezier curve"],
      nouns: ["animation", "graph", "easing", "bezier", "keyframe"],
      verbs: ["edit", "ease", "curve", "interpolate"],
    },
  },
  {
    capability: "manage_animation_timeline",
    branch: { field: "operation", value: "timeline" },
    graph: ANIMATION_TIMELINE_GRAPH,
    schemaFields: ["operation", "animation_id", "action", "time", "length", "fps", "loop_mode", "range", "molang", "easing", "bone_ids"],
    nestedActions: {
      select: "CONTROL",
      play: "CONTROL",
      pause: "CONTROL",
      stop: "CONTROL",
      set_time: "CONTROL",
      select_range: "CONTROL",
      expand_bones: "CONTROL",
      collapse_bones: "CONTROL",
      set_length: "MUTATION",
      set_fps: "MUTATION",
      loop: "MUTATION",
      set_anim_time_update: "MUTATION",
      set_blend_weight: "MUTATION",
      set_easing: "MUTATION",
    },
    semantic: {
      intents: ["control animation timeline", "scrub animation", "play animation preview"],
      nouns: ["animation", "timeline", "playback", "time", "range"],
      verbs: ["play", "pause", "stop", "scrub", "select"],
    },
  },
  {
    capability: "manage_animation_timeline",
    branch: { field: "operation", value: "batch" },
    graph: ANIMATION_TIMELINE_GRAPH,
    schemaFields: ["operation", "animation_id", "batch_operation", "selection", "range", "pattern", "parameters"],
    operationClass: "MUTATION",
    semantic: {
      intents: ["batch edit animation keyframes", "offset or scale keyframe timing"],
      nouns: ["animation", "keyframes", "batch", "timing", "range"],
      verbs: ["batch", "offset", "scale", "repeat"],
    },
  },
  {
    capability: "manage_animation_timeline",
    branch: { field: "operation", value: "copy_paste" },
    graph: ANIMATION_TIMELINE_GRAPH,
    schemaFields: ["operation", "action", "source", "target"],
    nestedActions: {
      copy: "CONTROL",
      paste: "MUTATION",
      mirror_paste: "MUTATION",
    },
    operationClass: "MUTATION",
    semantic: {
      intents: ["copy animation keyframes", "paste or mirror keyframes"],
      nouns: ["animation", "keyframes", "copy", "paste", "mirror"],
      verbs: ["copy", "paste", "mirror"],
    },
  },
  {
    capability: "manage_animation_timeline",
    branch: { field: "operation", value: "properties" },
    graph: ANIMATION_TIMELINE_GRAPH,
    schemaFields: [
      "operation", "animation_id", "length", "fps", "loop_mode",
      "anim_time_update", "blend_weight", "start_delay", "loop_delay",
      "override_previous_animation", "rotation_spaces",
    ],
    operationClass: "MUTATION",
    semantic: {
      intents: ["edit animation clip properties", "set animation length fps loop or molang"],
      nouns: ["animation", "clip", "length", "fps", "loop", "molang", "blend weight"],
      verbs: ["set", "edit", "configure", "change"],
    },
  },

  {
    capability: "manage_animation_controller",
    branch: { field: "resource_kind", value: "client_entity" },
    schemaFields: [
      "resource_kind", "resource_source", "resource_output",
      "resource_operations", "max_content_length",
    ],
    operationClass: "MUTATION",
    verificationClass: "focused_read",
    semantic: {
      intents: ["edit client entity animation runtime wiring", "configure client entity molang animation bindings"],
      nouns: ["client entity", "animation", "molang", "mapping", "runtime", "binding"],
      verbs: ["edit", "configure", "set", "remove", "wire"],
    },
  },
  {
    capability: "manage_animation_controller",
    branch: { field: "resource_kind", value: "animation_controller" },
    schemaFields: [
      "resource_kind", "resource_source", "resource_output",
      "resource_controller", "resource_operations", "max_content_length",
    ],
    operationClass: "MUTATION",
    verificationClass: "focused_read",
    semantic: {
      intents: ["edit animation controller resource variables", "configure controller variable remap"],
      nouns: ["animation", "controller", "resource", "variable", "remap"],
      verbs: ["edit", "configure", "set", "remove"],
    },
  },

  {
    capability: "gradient_tool",
    semantic: {
      intents: ["paint gradient", "shade with gradient", "automatic color transition"],
      nouns: ["texture", "gradient", "color", "shade"],
      verbs: ["gradient", "shade", "blend", "transition"],
    },
    graph: {
      requires: ["project_bound", "texture_available"],
      produces: ["texture_available"],
      invalidates: ["visual_evidence_current"],
    },
  },
  {
    capability: "paint_texture_transaction",
    semantic: {
      intents: ["exact pixel edit", "atomic texture edit", "revision protected paint"],
      nouns: ["texture", "pixel", "pixels"],
      verbs: ["paint", "edit", "replace", "set"],
    },
    graph: {
      requires: ["project_bound", "texture_available"],
      produces: ["texture_available"],
      invalidates: ["visual_evidence_current"],
    },
  },
  {
    capability: "paint_with_brush",
    semantic: {
      intents: ["paint texture with brush", "brush stroke", "manual texture stroke"],
      nouns: ["texture", "brush", "stroke", "paint"],
      verbs: ["paint", "brush", "draw"],
    },
    graph: {
      requires: ["project_bound", "texture_available"],
      produces: ["texture_available"],
      invalidates: ["visual_evidence_current"],
    },
  },
  {
    capability: "create_animation",
    semantic: {
      intents: ["create animation", "new animation", "add animation clip"],
      nouns: ["animation", "clip"],
      verbs: ["create", "new", "add"],
    },
    graph: {
      requires: ["project_bound", "geometry_available"],
      produces: ["animation_available"],
    },
  },
  {
    capability: "manage_animation_timeline",
    semantic: {
      intents: ["edit keyframe", "animation timeline", "change easing", "bone animation"],
      nouns: ["animation", "timeline", "keyframe", "easing", "bone"],
      verbs: ["edit", "add", "change", "animate"],
    },
    graph: ANIMATION_TIMELINE_GRAPH,
  },
  {
    capability: "manage_animation_effects",
    semantic: {
      intents: ["add animation sound", "add animation particle", "timeline event"],
      nouns: ["animation", "sound", "particle", "effect", "event"],
      verbs: ["add", "edit", "trigger"],
    },
    graph: {
      requires: ["project_bound", "animation_available"],
      produces: ["animation_available"],
      invalidates: ["visual_evidence_current"],
    },
  },
  {
    capability: "manage_animation_controller",
    semantic: {
      intents: ["edit animation controller", "state machine", "animation transition"],
      nouns: ["controller", "state", "transition", "animation"],
      verbs: ["create", "edit", "transition", "blend"],
    },
    graph: {
      requires: ["project_bound", "animation_available"],
      produces: ["animation_available"],
      invalidates: ["visual_evidence_current"],
    },
  },
  {
    capability: "inspect_particle",
    semantic: {
      intents: ["inspect particle", "read particle emitter"],
      nouns: ["particle", "emitter"],
      verbs: ["inspect", "read", "check"],
    },
    graph: {
      requires: ["project_bound", "particle_available"],
    },
  },
  {
    capability: "manage_particle",
    semantic: {
      intents: ["create particle", "edit particle emitter", "change particle"],
      nouns: ["particle", "emitter", "snowstorm"],
      verbs: ["create", "edit", "change", "configure"],
    },
    graph: {
      requires: ["project_bound"],
      produces: ["particle_available"],
      invalidates: ["visual_evidence_current"],
    },
  },
  {
    capability: "capture_model_views",
    semantic: {
      intents: ["capture model view", "visual verification", "take preview", "inspect appearance"],
      nouns: ["model", "view", "preview", "image", "camera"],
      verbs: ["capture", "preview", "verify", "see"],
    },
    graph: {
      requires: ["project_bound", "geometry_available"],
      produces: ["visual_evidence_current"],
    },
  },
  {
    capability: "inspect_model_bounds",
    semantic: {
      intents: ["measure model bounds", "check total size", "inspect dimensions"],
      nouns: ["model", "bounds", "size", "dimensions"],
      verbs: ["measure", "check", "inspect"],
    },
  },
  {
    capability: "bone_rigging",
    branch: { field: "action", value: "set_ik" },
    schemaFields: ["action", "bone_data"],
    semantic: {
      intents: ["configure bone inverse kinematics", "set ik target", "enable bone ik"],
      nouns: ["bone", "ik", "target", "inverse kinematics"],
      verbs: ["set", "enable", "configure", "target"],
      excludes: ["create", "parent", "unparent", "delete", "rename", "pivot"],
      examples: ["enable ik on this bone", "set the ik target for this bone"],
    },
  },
  {
    capability: "bone_rigging",
    branch: { field: "action", value: "set_ik_controller" },
    schemaFields: ["action", "bone_data"],
    semantic: {
      intents: ["configure native ik controller", "set ik pole", "set ik root"],
      nouns: ["ik", "controller", "pole", "root", "target"],
      verbs: ["configure", "set", "bind"],
      excludes: ["create", "parent", "unparent", "delete", "rename", "pivot"],
      examples: ["set the ik pole for this controller", "configure native ik root and target"],
    },
  },
  {
    capability: "bone_rigging",
    branch: { field: "action", value: "mirror" },
    schemaFields: ["action", "bone_data"],
    semantic: {
      intents: ["mirror bone rig", "mirror bone"],
      nouns: ["bone", "rig", "mirror", "axis"],
      verbs: ["mirror", "duplicate"],
      excludes: ["create", "parent", "unparent", "delete", "rename", "pivot"],
      examples: ["mirror this bone across x", "mirror the left bone to the right"],
    },
  },

  {
    capability: "reparent_element",
    semantic: {
      intents: ["change hierarchy parent", "move element to bone", "reparent bone"],
      nouns: ["parent", "bone", "group", "hierarchy", "element"],
      verbs: ["reparent", "parent", "unparent", "move"],
      excludes: [
        "resize",
        "texture",
        "position",
        "translate",
        "shift",
        "rotation",
        "scale",
        "pivot",
      ],
    },
  },
  {
    capability: "modify_group",
    semantic: {
      intents: ["adjust bone pivot", "move group", "edit group transform"],
      nouns: ["group", "bone", "pivot"],
      verbs: ["pivot", "move", "adjust", "modify"],
      excludes: ["cube", "cuboid", "texture", "reparent", "parent"],
    },
  },
];

export const CAPABILITY_BRANCH_MANIFEST: readonly CapabilityBranchManifestEntry[] =
  CAPABILITY_BRANCH_SPECS.map((entry) => ({
    ...entry,
    id: capabilitySemanticId(entry.capability, entry.branch),
  }));

export function manifestEntriesForCapability(
  capability: string
): readonly CapabilityBranchManifestEntry[] {
  return CAPABILITY_BRANCH_MANIFEST.filter(
    (entry) => entry.capability === capability
  );
}

export function manifestEntryForBranch(
  capability: string,
  branch?: CapabilityBranchHint
): CapabilityBranchManifestEntry | null {
  const entries = manifestEntriesForCapability(capability);
  if (branch) {
    const exact = entries.find(
      (entry) =>
        entry.branch?.field === branch.field &&
        entry.branch.value === branch.value
    );
    if (exact) return exact;
  }
  return entries.find((entry) => entry.branch === undefined) ?? null;
}

export function nestedOperationClassForArguments(
  capability: string,
  args: Record<string, unknown>
): CapabilityOperationClass | null {
  const discriminator = ["operation", "type", "mode", "resource_kind"]
    .map((field) => ({ field, value: args[field] }))
    .find((candidate) => typeof candidate.value === "string");
  if (!discriminator) return null;
  const entry = manifestEntryForBranch(capability, {
    field: discriminator.field,
    value: discriminator.value as string,
  });
  const action = typeof args.action === "string" ? args.action : null;
  if (action && entry?.nestedActions?.[action]) {
    return entry.nestedActions[action]!;
  }
  return entry?.operationClass ?? null;
}

export function nestedOperationClassForAction(
  capability: string,
  action: string
): CapabilityOperationClass | null {
  const classes = [
    ...new Set(
      manifestEntriesForCapability(capability)
        .map((entry) => entry.nestedActions?.[action])
        .filter(
          (value): value is CapabilityOperationClass =>
            typeof value === "string"
        )
    ),
  ];
  return classes.length === 1 ? classes[0]! : null;
}
