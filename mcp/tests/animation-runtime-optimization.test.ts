import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { sharedPoseFraming,samePoseBounds,comparePoseCameraReceipts } from "@/lib/animation/evidenceFraming";
import { selectNativePoseDiagnosticRoute } from "@/lib/animation/poseDiagnosticScope";
import {
  animationAwareCaptureModelViewsParameters,
  requireCompleteAnimationCaptureSample,
  captureContinuationContent,
  aggregateAnimationCaptureTraffic,
  focusedInspectAnimationParameters,
  optimizedAnimationTimelineParameters,
} from "@/server/runtime/animationRuntimeContracts";

describe("fixed-camera multi-pose contracts (pure, no screenshots)", () => {
  const pose=(time:number,min:[number,number,number],max:[number,number,number])=>
    ({time,bounds:{min,max}});
  test("sampled envelope covers all event poses, not just the first view",()=>{
    const rows=[pose(0,[-2,0,-2],[2,8,2]),pose(0.8,[-9,-1,-2],[4,12,5])];
    expect(sharedPoseFraming(rows)).toMatchObject({
      framing:{mode:"explicit",min:[-9,-1,-2],max:[4,12,5]},
      basis:"SAMPLED_POSE_UNION",unsampled_motion_verified:false});
    expect(sharedPoseFraming(rows,{mode:"explicit",min:[-10,-2,-4],max:[8,15,8]}).basis)
      .toBe("CALLER_EXPLICIT");
    expect(()=>sharedPoseFraming(rows,{mode:"explicit",min:[-2,0,-2],max:[2,8,2]}))
      .toThrow("ANIMATION_EXPLICIT_FRAME_EXCLUDES_POSE");
    expect(samePoseBounds(rows[0].bounds,rows[1].bounds)).toBe(false);
  });
  test("strict planned camera comparison never grants visual approval",()=>{
    const base={min:[-9,-1,-2] as [number,number,number],
      max:[4,12,5] as [number,number,number]};
    const row=(time:number,zoom:number)=>({
      time,framing_bounds:base,
      captures:[{view:"front",camera_spec:{projection:"orthographic",zoom}}],
    });
    expect(comparePoseCameraReceipts([row(0,1),row(0.8,1)])).toMatchObject({
      state:"MATCHED_PLANNED_CAMERA",actual_native_renderer_attested:false,
      visual_verdict:"NOT_EVALUATED"});
    expect(comparePoseCameraReceipts([row(0,1),row(0.8,2)]).reason)
      .toBe("POSE_CAMERA_FRAMING_DRIFT");
    expect(comparePoseCameraReceipts([row(0,1)]).state).toBe("UNVERIFIED");
  });
});

describe("Animation camera binding source contract",()=>{
  test("all sampled poses route through one envelope and a current-pose bounds fence",async()=>{
    const runtime=await Bun.file("server/runtime/contracts/animation.ts").text();
    const camera=await Bun.file("server/tools/inspection/camera.ts").text();
    expect(runtime).toContain("const sharedFrame=sharedPoseFraming(observedPoses,callerFrame)");
    expect(runtime).toContain("fixedCaptureRequest as unknown as Record<string, unknown>");
    expect(runtime).toContain("ANIMATION_POSE_BOUNDS_CHANGED_DURING_CAPTURE");
    expect(runtime).toContain("pose_camera_comparability: comparePoseCameraReceipts");
    expect(camera).toContain("native_current_pose_bounds: observed.bounds");
    expect(runtime.indexOf("const captureStartedAtMs = Date.now()"))
      .toBeLessThan(runtime.indexOf("observedPoses.push({time,bounds})"));
    expect(runtime.indexOf("observedPoses.push({time,bounds})"))
      .toBeLessThan(runtime.indexOf("fixedCaptureRequest as unknown as Record<string, unknown>"));
  });
});

describe("scope-aware native pose diagnostics",()=>{
  test("appearance-only event poses do not run optional trajectory readers",()=>{
    expect(selectNativePoseDiagnosticRoute(3,["silhouette","width"])).toMatchObject({
      mode:"TARGETED",geometry:false,locators:false,joints:false,
      visual_verdict:"NOT_EVALUATED"});
    expect(selectNativePoseDiagnosticRoute(2,["depth"])).toMatchObject({
      geometry:true,locators:false,joints:false});
  });
  test("attachment and unscoped legacy retain full diagnostics",()=>{
    expect(selectNativePoseDiagnosticRoute(2,["attachment"])).toMatchObject({
      geometry:true,locators:true,joints:true});
    expect(selectNativePoseDiagnosticRoute(3,undefined)).toMatchObject({
      mode:"UNSCOPED_LEGACY",geometry:true,locators:true,joints:true});
    expect(selectNativePoseDiagnosticRoute(1,["attachment"])).toMatchObject({
      mode:"NOT_REQUESTED",geometry:false,locators:false,joints:false});
  });
  test("canonical Animation Runtime applies the pure scoped decision",async()=>{
    const runtime=await Bun.file("server/runtime/contracts/animation.ts").text();
    expect(runtime).toContain("selectNativePoseDiagnosticRoute(");
    expect(runtime).toContain("if (collectLocator) {");
    expect(runtime).toContain("if (collectJoint && locatorFrame) {");
    expect(runtime).toContain("native_pose_diagnostic_scope: nativePoseScope");
  });
});

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


  test("checks each model view against real bytes or a prior exact-byte alias", () => {
    const imageA = Buffer.from([137,80,78,71,13,10,26,10,11]);
    const imageB = Buffer.from([137,80,78,71,13,10,26,10,12]);
    const dataA = imageA.toString("base64");
    const dataB = imageB.toString("base64");
    const shaA = createHash("sha256").update(imageA).digest("hex");
    const shaB = createHash("sha256").update(imageB).digest("hex");
    const capture = (view: string, sha: string, bytes: number,
                     delivery: string, from: string | null) => ({
      view, image_sha256: sha, png_bytes: bytes,
      image_delivery: delivery, reused_from_view: from,
    });
    const direct = {
      structuredContent: {
        captures: [capture("front",shaA,imageA.length,"content.image",null),
                   capture("left",shaB,imageB.length,"content.image",null)],
        total_png_bytes: imageA.length + imageB.length,
        warnings: 0,
        image_transport: {
          policy: "LOSSLESS_SAME_RESPONSE_EXACT_PNG",
          generated_image_count: 2, delivered_image_count: 2,
          reused_exact_image_count: 0, diagnostic_not_sent_image_count: 0,
        },
      },
      content: [
        {type:"text",text:"VIEW front"},
        {type:"image",mimeType:"image/png",data:dataA},
        {type:"text",text:"VIEW left"},
        {type:"image",mimeType:"image/png",data:dataB},
      ],
    };
    expect(requireCompleteAnimationCaptureSample(direct,2).captures).toHaveLength(2);
    // Keep earlier failure protections while introducing exact PNG aliasing.
    expect(() => requireCompleteAnimationCaptureSample({
      ...direct, isError: true,
    }, 2)).toThrow("ANIMATION_CAPTURE_INCOMPLETE");
    expect(() => requireCompleteAnimationCaptureSample({
      ...direct, structuredContent: {
        ...direct.structuredContent,
        captures: [direct.structuredContent.captures[0]],
      },
    }, 2)).toThrow("ANIMATION_CAPTURE_INCOMPLETE");
    const alias = {
      structuredContent: {
        ...direct.structuredContent,
        captures: [
          capture("front",shaA,imageA.length,"content.image",null),
          capture("left",shaA,imageA.length,"same_response_exact_png","front"),
        ],
        total_png_bytes: imageA.length * 2,
        image_transport: {
          ...direct.structuredContent.image_transport,
          delivered_image_count: 1, reused_exact_image_count: 1,
        },
      },
      content: [
        {type:"text",text:"VIEW front"},
        {type:"image",mimeType:"image/png",data:dataA},
        {type:"text",text:"VIEW left: PNG is byte-identical to MODEL VIEW front in this response (SHA-256 "+shaA+"). Its own camera identity remains distinct."},
      ],
    };
    expect(requireCompleteAnimationCaptureSample(alias,2).captures).toHaveLength(2);
    expect(() => requireCompleteAnimationCaptureSample({
      ...alias,
      structuredContent: {
        ...alias.structuredContent,
        captures: [alias.structuredContent.captures[0],
          {...alias.structuredContent.captures[1], reused_from_view:"missing"}],
      },
    },2)).toThrow("ANIMATION_CAPTURE_INCOMPLETE");
    expect(() => requireCompleteAnimationCaptureSample({
      ...direct,
      structuredContent: {
        ...direct.structuredContent,
        captures: [direct.structuredContent.captures[0],
          {...direct.structuredContent.captures[1], image_sha256:shaA}],
      },
    },2)).toThrow("ANIMATION_CAPTURE_INCOMPLETE");
    expect(() => requireCompleteAnimationCaptureSample({
      ...direct, content: direct.content.filter(item => item.type!=="image" || item.data!==dataB),
    },2)).toThrow("ANIMATION_CAPTURE_INCOMPLETE");
  });

  test("keeps silhouette labels and verifies image identity independently", () => {
    const png = Buffer.from([137,80,78,71,13,10,26,10,55]);
    const sha = createHash("sha256").update(png).digest("hex");
    const data = png.toString("base64");
    const result = {
      structuredContent: {
        captures: [
          {view:"front",image_sha256:sha,png_bytes:png.length,
           image_delivery:"content.image",reused_from_view:null,
           silhouette_evidence:{state:"AVAILABLE",image_sha256:sha}},
        ],
        image_transport:{
          policy:"LOSSLESS_SAME_RESPONSE_EXACT_PNG",
          generated_image_count:2,delivered_image_count:2,
          reused_exact_image_count:0,diagnostic_not_sent_image_count:0,
        },
        total_png_bytes:png.length,warnings:0,
      },
      content:[
        {type:"text",text:"VIEW front"},
        {type:"image",mimeType:"image/png",data},
        {type:"text",text:"SILHOUETTE VIEW front: visible solid Cube geometry only."},
        {type:"image",mimeType:"image/png",data},
      ],
    };
    expect(requireCompleteAnimationCaptureSample(result,1).captures).toHaveLength(1);
    expect(captureContinuationContent(result)).toEqual(result.content);
    expect(() => requireCompleteAnimationCaptureSample({
      ...result, content:result.content.filter(item =>
        item.type!=="text" || !item.text?.startsWith("SILHOUETTE VIEW")),
    },1)).toThrow("ANIMATION_CAPTURE_INCOMPLETE");
  });

  test("aggregates all animation pose image bytes rather than first-pose counters", () => {
    const first={
      generated_image_count:2,generated_png_bytes:900,
      delivered_image_count:1,delivered_png_bytes:500,
      reused_exact_image_count:1,reused_exact_png_bytes:400,
      diagnostic_not_sent_image_count:0,diagnostic_not_sent_png_bytes:0,
      model_image_count:2,silhouette_image_count:0,capture_processing_ms:12,
    };
    const second={
      generated_image_count:3,generated_png_bytes:1500,
      delivered_image_count:2,delivered_png_bytes:1200,
      reused_exact_image_count:0,reused_exact_png_bytes:0,
      diagnostic_not_sent_image_count:1,diagnostic_not_sent_png_bytes:300,
      model_image_count:2,silhouette_image_count:1,capture_processing_ms:18,
    };
    expect(aggregateAnimationCaptureTraffic([first,second])).toMatchObject({
      generated_image_count:5,generated_png_bytes:2400,
      delivered_image_count:3,delivered_png_bytes:1700,
      reused_exact_image_count:1,reused_exact_png_bytes:400,
      diagnostic_not_sent_image_count:1,diagnostic_not_sent_png_bytes:300,
      model_image_count:4,silhouette_image_count:1,capture_processing_ms:30,
      api_token_usage:null,cross_pose_reuse:false,
      measurement_scope:"ALL_ANIMATION_POSE_SAMPLES",
    });
    expect(()=>aggregateAnimationCaptureTraffic([
      {...first, delivered_png_bytes:NaN},
    ])).toThrow("ANIMATION_CAPTURE_TRAFFIC_UNVERIFIED");
  });



  test("native animation image capture reuses its preview frame for bounded Geometry OBB evidence", async () => {
    const source = await Bun.file("server/runtime/contracts/animation.ts").text();
    const start = source.indexOf("function observeNativeAnimationGeometryPose(");
    const capture = source.indexOf("async function captureAnimationSamples(", start);
    const end = source.indexOf("function keyframesForChannel(", capture);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(capture).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(capture);
    const reader = source.slice(start, capture);
    const operation = source.slice(capture, end);
    expect(reader).toContain("GEOMETRY_WORLD_OBB_SAMPLE_LIMIT");
    expect(reader).toContain("omitted_cube_count: all.length - selected.length");
    expect(reader).toContain("cube.visibility !== false && isEffectivelyVisible(cube.mesh)");
    expect(reader).toContain("orientedBoxFromCube(cube)");
    expect(reader).toContain('cube.parent === "root" ? "root" : null');
    expect(reader).not.toContain("Undo.initEdit");
    expect(reader).not.toContain("Timeline.setTime(");
    expect(operation).toContain("const compareGeometry = nativePoseScope.geometry");
    expect(operation.indexOf("withTemporaryAnimationPreview("))
      .toBeLessThan(operation.indexOf("observeNativeAnimationGeometryPose("));
    expect(operation.indexOf("requireCompleteAnimationCaptureSample("))
      .toBeLessThan(operation.indexOf("observeNativeAnimationGeometryPose("));
    expect(operation).toContain("analyzeGeometryPoseSequence(geometrySnapshots)");
    expect(operation).toContain("geometry_pose_review: geometryPoseReview");
    expect(operation).toContain("native_world_obb_observation_incomplete");
    expect(operation).toContain("geometry_pose_comparison_unavailable");
    expect(operation).toContain("geometry_mutation_authorized: false");
    expect(operation).not.toContain("Undo.initEdit");
    expect(operation).not.toContain("Timeline.setTime(");

    // Reuse the existing public schema. Extra request keys are stripped by
    // its inherited Zod object; they must not create a new capability.
    const parsed = animationAwareCaptureModelViewsParameters.parse({
      views: ["front"], front_direction: "+z",
      animation_preview: { animation_id: "walk", times: [0, 0.5] },
      geometry_pose_review: true,
    });
    expect(parsed.animation_preview?.times).toEqual([0, 0.5]);
    expect(parsed).not.toHaveProperty("geometry_pose_review");
  });

  test("multi-time locator QA uses the existing passive reader and forbids overlapping capture sessions", async () => {
    const source = await Bun.file("server/runtime/contracts/animation.ts").text();
    const reader = source.slice(
      source.indexOf("function observeNativeAnimationLocatorFrame("),
      source.indexOf("async function captureAnimationSamples(")
    );
    const operation = source.slice(
      source.indexOf("async function captureAnimationSamples("),
      source.indexOf("function keyframesForChannel(")
    );
    expect(reader).toContain("readDirectLocatorCandidates(group)");
    expect(reader).toContain("CURRENT_POSE_LOCATOR_LIMIT");
    expect(reader).toContain("ANIMATION_LOCATOR_INVENTORY_OR_CONTEXT_CHANGED");
    expect(reader).not.toContain("Undo.initEdit");
    expect(reader).not.toContain("Timeline.setTime(");
    expect(operation).toContain('ANIMATION_PREVIEW_CAPTURE_ALREADY_ACTIVE');
    expect(operation.indexOf("activeAnimationPreviewCapture = true"))
      .toBeLessThan(operation.indexOf("withTemporaryAnimationPreview("));
    expect(operation).toContain("} finally {\n    activeAnimationPreviewCapture = false;");
    expect(operation.indexOf("requireCompleteAnimationCaptureSample("))
      .toBeLessThan(operation.indexOf("observeNativeAnimationLocatorFrame("));
    expect(operation).toContain("analyzeObservedAnimationLocatorTrajectories(locatorFrames)");
    expect(operation).toContain("locator_trajectory_review: locatorTrajectoryReview");
    expect(operation).toContain("native_preview_restoration_attested: false");
    expect(operation).not.toContain("Undo.initEdit");
  });


  test("native animation screenshot can reuse passive Group pose reader for bounded joint ancestry", async () => {
    const source = await Bun.file("server/runtime/contracts/animation.ts").text();
    const start = source.indexOf("function observeNativeAnimationJointOriginFrame(");
    const captureStart = source.indexOf("async function captureAnimationSamples(", start);
    const reader = source.slice(start, captureStart);
    const operation = source.slice(captureStart, source.indexOf("function keyframesForChannel("));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(captureStart).toBeGreaterThan(start);
    expect(reader).toContain("readCurrentBonePoseSnapshot(animation, group)");
    expect(reader).toContain("ANIMATION_JOINT_ORIGIN_MAX_GROUPS");
    expect(reader).toContain("ANIMATION_JOINT_ANCESTRY_UNVERIFIED");
    expect(reader).not.toContain("Timeline.setTime(");
    expect(reader).not.toContain("Undo.initEdit");
    expect(operation.indexOf("requireCompleteAnimationCaptureSample("))
      .toBeLessThan(operation.indexOf("observeNativeAnimationJointOriginFrame("));
    expect(operation).toContain("analyzeObservedAnimationJointOriginFrames(jointOriginFrames)");
    expect(operation).toContain("joint_origin_review: jointOriginReview");
    expect(operation).toContain("native_joint_origin_observation_incomplete");
    expect(operation).toContain("native_ik_bake_authorized: false");
  });

  test("native read-only Group orientations reject nonuniform scales and do not change Timeline", async () => {
    const source=await Bun.file("server/runtime/contracts/animation.ts").text();
    const start=source.indexOf("function readNativeAnimationGroupWorldQuaternion(");
    const end=source.indexOf("function observeNativeAnimationJointOriginFrame(",start);
    const nativeReader=source.slice(start,end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(nativeReader).toContain("getWorldQuaternion(new THREE.Quaternion())");
    expect(nativeReader).toContain("ANIMATION_MESH_ORIENTATION_PARENT_UNVERIFIED");
    expect(nativeReader).toContain("ANIMATION_MESH_ORIENTATION_SCALE_UNSUPPORTED");
    expect(nativeReader).toContain("ANIMATION_MESH_ORIENTATION_QUATERNION_INVALID");
    expect(nativeReader).not.toContain("Undo.initEdit");
    expect(nativeReader).not.toContain("Timeline.setTime(");
    const execution=source.slice(end,source.indexOf("async function captureAnimationSamples(",end));
    expect(execution).toContain("readNativeAnimationGroupWorldQuaternion(group)");
    expect(execution).toContain("orientation_unavailable_reason");
  });

  test("native Euler preview gate reuses Blockbench pre_rotation without authoring rotation", async () => {
    const source=await Bun.file("server/runtime/contracts/animation.ts").text();
    const start=source.indexOf("function readNativeAnimationGroupEulerContext(");
    const end=source.indexOf("function observeNativeAnimationJointOriginFrame(",start);
    const reader=source.slice(start,end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(reader).toContain("mesh?.pre_rotation");
    expect(reader).toContain("mesh?.fix_rotation");
    expect(reader).toContain("settings.rotation_global");
    expect(reader).toContain("animation.override===true");
    expect(reader).toContain("format.euler_order");
    expect(reader).toContain("quaternionInterpolation");
    expect(reader).toContain("inspectObservedAdditiveEulerPose({");
    expect(reader).not.toContain("Undo.initEdit");
    expect(reader).not.toContain("Timeline.setTime(");
    const capture=source.slice(end,source.indexOf("async function captureAnimationSamples(",end));
    expect(capture).toContain("readNativeAnimationGroupEulerContext(group,animation)");
    expect(capture).toContain("euler_pose_review:eulerReview");
  });

  test("native exact Euler parity reads raw numeric key data without interpolation or editor mutations",async()=>{
    const source=await Bun.file("server/runtime/contracts/animation.ts").text();
    const start=source.indexOf("function readNativeExactRotationKeyParity(");
    const end=source.indexOf("function observeNativeAnimationJointOriginFrame(",start);
    const reader=source.slice(start,end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(reader).toContain("animator.rotation");
    expect(reader).toContain("IK_EXACT_EULER_KEYFRAME_LIMIT");
    expect(reader).toContain("key.data_points.map((point)");
    expect(reader).toContain("compareObservedEulerToExactAuthoredRotationKey({");
    expect(reader).not.toContain("key.getArray(");
    expect(reader).not.toContain("animator.interpolate(");
    expect(reader).not.toContain("Timeline.setTime(");
    expect(reader).not.toContain("Undo.initEdit");
    const consumer=source.slice(end,source.indexOf("async function captureAnimationSamples(",end));
    expect(consumer).toContain("readNativeExactRotationKeyParity(");
    expect(consumer).toContain("euler_exact_keyframe_review:exactSourceParity");
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
