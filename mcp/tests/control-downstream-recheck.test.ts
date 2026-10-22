import { describe, expect, test } from "bun:test";
import { downstreamRechecksForFreshness } from "@/gateway/control/delta/recheck";
import {
  animationVerificationScope,
  textureVerificationScope,
} from "@/gateway/control/delta/verification";

describe("cross-domain regression recheck planning", () => {
  test("UV and mapped Texture share one authoritative scoped receipt read", () => {
    let envelopeReads = 0;
    let uvReads = 0;
    const payload = {
      receipt: {
        get changed_cube_ids() {
          uvReads++;
          return ["cube-a", "cube-a"];
        },
        changed_island_ids: ["island-a"],
        changed_faces: [{ cube_uuid: "cube-a", face: "north" }],
      },
    };
    const envelope = {
      execution: "unchanged", // Must not override authoritative structured content.
      get structuredContent() {
        envelopeReads++;
        return payload;
      },
    };
    const result = downstreamRechecksForFreshness({
      currentDomain: "TEXTURING",
      stale: ["UV_MAPPING", "TEXTURE_APPEARANCE", "UV_MAPPING"],
      result: envelope,
    });
    expect(envelopeReads).toBe(1);
    expect(uvReads).toBe(1);
    const uv = result.required.find(entry => entry.scope === "UV_MAPPING");
    const texture = result.required.find(entry => entry.scope === "TEXTURE_APPEARANCE");
    expect(uv?.target).toEqual({
      cube_ids: ["cube-a"],
      island_ids: ["island-a"],
      faces: [{ cube_uuid: "cube-a", face: "north" }],
    });
    expect(texture?.target).toEqual(uv?.target);
    expect(result.required).toHaveLength(2);
  });

  test("missing UV target preserves texture-region fallback without another envelope read", () => {
    let reads = 0;
    const result = downstreamRechecksForFreshness({
      currentDomain: "TEXTURING",
      stale: ["UV_MAPPING", "TEXTURE_APPEARANCE", "MATERIAL_RENDER"],
      result: {
        get structuredContent() {
          reads++;
          return {
            texture: { uuid: "atlas-a" },
            revision: { after: "revision-2" },
            affected_rect: [8, 12, 16, 24],
            changes: [{ cube_uuid: "cube-a", face: "north" }],
          };
        },
      },
    });
    expect(reads).toBe(1);
    expect(result.required.find(entry => entry.scope === "UV_MAPPING")?.target)
      .toBeUndefined();
    expect(result.required.find(entry => entry.scope === "TEXTURE_APPEARANCE")?.target)
      .toEqual({
        texture_uuid: "atlas-a",
        affected_rect: [8, 12, 16, 24],
        revision: "revision-2",
      });
    expect(result.required.find(entry => entry.scope === "MATERIAL_RENDER")?.target)
      .toEqual({
        cube_ids: ["cube-a"],
        faces: [{ cube_uuid: "cube-a", face: "north" }],
      });
  });

  test("untargeted scopes do not read or infer any Runtime receipt", () => {
    const result = downstreamRechecksForFreshness({
      currentDomain: "GEOMETRY",
      stale: ["GEOMETRY_STRUCTURE", "PARTICLE_SYSTEM"],
      result: {
        get structuredContent(): never {
          throw new Error("No targeted scope should consult Runtime receipt");
        },
      },
    });
    expect(result.required).toHaveLength(2);
    expect(result.required.every(entry => entry.target === undefined)).toBe(true);
  });

  test("verified texture region is reused without reading the same affected_rect again", () => {
    let reads = 0;
    const receipt = {
      texture: { uuid: "atlas-1" },
      revision: { after: "revision-5" },
      get affected_rect() {
        reads++;
        return [2, 4, 14, 20];
      },
      visual_evidence: null,
    };
    const scope = textureVerificationScope(receipt);
    expect(scope?.kind).toBe("TEXTURE_REGION");
    expect(reads).toBe(1);
    const options = {
      currentDomain: "TEXTURING" as const,
      stale: ["TEXTURE_APPEARANCE" as const],
      result: receipt,
    };
    const reused = downstreamRechecksForFreshness({
      ...options, verificationScope: scope,
    });
    expect(reads).toBe(1);
    const legacy = downstreamRechecksForFreshness(options);
    expect(reads).toBe(2);
    expect(reused).toEqual(legacy);
    expect(reused.required[0]?.target).toEqual({
      texture_uuid: "atlas-1",
      affected_rect: [2, 4, 14, 20],
      revision: "revision-5",
    });
  });

  test("verified animation range reuses existing keyframe bounds without recomputation", () => {
    let reads = 0;
    const receipt = {
      animation: { uuid: "walk-1" },
      bone: { uuid: "bone-a" },
      channel: "rotation",
      get affected_keyframes() {
        reads++;
        return [{ time: 0.25 }, { time: 0.75 }];
      },
    };
    const scope = animationVerificationScope(receipt);
    expect(scope?.kind).toBe("ANIMATION_RANGE");
    // The existing visual-scope extractor checks the array and then reads it.
    const afterScopeReads = reads;
    expect(afterScopeReads).toBeGreaterThan(0);
    const options = {
      currentDomain: "ANIMATION" as const,
      stale: ["ANIMATION_MOTION" as const],
      result: receipt,
    };
    const reused = downstreamRechecksForFreshness({
      ...options, verificationScope: scope,
    });
    expect(reads).toBe(afterScopeReads);
    const legacy = downstreamRechecksForFreshness(options);
    expect(reads).toBeGreaterThan(afterScopeReads);
    expect(reused).toEqual(legacy);
    expect(reused.required[0]?.target).toEqual({
      animation_uuid: "walk-1",
      bone_ids: ["bone-a"],
      channel: "rotation",
      time_range: [0.25, 0.75],
    });
  });

  test("unrelated verification scope cannot replace texture evidence", () => {
    const result = {
      texture: { uuid: "texture-a" },
      revision: { after: "r3" },
      affected_rect: [1, 2, 3, 4],
    };
    const base = {
      currentDomain: "TEXTURING" as const,
      stale: ["TEXTURE_APPEARANCE" as const],
      result,
    };
    const withUnrelatedScope = downstreamRechecksForFreshness({
      ...base,
      verificationScope: {
        kind: "CUBE_TARGETS",
        cube_uuids: ["cube-a"],
        framing: { min: [0, 0, 0], max: [1, 1, 1] },
      },
    });
    expect(withUnrelatedScope).toEqual(
      downstreamRechecksForFreshness(base)
    );
  });

  test("translation-only geometry keeps UV/texture/animation preserved", () => {
    const result = downstreamRechecksForFreshness({
      currentDomain: "GEOMETRY",
      stale: ["GEOMETRY_STRUCTURE"],
    });
    expect(result.required).toEqual([
      {
        scope: "GEOMETRY_STRUCTURE",
        domain: "GEOMETRY",
        action: "REVERIFY_GEOMETRY",
        reason: "Authored geometry structure changed.",
      },
    ]);
    expect(result.preserved_domains).toEqual([
      "TEXTURING",
      "ANIMATION",
    ]);
  });

  test("resize-style stale scopes request only affected downstream checks", () => {
    const result = downstreamRechecksForFreshness({
      currentDomain: "GEOMETRY",
      stale: [
        "GEOMETRY_STRUCTURE",
        "UV_MAPPING",
        "TEXTURE_APPEARANCE",
        "ANIMATION_MOTION",
      ],
    });
    expect(result.required.map((entry) => entry.action)).toEqual([
      "REVERIFY_ANIMATION_MOTION",
      "REVERIFY_GEOMETRY",
      "REVERIFY_MAPPED_TEXTURE",
      "REVERIFY_UV_LAYOUT",
    ]);
    expect(result.preserved_domains).toEqual([]);
  });

  test("pivot-only geometry does not invalidate UV or texture", () => {
    const result = downstreamRechecksForFreshness({
      currentDomain: "GEOMETRY",
      stale: ["GEOMETRY_STRUCTURE", "ANIMATION_MOTION"],
    });
    expect(result.required.map((entry) => entry.action)).toEqual([
      "REVERIFY_ANIMATION_MOTION",
      "REVERIFY_GEOMETRY",
    ]);
    expect(result.required.map((entry) => entry.action)).not.toContain(
      "REVERIFY_UV_LAYOUT"
    );
    expect(result.required.map((entry) => entry.action)).not.toContain(
      "REVERIFY_MAPPED_TEXTURE"
    );
    expect(result.preserved_domains).toEqual(["TEXTURING"]);
  });

  test("texture appearance mutation keeps animation preserved", () => {
    const result = downstreamRechecksForFreshness({
      currentDomain: "TEXTURING",
      stale: ["TEXTURE_APPEARANCE"],
    });
    expect(result.required).toHaveLength(1);
    expect(result.required[0]).toMatchObject({
      domain: "TEXTURING",
      action: "REVERIFY_MAPPED_TEXTURE",
    });
    expect(result.preserved_domains).toEqual([
      "GEOMETRY",
      "ANIMATION",
    ]);
  });
});
