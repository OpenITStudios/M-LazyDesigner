import { describe, expect, test } from "bun:test";
import { CAPABILITY_CORE_MANIFEST } from "@/lib/capabilities/manifest";
import {
  BOUNDED_VISUAL_SCOPE_CAPABILITIES,
  verificationScopeForResult,
} from "@/gateway/control/delta/verification";

describe("bounded visual verification scope registry", () => {
  test("every bounded scope capability is canonical and visually verified", () => {
    expect(BOUNDED_VISUAL_SCOPE_CAPABILITIES).toEqual(
      expect.arrayContaining([
        "manage_cubes",
        "manage_animation_timeline",
        "manage_keyframes",
        "paint_texture_transaction",
      ])
    );

    for (const capability of BOUNDED_VISUAL_SCOPE_CAPABILITIES) {
      const entry = CAPABILITY_CORE_MANIFEST.get(capability);
      expect(entry, capability).toBeDefined();
      expect(entry?.verificationClass, capability).toBe("visual");
    }
  });

  test("Cube, animation and texture scopes read one canonical MCP receipt", () => {
    const cases: Array<{ capability: string; receipt: object; kind: string }> = [
      {
        capability: "manage_cubes",
        receipt: {
          visual_scope: {
            cube_uuids: ["cube-a"],
            framing: { min: [-1, 0, -1], max: [2, 6, 2] },
          },
        },
        kind: "CUBE_TARGETS",
      },
      {
        capability: "manage_keyframes",
        receipt: {
          animation: { uuid: "walk-a" },
          bone: { uuid: "arm-a" },
          channel: "rotation",
          affected_keyframes: [{ time: 0.25 }, { time: 0.75 }],
        },
        kind: "ANIMATION_RANGE",
      },
      {
        capability: "paint_texture_transaction",
        receipt: {
          texture: { uuid: "atlas-a" },
          revision: { after: "revision-2" },
          affected_rect: [2, 4, 12, 16],
          visual_evidence: { kind: "affected_region_png" },
        },
        kind: "TEXTURE_REGION",
      },
    ];
    for (const { capability, receipt, kind } of cases) {
      let reads = 0;
      const envelope = {
        visual_scope: null,
        get structuredContent() {
          reads++;
          return receipt;
        },
      };
      const direct = verificationScopeForResult(capability, "visual", receipt);
      const wrapped = verificationScopeForResult(capability, "visual", envelope);
      expect(wrapped, capability).toEqual(direct);
      expect(String(wrapped?.kind), capability).toBe(kind);
      expect(reads, capability).toBe(1);
    }
  });

  test("returned texture PNG evidence requires exact revision, extent and dimensions", () => {
    const receipt = {
      texture: { uuid: "atlas-a" },
      revision: { after: "sha256:revision-new" },
      affected_rect: [4, 8, 8, 12],
      visual_evidence: {
        kind: "affected_region_png",
        affected_rect: [4, 8, 8, 12],
        revision: "sha256:revision-new",
        width: 4, height: 4,
      },
    };
    const scope = (candidate: object) =>
      verificationScopeForResult("paint_texture_transaction", "visual", candidate);
    expect(scope(receipt)).toMatchObject({
      kind: "TEXTURE_REGION",
      evidence_source: "mutation_response",
    });
    for (const visual_evidence of [
      { kind: "affected_region_png" },
      { ...receipt.visual_evidence, revision: "sha256:revision-old" },
      { ...receipt.visual_evidence, affected_rect: [4, 8, 7, 12] },
      { ...receipt.visual_evidence, width: 3 },
      { ...receipt.visual_evidence, height: 3 },
    ]) {
      expect(scope({ ...receipt, visual_evidence })).toMatchObject({
        kind: "TEXTURE_REGION",
        evidence_source: "follow_up_read",
      });
    }
  });

  test("invalid texture region corners never enable narrow visual verification", () => {
    for (const affected_rect of [
      [-1, 0, 8, 8],
      [0, -1, 8, 8],
      [8, 0, 8, 8],
      [0, 8, 8, 8],
      [10, 1, 4, 8],
      [0, 10, 8, 3],
      [0, 0, Number.NaN, 8],
    ]) {
      expect(verificationScopeForResult("paint_texture_transaction", "visual", {
        texture: { uuid: "atlas-a" },
        revision: { after: "revision" },
        affected_rect,
        visual_evidence: { kind: "affected_region_png" },
      })).toBeNull();
    }
  });

  test("malformed authoritative inner receipt never borrows outer visual proof", () => {
    const cube = {
      visual_scope: {
        cube_uuids: ["cube-a"],
        framing: { min: [0, 0, 0], max: [1, 1, 1] },
      },
    };
    const texture = {
      texture: { uuid: "atlas-a" },
      revision: { after: "rev-b" },
      affected_rect: [0, 0, 8, 8],
    };
    expect(verificationScopeForResult("manage_cubes", "visual", {
      ...cube, structuredContent: null,
    })).toBeNull();
    expect(verificationScopeForResult("paint_texture_transaction", "visual", {
      ...texture, structuredContent: { affected_rect: [0, 0] },
    })).toBeNull();
    expect(verificationScopeForResult("manage_keyframes", "visual", {
      animation: { uuid: "walk-a" },
      bone: { uuid: "arm-a" },
      affected_keyframes: [{ time: 1 }],
      structuredContent: [],
    })).toBeNull();
  });

  test("nonvisual verification never reads a supplied receipt envelope", () => {
    const envelope = {
      get structuredContent(): never {
        throw new Error("Focused-read proof must not inspect visual receipt");
      },
    };
    expect(
      verificationScopeForResult("manage_cubes", "focused_read", envelope)
    ).toBeNull();
  });

  test("unsupported visual capabilities remain broad rather than inventing precision", () => {
    expect(
      verificationScopeForResult(
        "animation_graph_editor",
        "visual",
        {
          action: "ease_in",
          affected_count: 4,
        }
      )
    ).toBeNull();
  });

  test("non-visual verification never emits a visual scope", () => {
    expect(
      verificationScopeForResult(
        "manage_keyframes",
        "focused_read",
        {
          animation: { uuid: "anim-a" },
          bone: { uuid: "bone-a" },
          affected_keyframes: [{ time: 0.5 }],
        }
      )
    ).toBeNull();
  });
});
