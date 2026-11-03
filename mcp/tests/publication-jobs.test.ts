import { describe, expect, test } from "bun:test";
import { PublicationRenderJobs } from "@/server/publication/jobs";
import {
  type PublicationRenderReceipt,
  type PreparedPublicationRender,
} from "@/server/publication/execute";
import { publicationRenderParameters } from "@/lib/publication/contracts";

const REQUEST = {
  blender_executable: "/opt/blender-5.2/blender",
  output_path: "/tmp/finished.png",
  quality: "preview" as const,
  width: 256,
  height: 256,
};

const receipt: PublicationRenderReceipt = {
  state: "RENDERED_DRAFT",
  source_project_uuid: "test-project",
  source_sha256: "a".repeat(64),
  glb_sha256: "b".repeat(64),
  worker_sha256: "c".repeat(64),
  cube_count: 1,
  material_count: 1,
  blender_target: "5.2.x",
  engine: "CYCLES",
  quality: "preview",
  render_settings: {
    background: "dark",
    camera: { yaw_degrees: 38, elevation_degrees: 18, projection: "perspective", mode: "auto", framing_padding: 1.28 },
    look: {
      key: 1, fill: 1, rim: 1, softness: 1, environment: 1, exposure_ev: 0,
      glow_strength: 0.08, glow_threshold: 2, glow_size: 0.45,
    },
    samples: 32,
    noise_threshold: 0.08,
    device: "auto",
    view_transform: "AgX",
  },
  diagnostics: {
    asset: { mesh_count: 1, polygon_count: 12, material_count: 1, world_min: [0, 0, 0], world_max: [1, 1, 1] },
    camera: {
      mode: "auto", requested_yaw_degrees: 38, requested_elevation_degrees: 18,
      resolved_yaw_degrees: 23, resolved_elevation_degrees: 18,
      projection: "perspective", candidate_count: 15,
      projected_bounds: [0.15, 0.15, 0.85, 0.85],
      projected_area: 0.49, frame_safe: true, quality_is_artistic_score: false,
    },
    lights: [
      { name: "LD_Key", power: 240, size: 2, position: [1, 2, 3] },
      { name: "LD_Fill", power: 90, size: 2.8, position: [2, 1, 3] },
      { name: "LD_Rim", power: 340, size: 1.6, position: [1, 3, 2] },
    ],
    renderer: {
      engine: "CYCLES", view_transform: "AgX",
      sampling: { samples: 32, adaptive_threshold: 0.08, denoising: true },
      device: { requested: "auto", actual: "CPU", backend: null },
      render_size: [256, 256],
    },
    image: {
      image_dimensions: [256, 256],
      sampled_pixels: 9216, visible_samples: 9216,
      mean_visible_luminance: 0.4, high_luminance_fraction: 0.01,
      near_black_visible_fraction: 0.2, nonopaque_fraction: 0,
      analysis_type: "MEASURED_DOWNSAMPLED_CYCLES_PNG", artistic_quality_score: null,
    },
    warnings: [],
    artistic_quality: "NOT_EVALUATED",
  },
  output_path: "/tmp/finished.png",
  output_png_sha256: "d".repeat(64),
  output_png_bytes: 4096,
  width: 256,
  height: 256,
  editor_state: "UNTOUCHED_BY_SNAPSHOT_AND_SOURCE_RECHECKED",
  visual_quality: "NOT_EVALUATED",
  live_minecraft_verified: false,
};

const prepared = async (input: unknown): Promise<PreparedPublicationRender> => ({
  request: publicationRenderParameters.parse(input),
  snapshot: {} as PreparedPublicationRender["snapshot"],
});

async function drain(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("Nonblocking publication jobs through one serialized native preparation", () => {
  test("job start awaits the bounded native snapshot, but never the full Cycles render", async () => {
    let resolve!: (value: PublicationRenderReceipt) => void;
    const pending = new Promise<PublicationRenderReceipt>(r => { resolve = r; });
    const jobs = new PublicationRenderJobs(async () => pending, prepared);
    const started = await jobs.start(REQUEST);
    expect(started.state).toBe("RUNNING");
    expect(started.job_id).toMatch(/^render_[a-f0-9]{24}$/);
    expect(started.receipt).toBeNull();
    expect(started.output_is_visual_qa).toBe(false);
    await expect(jobs.start(REQUEST)).rejects.toThrow("PUBLICATION_RENDER_JOB_BUSY");
    await drain();
    expect(jobs.status(started.job_id).state).toBe("RUNNING");
    resolve(receipt);
    await drain();
    expect(jobs.status(started.job_id)).toMatchObject({
      state: "RENDERED_DRAFT", receipt: {
        output_png_sha256: receipt.output_png_sha256,
        render_settings: {
          samples: 32,
          look: { glow_strength: 0.08 },
        },
        visual_quality: "NOT_EVALUATED",
      },
    });
    const next = await jobs.start(REQUEST);
    expect(next.job_id).not.toBe(started.job_id);
    expect(() => jobs.status(started.job_id)).toThrow("EXPIRED");
  });

  test("a second native preparation is blocked while first GLB snapshot is unfinished", async () => {
    let complete!: (value: PreparedPublicationRender) => void;
    const pendingPrepare = new Promise<PreparedPublicationRender>(r => { complete = r; });
    const jobs = new PublicationRenderJobs(async () => receipt, async () => pendingPrepare);
    const first = jobs.start(REQUEST);
    await expect(jobs.start(REQUEST)).rejects.toThrow("PUBLICATION_RENDER_JOB_BUSY");
    complete(await prepared(REQUEST));
    const started = await first;
    expect(started.state).toBe("RUNNING");
  });

  test("cancel returns CANCELLING until the worker confirms termination", async () => {
    const jobs = new PublicationRenderJobs((_prepared, signal) =>
      new Promise<PublicationRenderReceipt>((_resolve, reject) => {
        if (signal.aborted) reject(new Error("PUBLICATION_BLENDER_CANCELLED"));
        else signal.addEventListener("abort",
          () => reject(new Error("PUBLICATION_BLENDER_CANCELLED")),
          { once: true });
      }), prepared,
    );
    const started = await jobs.start(REQUEST);
    expect(jobs.cancel(started.job_id).state).toBe("CANCELLING");
    await expect(jobs.start(REQUEST)).rejects.toThrow("PUBLICATION_RENDER_JOB_BUSY");
    await drain();
    expect(jobs.status(started.job_id).state).toBe("CANCELLED");
    expect(jobs.status(started.job_id).receipt).toBeNull();
  });

  test("uncertain process exit blocks second render instead of hiding the worker", async () => {
    const jobs = new PublicationRenderJobs(async () => {
      throw new Error("PUBLICATION_BLENDER_EXIT_UNCONFIRMED");
    }, prepared);
    const started = await jobs.start(REQUEST);
    await drain();
    expect(jobs.status(started.job_id).state).toBe("EXIT_UNCONFIRMED");
    await expect(jobs.start(REQUEST)).rejects.toThrow("PUBLICATION_RENDER_JOB_BUSY");
    expect(() => jobs.status("render_" + "0".repeat(24))).toThrow("NOT_FOUND");
  });

  test("plugin unload aborts active Cycles job and prevents restart in retired runtime", async () => {
    const jobs = new PublicationRenderJobs((_prepared, signal) =>
      new Promise<PublicationRenderReceipt>((_resolve, reject) => {
        if (signal.aborted) reject(new Error("PUBLICATION_BLENDER_CANCELLED"));
        else signal.addEventListener("abort", () =>
          reject(new Error("PUBLICATION_BLENDER_CANCELLED")), { once: true });
      }), prepared,
    );
    const started = await jobs.start(REQUEST);
    jobs.retire();
    expect(jobs.status(started.job_id).state).toBe("CANCELLING");
    await drain();
    expect(jobs.status(started.job_id).state).toBe("CANCELLED");
    await expect(jobs.start(REQUEST)).rejects.toThrow("PUBLICATION_RENDER_RUNTIME_RETIRED");
  });

  test("plugin unloading mid-snapshot cannot start detached Cycles afterwards", async () => {
    let resolvePrepare!: (value: PreparedPublicationRender) => void;
    let ran = false;
    const jobs = new PublicationRenderJobs(async () => {
      ran = true;
      return receipt;
    }, () => new Promise<PreparedPublicationRender>(resolve => {
      resolvePrepare = resolve;
    }));
    const pending = jobs.start(REQUEST);
    jobs.retire();
    resolvePrepare(await prepared(REQUEST));
    await expect(pending).rejects.toThrow("PUBLICATION_RENDER_RUNTIME_RETIRED");
    expect(ran).toBe(false);
  });

  test("invalid source render input creates no job", async () => {
    const jobs = new PublicationRenderJobs(async () => receipt, prepared);
    await expect(jobs.start({ ...REQUEST, output_path: "../relative.png" })).rejects.toThrow();
    expect(() => jobs.status("bad-id")).toThrow("NOT_FOUND");
  });
});
