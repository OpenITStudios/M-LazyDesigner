import { describe, expect, test } from "bun:test";
import { cubeToolDocs, placeCubeParameters } from "@/server/tools/cubes";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("place_cube creation completeness", () => {
  test("per-element parent and initial inflate are optional authored creation state", () => {
    expect(
      placeCubeParameters.safeParse({
        group: "body",
        elements: [
          { name: "base", from: [0, 0, 0], to: [4, 4, 4] },
          {
            name: "layer",
            from: [0, 0, 0],
            to: [4, 4, 4],
            group: "armor",
            inflate: 0.25,
          },
        ],
      }).success
    ).toBe(true);

    expect(
      placeCubeParameters.safeParse({
        elements: [
          {
            name: "bad",
            from: [0, 0, 0],
            to: [1, 1, 1],
            inflate: Number.POSITIVE_INFINITY,
          },
        ],
      }).success
    ).toBe(false);
  });

  test("existing top-level group and root compatibility remain valid", () => {
    expect(
      placeCubeParameters.safeParse({
        group: "body",
        elements: [{ name: "body", from: [0, 0, 0], to: [4, 8, 4] }],
      }).success
    ).toBe(true);

    expect(
      placeCubeParameters.safeParse({
        elements: [{ name: "root_cube", from: [0, 0, 0], to: [1, 1, 1] }],
      }).success
    ).toBe(true);
  });

  test("all explicit parent references are preflighted before Undo", async () => {
    const cubes = await source("server/tools/geometry/cubes.ts");
    const start = cubes.indexOf("const executeCreateCubes");
    const undo = cubes.indexOf("Undo.initEdit", start);
    const defaultPreflight = cubes.indexOf("resolvePlacementGroup(group)", start);
    const elementPreflight = cubes.indexOf("resolvePlacementGroup(element.group)", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(defaultPreflight).toBeGreaterThan(start);
    expect(elementPreflight).toBeGreaterThan(start);
    expect(defaultPreflight).toBeLessThan(undo);
    expect(elementPreflight).toBeLessThan(undo);
    const creation = cubes.indexOf("new Cube(", undo);
    expect(creation).toBeGreaterThan(undo);
    expect(cubes.indexOf("inflate: element.inflate", creation)).toBeGreaterThan(creation);
  });

  test("Phase 3 extends the existing Cube tool instead of adding a new tool family", async () => {
    expect(cubeToolDocs.map(({ name }) => name)).toEqual([
      "manage_cubes",
    ]);

    const cubes = await source("server/tools/geometry/cubes.ts");
    for (const forbidden of [
      "professional_preset",
      "construction_preset",
      "asset_class_profile",
      "professional_planner",
    ]) {
      expect(cubes).not.toContain(forbidden);
    }
  });
});
