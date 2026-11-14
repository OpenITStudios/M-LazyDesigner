import {
  analyzeAnimationQuality,
  type AnimationQualityTrackInput,
} from "../../lib/animation/quality";
import {
  analyzeAnimationMotionDynamics,
  type AnimationMotionTrackInput,
} from "../../lib/animation/motionDynamics";
import {
  analyzeAnimationContactEvidence,
  type ContactConstraintInput,
} from "../../lib/animation/contactEvidence";
import { planTemporalImageEvidence } from "../../lib/animation/temporalEvidenceSampling";
import {
  nativeKeyframeTimesCollide,
  NATIVE_KEYFRAME_REPLACE_TIME_TOLERANCE,
  requireValidPlannedKeyframeTimes,
} from "../../lib/animation/batchPlanning";
import {
  parseAuthoringPlanFlags, readAuthoringPlanJson, authoringPlanError,
  type ReadOnlyAuthoringCliResponse,
} from "./cliInput";

export const ANIMATION_CLI_MAX_INPUT_BYTES = 262_144;
export const ANIMATION_CLI_MAX_TRACKS = 128;
export const ANIMATION_CLI_MAX_KEYS = 4096;
export const ANIMATION_CLI_MAX_CONTACTS = 64;
export const ANIMATION_CLI_MAX_SAMPLES = 2048;

type Track = AnimationQualityTrackInput & AnimationMotionTrackInput;
type MotionInput = {
  schema: "lazydesigner-animation-analysis-input-v1";
  animation_uuid: string;
  duration_seconds: number;
  loop_mode: string;
  tracks: Track[];
  contact_constraints?: ContactConstraintInput[];
  max_review_frames?: number;
  focus_bone_uuid?: string;
  focus_time_range?: { start: number; end: number };
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
function id(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 && value.length <= 160 && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}
function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function vec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(number);
}

function validateContact(value: unknown): value is ContactConstraintInput {
  if (!record(value) || !only(value, [
    "id", "mode", "tolerance", "samples", "sampling_window", "support_plane",
  ]) || !id(value.id) ||
      !["pair", "fixed", "planted"].includes(value.mode as string) ||
      !number(value.tolerance) || value.tolerance < 0 ||
      !Array.isArray(value.samples) || value.samples.length === 0 ||
      value.samples.length > ANIMATION_CLI_MAX_SAMPLES ||
      value.samples.some(sample => !record(sample) ||
        !only(sample, ["time", "marker", "target"]) ||
        !number(sample.time) || sample.time < 0 || sample.time > 10000 ||
        !vec3(sample.marker) || !vec3(sample.target))) return false;
  if (value.sampling_window !== undefined &&
      (!record(value.sampling_window) ||
       !only(value.sampling_window, ["start", "end", "max_gap_seconds"]) ||
       !number(value.sampling_window.start) ||
       !number(value.sampling_window.end) ||
       !number(value.sampling_window.max_gap_seconds) ||
       value.sampling_window.start < 0 ||
       value.sampling_window.end <= value.sampling_window.start ||
       value.sampling_window.max_gap_seconds <= 0)) return false;
  if (value.support_plane !== undefined &&
      (!record(value.support_plane) ||
       !only(value.support_plane, [
         "axis", "coordinate", "allowed_side", "penetration_tolerance",
       ]) ||
       !["X", "Y", "Z"].includes(value.support_plane.axis as string) ||
       !["POSITIVE", "NEGATIVE"].includes(value.support_plane.allowed_side as string) ||
       !number(value.support_plane.coordinate) ||
       !number(value.support_plane.penetration_tolerance) ||
       value.support_plane.penetration_tolerance < 0)) return false;
  // IK, native transforms, and contact-marker binding have existing
  // specialist owners; this limited CLI never guesses or applies them.
  return true;
}

export function parseAnimationAnalysisInput(value: unknown): MotionInput {
  if (!record(value) || !only(value, [
    "schema", "animation_uuid", "duration_seconds", "loop_mode", "tracks",
    "contact_constraints", "max_review_frames", "focus_bone_uuid",
    "focus_time_range",
  ]) || value.schema !== "lazydesigner-animation-analysis-input-v1" ||
      !id(value.animation_uuid) ||
      !number(value.duration_seconds) ||
      value.duration_seconds <= 0 || value.duration_seconds > 10000 ||
      !id(value.loop_mode) ||
      !Array.isArray(value.tracks) || value.tracks.length === 0 ||
      value.tracks.length > ANIMATION_CLI_MAX_TRACKS ||
      (value.max_review_frames !== undefined &&
        (typeof value.max_review_frames !== "number" ||
         !Number.isSafeInteger(value.max_review_frames) ||
         (value.max_review_frames as number) < 2 ||
         (value.max_review_frames as number) > 5)) ||
      (value.focus_bone_uuid !== undefined && !id(value.focus_bone_uuid)) ||
      (value.focus_time_range !== undefined &&
        (!record(value.focus_time_range) ||
         !only(value.focus_time_range, ["start", "end"]) ||
         !number(value.focus_time_range.start) ||
         !number(value.focus_time_range.end) ||
         value.focus_time_range.start < 0 ||
         value.focus_time_range.end > value.duration_seconds ||
         value.focus_time_range.end <= value.focus_time_range.start))) {
    throw new Error("ANIMATION_CLI_INPUT_INVALID");
  }

  const seen = new Set<string>();
  const names = new Map<string, string>();
  let keys = 0;
  for (const track of value.tracks) {
    if (!record(track) || !only(track, [
      "group_uuid", "group_name", "is_root", "channel", "keyframes",
    ]) || !id(track.group_uuid) || !id(track.group_name) ||
        typeof track.is_root !== "boolean" ||
        !["position", "rotation", "scale"].includes(track.channel as string) ||
        !Array.isArray(track.keyframes)) {
      throw new Error("ANIMATION_CLI_TRACK_INVALID");
    }
    const key = track.group_uuid + "\0" + track.channel;
    if (seen.has(key) || (names.has(track.group_uuid) &&
        names.get(track.group_uuid) !== track.group_name)) {
      throw new Error("ANIMATION_CLI_TRACK_IDENTITY_CONFLICT");
    }
    seen.add(key);
    names.set(track.group_uuid, track.group_name as string);
    keys += track.keyframes.length;
    if (keys > ANIMATION_CLI_MAX_KEYS) {
      throw new Error("ANIMATION_CLI_KEYFRAME_BUDGET_EXCEEDED");
    }
    for (const frame of track.keyframes) {
      if (!record(frame) || !only(frame, [
        "time", "value", "interpolation",
        "has_multiple_data_points", "data_point_count",
      ]) || !number(frame.time) || frame.time < 0 || frame.time > 10000 ||
          !Array.isArray(frame.value) ||
          frame.value.length > 8 ||
          frame.value.some(part =>
            !(number(part) || typeof part === "string" && part.length <= 256)) ||
          (frame.interpolation !== undefined &&
            (typeof frame.interpolation !== "string" ||
             frame.interpolation.length > 48)) ||
          (frame.has_multiple_data_points !== undefined &&
            typeof frame.has_multiple_data_points !== "boolean") ||
          (frame.data_point_count !== undefined &&
            (typeof frame.data_point_count !== "number" ||
             !Number.isSafeInteger(frame.data_point_count) ||
             frame.data_point_count < 0 || frame.data_point_count > 16))) {
        throw new Error("ANIMATION_CLI_KEYFRAME_INVALID");
      }
    }
  }
  if (value.contact_constraints !== undefined &&
      (!Array.isArray(value.contact_constraints) ||
       value.contact_constraints.length > ANIMATION_CLI_MAX_CONTACTS ||
       value.contact_constraints.some(c => !validateContact(c)) ||
       value.contact_constraints.reduce((n, c) => n + c.samples.length, 0) >
         ANIMATION_CLI_MAX_SAMPLES)) {
    throw new Error("ANIMATION_CLI_CONTACT_INPUT_INVALID");
  }
  return value as unknown as MotionInput;
}

/**
 * Delegate every numerical interpretation to existing Animation owners.
 * Input identities, keyframes and contact markers are caller declarations;
 * no native keyframe readback, preview or user approval is attested.
 */
export function prepareAnimationAnalysis(
  value: unknown, inputSha256: string | null = null
) {
  const input = parseAnimationAnalysisInput(value);
  const collisions: Array<{
    group_uuid: string; channel: string; first: number; second: number;
  }> = [];
  let collisionCount = 0, outsideClipCount = 0;
  // Absence of native data-point cardinality must remain unknown,
  // never silently projected as a single sampled key.
  const unknownOrNonSingleDataPoints = input.tracks.reduce(
    (sum, track) => sum + track.keyframes.filter(frame =>
      frame.data_point_count !== 1 || frame.value.length < 3
    ).length, 0
  );
  const contactSampleOutsideClipCount = input.contact_constraints?.reduce(
    (count, constraint) => count +
      constraint.samples.filter(sample => sample.time > input.duration_seconds).length +
      (constraint.sampling_window && constraint.sampling_window.end > input.duration_seconds
        ? 1 : 0),
    0
  ) ?? 0;
  for (const track of input.tracks) {
    const times = track.keyframes.map(frame => frame.time);
    requireValidPlannedKeyframeTimes(times, "Animation CLI authored source");
    outsideClipCount += times.filter(time => time > input.duration_seconds).length;
    const ordered = [...times].sort((a, b) => a - b);
    for (let i = 1; i < ordered.length; i++) {
      if (nativeKeyframeTimesCollide(ordered[i - 1], ordered[i])) {
        collisionCount++;
        if (collisions.length < 8) {
          collisions.push({
            group_uuid: track.group_uuid, channel: track.channel,
            first: ordered[i - 1], second: ordered[i],
          });
        }
      }
    }
  }
  const quality = analyzeAnimationQuality({
    loop_mode: input.loop_mode, length: input.duration_seconds,
    tracks: input.tracks, example_limit: 8,
  });
  const motion = analyzeAnimationMotionDynamics({
    loop_mode: input.loop_mode, tracks: input.tracks, example_limit: 6,
  });
  const contact = input.contact_constraints !== undefined
    ? analyzeAnimationContactEvidence({
        constraints: input.contact_constraints, exampleLimit: 8,
      })
    : null;
  const frameHints = planTemporalImageEvidence({
    duration_seconds: input.duration_seconds,
    tracks: input.tracks.map(track => ({
      group_uuid: track.group_uuid, group_name: track.group_name,
      channel: track.channel,
      keyframes: track.keyframes.map(frame => ({
        time: frame.time, value: frame.value,
        ...(frame.data_point_count === undefined ? {} :
          { data_point_count: frame.data_point_count }),
      })),
    })),
    ...(input.max_review_frames === undefined ? {} :
      { max_frames: input.max_review_frames }),
    ...(input.focus_bone_uuid === undefined ? {} :
      { focus_bone_uuid: input.focus_bone_uuid }),
    ...(input.focus_time_range === undefined ? {} :
      { focus_time_range: input.focus_time_range }),
  });
  const reviewReasons: string[] = [];
  if (collisionCount) reviewReasons.push("POTENTIAL_NATIVE_KEYFRAME_REPLACEMENT");
  if (outsideClipCount) reviewReasons.push("AUTHORED_KEYS_OUTSIDE_CLIP_DURATION");
  if (contactSampleOutsideClipCount) reviewReasons.push("CONTACT_SAMPLES_OUTSIDE_CLIP_DURATION");
  if (quality.state === "available") {
    if (quality.loop_seam.review_track_count ||
        quality.loop_seam.unresolved_rotation_arc_track_count)
      reviewReasons.push("LOOP_SEAM_REVIEW");
    if (quality.loop_seam.boundary_missing_track_count)
      reviewReasons.push("LOOP_BOUNDARY_KEYS_UNVERIFIED");
  }
  if (contact?.state === "available") {
    if (contact.review_constraint_count) reviewReasons.push("CONTACT_DRIFT_OR_PENETRATION");
    if (contact.invalid_constraint_count || contact.unverified_constraint_count)
      reviewReasons.push("CONTACT_SAMPLE_COVERAGE_INCOMPLETE");
  } else if (contact !== null) {
    reviewReasons.push("CONTACT_EVIDENCE_UNAVAILABLE");
  }
  const status = reviewReasons.length > 0 ? "REVIEW_REQUIRED" :
    unknownOrNonSingleDataPoints > 0 ? "EVIDENCE_INCOMPLETE" :
      "DIAGNOSTIC_ONLY";
  return {
    schema: "lazydesigner-animation-cli-v1" as const,
    input_sha256: inputSha256,
    animation_uuid_claim: input.animation_uuid,
    evidence_scope: "CALLER_SUPPLIED_AUTHORED_KEYS_AND_CONTACT_SAMPLES" as const,
    native_origin_verified: false as const,
    native_playback_observed: false as const,
    continuous_motion_verified: false as const,
    visual_verdict: "UNVERIFIED" as const,
    automatic_keyframe_correction: false as const,
    source_timing: {
      state: collisionCount > 0 ? "REVIEW_REQUIRED" as const :
        "DECLARED_KEYS_CHECKED" as const,
      evaluated_tracks: input.tracks.length, evaluated_keyframes:
        input.tracks.reduce((sum, t) => sum + t.keyframes.length, 0),
      unknown_or_non_single_data_point_keyframes: unknownOrNonSingleDataPoints,
      potential_replacement_count: collisionCount,
      potential_replacement_examples: collisions,
      examples_truncated: collisionCount > collisions.length,
      outside_declared_clip_count: outsideClipCount,
      time_tolerance_seconds: NATIVE_KEYFRAME_REPLACE_TIME_TOLERANCE,
      contact_samples_or_windows_outside_clip_count: contactSampleOutsideClipCount,
    },
    quality,
    motion,
    contact: contact ?? { state: "not_requested" as const },
    temporal_frame_hints: frameHints,
    status,
    review_reasons: reviewReasons,
    next_action: status === "REVIEW_REQUIRED"
      ? "REVIEW_SOURCE_TIMING_CONTACT_AND_NATIVE_CLIP_BEFORE_CORRECTION"
      : status === "EVIDENCE_INCOMPLETE"
        ? "OBTAIN_EXACT_NATIVE_KEYFRAME_DATA_POINT_COUNTS_IF_DECISION_CRITICAL"
        : "COMPARE_APPROVED_MOTION_WITH_NATIVE_POSES_AND_PLAYBACK",
  };
}

const HELP =
  "Usage: bun run analyze:animation -- --input <animation.json> [--json]\n" +
  "Manifest: lazydesigner-animation-analysis-input-v1.\n" +
  "Read-only quality, timing, contact and candidate review times.\n" +
  "Declared keys/samples are not native proof or continuous-motion PASS.\n";
export async function runAnimationCli(
  argv: readonly string[]
): Promise<ReadOnlyAuthoringCliResponse> {
  try {
    const { inputPath, json, help } = parseAuthoringPlanFlags(
      argv, "ANIMATION_CLI"
    );
    if (help) return { exitCode: 0, stdout: HELP, stderr: "" };
    const { value, sha256 } = await readAuthoringPlanJson(
      inputPath!, "ANIMATION_CLI", ANIMATION_CLI_MAX_INPUT_BYTES
    );
    const report = prepareAnimationAnalysis(value, sha256);
    if (json) return {
      exitCode: 0, stdout: JSON.stringify(report) + "\n", stderr: "",
    };
    return {
      exitCode: 0,
      stdout: [
        "Animation authoring diagnostics (read-only)",
        `Status: ${report.status}`,
        `Potential time collisions: ${report.source_timing.potential_replacement_count}`,
        `Contact: ${report.contact.state}`,
        `Candidate image times: ${report.temporal_frame_hints.suggested_times_seconds.length}`,
        "Native playback and visual quality: UNVERIFIED",
        `Next: ${report.next_action}`,
      ].join("\n") + "\n", stderr: "",
    };
  } catch (error) {
    return {
      exitCode: 2, stdout: "",
      stderr: authoringPlanError(error, "ANIMATION_CLI_INPUT_INVALID"),
    };
  }
}
if (import.meta.main) {
  const response = await runAnimationCli(process.argv.slice(2));
  if (response.stdout) process.stdout.write(response.stdout);
  if (response.stderr) process.stderr.write(response.stderr);
  process.exitCode = response.exitCode;
}
