import { describe, expect, test } from "bun:test";
import { buildControlDelta } from "@/gateway/control";

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
        receipt: {
          changed_island_ids: ["face:cube-a:north", "face:cube-b:south"],
          changed_cube_ids: ["cube-a", "cube-b"],
          moved: [
            { island_id: "face:cube-a:north" },
            { island_id: "face:cube-b:south" },
          ],
          changed_faces: [
            { cube_uuid: "cube-a", face: "north" },
            { cube_uuid: "cube-b", face: "south" },
          ],
        },
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

  test("UV target extraction deduplicates receipt identities", () => {
    const delta = buildControlDelta({
      capability: "manage_uv_layout",
      branch: { field: "operation", value: "apply" },
      phaseBefore: "texturing",
      phaseAfter: "texturing",
      projectUuid: "project-a",
      succeeded: true,
      result: {
        receipt: {
          changed_island_ids: ["i-a", "i-a"],
          changed_cube_ids: ["cube-a", "cube-a"],
          changed_faces: [
            { cube_uuid: "cube-a", face: null },
          ],
        },
      },
    });

    const uv = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "UV_MAPPING"
    );

    expect(uv?.target).toMatchObject({
      cube_ids: ["cube-a"],
      island_ids: ["i-a"],
      faces: [{ cube_uuid: "cube-a", face: null }],
    });
  });


  test("malformed or incomplete UV scope never reports a partial affected surface", () => {
    const valid = {
      changed_island_ids: ["face:cube-a:north"],
      changed_cube_ids: ["cube-a"],
      changed_faces: [{ cube_uuid: "cube-a", face: "north" }],
      moved: [{ island_id: "face:cube-a:north" }],
    };
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
        receipt: {
          changed_cube_ids: cubes,
          changed_island_ids: cubes.map((id) => "box:" + id),
          changed_faces: cubes.map((id) => ({ cube_uuid: id, face: null })),
        },
      },
    });
    const mapped = delta.downstream_recheck.required.find(
      (entry) => entry.scope === "TEXTURE_APPEARANCE"
    );
    expect(mapped?.action).toBe("REVERIFY_MAPPED_TEXTURE");
    expect(mapped?.target).toBeUndefined();
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
