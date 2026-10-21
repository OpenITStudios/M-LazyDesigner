import { describe, expect, test } from "bun:test";

// T0 architecture guards, not proof of native mutation or registration execution.
const moduleContracts = [
  {
    domain: "texture",
    facade: "server/tools/texture.ts",
    order: [
      "registerCreateTextureTool();",
      "registerTextureAssignmentTools();",
      "registerTextureReadTools();",
      "registerTextureMaterialTools();",
      "registerTextureActivationTool();",
    ],
    owners: [
      { path: "server/tools/texture/create.ts", exports: ["export function registerCreateTextureTool"] },
      { path: "server/tools/texture/read.ts", exports: ["export function registerTextureReadTools"] },
      { path: "server/tools/texture/atlas.ts", exports: ["export function buildUvAtlasAudit"] },
      { path: "server/tools/texture/assignment.ts", exports: ["export function registerTextureAssignmentTools", "export function registerTextureActivationTool"] },
      { path: "server/tools/texture/materials.ts", exports: ["export function registerTextureMaterialTools"] },
    ],
  },
  {
    domain: "paint",
    facade: "server/tools/paint.ts",
    order: [
      "registerPaintPrimitiveTools();",
      "registerPaintEraserTool();",
      "registerPaintSettingsTool();",
      "registerPaintBrushTools();",
      "registerPaintSelectionLayerTools();",
    ],
    owners: [
      { path: "server/tools/paint/primitives.ts", exports: ["export function registerPaintPrimitiveTools"] },
      { path: "server/tools/paint/brush.ts", exports: ["export function registerPaintEraserTool", "export function registerPaintBrushTools"] },
      { path: "server/tools/paint/settings.ts", exports: ["export function registerPaintSettingsTool"] },
      { path: "server/tools/paint/selectionLayers.ts", exports: ["export function registerPaintSelectionLayerTools"] },
      { path: "server/tools/paint/shared.ts", exports: ["export function normalizeTexturePixelRegion"] },
    ],
  },
  {
    domain: "element",
    facade: "server/tools/element.ts",
    order: [
      "registerRemoveElementTool();",
      "registerAddGroupTool();",
      "registerListOutlineTool();",
      "registerElementMutationTools();",
      "registerElementDiscoveryTools();",
      "registerElementHierarchyTools();",
    ],
    owners: [
      { path: "server/tools/element/mutation.ts", exports: ["export function registerElementMutationTools"] },
      { path: "server/tools/element/hierarchy.ts", exports: ["export function registerElementHierarchyTools"] },
      { path: "server/tools/element/discovery.ts", exports: ["export function registerElementDiscoveryTools"] },
      { path: "server/tools/element/shared.ts", exports: ["export function resolveUniqueDestructiveElement"] },
    ],
  },
];

describe("Capability facade ownership", () => {
  test.each(moduleContracts)("$domain delegates to its owners in canonical order", async ({ facade, order, owners }) => {
    const [surface, ...implementations] = await Promise.all([
      Bun.file(facade).text(),
      ...owners.map(owner => Bun.file(owner.path).text()),
    ]);
    for (const forbidden of ["createTool(", "Undo.initEdit"]) {
      expect(surface, facade).not.toContain(forbidden);
    }
    // Finding every marker also covers the former separate presence assertions.
    const positions = order.map(marker => {
      const position = surface.indexOf(marker);
      expect(position, facade + ": " + marker).toBeGreaterThanOrEqual(0);
      return position;
    });
    expect(positions, facade).toEqual([...positions].sort((a, b) => a - b));
    for (const [index, owner] of owners.entries()) {
      for (const declaration of owner.exports) {
        expect(implementations[index], owner.path).toContain(declaration);
      }
    }
  });
});
