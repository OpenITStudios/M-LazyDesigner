import { describe, expect, test } from "bun:test";
import {
  compactGatewayCapabilityContent,
  compactGatewayCapabilityStructuredContent,
} from "./resultCompaction";

describe("Gateway result-compaction information preservation", () => {
  const warning = [
    { type: "text", text: "WARNING: UV seam is UNVERIFIED. Do not finalize." },
  ];

  test("receipt_only preserves warning, blocker and pending-save information", () => {
    for (const text of [
      warning[0].text,
      "BLOCKED: a required reference is missing.",
      "Artifact pending: not saved to a .bbmodel.",
    ]) {
      const content = [{ type: "text", text }];
      expect(compactGatewayCapabilityContent(
        "modify_group", { after: { uuid: "bone" } }, content, "receipt_only"
      )).toEqual(content);
    }
  });

  test("inspect_elements preserves warning text despite its summary shortcut", () => {
    expect(compactGatewayCapabilityContent(
      "inspect_elements", { uuid: "a", name: "arm", type: "group" },
      warning, "focused_read", true
    )).toEqual(warning);
  });

  test("read-only results preserve unique human explanations beyond structured fields", () => {
    const structured = { uuid: "cube-a", faces: 6 };
    const guidance = [{
      type: "text",
      text: "Upper faces share a small section of the atlas.",
    }];
    expect(compactGatewayCapabilityContent(
      "inspect_elements", structured, guidance, "focused_read", true
    )).toEqual(guidance);
    const ordinary = [{
      type: "text",
      text: "The source image corresponds to the underside only.",
    }];
    expect(compactGatewayCapabilityContent(
      "inspect_element", structured, ordinary, "focused_read", true
    )).toEqual(ordinary);
    expect(compactGatewayCapabilityContent(
      "inspect_element", structured,
      [{ type: "text", text: "Read complete." }], "focused_read", true
    )).toEqual([{ type: "text", text: "Read complete." }]);
  });

  test("inspect_elements compacts only its exact generated identity summary", () => {
    const structured = { uuid: "u-1", type: "cube", name: "body" };
    for (const text of [
      'Inspected cube "body" (u-1).',
      'Inspected cube "body" (u-1) with UV mapping detail.',
    ]) {
      expect(compactGatewayCapabilityContent(
        "inspect_elements", structured, [{ type: "text", text }],
        "focused_read"
      )).toEqual([{ type: "text", text: "Inspection ready." }]);
    }
    for (const text of [
      'Inspected cube "body" (u-1). Top face needs a different UV offset.',
      'Inspected cube "body" (wrong-uuid).',
    ]) {
      const content = [{ type: "text", text }];
      expect(compactGatewayCapabilityContent(
        "inspect_elements", structured, content, "focused_read"
      )).toEqual(content);
    }
  });

  test("manage_cubes preserves warnings and multi-item image evidence", () => {
    expect(compactGatewayCapabilityContent(
      "manage_cubes", { execution: "applied", modified: 1 },
      warning, "visual"
    )).toEqual(warning);
    const mixed = [
      { type: "text", text: "Applied." },
      { type: "image", data: "fixture", mimeType: "image/png" },
    ];
    expect(compactGatewayCapabilityContent(
      "manage_cubes", { execution: "applied", modified: 1 },
      mixed, "visual"
    )).toEqual(mixed);
  });

  test("unverified mutation quality and incomplete approval text are never compacted", () => {
    const receipt = { execution: "applied", modified: 1 };
    for (const text of [
      "Applied authored update to Cube body. Structural effects recorded; reference fidelity was not evaluated.",
      "Geometry correction was not reviewed.",
      "Model has not been approved by the artist.",
      "Surface has not been tested against the reference.",
      "UV corrections have not yet been reviewed.",
      "Geometry reference has not fully been evaluated.",
    ]) {
      const content = [{ type: "text", text }];
      expect(compactGatewayCapabilityContent(
        "manage_cubes", receipt, content, "visual"
      )).toEqual(content);
    }
  });

  test("failed mutations retain all text and prestate even with an authoritative-looking after", () => {
    const failure = {
      execution: "applied",
      before: { uuid: "a", face_uvs: { north: [0, 0, 4, 4] } },
      after: { uuid: "a", face_uvs: { north: [4, 4, 8, 8] } },
      geometry_effect: { changed_fields: ["faces"] },
      recovery: { state_uncertain: true, rollback: "inspect current project" },
    };
    const text = [{ type: "text", text: "Please inspect the current authored UV state." }];
    expect(compactGatewayCapabilityStructuredContent(
      "manage_cubes", failure, "visual", false
    )).toBe(failure);
    expect(compactGatewayCapabilityStructuredContent(
      "modify_group", failure, "receipt_only", false
    )).toBe(failure);
    expect(compactGatewayCapabilityContent(
      "manage_cubes", failure, text, "visual", false, false
    )).toEqual(text);
    expect(compactGatewayCapabilityContent(
      "modify_group", failure, text, "receipt_only", false, false
    )).toEqual(text);
  });

  test("complete Cube receipt drops redundant prestate, but incomplete evidence is retained", () => {
    const complete = {
      before: { uuid: "arm", face_uvs: { north: [0, 0, 4, 4] } },
      after: {
        uuid: "arm", name: "arm", rotation: [0, 10, 0],
        face_uvs: { north: [0, 0, 4, 4] },
      },
      geometry_effect: { changed_fields: ["rotation"] },
    };
    const incomplete = {
      before: { uuid: "tail", face_uvs: { north: [0, 0, 1, 1] } },
      after: { uuid: "tail", face_uvs: { north: [4, 0, 5, 1] } },
      geometry_effect: { description: "could not resolve changed fields" },
    };
    const batch = { execution: "applied", effects: [complete, incomplete] };
    const result = compactGatewayCapabilityStructuredContent(
      "manage_cubes", batch, "visual"
    ) as { effects: unknown[] };
    expect(result.effects[0]).toEqual({
      after: { uuid: "arm", name: "arm", rotation: [0, 10, 0] },
      geometry_effect: complete.geometry_effect,
    });
    expect(result.effects[1]).toEqual(incomplete);
    expect(compactGatewayCapabilityStructuredContent(
      "manage_cubes", incomplete, "visual"
    )).toEqual(incomplete);
    expect(compactGatewayCapabilityStructuredContent(
      "manage_cubes", { execution: "applied", effects: [{ before: complete.before }] },
      "visual"
    )).toEqual({
      execution: "applied", effects: [{ before: complete.before }],
    });
    const group = { before: { uuid: "bone", rotation: 0 }, after: { uuid: "bone", rotation: 90 } };
    expect(compactGatewayCapabilityStructuredContent(
      "modify_group", group, "receipt_only"
    )).toEqual({ after: group.after });
  });

  test("normal successful result is still compact", () => {
    expect(compactGatewayCapabilityContent(
      "modify_group", { after: { uuid: "bone" } },
      [{ type: "text", text: "Updated bone." }], "receipt_only"
    )).toEqual([{ type: "text", text: "Receipt complete." }]);
    expect(compactGatewayCapabilityContent(
      "manage_cubes", { execution: "applied", modified: 1 },
      [{ type: "text", text: "Modified cube." }], "visual"
    )).toEqual([{ type: "text", text: "Cube mutation applied; use structured receipt." }]);
  });
});
