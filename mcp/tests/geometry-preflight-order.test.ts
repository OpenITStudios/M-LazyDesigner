import { describe, expect, test } from "bun:test";
import { validateCubeGeometrySpan } from "@/server/tools/cubes";
import {
  boxUvSubunitAxes,
  requireBoxUvRepresentableSpan,
  requireDistinctCubeBatchPlacements,
} from "@/lib/geometry/cubeSpan";

describe("Geometry mutation preflight ordering", () => {
  test("Box UV sub-unit guard preserves true planes and explicit per-face option", () => {
    expect(boxUvSubunitAxes([0, 0, 0], [0.25, 8, 8])).toEqual(["x"]);
    expect(boxUvSubunitAxes([0, 0, 0], [0, 8, 8])).toEqual([]);
    expect(boxUvSubunitAxes([0, 0, 0], [1, 8, 8])).toEqual([]);
    expect(() => requireBoxUvRepresentableSpan([0, 0, 0], [0.25, 8, 8], "wing"))
      .toThrow("sub-unit Box UV size on x");
    expect(() => requireBoxUvRepresentableSpan([0, 0, 0], [0, 8, 8], "plane")).not.toThrow();
    expect(() => requireBoxUvRepresentableSpan([0, 0, 0], [1, 8, 8], "solid")).not.toThrow();
  });

  test("legacy fractional Box UV can be moved or improved but not worsened", () => {
    const previous = { from: [0, 0, 0], to: [0.25, 4, 4] };
    expect(() => requireBoxUvRepresentableSpan([2, 0, 0], [2.25, 4, 4],
      "translation", previous)).not.toThrow();
    expect(() => requireBoxUvRepresentableSpan([0, 0, 0], [0.5, 4, 4],
      "larger", previous)).not.toThrow();
    expect(() => requireBoxUvRepresentableSpan([0, 0, 0], [0.125, 4, 4],
      "worse", previous)).toThrow("sub-unit Box UV size on x");
    expect(() => requireBoxUvRepresentableSpan([0, 0, 0], [4, 0.5, 4],
      "new risk", previous)).toThrow("sub-unit Box UV size on y");
  });

  test("identical untextured batch Cubes do not create redundant geometry", () => {
    const a = {
      name: "body", parent_id: "bone:torso",
      from: [0, 0, 0], to: [4, 6, 3],
      origin: [0, 0, 0], rotation: [0, 0, 0], inflate: 0,
    };
    const b = { ...a, name: "body_duplicate" };
    expect(() => requireDistinctCubeBatchPlacements([a, b]))
      .toThrow("DUPLICATE_CUBE_PLACEMENT");
    expect(() => requireDistinctCubeBatchPlacements([
      a, { ...b, parent_id: "bone:arm" },
    ])).not.toThrow();
    expect(() => requireDistinctCubeBatchPlacements([
      a, { ...b, rotation: [0, 15, 0] },
    ])).not.toThrow();
    expect(() => requireDistinctCubeBatchPlacements([
      a, { ...b, inflate: 0.1 },
    ])).not.toThrow();
    expect(() => requireDistinctCubeBatchPlacements([
      a, { ...b, from: [0, 0, 0.5], to: [4, 6, 3.5] },
    ])).not.toThrow();
  });

  test("surface and bounds readers share native rendered visibility scope", async () => {
    const bounds = await Bun.file("lib/geometry/renderedModelBounds.ts").text();
    const runtime = await Bun.file("server/tools/validation/qualityEvidenceRuntime.ts").text();
    expect(bounds).toContain("cube.visibility !== false && isEffectivelyVisible(cube.mesh)");
    expect(runtime).toContain("cube.visibility !== false && isEffectivelyVisible(cube.mesh)");
    expect(runtime).toContain('import { isEffectivelyVisible } from "@/lib/geometry/renderedModelBounds"');
  });

  test("current preview OBB evidence reads native matrices without modifying animation time or Undo", async () => {
    const source = await Bun.file("server/tools/validation/qualityEvidenceRuntime.ts").text();
    const start = source.indexOf("function geometrySurfaceRuntime()");
    const end = source.indexOf("function uvPhysicalRuntime()", start);
    const body = source.slice(start, end);
    expect(body).toContain("orientedBoxFromCube(cube)");
    expect(body).toContain("current_preview_world_obb_review:");
    expect(body).toContain("omitted_cube_count: visibleCubes.length - sampled.length");
    expect(body).not.toContain("Undo.initEdit");
    expect(body).not.toContain("Timeline.time =");
  });

  test("geometry inspection projects Cube pivot and parent into merge evidence", async () => {
    const source = await Bun.file("server/tools/validation/qualityEvidenceRuntime.ts").text();
    const start = source.indexOf("function geometrySurfaceRuntime()");
    const end = source.indexOf("function uvPhysicalRuntime()", start);
    const body = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(body).toContain("origin: [...cube.origin]");
    expect(body).toContain("cube.parent instanceof Group");
  });

  test("direct Cube create plans marginal projection and merge before native Undo", async () => {
    const source = await Bun.file("server/tools/geometry/cubes.ts").text();
    const create = source.slice(source.indexOf("const executeCreateCubes"),
      source.indexOf("const executeUpdateCube"));
    for (const method of ["analyzeStaticMarginalProjection(", "analyzeStaticCubeMergeCandidates("]) {
      expect(create.indexOf(method)).toBeGreaterThanOrEqual(0);
      expect(create.indexOf(method)).toBeLessThan(create.indexOf("Undo.initEdit"));
    }
    expect(create).toContain("geometry_contribution_review");
    expect(create).toContain("marginal_projection:");
    expect(create).toContain("merge_candidates:");
    expect(create).toContain("realId(entry.cube_uuid)");
  });

  test("direct Cube create returns evidence for interior filler before opening native Undo", async () => {
    const source = await Bun.file("server/tools/geometry/cubes.ts").text();
    const block = source.slice(source.indexOf("const executeCreateCubes"),
      source.indexOf("const executeUpdateCube"));
    expect(block.indexOf("analyzeStaticCubeContainment(")).toBeGreaterThanOrEqual(0);
    expect(block.indexOf("analyzeStaticCubeContainment("))
      .toBeLessThan(block.indexOf("Undo.initEdit"));
    expect(block).toContain("geometry_contribution_review");
    expect(block).toContain("if (!customFaceUvs)");
    expect(block).toContain("cube.parent instanceof Group");
  });

  test("per-face UV stays exempt from duplicate rejection but receives pre-Undo contribution evidence", async () => {
    const code = await Bun.file("server/tools/geometry/cubes.ts").text();
    const create = code.slice(code.indexOf("const executeCreateCubes"), code.indexOf("const executeUpdateCube"));
    const guard = create.indexOf("if (!customFaceUvs)");
    const duplicate = create.indexOf("requireDistinctCubeBatchPlacements(", guard);
    const pending = create.indexOf("const pending: SurfaceEvidenceCube[]", duplicate);
    const undo = create.indexOf("Undo.initEdit", pending);
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(duplicate).toBeGreaterThan(guard);
    expect(pending).toBeGreaterThan(duplicate);
    expect(undo).toBeGreaterThan(pending);
    expect(create.slice(duplicate, pending)).toContain("}");
    for (const analyzer of [
      "analyzeStaticCubeContainment(source, scope)",
      "analyzeStaticMarginalProjection(source, scope)",
      "analyzeStaticCubeMergeCandidates(source, scope)",
    ]) expect(create.slice(pending, undo)).toContain(analyzer);
    expect(create).toContain("isEffectivelyVisible(cube.mesh)");
    expect(create).toContain("geometry_contribution_review");
    expect(create).not.toContain("autoDelete");
  });

  test("the exact batch duplicate guard executes before Undo but not for per-face layering", async () => {
    const source = await Bun.file("server/tools/geometry/cubes.ts").text();
    const create = source.slice(
      source.indexOf("const executeCreateCubes"),
      source.indexOf("const executeUpdateCube")
    );
    expect(create.indexOf("requireDistinctCubeBatchPlacements("))
      .toBeGreaterThanOrEqual(0);
    expect(create.indexOf("requireDistinctCubeBatchPlacements("))
      .toBeLessThan(create.indexOf("Undo.initEdit"));
    expect(create).toContain("if (!customFaceUvs)");
  });

  test("inherited Box UV mutation paths check sub-unit dimensions before Undo", async () => {
    const source = await Bun.file("server/tools/geometry/cubes.ts").text();
    for (const [startMarker, endMarker] of [
      ["const executeCreateCubes", "const executeUpdateCube"],
      ["const executeUpdateCube", "const executeBatchUpdateCubes"],
      ["const executeBatchUpdateCubes", "createTool(cubeToolDocs[0].name"],
    ]) {
      const start = source.indexOf(startMarker);
      const end = source.indexOf(endMarker, start);
      const block = source.slice(start, end);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(block.indexOf("requireBoxUvRepresentableSpan(")).toBeGreaterThanOrEqual(0);
      expect(block.indexOf("Undo.initEdit")).toBeGreaterThan(block.indexOf("requireBoxUvRepresentableSpan("));
    }
    expect(source).toContain("const autoPackBoxUv = !customFaceUvs && Project?.box_uv === true");
    expect(source).toContain("update.faces === undefined");
    expect(source).toContain("faces === undefined");
  });
  test("Cube span preflight permits solid/plane-like geometry and rejects invalid spans", () => {
    expect(
      validateCubeGeometrySpan([0, 0, 0], [4, 8, 4], 0, "solid")
    ).toMatchObject({
      representation: "solid",
      authored_size: [4, 8, 4],
      rendered_size: [4, 8, 4],
    });

    expect(
      validateCubeGeometrySpan([0, 0, 0], [0, 8, 8], 0, "plane")
    ).toMatchObject({
      representation: "plane_like",
      authored_size: [0, 8, 8],
      rendered_size: [0, 8, 8],
    });

    expect(() =>
      validateCubeGeometrySpan([4, 0, 0], [0, 8, 8], 0, "reversed")
    ).toThrow("reverses authored Cube bounds");

    expect(() =>
      validateCubeGeometrySpan([0, 0, 0], [0, 0, 8], 0, "line")
    ).toThrow("collapses 2 authored axes");

    expect(() =>
      validateCubeGeometrySpan([0, 0, 0], [1, 1, 1], -0.75, "over-deflated")
    ).toThrow("negative rendered span");

    expect(
      validateCubeGeometrySpan([0, 0, 0], [1, 2, 2], -0.5, "deflated-plane")
    ).toMatchObject({
      representation: "plane_like",
      rendered_size: [0, 1, 1],
    });
  });

  test("Cube geometry safety preflight runs before Undo for create/update/batch", async () => {
    const source = await Bun.file("server/tools/geometry/cubes.ts").text();
    const sections = [
      {
        start: "const executeCreateCubes",
        end: "const executeUpdateCube",
      },
      {
        start: "const executeUpdateCube",
        end: "const executeBatchUpdateCubes",
      },
      {
        start: "const executeBatchUpdateCubes",
        end: "createTool(cubeToolDocs[0].name",
      },
    ];

    for (const section of sections) {
      const start = source.indexOf(section.start);
      const end = source.indexOf(section.end, start);
      const block = source.slice(start, end);
      const preflight = block.indexOf("validateCubeGeometrySpan(");
      const undo = block.indexOf("Undo.initEdit");
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(preflight).toBeGreaterThanOrEqual(0);
      expect(undo).toBeGreaterThan(preflight);
    }
  });

  test("add_group resolves all names and parent targets before opening Undo", async () => {
    const source = await Bun.file("server/tools/element/hierarchy.ts").text();
    const start = source.indexOf("createTool(elementHierarchyToolDocs[0].name");
    const end = source.indexOf('createTool("modify_group"', start);
    const block = source.slice(start, end);

    const names = block.indexOf("assertBatchGroupNamesAvailable(batch)");
    const parents = block.indexOf("const parentPlan = planGroupBatchParents(batch)");
    const undo = block.indexOf("Undo.initEdit");
    expect(names).toBeGreaterThan(-1);
    expect(parents).toBeGreaterThan(names);
    expect(undo).toBeGreaterThan(parents);
    expect(block).toContain("created[plannedParent]");
  });

  test("duplicate_element completes deterministic preflight before Undo", async () => {
    const source = await Bun.file("server/tools/element/mutation.ts").text();
    const start = source.indexOf("createTool(elementMutationToolDocs[1].name");
    const end = source.indexOf("createTool(elementMutationToolDocs[2].name", start);
    const block = source.slice(start, end);

    const preflight = block.indexOf(
      "preflightFaithfulDuplicate(element, offset, newName)"
    );
    const undo = block.indexOf("Undo.initEdit");
    const mutation = block.indexOf("duplicateFaithfully(element, offset, newName)");
    expect(preflight).toBeGreaterThan(-1);
    expect(undo).toBeGreaterThan(preflight);
    expect(mutation).toBeGreaterThan(undo);
  });

  test("batch Cube UUID collisions fail before native Undo starts", async () => {
    const source = await Bun.file("server/tools/geometry/cubes.ts").text();
    const start = source.indexOf("const executeBatchUpdateCubes");
    const end = source.indexOf("createTool(cubeToolDocs[0].name", start);
    const block = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const lookup = block.indexOf("resolveUniqueUuid(Cube.all ?? [], update.id");
    const undo = block.indexOf("Undo.initEdit");
    expect(lookup).toBeGreaterThanOrEqual(0);
    expect(undo).toBeGreaterThan(lookup);
    expect(block).not.toContain("(Cube.all ?? []).find(");
  });

  test("Group pivot transfer fails closed before Undo when mesh is unavailable", async () => {
    const source = await Bun.file("server/tools/element/hierarchy.ts").text();
    const start = source.indexOf('createTool("modify_group"');
    const end = source.indexOf('createTool("reparent_element"', start);
    const block = source.slice(start, end);

    const meshGuard = block.indexOf("!group.mesh");
    const undo = block.indexOf("Undo.initEdit", meshGuard);
    expect(meshGuard).toBeGreaterThan(-1);
    expect(undo).toBeGreaterThan(meshGuard);
    expect(block).toContain("pivot readback did not match the requested origin");
  });

  test("duplicate runtime helper no longer hides preflight after Undo", async () => {
    const source = await Bun.file("server/tools/element/mutation.ts").text();
    const helperStart = source.indexOf("function duplicateFaithfully(");
    const helperEnd = source.indexOf("function vector3Equals", helperStart);
    const helper = source.slice(helperStart, helperEnd);
    expect(helper).not.toContain("preflightDuplicateTranslation");
    expect(helper).not.toContain("preflightDuplicateGroupNames");
  });
});
