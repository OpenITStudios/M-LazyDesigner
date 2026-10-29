import { describe, expect, test } from "bun:test";
import {
  emptyReference,
  parseReferencePackage,
} from "./referenceParser";

describe("Control reference parser", () => {
  test("rejects malformed JSON and wrong schema", () => {
    expect(parseReferencePackage("{", "/tmp/REFERENCE.json", "/tmp")).toBeNull();
    expect(
      parseReferencePackage(
        JSON.stringify({ schema: "other-schema" }),
        "/tmp/REFERENCE.json",
        "/tmp"
      )
    ).toBeNull();
  });

  test("projects model reference data deterministically", () => {
    const raw = JSON.stringify({
      schema: "lazydesigner-reference-v1",
      asset: {
        name: "Chair",
        kind: "MODEL",
        profile: "PROP_FURNITURE",
        intent: "build chair",
      },
      requirements: {
        dimensions_blocks: { width: 1, height: 2, length: 1 },
        player_relative_scale: "human scale",
        animation_required: false,
      },
      readiness: {
        overall: "READY",
        geometry: "READY",
        texture: "UNKNOWN",
        animation: "UNKNOWN",
      },
      unknowns: {
        blocking: ["texture decision"],
        non_blocking: ["optional animation"],
      },
      documents: {
        geometry: "geometry.md",
        texture: "texture.md",
      },
      images: [
        {
          id: "front",
          file: "front.png",
          role: "front",
          used_by: ["geometry", "TEXTURE", "invalid"],
          status: "ready",
        },
      ],
      parts: [
        {
          id: "seat",
          role: "GEOMETRY",
          symmetry: "NONE",
          motion: "STATIC",
          evidence: "SUPPORTED",
          nested_ignored: { unsafe: true },
        },
      ],
      articulation: [
        {
          id: "seat_hinge",
          motion: "RIGID",
          pivot_region: "rear edge",
          clearance: ["backrest", "frame"],
        },
      ],
      materials: [
        {
          id: "wood",
          affected_parts: ["seat", "backrest"],
          base_color: "warm brown",
        },
      ],
      animation_guidance: [
        {
          name: "fold",
          type: "ONE_SHOT",
          participants: ["seat"],
        },
      ],
      constraints: [
        "preserve seat opening",
        "do not fill negative space",
      ],
    });

    const result = parseReferencePackage(
      raw,
      "/project/REFERENCE.json",
      "/project"
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      available: true,
      asset_name: "Chair",
      asset_kind: "MODEL",
      selected_profile: "PROP_FURNITURE",
      intent: "build chair",
      requirements: {
        dimensions_blocks: { width: 1, height: 2, length: 1 },
        player_relative_scale: "human scale",
        animation_required: false,
      },
      documents: {
        GEOMETRY: "geometry.md",
        TEXTURE: "texture.md",
      },
      semantic_facts: {
        parts: [
          {
            id: "seat",
            role: "GEOMETRY",
            symmetry: "NONE",
            motion: "STATIC",
            evidence: "SUPPORTED",
          },
        ],
        articulation: [
          {
            id: "seat_hinge",
            motion: "RIGID",
            pivot_region: "rear edge",
            clearance: ["backrest", "frame"],
          },
        ],
        materials: [
          {
            id: "wood",
            affected_parts: ["seat", "backrest"],
            base_color: "warm brown",
          },
        ],
        animation_guidance: [
          {
            name: "fold",
            type: "ONE_SHOT",
            participants: ["seat"],
          },
        ],
        constraints: [
          "preserve seat opening",
          "do not fill negative space",
        ],
      },
    });
    expect(result?.images[0]?.used_by).toEqual(["GEOMETRY", "TEXTURE"]);
    // Nonempty nested facts are available in the canonical source, not the
    // flattened stage projection. Signal recovery instead of silent loss.
    expect(result?.truncated_sections).toContain("parts");
    expect(result?.fingerprint).toHaveLength(64);
  });

  test("fingerprint is stable across JSON whitespace and key ordering", () => {
    const first = parseReferencePackage(
      '{"schema":"lazydesigner-reference-v1","asset":{"name":"Chair","kind":"MODEL"}}',
      "/project/REFERENCE.json",
      "/project"
    );
    const second = parseReferencePackage(
      JSON.stringify(
        {
          asset: { kind: "MODEL", name: "Chair" },
          schema: "lazydesigner-reference-v1",
        },
        null,
        4
      ),
      "/project/REFERENCE.json",
      "/project"
    );

    expect(first?.fingerprint).toBe(second?.fingerprint);
  });

  test("projects particle-specific fields only for particle assets", () => {
    const raw = JSON.stringify({
      schema: "lazydesigner-reference-v1",
      asset: { name: "Smoke", kind: "PARTICLE" },
      particle: {
        identifier: "mivubi:smoke",
        particle_json: "smoke.json",
        texture_png: "smoke.png",
        trigger: { intent: "burst", time_seconds: 0.5 },
        bind_to_actor: true,
      },
    });

    const result = parseReferencePackage(
      raw,
      "/project/REFERENCE.json",
      "/project"
    );
    expect(result?.particle).toMatchObject({
      identifier: "mivubi:smoke",
      particle_json: "smoke.json",
      texture_png: "smoke.png",
      trigger_intent: "burst",
      trigger_time_seconds: 0.5,
      bind_to_actor: true,
    });
  });

  test("passes bounded image landmarks into the stage reference contract", () => {
    const doc = {
      schema: "lazydesigner-reference-v1",
      asset: { name: "Lantern", kind: "MODEL" },
      images: [{
        id: "IMG_FRONT", file: "images/front.png",
        view: "front", used_by: ["GEOMETRY"],
        landmarks: [
          { id: "handle", uv: [0.5, 0.1], part_id: "handle" },
          { id: "body", uv: [0.5, 0.55] },
        ],
      }],
    };
    const parsed = parseReferencePackage(JSON.stringify(doc), "/pkg/REFERENCE.json", "/pkg");
    expect(parsed?.images[0].landmarks).toEqual([
      { id: "handle", uv: [0.5, 0.1], part_id: "handle" },
      { id: "body", uv: [0.5, 0.55], part_id: null },
    ]);
    expect(parseReferencePackage(JSON.stringify({
      ...doc,
      images: [{ ...doc.images[0], landmarks: [
        { id: "handle", uv: [0.5, 0.1] },
        { id: "handle", uv: [0.5, 0.9] },
      ] }],
    }), "/pkg/REFERENCE.json", "/pkg")).toBeNull();
    expect(parseReferencePackage(JSON.stringify({
      ...doc,
      images: [{ ...doc.images[0], landmarks: [
        { id: "handle", uv: [1.2, 0.1] },
      ] }],
    }), "/pkg/REFERENCE.json", "/pkg")).toBeNull();
    expect(parseReferencePackage(JSON.stringify({
      ...doc,
      images: [{ ...doc.images[0], view: undefined, landmarks: [
        { id: "handle", uv: [0.5, 0.1] },
      ] }],
    }), "/pkg/REFERENCE.json", "/pkg")).toBeNull();
  });

  test("anchors marked reference image regions to existing semantic parts and one view", () => {
    const model = {
      schema: "lazydesigner-reference-v1",
      asset: { name: "Workbench", kind: "MODEL", profile: "PROP_FURNITURE" },
      parts: [{ id: "frame", role: "GEOMETRY" }, { id: "stripe", role: "TEXTURE" }],
      images: [{
        id: "IMG_FRONT", file: "images/front.png", view: "front",
        used_by: ["GEOMETRY", "TEXTURE"], status: "APPROVED",
        regions: [
          { id: "body", part_id: "frame", evidence_role: "PRIMARY_VOLUME",
            visibility: "DIRECT", box_uv: [0.1, 0.2, 0.9, 0.9] },
          { id: "trim", part_id: "stripe", evidence_role: "SURFACE_DETAIL",
            visibility: "PARTIAL", box_uv: [0.3, 0.4, 0.8, 0.5] },
        ],
      }],
    };
    const parse = (value: unknown) =>
      parseReferencePackage(JSON.stringify(value), "/pkg/REFERENCE.json", "/pkg");
    const result = parse(model);
    expect(result?.images[0]?.regions).toHaveLength(2);
    expect(result?.images[0]?.regions?.[0]).toMatchObject({
      id: "body", part_id: "frame", visibility: "DIRECT",
    });
    expect(parse({ ...model, images: [{ ...model.images[0], view: undefined }] })).toBeNull();
    expect(parse({ ...model, images: [{ ...model.images[0], regions: [
      { ...model.images[0].regions[0], part_id: "unlisted_part" },
    ] }] })).toBeNull();
    expect(parse({ ...model, parts: [{ id: "frame" }, { id: "frame" }] })).toBeNull();
    expect(parse({ ...model, images: [{ ...model.images[0], regions: [
      { ...model.images[0].regions[0], box_uv: [0.9, 0.2, 0.1, 0.8] },
    ] }] })).toBeNull();
    expect(parse({ ...model, images: [{ ...model.images[0], regions: [
      { id: "hidden", part_id: "frame", evidence_role: "PRIMARY_VOLUME",
        visibility: "OCCLUDED", box_uv: null },
    ] }] })?.images[0]?.regions?.[0]?.box_uv).toBeNull();
  });

  test("signals omitted reference facts while validating all part IDs", () => {
    const doc = {
      schema: "lazydesigner-reference-v1",
      parts: Array.from({ length: 25 }, (_, i) => ({ id: "part_" + i, role: "GEOMETRY" })),
      unknowns: { blocking: Array.from({ length: 17 }, (_, i) => "unknown " + i) },
      images: [{
        id: "front", file: "front.png", view: "front",
        regions: [{ id: "last", part_id: "part_24", evidence_role: "PRIMARY_VOLUME",
          visibility: "DIRECT", box_uv: [0.1, 0.1, 0.5, 0.5] }],
      }],
    };
    const parsed = parseReferencePackage(JSON.stringify(doc), "/pkg/REFERENCE.json", "/pkg");
    expect(parsed?.semantic_facts?.parts).toHaveLength(24);
    expect(parsed?.images[0].regions?.[0].part_id).toBe("part_24");
    expect(parsed?.blocking_unknowns).toHaveLength(16);
    expect(parsed?.truncated_sections).toEqual(["parts", "unknowns.blocking"]);
  });

  test("signals field and nested-list omissions even below the row cap", () => {
    const doc = {
      schema: "lazydesigner-reference-v1",
      parts: [{
        id: "body",
        related_parts: Array.from({ length: 13 }, (_, i) => `part-${i}`),
      }],
      materials: [{
        id: "gold",
        ...Object.fromEntries(Array.from({ length: 16 },
          (_, i) => [`detail_${i}`, `value_${i}`])),
      }],
      articulation: [{ id: "hinge", related_parts: ["body"] }],
    };
    const parsed = parseReferencePackage(JSON.stringify(doc), "/pkg/REFERENCE.json", "/pkg");
    expect(parsed?.semantic_facts?.parts[0]?.related_parts).toHaveLength(12);
    expect(parsed?.semantic_facts?.materials[0]?.detail_15).toBeUndefined();
    expect(parsed?.truncated_sections).toEqual(["parts", "materials"]);
  });

  test("signals non-flat and malformed fact fields without altering the source", () => {
    const model = {
      schema: "lazydesigner-reference-v1",
      materials: [{
        id: "coat",
        appearance: { hue: "warm", finish: "matte" },
        affected_parts: ["torso", 17, "head"],
      }],
      animation_guidance: [{
        name: "attack",
        key_poses: ["anticipation", "", "impact"],
      }],
      parts: [{ id: "main", parent: null }],
    };
    const parsed = parseReferencePackage(JSON.stringify(model), "/pkg/REFERENCE.json", "/pkg");
    expect(parsed?.semantic_facts?.materials[0]).toEqual({
      id: "coat", affected_parts: ["torso", "head"],
    });
    expect(parsed?.semantic_facts?.animation_guidance[0]?.key_poses)
      .toEqual(["anticipation", "impact"]);
    expect(parsed?.truncated_sections).toEqual(["materials", "animation_guidance"]);
  });

  test("rejects wrong section types instead of reporting an empty valid inventory", () => {
    for (const section of ["articulation", "materials", "animation_guidance", "constraints"]) {
      const parsed = parseReferencePackage(JSON.stringify({
        schema: "lazydesigner-reference-v1",
        [section]: { unexpected: "not-an-array" },
      }), "/pkg/REFERENCE.json", "/pkg");
      expect(parsed).toBeNull();
    }
  });

  test("rejects malformed and duplicate source identities instead of silently omitting them", () => {
    const parse = (value: unknown) =>
      parseReferencePackage(JSON.stringify(value), "/pkg/REFERENCE.json", "/pkg");
    const base = { schema: "lazydesigner-reference-v1" };
    expect(parse({ ...base, images: [{ id: "front" }] })).toBeNull();
    expect(parse({ ...base, images: [null] })).toBeNull();
    expect(parse({ ...base, images: [
      { id: "front", file: "a.png" }, { id: "front", file: "b.png" },
    ] })).toBeNull();
    expect(parse({ ...base, parts: [{ id: "left" }, { id: "left" }] })).toBeNull();
    expect(parse({ ...base, parts: [{ id: "left" }, {}] })).toBeNull();
    expect(parse({ ...base, unknowns: { blocking: ["known", null] } })).toBeNull();
    expect(parse({ ...base, materials: [{ id: "coat" }, null] })).toBeNull();
    expect(parse({ ...base, articulation: ["misplaced text"] })).toBeNull();
    expect(parse({ ...base, animation_guidance: [{ name: "walk" }, 42] })).toBeNull();
    expect(parse({ ...base, constraints: ["keep legs attached", null] })).toBeNull();
    expect(parse({ ...base, constraints: [""] })).toBeNull();
    expect(parse({ ...base, images: "front.png" })).toBeNull();
  });

  test("canonical Geometry image constraints reject invalid source dimensions and identities", () => {
    const parse = (input: unknown) =>
      parseReferencePackage(JSON.stringify(input), "/pkg/REFERENCE.json", "/pkg");
    const source = {
      schema: "lazydesigner-reference-v1",
      parts: [{ id: "body", role: "GEOMETRY" }],
      images: [{
        id: "FRONT", file: "images/front.png", view: "front",
        used_by: ["GEOMETRY"], status: "APPROVED",
        part_world_constraints: [{
          part_id: "body", dimensions: { x: 8, z: 0 },
          attachment_parent: null, required: true,
        }],
      }],
    };
    expect(parse(source)?.images[0]?.part_world_constraints)
      .toEqual(source.images[0].part_world_constraints);
    const invalid = [
      [{ part_id: "body", dimensions: { z: -1 } }],
      [{ part_id: "body", dimensions: { z: null } }],
      [{ part_id: "body", dimensions: { unknown: 3 } }],
      [{ part_id: "ghost", dimensions: { z: 1 } }],
      [{ part_id: "body", dimensions: {} }],
      [{ part_id: "body", dimensions: { z: 1 }, attachment_parent: "" }],
      [{ part_id: "body", dimensions: { z: 1 }, required: "yes" }],
      [{ part_id: "body", required: true }],
      [{ part_id: "body", dimensions: { z: 1 }, unsupported: true }],
      [{ part_id: "body", dimensions: { z: 1 } },
       { part_id: "body", dimensions: { z: 1 } }],
      [], null,
    ];
    for (const rows of invalid) {
      expect(parse({ ...source, images: [{
        ...source.images[0], part_world_constraints: rows,
      }] })).toBeNull();
    }
    expect(parse({ ...source, images: [{
      ...source.images[0], view: undefined,
    }] })).toBeNull();
    expect(parse({ ...source, images: [{
      ...source.images[0], used_by: ["TEXTURE"],
    }] })).toBeNull();
    expect(parse({ ...source, images: [{
      ...source.images[0], part_world_constraints: Array.from(
        { length: 17 }, () => ({ part_id: "body", dimensions: { z: 0 } })
      ),
    }] })).toBeNull();
  });

  test("empty reference keeps a stable unavailable shape", () => {
    expect(emptyReference("REFERENCE_NOT_FOUND")).toMatchObject({
      available: false,
      selected_profile: null,
      documents: {},
      images: [],
      semantic_facts: {
        parts: [],
        articulation: [],
        materials: [],
        animation_guidance: [],
        constraints: [],
      },
      unavailable_reason: "REFERENCE_NOT_FOUND",
    });
  });
});
