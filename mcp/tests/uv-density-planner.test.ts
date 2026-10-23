import { describe, expect, test } from "bun:test";
import { buildUvLayoutSnapshot } from "@/lib/uv/islands";
import {
  mapFaceUvToTexturePixels,
  requireExactFacePixelGrid,
} from "@/lib/uv/facePixelMapping";
import {
  measureUvIslandDensity,
  physicalPixelsPerUvUnit,
  planUvDensity,
} from "@/lib/uv/density";

describe("UV Core density planning", () => {
  test("exact Painter addressing also snaps only machine-level UV pixel drift", () => {
    const metrics = { width: 256, displayHeight: 256, uvWidth: 128, uvHeight: 128 };
    const valid = mapFaceUvToTexturePixels(
      [0.5000000000000001, 0, 1.5000000000000002, 1], metrics, "pixel test");
    expect(requireExactFacePixelGrid(valid, "pixel test")).toEqual([2, 2]);
    const halfPixel = mapFaceUvToTexturePixels(
      [0.25, 0, 1.25, 1], metrics, "pixel test");
    expect(() => requireExactFacePixelGrid(halfPixel, "pixel test"))
      .toThrow("exact physical pixel boundaries");
  });

  test("density proposals round up to whole physical pixels without reducing requested detail", () => {
    const snapshot = buildUvLayoutSnapshot([
      { uuid: "panel", name: "panel", from: [0,0,0], to: [1.25,2.5,1],
        box_uv: false, autouv: 0, mirror_uv: false,
        faces: [{ face: "north", uv: [8,0,9.25,2.5] }] },
    ], 128, 128, () => ({
      density: { policy: "CUSTOM", target_pixels_per_model_unit: 1 },
    }));
    const plan = planUvDensity(snapshot, {
      bitmap_width: 256, bitmap_height: 256,
      default_target_pixels_per_model_unit: 1,
    });
    expect(plan.proposals[0].proposed_size).toEqual([1, 1.5]);
    expect(plan.proposals[0].changed).toBe(true);
    expect(snapshot.islands[0].rect.width).toBe(1.25);
  });

  test("converts logical UV scale to physical pixels explicitly", () => {
    expect(physicalPixelsPerUvUnit(128, 128, 256, 512)).toEqual([2, 4]);
  });

  test("measures per-face density without changing layout", () => {
    const snapshot = buildUvLayoutSnapshot(
      [
        {
          uuid: "panel",
          name: "panel",
          from: [0, 0, 0],
          to: [8, 4, 1],
          box_uv: false,
          autouv: 0,
          mirror_uv: false,
          faces: [{ face: "north", uv: [0, 0, 8, 4] }],
        },
      ],
      128,
      128
    );
    const measurement = measureUvIslandDensity(
      snapshot.islands[0],
      [2, 2],
      2
    );
    expect(measurement.pixels_per_model_unit).toEqual([2, 2]);
    expect(measurement.anisotropy_ratio).toBe(1);
    expect(measurement.target_pixels_per_model_unit).toBeNull();
  });

  test("NORMALIZE and CUSTOM constraints produce size proposals only where native mapping can represent them", () => {
    const snapshot = buildUvLayoutSnapshot(
      [
        {
          uuid: "body",
          name: "body",
          from: [0, 0, 0],
          to: [8, 8, 8],
          box_uv: true,
          uv_offset: [0, 0],
          autouv: 0,
          mirror_uv: false,
          faces: [],
        },
        {
          uuid: "logo",
          name: "logo",
          from: [0, 0, 0],
          to: [4, 4, 1],
          box_uv: false,
          autouv: 0,
          mirror_uv: false,
          faces: [{ face: "north", uv: [40, 0, 44, 4] }],
        },
      ],
      128,
      128,
      (island) =>
        island.source.cube_name === "body"
          ? { density: { policy: "NORMALIZE" } }
          : {
              density: {
                policy: "CUSTOM",
                target_pixels_per_model_unit: 4,
                multiplier: 1.5,
              },
              unique_detail: true,
            }
    );

    const plan = planUvDensity(snapshot, {
      bitmap_width: 256,
      bitmap_height: 256,
      default_target_pixels_per_model_unit: 2,
    });

    const body = plan.proposals.find(
      (proposal) => proposal.island_id === "box:body"
    )!;
    const logo = plan.proposals.find(
      (proposal) => proposal.island_id === "face:logo:north"
    )!;

    // Box UV footprint size is geometry-owned; density is diagnostic only.
    expect(body.changed).toBe(false);
    expect(body.proposed_size).toEqual([32, 16]);
    const bodyMeasurement = plan.measurements.find(
      (measurement) => measurement.island_id === "box:body"
    )!;
    expect(bodyMeasurement.target_pixels_per_model_unit).toBeNull();

    // Logo requests 4 * 1.5 = 6 physical px/model-unit.
    expect(logo.target_pixels_per_model_unit).toBe(6);
    expect(logo.proposed_size).toEqual([12, 12]);
    expect(logo.changed).toBe(true);

    // Planner remains read-only: source snapshot coordinates are untouched.
    expect(snapshot.islands[1].rect).toEqual({
      x: 40,
      y: 0,
      width: 4,
      height: 4,
    });
  });

  test("locked islands report density but never propose a resize", () => {
    const snapshot = buildUvLayoutSnapshot(
      [{
        uuid: "locked",
        name: "locked",
        from: [0,0,0],
        to: [4,4,1],
        box_uv: false,
        autouv: 0,
        mirror_uv: false,
        faces: [{ face: "north", uv: [0,0,4,4] }],
      }],
      128,
      128,
      () => ({
        locked: true,
        density: {
          policy: "CUSTOM",
          target_pixels_per_model_unit: 4,
        },
      })
    );
    const plan = planUvDensity(snapshot, {
      bitmap_width: 128,
      bitmap_height: 128,
      default_target_pixels_per_model_unit: 1,
    });
    expect(plan.measurements[0].target_pixels_per_model_unit).toBeNull();
    expect(plan.proposals[0].changed).toBe(false);
    expect(plan.changed_island_ids).toEqual([]);
  });

  test("density planner rejects invalid scale instead of inventing fallback values", () => {
    const snapshot = buildUvLayoutSnapshot([], 128, 128);
    expect(() =>
      planUvDensity(snapshot, {
        bitmap_width: 0,
        bitmap_height: 128,
        default_target_pixels_per_model_unit: 1,
      })
    ).toThrow(/Bitmap width/);
  });
});
