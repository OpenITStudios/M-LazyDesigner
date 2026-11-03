import { describe, expect, test } from "bun:test";
import {
  publicationEnvironmentSchema, validateHdriBytes,
} from "@/lib/publication/environment";
import {
  makePublicationJob, publicationRenderParameters,
} from "@/lib/publication/contracts";

const blender = "/usr/bin/blender";
const output = "/tmp/publication.png";
const source = {
  project_uuid: "synthetic-project",
  sha256: "a".repeat(64),
  glb_path: "/tmp/model.glb",
  mesh_count: 1,
  materials: {
    ld_color_test: {
      color_uuid: "color", texture_sha256: "b".repeat(64),
      alpha_mode: "OPAQUE" as const, pbr: "NONE" as const,
    },
  },
};

describe("Explicit, bounded HDRI environment source", () => {
  test("studio does not require an asset and cannot load an undeclared one", () => {
    expect(publicationEnvironmentSchema.parse({ mode: "studio" }))
      .toEqual({ mode: "studio" });
    expect(publicationEnvironmentSchema.safeParse({
      mode: "studio", hdri_path: "/tmp/background.hdr",
    }).success).toBe(false);
    expect(publicationEnvironmentSchema.safeParse({ mode: "hdri" }).success)
      .toBe(false);
    expect(publicationEnvironmentSchema.safeParse({
      mode: "hdri", hdri_path: "https://example.com/hdr.hdr",
    }).success).toBe(false);
    expect(publicationEnvironmentSchema.safeParse({
      mode: "hdri", hdri_path: "/tmp/../foo.hdr",
    }).success).toBe(false);
  });

  test("recognizes bounded Radiance and OpenEXR source signatures only", () => {
    validateHdriBytes("/tmp/env.hdr", Buffer.from("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n", "ascii"));
    validateHdriBytes("/tmp/env.hdr", Buffer.from("#?RGBE\nFORMAT=32-bit_rle_rgbe\n", "ascii"));
    const exr = Buffer.concat([
      Buffer.from("762f3101", "hex"), Buffer.alloc(24),
    ]);
    validateHdriBytes("/tmp/env.exr", exr);
    expect(() => validateHdriBytes("/tmp/env.hdr", Buffer.alloc(30))).toThrow("SIGNATURE");
    expect(() => validateHdriBytes("/tmp/env.exr", Buffer.alloc(30))).toThrow("SIGNATURE");
    expect(() => validateHdriBytes("/tmp/env.hdr", Buffer.alloc(5))).toThrow("TOO_LARGE");
    expect(() => validateHdriBytes("/tmp/env.hdr", Buffer.alloc(65 * 1024 * 1024))).toThrow("TOO_LARGE");
  });

  test("Blender job must use prepared isolated HDRI path with digest", () => {
    const studio = makePublicationJob(publicationRenderParameters.parse({
      blender_executable: blender, output_path: output,
    }), source);
    expect(studio.environment).toEqual({
      mode: "studio", hdri_path: null, hdri_sha256: null,
    });
    const input = publicationRenderParameters.parse({
      blender_executable: blender, output_path: output,
      environment: { mode: "hdri", hdri_path: "/tmp/user-approved.hdr" },
    });
    expect(() => makePublicationJob(input, source)).toThrow("HDRI_ASSET_NOT_PREPARED");
    const job = makePublicationJob(input, {
      ...source,
      environment_asset: { path: "/tmp/isolation/environment.hdr", sha256: "f".repeat(64) },
    });
    expect(job.environment).toEqual({
      mode: "hdri", hdri_path: "/tmp/isolation/environment.hdr",
      hdri_sha256: "f".repeat(64),
    });
  });
});
