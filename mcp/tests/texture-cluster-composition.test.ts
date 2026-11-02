import { describe, expect, test } from "bun:test";
import { computeTextureRevision } from "@/lib/texture/revision";
import { applyPaintTransactionRgba } from "@/lib/texture/paintTransaction";
import {
  compileReferencePixelClusterPaint,
  type ClusterCompositionInput,
  type ClusterNativeFace,
} from "@/lib/texture/sourceComposer";

const SIDES = ["north", "south", "east", "west", "up", "down"] as const;
const SOURCE_SHA = "a".repeat(64);

function nativeCube(
  cubeUuid: string,
  uv: readonly number[] = [4, 0, 0, 4],
  rotation = 90,
  material = "painted_iron"
): ClusterNativeFace[] {
  return SIDES.map(face => face === "north"
    ? {
      cube_uuid: cubeUuid, face, enabled: true, texture_uuid: "atlas",
      native_material_name: material, rect: null, uv, rotation,
    }
    : {
      cube_uuid: cubeUuid, face, enabled: false, texture_uuid: null,
      native_material_name: "", rect: null, uv: null, rotation: null,
    });
}

function facePlan(cube_uuid = "armor") {
  return {
    cube_uuid, face: "north" as const,
    source_claim: {
      image_id: "approved_front",
      image_sha256: SOURCE_SHA,
      image_region_id: "armor_plate",
      part_id: "chest_armor",
      observation_id: "observed_clusters",
    },
    clusters: [
      {
        cluster_id: "shadow_mass", role: "shadow" as const,
        source_observation_id: "observed_clusters",
        shape: { kind: "rect" as const, x: 0, y: 0, width: 2, height: 2 },
      },
      {
        cluster_id: "highlight_step", role: "highlight" as const,
        source_observation_id: "observed_clusters",
        shape: { kind: "runs" as const,
          runs: [{ x: 2, y: 2, width: 2 }, { x: 3, y: 3, width: 1 }] },
      },
      {
        cluster_id: "identity_mark", role: "identity" as const,
        source_observation_id: "observed_clusters",
        shape: { kind: "rect" as const, x: 1, y: 3, width: 1, height: 1 },
      },
      {
        cluster_id: "wear_detail", role: "detail" as const,
        source_observation_id: "observed_clusters",
        shape: { kind: "rect" as const, x: 3, y: 0, width: 1, height: 1 },
      },
    ],
    quiet_zones: [{ kind: "rect" as const, x: 0, y: 3, width: 2, height: 1 }],
  };
}

async function fixture(
  options: Partial<ClusterCompositionInput> = {},
  bitmap?: Uint8ClampedArray
): Promise<ClusterCompositionInput> {
  const pixels = bitmap ?? new Uint8ClampedArray(8 * 8 * 4);
  return {
    texture_uuid: "atlas",
    bitmap_width: 8, bitmap_height: 8,
    logical_uv_width: 8, logical_uv_height: 8,
    bitmap: pixels,
    expected_revision: await computeTextureRevision(pixels, 8, 8),
    native_faces: nativeCube("armor"),
    faces: [facePlan()],
    source_mode: "transparent_template",
    palette: {
      base: "#745b48", shadow: "#3a2e29", highlight: "#c6a27c",
      identity: "#f2bb39", detail: "#594337",
    },
    ...options,
  };
}

const colorAt = (pixels: Uint8ClampedArray, x: number, y: number) =>
  [...pixels.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];

describe("reference-declared face-local pixel cluster composer", () => {
  test("compiles stepped, signed/rotated UV clusters to existing atomic paint operations", async () => {
    const source = await fixture();
    const original = [...source.bitmap];
    const result = await compileReferencePixelClusterPaint(source);
    expect(result.state).toBe("source_compiled_needs_native_revalidation");
    expect(result.transaction.texture_id).toBe("atlas");
    expect(result.transaction.expected_revision).toBe(source.expected_revision);
    expect(result.transaction.operations[0]).toEqual({
      operation: "fill_rect", color: "#745b48",
      rect: { x: 0, y: 0, width: 4, height: 4 },
    });
    expect(result.transaction.operations).toHaveLength(5);
    expect(result.summary).toMatchObject({
      face_count: 1, cluster_count: 4, covered_face_pixels: 16,
      quiet_zone_count: 1, identity_pixels: 1,
      changed_pixels: 16, changed_rect: [0,0,4,4],
    });
    expect(result.provenance).toMatchObject({
      reference_claims: "CALLER_DECLARED_NOT_IMAGE_ATTESTED",
      native_inventory: "CALLER_SNAPSHOT_NOT_RECHECKED",
      mutation_authorized: false, visual_verdict: "not_evaluated",
    });
    const rendered = applyPaintTransactionRgba(
      source.bitmap, 8, 8, result.transaction.operations);
    // Signed U-flip + 90 degree rotation: (localX,localY)->(3-localY,3-localX).
    expect(colorAt(rendered.pixels, 3, 3)).toEqual([0x3a,0x2e,0x29,255]);
    expect(colorAt(rendered.pixels, 0, 2)).toEqual([0xf2,0xbb,0x39,255]);
    expect(colorAt(rendered.pixels, 3, 0)).toEqual([0x59,0x43,0x37,255]);
    expect(colorAt(rendered.pixels, 0, 0)).toEqual([0x74,0x5b,0x48,255]);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (x < 4 && y < 4) continue;
        expect(colorAt(rendered.pixels, x, y))
          .toEqual(colorAt(source.bitmap, x, y));
      }
    }
    expect([...source.bitmap]).toEqual(original); // pure planning
  });

  test("respect 90/270 face rotations and signed UV without bleeding into adjacent islands", async () => {
    const source = await fixture({
      native_faces: nativeCube("armor", [0,4,4,0], 90),
    });
    const result = await compileReferencePixelClusterPaint(source);
    const preview = applyPaintTransactionRgba(source.bitmap,8,8,
      result.transaction.operations).pixels;
    // V-flip plus 90: (localX,localY) => (localY,localX).
    expect(colorAt(preview,0,0)).toEqual([0x3a,0x2e,0x29,255]);
    expect(colorAt(preview,3,1)).toEqual([0xf2,0xbb,0x39,255]);
    expect(colorAt(preview,0,3)).toEqual([0x59,0x43,0x37,255]);
    expect(colorAt(preview,7,7)).toEqual([0,0,0,0]);
    const other = await fixture({
      native_faces: nativeCube("armor", [0,4,4,0], 270),
    });
    const result270 = await compileReferencePixelClusterPaint(other);
    const preview270 = applyPaintTransactionRgba(other.bitmap,8,8,
      result270.transaction.operations).pixels;
    // V-flip plus 270: (localX,localY) => (3-localY,3-localX).
    expect(colorAt(preview270,3,3)).toEqual([0x3a,0x2e,0x29,255]);
    expect(colorAt(preview270,0,2)).toEqual([0xf2,0xbb,0x39,255]);
    expect(colorAt(preview270,7,7)).toEqual([0,0,0,0]);
  });

  test("supports an explicitly authorized uniformly opaque template without touching other atlas regions", async () => {
    const bitmap = new Uint8ClampedArray(
      Array.from({ length: 64 }, () => [72,72,72,255]).flat());
    const source = await fixture({
      source_mode: "uniform_opaque_template",
    }, bitmap);
    const result = await compileReferencePixelClusterPaint(source);
    const preview = applyPaintTransactionRgba(bitmap, 8, 8,
      result.transaction.operations).pixels;
    expect(colorAt(preview, 6, 6)).toEqual([72,72,72,255]);
    expect(colorAt(preview, 3, 3)).toEqual([0x3a,0x2e,0x29,255]);
    expect(colorAt(bitmap, 3, 3)).toEqual([72,72,72,255]);
  });

  test("rejects stale revision and a detailed/partly transparent existing painting", async () => {
    const source = await fixture();
    const stale = { ...source, expected_revision:
      "sha256:8x8:" + "b".repeat(64) };
    await expect(compileReferencePixelClusterPaint(stale))
      .rejects.toThrow("changed since the caller observed it");
    const painted = new Uint8ClampedArray(source.bitmap);
    painted[(1 * 8 + 1) * 4 + 3] = 255;
    const notBlank = await fixture({}, painted);
    await expect(compileReferencePixelClusterPaint(notBlank))
      .rejects.toThrow("CLUSTER_SOURCE_NOT_TRANSPARENT");
    const opaque = new Uint8ClampedArray(
      Array.from({length:64},()=>[70,70,70,255]).flat());
    opaque[0] = 71;
    await expect(compileReferencePixelClusterPaint(
      await fixture({source_mode:"uniform_opaque_template"},opaque)))
      .rejects.toThrow("CLUSTER_SOURCE_ALREADY_DETAILED");
  });

  test("rejects an unselected pixel owner, even exact UV reuse", async () => {
    const input = await fixture({
      native_faces: [...nativeCube("armor"), ...nativeCube("arm2")],
    });
    await expect(compileReferencePixelClusterPaint(input))
      .rejects.toThrow("FACE_SCOPE_UNSELECTED_UV_OWNER");
    const both = await fixture({
      native_faces: [...nativeCube("armor"), ...nativeCube("arm2")],
      faces: [facePlan("armor"),facePlan("arm2")],
    });
    await expect(compileReferencePixelClusterPaint(both))
      .rejects.toThrow("CLUSTER_SHARED_UV_REVIEW_REQUIRED");
  });

  test("rejects missing native face inventory, unresolved texture and invalid UV", async () => {
    const source = await fixture();
    await expect(compileReferencePixelClusterPaint({
      ...source, native_faces: source.native_faces.slice(0,5),
    })).rejects.toThrow("CLUSTER_NATIVE_FACE_INVENTORY_INCOMPLETE");
    const missing = source.native_faces.map(face =>
      face.face === "north" ? { ...face, texture_uuid: null } : face);
    await expect(compileReferencePixelClusterPaint({
      ...source, native_faces: missing,
    })).rejects.toThrow("CLUSTER_NATIVE_TEXTURE_UNRESOLVED");
    const subpixel = source.native_faces.map(face =>
      face.face === "north" ? { ...face, uv: [0,0,3.5,4] } : face);
    await expect(compileReferencePixelClusterPaint({
      ...source, native_faces: subpixel,
    })).rejects.toThrow("exact physical pixel boundaries");
  });

  test("protects quiet areas, refuses disconnected shapes and overlapping roles", async () => {
    const source = await fixture();
    const first = facePlan();
    const overQuiet = {
      ...first,
      clusters: [...first.clusters, {
        cluster_id: "bad_detail", role: "detail" as const,
        source_observation_id:"observed_clusters",
        shape:{kind:"rect" as const,x:0,y:3,width:1,height:1},
      }],
    };
    await expect(compileReferencePixelClusterPaint({
      ...source, faces:[overQuiet],
    })).rejects.toThrow("CLUSTER_QUIET_ZONE_DETAIL");

    const overlapped = {
      ...first,
      clusters: [...first.clusters, {
        cluster_id: "duplicate_color_area", role: "accent" as const,
        source_observation_id:"observed_clusters",
        shape:{kind:"rect" as const,x:0,y:0,width:1,height:1},
      }],
    };
    await expect(compileReferencePixelClusterPaint({
      ...source, faces:[overlapped],
      palette:{...source.palette,accent:"#55aa22"},
    })).rejects.toThrow("CLUSTER_OVERLAPPING_INTENTS");

    const disconnected = {
      ...first,
      clusters: [{
        cluster_id:"pieces",role:"shadow" as const,
        source_observation_id:"observed_clusters",
        shape:{kind:"runs" as const,
          runs:[{x:0,y:0,width:1},{x:3,y:3,width:1}]},
      }],
    };
    await expect(compileReferencePixelClusterPaint({
      ...source,faces:[disconnected],
    })).rejects.toThrow("CLUSTER_DISCONNECTED");
  });

  test("reference metadata does not silently become image proof or a guessed material", async () => {
    const source = await fixture();
    const forged = {
      ...facePlan(),
      source_claim:{...facePlan().source_claim,image_sha256:"unknown"},
    };
    await expect(compileReferencePixelClusterPaint({
      ...source,faces:[forged],
    })).rejects.toThrow("CLUSTER_REFERENCE_CLAIM_INVALID");
    const wrong = {
      ...facePlan(),
      clusters:[{...facePlan().clusters[0],
        source_observation_id:"another_observation"}],
    };
    await expect(compileReferencePixelClusterPaint({
      ...source,faces:[wrong],
    })).rejects.toThrow("CLUSTER_INTENT_INVALID");
  });

  test("no-op flat template is rejected rather than committing an empty Undo", async () => {
    const bitmap = new Uint8ClampedArray(
      Array.from({length:64},()=>[96,96,96,255]).flat());
    const source=await fixture({
      source_mode:"uniform_opaque_template",
      palette:{base:"#606060",shadow:"#606060"},
      faces:[{
        ...facePlan(),
        clusters:[{
          cluster_id:"no_change",role:"shadow" as const,
          source_observation_id:"observed_clusters",
          shape:{kind:"rect" as const,x:0,y:0,width:1,height:1},
        }],
        quiet_zones:[],
      }],
    },bitmap);
    await expect(compileReferencePixelClusterPaint(source))
      .rejects.toThrow("CLUSTER_PAINT_NO_CHANGE");
  });
});
