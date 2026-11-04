import { describe, expect, test } from "bun:test";
import {
  parseReferenceImageRegions,
  summarizeReferencePartRegions,
} from "@/lib/reference/imageRegionEvidence";

describe("source-image region → semantic-part evidence", () => {
  test("preserves authored volume, surface, contact and hidden claims without inventing geometry", () => {
    const regions = parseReferenceImageRegions([
      { id: "torso", part_id: "body", evidence_role: "PRIMARY_VOLUME",
        visibility: "DIRECT", box_uv: [0.2, 0.2, 0.8, 0.8] },
      { id: "badge", part_id: "body", evidence_role: "SURFACE_DETAIL",
        visibility: "DIRECT", box_uv: [0.4, 0.4, 0.6, 0.5] },
      { id: "joint", part_id: "arm", related_part_id: "body",
        evidence_role: "CONTACT", visibility: "PARTIAL", box_uv: [0.15, 0.3, 0.3, 0.55] },
      { id: "rear_leg", part_id: "leg", evidence_role: "PRIMARY_VOLUME",
        visibility: "OCCLUDED", box_uv: null },
    ]);
    expect(regions).toHaveLength(4);
    expect(regions![3]!.box_uv).toBeNull();
    const summary = summarizeReferencePartRegions([
      { id: "IMG_FRONT", view: "front", sha256: "a".repeat(64), regions: regions! },
      { id: "IMG_DETAIL", view: "front", sha256: "b".repeat(64), regions: [
        { ...regions![0]!, id: "torso_second", box_uv: [0.2, 0.2, 0.8, 0.8] },
      ] },
    ], [
      { id: "body", role: "GEOMETRY" },
      { id: "arm", role: "GEOMETRY" },
      { id: "leg", role: "GEOMETRY" },
    ]);
    expect(summary.state).toBe("ANNOTATED");
    expect(summary.visual_verdict).toBe("NOT_EVALUATED");
    expect(summary.region_count).toBe(5);
    expect(summary.parts.find((p) => p.part_id === "body")).toMatchObject({
      directly_visible_views: ["front"],
      geometry_region_ids: ["IMG_FRONT:torso", "IMG_DETAIL:torso_second"],
      texture_region_ids: ["IMG_FRONT:badge"],
      hidden_shape_status: "UNVERIFIED",
    });
    expect(summary.parts.find((p) => p.part_id === "leg")?.occluded_views).toEqual(["front"]);
    expect(summary.parts.find((p) => p.part_id === "leg")?.geometry_region_ids).toEqual([]);
    expect(summary.ownership_issues).toEqual([]);
  });

  test("surface decoration, occlusion, and ambiguous owners never become blanket geometry permission", () => {
    const direct = parseReferenceImageRegions([
      { id: "panel", part_id: "surface", evidence_role: "SURFACE_DETAIL",
        visibility: "DIRECT", box_uv: [0.2, 0.2, 0.6, 0.8] },
      { id: "volume", part_id: "painted", evidence_role: "PRIMARY_VOLUME",
        visibility: "DIRECT", box_uv: [0.1, 0.1, 0.5, 0.6] },
      { id: "excluded", part_id: "omitted", evidence_role: "PRIMARY_VOLUME",
        visibility: "DIRECT", box_uv: [0.2, 0.2, 0.4, 0.4] },
      { id: "obscured", part_id: "hidden", evidence_role: "PRIMARY_VOLUME",
        visibility: "OCCLUDED" },
    ])!;
    const result = summarizeReferencePartRegions([
      { id: "IMG", view: "front", sha256: "a".repeat(64), regions: direct },
    ], [
      { id: "surface", role: "TEXTURE" },
      { id: "painted", role: "TEXTURE" },
      { id: "omitted", role: "OMIT" },
      { id: "hidden", role: "UNRESOLVED" },
    ]);
    expect(result.parts.find((x) => x.part_id === "surface")?.geometry_region_ids).toEqual([]);
    expect(result.ownership_issues.map((x) => x.reason)).toEqual([
      "DECLARED_TEXTURE_BUT_VISIBLE_VOLUME",
      "DECLARED_OMIT_BUT_VISIBLE",
    ]);
    expect(result.parts.find((x) => x.part_id === "hidden")?.occluded_views).toEqual(["front"]);
    expect(result.parts.find((x) => x.part_id === "hidden")?.geometry_region_ids).toEqual([]);
  });

  test("rejects fabricated bounding boxes, duplicate identities, and relationships without a physical role", () => {
    const good = { id: "body", part_id: "body", evidence_role: "PRIMARY_VOLUME",
      visibility: "DIRECT", box_uv: [0.1, 0.2, 0.8, 0.9] };
    for (const regions of [
      [{ ...good, box_uv: [-0.1, 0.1, 0.5, 0.5] }],
      [{ ...good, box_uv: [0.9, 0.1, 0.1, 0.5] }],
      [{ ...good, box_uv: [0.1, 0.5, 0.8, 0.5] }],
      [{ ...good, box_uv: [0.1, 0.2, Number.NaN, 0.8] }],
      [{ ...good, visibility: "OCCLUDED" }],
      [{ ...good, box_uv: null }],
      [{ ...good, id: " " }],
      [{ ...good }, { ...good }],
      [{ ...good, related_part_id: "handle" }],
      [{ ...good, invented_mask: "mask.png" }],
      Array.from({ length: 17 }, (_, i) => ({ ...good, id: "part" + i })),
      "not-a-region-list",
    ]) expect(parseReferenceImageRegions(regions)).toBeNull();
    expect(parseReferenceImageRegions([
      { id: "hidden", part_id: "body", evidence_role: "PRIMARY_VOLUME",
        visibility: "OCCLUDED" },
    ])?.[0]?.box_uv).toBeNull();
    expect(parseReferenceImageRegions(undefined)).toEqual([]);
  });

  test("DRAFT and unapproved regions cannot contaminate approved coverage", () => {
    const region = parseReferenceImageRegions([{
      id: "main", part_id: "body", evidence_role: "PRIMARY_VOLUME",
      visibility: "DIRECT", box_uv: [0.1, 0.15, 0.8, 0.85],
    }])!;
    const images = [{
      id: "approved", view: "front" as const, status: "APPROVED",
      sha256: "a".repeat(64), regions: region,
    }, {
      id: "draft", view: "back" as const, status: "DRAFT",
      sha256: "b".repeat(64), regions: region,
    }, {
      id: "unknown", view: "left" as const, status: null,
      sha256: "c".repeat(64), regions: region,
    }];
    const summary = summarizeReferencePartRegions(images, [{ id: "body", role: "GEOMETRY" }]);
    expect(summary.region_count).toBe(1);
    expect(summary.parts[0]).toMatchObject({
      directly_visible_views: ["front"],
      geometry_region_ids: ["approved:main"],
      hidden_shape_status: "UNVERIFIED",
    });
    expect(summary.visual_verdict).toBe("NOT_EVALUATED");
    const draftOnly = summarizeReferencePartRegions(images.slice(1));
    expect(draftOnly).toMatchObject({
      state: "NO_ANNOTATIONS", part_count: 0, region_count: 0,
      visual_verdict: "NOT_EVALUATED",
    });
  });


  test("one approved image SHA relabelled as FRONT and BACK yields no trusted part-view coverage", () => {
    const region = parseReferenceImageRegions([{
      id: "main", part_id: "body", evidence_role: "PRIMARY_VOLUME",
      visibility: "DIRECT", box_uv: [0.1, 0.1, 0.9, 0.9],
    }])!;
    const sameSha = "a".repeat(64);
    const result = summarizeReferencePartRegions([
      { id: "front", status: "APPROVED", view: "front", sha256: sameSha, regions: region },
      { id: "back", status: "APPROVED", view: "back", sha256: sameSha, regions: region },
    ], [{ id: "body", role: "GEOMETRY" }]);
    expect(result).toMatchObject({
      state: "NO_ANNOTATIONS", part_count: 0, region_count: 0,
      visual_verdict: "NOT_EVALUATED",
    });
  });

  test("a DRAFT view alias cannot invalidate a separate approved view", () => {
    const region = parseReferenceImageRegions([{
      id: "mass", part_id: "body", evidence_role: "PRIMARY_VOLUME",
      visibility: "DIRECT", box_uv: [0.2, 0.15, 0.8, 0.85],
    }])!;
    const result = summarizeReferencePartRegions([
      { id: "front", status: "APPROVED", view: "front", sha256: "a".repeat(64), regions: region },
      { id: "draft-back", status: "DRAFT", view: "back", sha256: "a".repeat(64), regions: region },
      { id: "prose-alias", status: "APPROVED", view: "left", sha256: "unverified", regions: region },
    ], [{ id: "body", role: "GEOMETRY" }]);
    expect(result.state).toBe("ANNOTATED");
    expect(result.parts[0]).toMatchObject({
      directly_visible_views: ["front"], geometry_region_ids: ["front:mass"],
      hidden_shape_status: "UNVERIFIED",
    });
    expect(result.visual_verdict).toBe("NOT_EVALUATED");
  });

  test("distinct current approved images can contribute separate views without visual PASS", () => {
    const region = parseReferenceImageRegions([{
      id: "mass", part_id: "body", evidence_role: "PRIMARY_VOLUME",
      visibility: "DIRECT", box_uv: [0.1, 0.2, 0.9, 0.9],
    }])!;
    const result = summarizeReferencePartRegions([
      { id: "front", status: "APPROVED", view: "front", sha256: "a".repeat(64), regions: region },
      { id: "back", status: "APPROVED", view: "back", sha256: "b".repeat(64), regions: region },
      { id: "composite", status: "APPROVED", view: null, sha256: "c".repeat(64), regions: region },
    ], [{ id: "body", role: "GEOMETRY" }]);
    expect(result).toMatchObject({
      state: "ANNOTATED", part_count: 1, region_count: 2,
      visual_verdict: "NOT_EVALUATED",
    });
    expect(result.parts[0]).toMatchObject({
      directly_visible_views: ["front", "back"],
      geometry_region_ids: ["front:mass", "back:mass"],
      hidden_shape_status: "UNVERIFIED",
    });
  });
  test("distinct images with the same view never fabricate independent multi-view support", () => {
    const region = parseReferenceImageRegions([
      { id: "seat", part_id: "seat", evidence_role: "PRIMARY_VOLUME",
        visibility: "DIRECT", box_uv: [0.2, 0.3, 0.8, 0.9] },
    ])!;
    const summary = summarizeReferencePartRegions([
      { id: "front-1", view: "front", sha256: "a".repeat(64), regions: region },
      { id: "front-2", view: "front", sha256: "b".repeat(64), regions: region },
    ]);
    expect(summary.parts).toHaveLength(1);
    expect(summary.parts[0]?.directly_visible_views).toEqual(["front"]);
    expect(summary.part_count).toBe(1);
    expect(summary.visual_verdict).toBe("NOT_EVALUATED");
  });
});
