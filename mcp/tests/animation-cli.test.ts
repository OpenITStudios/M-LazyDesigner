import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseAnimationAnalysisInput,
  prepareAnimationAnalysis,
  runAnimationCli,
  ANIMATION_CLI_MAX_INPUT_BYTES,
} from "../scripts/authoring/analyze-animation";

function example() {
  return {
    schema: "lazydesigner-animation-analysis-input-v1",
    animation_uuid: "clip-walk",
    duration_seconds: 1,
    loop_mode: "loop",
    tracks: [{
      group_uuid: "leg", group_name: "Leg",
      is_root: false, channel: "rotation",
      keyframes: [
        { time: 0, value: [0, 0, 0], data_point_count: 1 },
        { time: 0.5, value: [45, 0, 0], data_point_count: 1 },
        { time: 1, value: [0, 0, 0], data_point_count: 1 },
      ],
    }],
    max_review_frames: 3,
  };
}

describe("read-only Animation source, timing and contact CLI", () => {
  test("valid authored motion remains diagnostic without native or visual PASS", () => {
    const input = example();
    const copy = structuredClone(input);
    const report = prepareAnimationAnalysis(input, "a".repeat(64));
    expect(report.schema).toBe("lazydesigner-animation-cli-v1");
    expect(report.input_sha256).toBe("a".repeat(64));
    expect(report.status).toBe("DIAGNOSTIC_ONLY");
    expect(report.quality.state).toBe("available");
    expect(report.motion.state).toBe("available");
    expect(report.source_timing).toMatchObject({
      evaluated_tracks: 1, evaluated_keyframes: 3,
      potential_replacement_count: 0,
      outside_declared_clip_count: 0,
    });
    expect(report.contact).toMatchObject({ state: "not_requested" });
    expect(report.temporal_frame_hints.state).toBe("CANDIDATE_ONLY");
    expect(report.temporal_frame_hints.suggested_times_seconds.length)
      .toBeLessThanOrEqual(3);
    expect(report.native_origin_verified).toBe(false);
    expect(report.native_playback_observed).toBe(false);
    expect(report.continuous_motion_verified).toBe(false);
    expect(report.visual_verdict).toBe("UNVERIFIED");
    expect(report.automatic_keyframe_correction).toBe(false);
    expect(input).toEqual(copy);
  });

  test("loop seam and near-coincident same-track keys trigger source review", () => {
    const input = example();
    input.tracks[0]!.keyframes[2]!.value = [30, 0, 0];
    input.tracks[0]!.keyframes.splice(2, 0, {
      time: 0.50005, value: [46, 0, 0], data_point_count: 1,
    });
    const report = prepareAnimationAnalysis(input);
    expect(report.status).toBe("REVIEW_REQUIRED");
    expect(report.source_timing.potential_replacement_count).toBe(1);
    expect(report.source_timing.potential_replacement_examples[0]).toMatchObject({
      group_uuid: "leg", channel: "rotation",
    });
    expect(report.review_reasons).toContain("POTENTIAL_NATIVE_KEYFRAME_REPLACEMENT");
    expect(report.review_reasons).toContain("LOOP_SEAM_REVIEW");
    expect(report.visual_verdict).toBe("UNVERIFIED");
  });

  test("keys and contact beyond declared clip duration stay review-required", () => {
    const input = example();
    input.tracks[0]!.keyframes.push({
      time: 1.5, value: [30, 0, 0], data_point_count: 1,
    });
    const report = prepareAnimationAnalysis({
      ...input,
      contact_constraints: [{
        id: "plant", mode: "planted", tolerance: 0.1,
        samples: [
          { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
          { time: 1.3, marker: [0, 0, 0], target: [0, 0, 0] },
        ],
      }],
    });
    expect(report.source_timing.outside_declared_clip_count).toBe(1);
    expect(report.source_timing.contact_samples_or_windows_outside_clip_count).toBe(1);
    expect(report.review_reasons).toContain("AUTHORED_KEYS_OUTSIDE_CLIP_DURATION");
    expect(report.review_reasons).toContain("CONTACT_SAMPLES_OUTSIDE_CLIP_DURATION");
  });

  test("declared planted-foot sliding is flagged without creating IK or native proof", () => {
    const report = prepareAnimationAnalysis({
      ...example(),
      contact_constraints: [{
        id: "left_foot_stance", mode: "planted", tolerance: 0.1,
        sampling_window: { start: 0, end: 0.4, max_gap_seconds: 0.2 },
        support_plane: {
          axis: "Y", coordinate: 0, allowed_side: "POSITIVE",
          penetration_tolerance: 0.05,
        },
        samples: [
          { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
          { time: 0.2, marker: [0.3, 0, 0], target: [0.3, 0, 0] },
          { time: 0.4, marker: [0.5, 0, 0], target: [0.5, 0, 0] },
        ],
      }],
    });
    expect(report.contact.state).toBe("available");
    if (report.contact.state !== "available") throw new Error("contact unavailable");
    expect(report.contact.review_constraint_count).toBe(1);
    expect(report.contact.constraints[0]?.planted_drift_violation).toBe(true);
    expect(report.contact.sample_provenance).toBe("caller_supplied_not_native_attested");
    expect(report.status).toBe("REVIEW_REQUIRED");
    expect(report.review_reasons).toContain("CONTACT_DRIFT_OR_PENETRATION");
    expect(report.automatic_keyframe_correction).toBe(false);
  });

  test("incomplete contact windows are not silently promoted into PASS", () => {
    const report = prepareAnimationAnalysis({
      ...example(),
      contact_constraints: [{
        id: "sparse_foot", mode: "planted", tolerance: 0.1,
        sampling_window: { start: 0, end: 1, max_gap_seconds: 0.1 },
        samples: [
          { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
          { time: 1, marker: [0, 0, 0], target: [0, 0, 0] },
        ],
      }],
    });
    expect(report.contact.state).toBe("available");
    if (report.contact.state !== "available") throw new Error("contact unavailable");
    expect(report.contact.unverified_constraint_count).toBe(1);
    expect(report.contact.pass_constraint_count).toBe(0);
    expect(report.review_reasons).toContain("CONTACT_SAMPLE_COVERAGE_INCOMPLETE");
    expect(report.visual_verdict).toBe("UNVERIFIED");
  });

  test("no documented data-point count cannot create invented image review events", () => {
    const input = example();
    const tracks = input.tracks.map(track => ({
      ...track, keyframes: track.keyframes.map(({ data_point_count: _, ...frame }) => frame),
    }));
    const report = prepareAnimationAnalysis({ ...input, tracks });
    expect(report.temporal_frame_hints).toMatchObject({
      state: "UNAVAILABLE", visual_pass_authorized: false,
    });
    expect(report.source_timing.unknown_or_non_single_data_point_keyframes).toBe(3);
    expect(report.status).toBe("EVIDENCE_INCOMPLETE");
    expect(report.native_playback_observed).toBe(false);
  });

  test("a native key with zero data points stays unverified, not a fabricated pose", () => {
    const input = example();
    input.tracks[0]!.keyframes[1]!.value = [];
    input.tracks[0]!.keyframes[1]!.data_point_count = 0;
    const report = prepareAnimationAnalysis(input);
    expect(report.status).toBe("EVIDENCE_INCOMPLETE");
    expect(report.source_timing.unknown_or_non_single_data_point_keyframes).toBe(1);
    expect(report.motion.state).toBe("unavailable");
    expect(report.temporal_frame_hints.state).toBe("UNAVAILABLE");
    expect(report.visual_verdict).toBe("UNVERIFIED");
  });

  test("malformed, ambiguous and over-budget manifests are rejected",
    expect(() => parseAnimationAnalysisInput({
      ...example(), native_verified: true,
    })).toThrow("ANIMATION_CLI_INPUT_INVALID");
    const duplicated = example();
    duplicated.tracks.push(structuredClone(duplicated.tracks[0]!));
    expect(() => parseAnimationAnalysisInput(duplicated))
      .toThrow("ANIMATION_CLI_TRACK_IDENTITY_CONFLICT");
    const invalid = example();
    invalid.tracks[0]!.keyframes[1]!.time = -0.1;
    expect(() => parseAnimationAnalysisInput(invalid))
      .toThrow("ANIMATION_CLI_KEYFRAME_INVALID");
    expect(() => parseAnimationAnalysisInput({
      ...example(),
      contact_constraints: [{ id: "foot", mode: "planted", tolerance: 0.1,
        samples: [], ik_chain: { pretend: true } }],
    })).toThrow("ANIMATION_CLI_CONTACT_INPUT_INVALID");
    expect(() => parseAnimationAnalysisInput({
      ...example(), tracks: Array.from({ length: 129 }, (_, i) => ({
        ...example().tracks[0], group_uuid: "g" + i,
      })),
    })).toThrow("ANIMATION_CLI_INPUT_INVALID");
  });

  test("JSON CLI reads but never changes source manifest or Blockbench state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lazy-animation-cli-"));
    const file = join(dir, "animation.json");
    try {
      const source = JSON.stringify(example());
      await writeFile(file, source);
      const outcome = await runAnimationCli(["--input", file, "--json"]);
      expect(outcome.exitCode).toBe(0);
      const data = JSON.parse(outcome.stdout);
      expect(data).toMatchObject({
        schema: "lazydesigner-animation-cli-v1",
        native_origin_verified: false,
        visual_verdict: "UNVERIFIED",
      });
      expect(await readFile(file, "utf8")).toBe(source);
      expect((await runAnimationCli(["--help"])).stdout)
        .toContain("lazydesigner-animation-analysis-input-v1");
      await writeFile(file, "{private-clip-content:");
      const bad = await runAnimationCli(["--input", file, "--json"]);
      expect(bad.exitCode).toBe(2);
      expect(bad.stderr).toContain("ANIMATION_CLI_INPUT_JSON_INVALID");
      expect(bad.stderr).not.toContain("private-clip-content");
      await writeFile(file, "x".repeat(ANIMATION_CLI_MAX_INPUT_BYTES + 1));
      const tooLarge = await runAnimationCli(["--input", file, "--json"]);
      expect(tooLarge.exitCode).toBe(2);
      expect(tooLarge.stderr).toContain("ANIMATION_CLI_INPUT_FILE_INVALID");
      expect((await runAnimationCli(["--input", file, "--apply"])).exitCode)
        .toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("managed CLI and package smoke route to same owner without a second Runtime", async () => {
    const [manager, packaging] = await Promise.all([
      Bun.file("../distribution/cli.ts").text(),
      Bun.file("../distribution/package.ts").text(),
    ]);
    expect(manager).toContain('command === "analyze-animation"');
    expect(manager).toContain("runAnimationCli(raw)");
    expect(packaging).toContain(
      "Compiled manager read-only Animation analysis smoke failed."
    );
    // Source assertions only; no managed executable or native app ran.
  });
});
