import type { DevelopmentSourceOwner } from "../types";
import { TEXTURING_PATH } from "../../context/authoring";

export const TEXTURING_SOURCE_OWNERS: Record<string, DevelopmentSourceOwner> = {
  create_texture: {
    source: "mcp/server/tools/texture/create.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/authoring/asset-authoring-usage-slimming.test.ts",
  },
  get_texture: {
    source: "mcp/server/tools/texture/read.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/texture-authoring-contract.test.ts",
  },
  activate_texture: {
    source: "mcp/server/tools/texture/assignment.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/capability-module-ownership.test.ts",
  },
  apply_texture: {
    source: "mcp/server/tools/texture/assignment.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/capability-module-ownership.test.ts",
  },
  add_texture_group: {
    source: "mcp/server/tools/texture/assignment.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/pbr-channel-contract.test.ts",
  },
  create_pbr_material: {
    source: "mcp/server/tools/texture/materials.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/material-native-ownership.test.ts",
  },
  configure_material: {
    source: "mcp/server/tools/texture/materials.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/material-native-ownership.test.ts",
  },
  list_materials: {
    source: "mcp/server/tools/texture/materials.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/texture-authoring-contract.test.ts",
  },
  get_material_info: {
    source: "mcp/server/tools/texture/materials.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/texture-authoring-contract.test.ts",
  },
  import_texture_set: {
    source: "mcp/server/tools/texture/materials.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/texture-authoring-contract.test.ts",
  },
  assign_texture_channel: {
    source: "mcp/server/tools/texture/materials.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/pbr-channel-contract.test.ts",
  },
  save_material_config: {
    source: "mcp/server/tools/texture/materials.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/pbr-material-configuration.test.ts",
  },
  paint_fill_tool: {
    source: "mcp/server/tools/paint/primitives.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  draw_shape_tool: {
    source: "mcp/server/tools/paint/primitives.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  gradient_tool: {
    source: "mcp/server/tools/paint/primitives.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  color_picker_tool: {
    source: "mcp/server/tools/paint/primitives.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  copy_brush_tool: {
    source: "mcp/server/tools/paint/primitives.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  paint_settings: {
    source: "mcp/server/tools/paint/settings.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  paint_with_brush: {
    source: "mcp/server/tools/paint/brush.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-stroke.test.ts",
  },
  eraser_tool: {
    source: "mcp/server/tools/paint/brush.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  create_brush_preset: {
    source: "mcp/server/tools/paint/brush.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  load_brush_preset: {
    source: "mcp/server/tools/paint/brush.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  texture_selection: {
    source: "mcp/server/tools/paint/selectionLayers.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  texture_layer_management: {
    source: "mcp/server/tools/paint/selectionLayers.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/paint-tool-selection.test.ts",
  },
  paint_texture_transaction: {
    source: "mcp/server/tools/paint/textureTransaction.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/live/texture-runtime-live-contract.test.ts",
  },
  get_face_material_instances: {
    source: "mcp/server/tools/texture/materialInstances.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/material-instance-mutation-result.test.ts",
  },
  set_face_material_instance: {
    source: "mcp/server/tools/texture/materialInstances.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/material-instance-mutation-result.test.ts",
  },
  list_material_instances: {
    source: "mcp/server/tools/texture/materialInstances.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/material-instance-mutation-result.test.ts",
  },
  bulk_set_material_instances: {
    source: "mcp/server/tools/texture/materialInstances.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/material-instance-mutation-result.test.ts",
  },
  clear_material_instances: {
    source: "mcp/server/tools/texture/materialInstances.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/material-instance-mutation-result.test.ts",
  },
  manage_material: {
    source: "mcp/server/runtime/consolidatedTools.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/consolidated-validation-preservation.test.ts",
  },
  manage_material_instances: {
    source: "mcp/server/runtime/consolidatedTools.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/consolidated-validation-preservation.test.ts",
  },
  manage_render_profile: {
    source: "mcp/server/tools/texture/renderProfile.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/render-profile-binding.test.ts",
  },
  filter_by_material: {
    source: "mcp/server/tools/element/discovery.ts",
    specialist: TEXTURING_PATH,
    anchor_test: "mcp/tests/material-native-ownership.test.ts",
  },
};