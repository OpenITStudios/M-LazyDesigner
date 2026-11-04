import type { DevelopmentSourceOwner } from "../types";
import { MODELLING_PATH } from "../../context/authoring";

export const CORE_SOURCE_OWNERS: Record<string, DevelopmentSourceOwner> = {
  create_project: {
    source: "mcp/server/tools/project/project.ts",
    specialist: null,
    anchor_test: "mcp/tests/project-affinity-runtime.test.ts",
  },
  switch_authoring_phase: {
    source: "mcp/server/runtime/phaseControl.ts",
    specialist: null,
    anchor_test: "mcp/tests/authoring-flow-simplification.test.ts",
  },
  get_project_info: {
    source: "mcp/server/tools/project/project.ts",
    specialist: null,
    anchor_test: "mcp/tests/p1-core-ownership.test.ts",
  },
  list_textures: {
    source: "mcp/server/tools/texture/read.ts",
    specialist: null,
    anchor_test: "mcp/tests/texture-authoring-contract.test.ts",
  },
  inspect_elements: {
    source: "mcp/server/runtime/consolidatedTools.ts",
    specialist: null,
    anchor_test: "mcp/tests/consolidated-validation-preservation.test.ts",
  },
  list_locator_elements: {
    source: "mcp/server/tools/geometry/locators.ts",
    specialist: null,
    anchor_test: "mcp/tests/bedrock-locator-coverage.test.ts",
  },
  capture_model_views: {
    source: "mcp/server/tools/inspection/camera.ts",
    specialist: MODELLING_PATH,
    anchor_test: "mcp/tests/camera-framing-contract.test.ts",
  },
  inspect_model_bounds: {
    source: "mcp/server/tools/project/project.ts",
    specialist: MODELLING_PATH,
    anchor_test: "mcp/tests/rendered-model-bounds-numeric-safety.test.ts",
  },
  export_model: {
    source: "mcp/server/tools/io/export.ts",
    specialist: null,
    anchor_test: "mcp/tests/inspection-export-capability-baseline.test.ts",
  },
  render_publication: {
    source: "mcp/server/tools/inspection/publication.ts",
    specialist: null,
    anchor_test: "mcp/tests/publication-render-contract.test.ts",
  },
  blender_render: {
    source: "mcp/gateway/providers/blenderRender.ts",
    specialist: null,
    anchor_test: "mcp/gateway/providers/blenderRender.test.ts",
  },
  undo: {
    source: "mcp/server/tools/state/history.ts",
    specialist: null,
    anchor_test: "mcp/tests/history-result-state.test.ts",
  },
  redo: {
    source: "mcp/server/tools/state/history.ts",
    specialist: null,
    anchor_test: "mcp/tests/history-result-state.test.ts",
  },
  get_undo_stack: {
    source: "mcp/server/tools/state/history.ts",
    specialist: null,
    anchor_test: "mcp/tests/history-result-state.test.ts",
  },
};