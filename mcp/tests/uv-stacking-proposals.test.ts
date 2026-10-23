import { describe, expect, test } from "bun:test";
import { extractUvIslands } from "@/lib/uv/islands";
import { discoverUvStackProposals } from "@/lib/uv/stacking";

function islands() {
  return extractUvIslands(
    [
      { uuid: "left", name: "left_arm", from: [0,0,0], to: [4,8,4], box_uv: false, autouv: 0, mirror_uv: false, faces: [{ face: "north", uv: [0,0,4,8] }] },
      { uuid: "right", name: "right_arm", from: [0,0,0], to: [4,8,4], box_uv: false, autouv: 0, mirror_uv: true, faces: [{ face: "north", uv: [8,0,12,8] }] },
      { uuid: "logo", name: "logo", from: [0,0,0], to: [4,8,1], box_uv: false, autouv: 0, mirror_uv: false, faces: [{ face: "north", uv: [16,0,20,8] }] },
    ],
    (island) => {
      if (island.source.cube_name === "left_arm" || island.source.cube_name === "right_arm") {
        return { stack_group: "arms", mirror_policy: "ALLOW" };
      }
      if (island.source.cube_name === "logo") {
        return { unique_detail: true, mirror_policy: "FORBID" };
      }
      return undefined;
    }
  );
}

describe("UV stack proposal engine", () => {
  test("explicit stack groups become READY only when compatible", () => {
    const proposals = discoverUvStackProposals(islands());
    const arms = proposals.proposals.find((proposal) => proposal.id === "stack:arms");
    expect(arms).toMatchObject({
      kind: "EXPLICIT_STACK_GROUP",
      state: "READY",
      island_ids: ["face:left:north", "face:right:north"],
      blockers: [],
    });
  });

  test("implicit matching remains REVIEW evidence rather than automatic stacking", () => {
    const raw = extractUvIslands([
      { uuid: "a", name: "bolt_a", from: [0,0,0], to: [2,2,2], box_uv: false, autouv: 0, mirror_uv: false, faces: [{ face: "north", uv: [0,0,2,2] }] },
      { uuid: "b", name: "bolt_b", from: [0,0,0], to: [2,2,2], box_uv: false, autouv: 0, mirror_uv: false, faces: [{ face: "north", uv: [4,0,6,2] }] },
    ]);
    expect(discoverUvStackProposals(raw)).toEqual({
      proposals: [
        expect.objectContaining({ kind: "MATCHING_FOOTPRINT_CANDIDATE", state: "REVIEW", island_ids: ["face:a:north", "face:b:north"] }),
      ],
      implicit_examples_truncated: false,
    });
  });

  test("unique detail and mirror-forbidden intent block explicit stacking", () => {
    const raw = extractUvIslands(
      [
        { uuid: "a", name: "a", from: [0,0,0], to: [2,2,2], box_uv: false, autouv: 0, mirror_uv: false, faces: [{ face: "north", uv: [0,0,2,2] }] },
        { uuid: "b", name: "b", from: [0,0,0], to: [2,2,2], box_uv: false, autouv: 0, mirror_uv: false, faces: [{ face: "north", uv: [4,0,6,2] }] },
      ],
      (island) => island.source.cube_name === "a"
        ? { stack_group: "identity", unique_detail: true }
        : { stack_group: "identity", mirror_policy: "FORBID" }
    );
    const proposal = discoverUvStackProposals(raw).proposals[0];
    expect(proposal.state).toBe("BLOCKED");
    expect(proposal.blockers).toContain("face:a:north:UNIQUE_DETAIL");
    expect(proposal.blockers).toContain("face:b:north:MIRROR_FORBIDDEN");
  });

  test("implicit candidate discovery can be disabled", () => {
    const raw = extractUvIslands([
      { uuid: "a", name: "a", from: [0,0,0], to: [2,2,2], box_uv: false, autouv: 0, mirror_uv: false, faces: [{ face: "north", uv: [0,0,2,2] }] },
      { uuid: "b", name: "b", from: [0,0,0], to: [2,2,2], box_uv: false, autouv: 0, mirror_uv: false, faces: [{ face: "north", uv: [4,0,6,2] }] },
    ]);
    expect(discoverUvStackProposals(raw, { include_implicit_candidates: false })).toEqual({
      proposals: [], implicit_examples_truncated: false,
    });
  });

  test("repeated matching components return bounded, deterministic candidates", () => {
    const raw = extractUvIslands(Array.from({ length: 80 }, (_, index) => {
      const id = "part-" + String(index).padStart(3, "0");
      return {
        uuid: id, name: id, from: [0, 0, 0], to: [2, 2, 2],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north" as const, uv: [0, 0, 2, 2] }],
      };
    }));
    const result = discoverUvStackProposals(raw);
    expect(discoverUvStackProposals([...raw].reverse())).toEqual(result);
    expect(result.proposals).toHaveLength(32);
    expect(result.implicit_examples_truncated).toBe(true);
    expect(result.proposals[0].island_ids).toEqual([
      "face:part-000:north", "face:part-001:north",
    ]);
    expect(result.proposals[31].island_ids).toEqual([
      "face:part-000:north", "face:part-032:north",
    ]);
    const smaller = discoverUvStackProposals(raw, { max_implicit_examples: 2 });
    expect(smaller.proposals).toHaveLength(2);
    expect(smaller.implicit_examples_truncated).toBe(true);
    expect(() => discoverUvStackProposals(raw, { max_implicit_examples: 33 }))
      .toThrow("within 0..32");
  });
});
