import { describe, expect, test } from "bun:test";
import { buildControlDelta } from "@/gateway/control";

function nativeUvReceipt(scope: {
  changed_island_ids: string[];
  changed_cube_ids: string[];
  changed_faces: Array<{ cube_uuid: string; face: string | null }>;
}) {
  return {
    schema: 1 as const,
    source_fingerprint_before: "sha256:" + "a".repeat(64),
    source_fingerprint_after: "sha256:" + "b".repeat(64),
    ...scope,
    moved: scope.changed_island_ids.map((island_id, index) => ({
      island_id,
      before: { x: index * 4, y: 0, width: 2, height: 2 },
      after: { x: index * 4 + 2, y: 0, width: 2, height: 2 },
      rotated_90: false,
    })),
  };
}

describe("UV downstream recheck targets", () => {
  test("UV apply carries affected cube face and island evidence into recheck targets", () => {
    const delta = buildControlDelta({
      capability: "manage_uv_layout",
      branch: { field: "operation", value: "apply" },
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        receipt: nativeUvReceipt({
          changed_island_ids: ["face:cube-a:north", "face:cube-b:south"],
          changed_cube_ids: ["cube-a", "cube-b"],
          changed_faces: [
            { cube_uuid: "cube-a", face: "north" },
            { cube_uuid: "cube-b", face: "south" },
          ],
        }),
      },
    });

    const uv = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "UV_MAPPING"
    );
    const texture = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "TEXTURE_APPEARANCE"
    );

    expect(uv?.target).toEqual({
      cube_ids: ["cube-a", "cube-b"],
      island_ids: ["face:cube-a:north", "face:cube-b:south"],
      faces: [
        { cube_uuid: "cube-a", face: "north" },
        { cube_uuid: "cube-b", face: "south" },
      ],
    });
    expect(texture?.target).toEqual(uv?.target);
  });

  test("duplicate native UV identity claims cannot narrow recheck scope", () => {
    const delta = buildControlDelta({
      capability: "manage_uv_layout",
      branch: { field: "operation", value: "apply" },
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        receipt: {
          ...nativeUvReceipt({
            changed_island_ids: ["i-a"],
            changed_cube_ids: ["cube-a"],
            changed_faces: [{ cube_uuid: "cube-a", face: null }],
          }),
          changed_island_ids: ["i-a", "i-a"],
          changed_cube_ids: ["cube-a", "cube-a"],
        },
      },
    });

    const uv = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "UV_MAPPING"
    );

    expect(uv?.target).toBeUndefined();
    expect(delta.downstream_recheck.required.find(
      (entry) => entry.scope === "TEXTURE_APPEARANCE"
    )?.target).toBeUndefined();
  });


  test("malformed or incomplete UV scope never reports a partial affected surface", () => {
    const valid = nativeUvReceipt({
      changed_island_ids: ["face:cube-a:north"],
      changed_cube_ids: ["cube-a"],
      changed_faces: [{ cube_uuid: "cube-a", face: "north" }],
    });
    const invalidReceipts = [
      { changed_cube_ids: ["cube-a", null] },
      { changed_island_ids: ["face:cube-a:north", " "] },
      { changed_faces: [{ cube_uuid: "cube-a", face: "north" },
        { cube_uuid: "", face: "south" }] },
      { changed_faces: [{ cube_uuid: "cube-a", face: "front" }] },
      { changed_faces: [{ cube_uuid: "cube-b", face: "north" }] },
      { changed_cube_ids: ["cube-a", "cube-b"] },
      { changed_faces: [] },
      { changed_faces: null },
      { changed_island_ids: undefined },
      { moved: [{ island_id: "other" }] },
      { moved: [{ island_id: "face:cube-a:north" }, { island_id: "extra" }] },
      { source_fingerprint_after: valid.source_fingerprint_before },
      { moved: [{ ...valid.moved[0], after: valid.moved[0].before }] },
      { changed_faces: [{ cube_uuid: "cube-a", face: "north" },
        { cube_uuid: "cube-a", face: "north" }] },
    ];
    for (const bad of invalidReceipts) {
      const delta = buildControlDelta({
        capability: "manage_uv_layout",
        branch: { field: "operation", value: "apply" },
        phaseBefore: "texturing", phaseAfter: "texturing",
        projectUuid: "project-a", succeeded: true,
        result: { receipt: { ...valid, ...bad } },
      });
      expect(delta.freshness.stale).toContain("UV_MAPPING");
      expect(delta.freshness.stale).toContain("TEXTURE_APPEARANCE");
      for (const scope of ["UV_MAPPING", "TEXTURE_APPEARANCE"]) {
        const entry = delta.downstream_recheck.required.find(
          (item) => item.scope === scope
        );
        expect(entry?.target, JSON.stringify(bad)).toBeUndefined();
      }
    }
  });

  test("large UV repack remains unbounded rather than emitting oversized target lists", () => {
    const cubes = Array.from({ length: 65 }, (_, i) => "cube-" + i);
    const delta = buildControlDelta({
      capability: "manage_uv_layout",
      branch: { field: "operation", value: "apply" },
      phaseBefore: "texturing", phaseAfter: "texturing",
      projectUuid: "project-a", succeeded: true,
      result: {
        receipt: nativeUvReceipt({
          changed_cube_ids: cubes,
          changed_island_ids: cubes.map((id) => "box:" + id),
          changed_faces: cubes.map((id) => ({ cube_uuid: id, face: null })),
        }),
      },
    });
    const mapped = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "TEXTURE_APPEARANCE"
    );
    expect(mapped?.action).toBe("REVERIFY_MAPPED_TEXTURE");
    expect(mapped?.target).toBeUndefined();
  });
  test("invalid native UV receipt does not use unrelated Texture-region evidence", () => {
    const receipt = nativeUvReceipt({
      changed_cube_ids: ["cube-a"],
      changed_island_ids: ["face:cube-a:north"],
      changed_faces: [{ cube_uuid: "cube-a", face: "north" }],
    });
    const delta = buildControlDelta({
      capability: "manage_uv_layout",
      branch: { field: "operation", value: "apply" },
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        receipt: {
          ...receipt,
          changed_island_ids: ["other-island"],
        },
        texture: { uuid: "unrelated-atlas" },
        revision: { after: "unrelated-revision" },
        affected_rect: [0, 0, 8, 8],
      },
    });
    for (const scope of ["UV_MAPPING", "TEXTURE_APPEARANCE"]) {
      expect(delta.downstream_recheck.required.find(
        (row) => row.scope === scope
      )?.target).toBeUndefined();
    }
  });

  test("native Box UV null-face targets remain bounded when receipt is complete", () => {
    const delta = buildControlDelta({
      capability: "manage_uv_layout",
      branch: { field: "operation", value: "apply" },
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        receipt: nativeUvReceipt({
          changed_cube_ids: ["cube-a"],
          changed_island_ids: ["box:cube-a"],
          changed_faces: [{ cube_uuid: "cube-a", face: null }],
        }),
      },
    });
    const target = delta.downstream_recheck.required.find(
      (row) => row.scope === "TEXTURE_APPEARANCE"
    )?.target;
    expect(target).toEqual({
      cube_ids: ["cube-a"],
      island_ids: ["box:cube-a"],
      faces: [{ cube_uuid: "cube-a", face: null }],
    });
  });

  test("non-UV geometry rechecks do not fabricate target evidence", () => {
    const delta = buildControlDelta({
      capability: "modify_group",
      phaseBefore: "geometry",
      phaseAfter: "geometry",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        execution: "applied",
        id: "group-a",
        name: "group-a",
        changed_fields: ["origin"],
        group: {
          uuid: "group-a",
          name: "group-a",
          origin: [1, 0, 0],
          rotation: [0, 0, 0],
          visibility: true,
          parent: "root",
        },
      },
    });

    expect(
      delta.downstream_recheck.required.every(
        (entry) => entry.target === undefined
      )
    ).toBe(true);
  });
});
