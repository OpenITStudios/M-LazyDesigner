import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { describeAnimationEvidenceBoundary } from "@/lib/animation/motionEvidence";

describe("Animation evidence remains bounded after retiring unused video transport", () => {
  test("authored keys, still PNG and playback command cannot certify continuous motion", () => {
    for (const source of [
      "NATIVE_CLIP_INSPECTION",
      "NATIVE_CONTROLLER_INSPECTION",
      "STATIC_POSE_PNG",
      "PLAYBACK_COMMAND",
    ] as const) {
      const boundary = describeAnimationEvidenceBoundary(source);
      expect(boundary).toMatchObject({
        contract: "LAZYDESIGNER_ANIMATION_MEDIA_V1",
        source,
        static_pose_visual_pass_claim: false,
        authored_motion_technical_pass_claim: false,
        temporal_motion: {
          state: "UNVERIFIED",
          reason: "CONTINUOUS_MOTION_REVIEW_NOT_ATTESTED",
          continuous_motion_reviewed: false,
          motion_pass_authorized: false,
          still_images_can_satisfy_motion: false,
          playback_command_can_satisfy_motion: false,
        },
      });
    }
    expect(describeAnimationEvidenceBoundary("STATIC_POSE_PNG").static_pose_pixels_available).toBe(true);
    expect(describeAnimationEvidenceBoundary("PLAYBACK_COMMAND").playback_command_executed).toBe(true);
    expect(describeAnimationEvidenceBoundary("NATIVE_CLIP_INSPECTION").authored_data_available).toBe(true);
    expect(describeAnimationEvidenceBoundary("NATIVE_CONTROLLER_INSPECTION").authored_data_available).toBe(true);
  });

  test("the experimental encoder, planner, binary resources and dependent tests remain absent", () => {
    for (const path of [
      "lib/animation/mp4RecordingPlan.ts",
      "server/runtime/animation/mp4Encoder.ts",
      "server/resources/motionMp4.ts",
      "gateway/resources/motionMp4.ts",
      "tests/animation-motion-mp4-bridge.test.ts",
      "tests/animation-mp4-encoder-contract.test.ts",
      "tests/gateway-motion-mp4-resource.test.ts",
    ]) {
      expect(existsSync(path)).toBe(false);
    }
  });

  test("Runtime, Gateway, Control and pose capture retain a non-approving boundary", async () => {
    const paths = [
      "server/runtime/contracts/animation.ts",
      "server/runtime/registration.ts",
      "gateway/runtime/backend.ts",
      "gateway/index.ts",
      "gateway/control/orchestration.ts",
      "lib/animation/motionEvidence.ts",
    ];
    for (const path of paths) {
      const source = await Bun.file(path).text();
      expect(source.toLowerCase()).not.toContain("mp4");
    }
    const runtime = await Bun.file(paths[0]!).text();
    const control = await Bun.file(paths[4]!).text();
    expect(runtime).toContain('"NATIVE_CLIP_INSPECTION"');
    expect(runtime).toContain('"NATIVE_CONTROLLER_INSPECTION"');
    expect(runtime).toContain('describeAnimationEvidenceBoundary("STATIC_POSE_PNG")');
    expect(runtime).toContain('describeAnimationEvidenceBoundary("PLAYBACK_COMMAND")');
    expect(runtime).toContain("return captureAnimationSamples(originalCaptureDefinition, request, context)");
    expect(control).toContain("Temporal motion stays UNVERIFIED");
    expect(control).toContain("native playback");
  });
});
