import { describe, expect, test } from "bun:test";
import {
  animationAwareCaptureModelViewsParameters,
  requireCompleteAnimationCaptureSample,
  focusedInspectAnimationParameters,
  optimizedAnimationTimelineParameters,
} from "@/server/runtime/animationRuntimeContracts";

describe("Animation runtime efficiency contracts", () => {
  test("multi-time canonical capture stays bounded to eight images per call", () => {
    const accepted = animationAwareCaptureModelViewsParameters.parse({
      views: ["front", "left"],
      front_direction: "+z",
      animation_preview: {
        animation_id: "anim-walk",
        times: [0, 0.25, 0.5, 0.75],
      },
    });
    expect(accepted.animation_preview?.times).toHaveLength(4);

    expect(
      animationAwareCaptureModelViewsParameters.safeParse({
        views: ["front", "left"],
        front_direction: "+z",
        animation_preview: {
          animation_id: "anim-walk",
          times: [0, 0.25, 0.5, 0.75, 1],
        },
      }).success
    ).toBe(false);

    expect(
      animationAwareCaptureModelViewsParameters.safeParse({
        views: ["front"],
        front_direction: "+z",
        animation_preview: {
          animation_id: "anim-walk",
          times: [0, 0],
        },
      }).success
    ).toBe(false);
  });

  test("evidence-target-driven captures respect eight-image limit after view selection", () => {
    // MEDIUM adds one orthogonal view to width: 2 views × 4 samples.
    expect(animationAwareCaptureModelViewsParameters.safeParse({
      evidence_targets: ["width"], verification_risk: "MEDIUM",
      front_direction: "+z",
      animation_preview: { animation_id: "anim-walk", times: [0, 0.25, 0.5, 0.75] },
    }).success).toBe(true);

    // HIGH expands width to front/left/top: 3 views × 3 samples > 8.
    const tooMany = animationAwareCaptureModelViewsParameters.safeParse({
      evidence_targets: ["width"], verification_risk: "HIGH",
      front_direction: "+z",
      animation_preview: { animation_id: "anim-walk", times: [0, 0.5, 1] },
    });
    expect(tooMany.success).toBe(false);
    if (!tooMany.success) {
      expect(tooMany.error.issues.some((issue) =>
        issue.message.includes("resolved views × times × optional silhouette images <= 8")
      )).toBe(true);
    }

    // Explicit single-view intent is authoritative even when evidence targets
    // and HIGH risk are also supplied: 1 view × 5 samples stays in budget.
    expect(animationAwareCaptureModelViewsParameters.safeParse({
      views: ["front"], evidence_targets: ["width"], verification_risk: "HIGH",
      front_direction: "+z",
      animation_preview: { animation_id: "anim-walk", times: [0, 0.25, 0.5, 0.75, 1] },
    }).success).toBe(true);

    // The inherited camera schema still rejects requests with no valid view
    // source. Extending for animation must not erase that cross-field rule.
    expect(animationAwareCaptureModelViewsParameters.safeParse({
      front_direction: "+z",
      animation_preview: { animation_id: "anim-walk", times: [0] },
    }).success).toBe(false);

    // Non-animation captures retain the ordinary canonical-view limit.
    expect(animationAwareCaptureModelViewsParameters.safeParse({
      evidence_targets: ["width"], verification_risk: "HIGH",
      front_direction: "+z",
    }).success).toBe(true);
  });

  test("silhouette dual-image captures are included in the potential media budget", () => {
    expect(animationAwareCaptureModelViewsParameters.safeParse({
      evidence_targets: ["silhouette"], verification_risk: "MEDIUM",
      front_direction: "+z",
      animation_preview: { animation_id: "anim-walk", times: [0, 0.5] },
    }).success).toBe(true); // 2 views × 2 times × 2 images = 8.

    expect(animationAwareCaptureModelViewsParameters.safeParse({
      evidence_targets: ["silhouette"], verification_risk: "MEDIUM",
      front_direction: "+z",
      animation_preview: { animation_id: "anim-walk", times: [0, 0.5, 1] },
    }).success).toBe(false); // 2 × 3 × 2 exceeds 8.

    expect(animationAwareCaptureModelViewsParameters.safeParse({
      evidence_targets: ["silhouette"], verification_risk: "HIGH",
      front_direction: "+z",
      animation_preview: { animation_id: "anim-walk", times: [0, 1] },
    }).success).toBe(false); // 3 × 2 × 2 exceeds 8.
  });

  test("rejects failed and partial native animation pose samples", () => {
    const good = {
      structuredContent: { captures: [{ view: "front" }, { view: "left" }] },
      content: [{ type: "text", text: "VIEW front" },
        { type: "image", data: "base64one" }, { type: "image", data: "base64two" }],
    };
    expect(requireCompleteAnimationCaptureSample(good, 2).captures).toHaveLength(2);
    expect(() => requireCompleteAnimationCaptureSample({ ...good, isError: true }, 2))
      .toThrow("ANIMATION_CAPTURE_INCOMPLETE");
    expect(() => requireCompleteAnimationCaptureSample({
      ...good, structuredContent: { captures: [{ view: "front" }] },
    }, 2)).toThrow("ANIMATION_CAPTURE_INCOMPLETE");
    expect(() => requireCompleteAnimationCaptureSample({
      ...good, content: [{ type: "image", data: "base64one" }],
    }, 2)).toThrow("ANIMATION_CAPTURE_INCOMPLETE");
  });

  test("focused Animation inspection can narrow one bone by channel and time range", () => {
    const accepted = focusedInspectAnimationParameters.parse({
      animation_id: "anim-walk",
      bone: "arm.left",
      channel: "rotation",
      time_range: { start: 0.2, end: 0.8 },
      diagnostics: true,
    });
    expect(accepted.channel).toBe("rotation");
    expect(accepted.time_range).toEqual({ start: 0.2, end: 0.8 });
    expect(accepted.diagnostics).toBe(true);

    expect(
      focusedInspectAnimationParameters.safeParse({
        animation_id: "anim-walk",
        channel: "rotation",
      }).success
    ).toBe(false);
    expect(
      focusedInspectAnimationParameters.safeParse({
        animation_id: "anim-walk",
        time_range: { start: 1, end: 0 },
      }).success
    ).toBe(false);
  });

  test("consolidated timeline separates the public branch from the batch operation", () => {
    const keyframes = optimizedAnimationTimelineParameters.parse({
      operation: "keyframes",
      animation_id: "anim-walk",
      action: "create",
      bone_name: "arm.left",
      channel: "rotation",
      keyframes: [{ time: 0, values: [0, 0, 0] }],
    });
    expect(keyframes.operation).toBe("keyframes");

    const batch = optimizedAnimationTimelineParameters.parse({
      operation: "batch",
      animation_id: "anim-walk",
      batch_operation: "offset",
      selection: "all",
      parameters: { offset_time: 0.1 },
    });
    expect(batch.operation).toBe("batch");
    if (batch.operation === "batch") {
      expect(batch.batch_operation).toBe("offset");
      expect(batch.animation_id).toBe("anim-walk");
    }

    expect(
      optimizedAnimationTimelineParameters.safeParse({
        operation: "batch",
        selection: "all",
        parameters: { offset_time: 0.1 },
      }).success
    ).toBe(false);
    expect(
      optimizedAnimationTimelineParameters.safeParse({
        operation: "batch",
        batch_operation: "mirror",
        selection: "all",
      }).success
    ).toBe(false);
  });

});
