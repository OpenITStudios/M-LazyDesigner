import { describe, expect, test } from "bun:test";
import { buildControlDelta } from "@/gateway/control";

describe("texture-region downstream recheck targets", () => {
  test("paint transaction carries exact texture region", () => {
    const delta = buildControlDelta({
      capability: "paint_texture_transaction",
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        texture: { uuid: "texture-a", name: "atlas" },
        revision: { before: "rev-1", after: "rev-2" },
        affected_rect: [8, 16, 24, 32],
        affected_size: [16, 16],
        operation_count: 1,
        pixel_writes: 20,
        visual_evidence: null,
      },
    });
    const texture = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "TEXTURE_APPEARANCE"
    );
    expect(texture?.target).toEqual({
      texture_uuid: "texture-a",
      affected_rect: [8, 16, 24, 32],
      revision: "rev-2",
    });
  });

  test("UV evidence keeps precedence for mapped texture recheck", () => {
    const delta = buildControlDelta({
      capability: "manage_uv_layout",
      branch: { field: "operation", value: "apply" },
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        receipt: {
          changed_island_ids: ["island-a"],
          changed_cube_ids: ["cube-a"],
          changed_faces: [{ cube_uuid: "cube-a", face: "north" }],
        },
      },
    });
    const texture = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "TEXTURE_APPEARANCE"
    );
    expect(texture?.target).toEqual({
      cube_ids: ["cube-a"],
      island_ids: ["island-a"],
      faces: [{ cube_uuid: "cube-a", face: "north" }],
    });
  });

  test("unbounded brush mutation does not invent a region target", () => {
    const delta = buildControlDelta({
      capability: "paint_with_brush",
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: { changed: true },
    });
    const texture = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "TEXTURE_APPEARANCE"
    );
    expect(texture?.target).toBeUndefined();
  });
  test("malformed paint evidence never narrows mapped-texture rechecks", () => {
    const base = {
      texture: { uuid: "texture-a" },
      revision: { after: "rev-2" },
      affected_rect: [8, 16, 24, 32],
    };
    const invalid = [
      { affected_rect: [8, 16, 8, 32] },     // Empty horizontal extent
      { affected_rect: [24, 16, 8, 32] },    // Reversed corners
      { affected_rect: [-1, 16, 8, 32] },    // Negative origin
      { affected_rect: [8, 16, 24, 16] },    // Empty vertical extent
      { affected_rect: [8, 16, NaN, 32] },   // Invalid pixel
      { texture: { uuid: " " } },             // Unbound texture
      { revision: { after: "" } },            // Missing revision
    ];
    for (const override of invalid) {
      const result = { ...base, ...override };
      const delta = buildControlDelta({
        capability: "paint_texture_transaction",
        phaseBefore: "texturing",
        phaseAfter: "texturing",
        projectUuid: "project-a",
        succeeded: true,
        result,
      });
      const target = delta.downstream_recheck.required.find(
        (entry) => entry.scope === "TEXTURE_APPEARANCE"
      );
      expect(delta.freshness.stale).toContain("TEXTURE_APPEARANCE");
      expect(target?.action).toBe("REVERIFY_MAPPED_TEXTURE");
      expect(target?.target).toBeUndefined();
      expect(delta.verification_scope).toBeNull();
    }
  });

  test("malformed structuredContent never borrows outer texture target", () => {
    const delta = buildControlDelta({
      capability: "paint_texture_transaction",
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        texture: { uuid: "outer" },
        revision: { after: "outer-revision" },
        affected_rect: [0, 0, 16, 16],
        structuredContent: {
          texture: { uuid: "inner" },
          revision: { after: "inner-revision" },
          affected_rect: [7, 7, 7, 10],
        },
      },
    });
    expect(delta.downstream_recheck.required.find(
      (entry) => entry.scope === "TEXTURE_APPEARANCE"
    )?.target).toBeUndefined();
  });

});
