import { describe, expect, test } from "bun:test";
import {
  animationCopyPasteParameters,
  animationTimelineParameters,
  createAnimationParameters,
  batchKeyframeOperationsParameters,
  boneRiggingParameters,
  countAnimationClipboardKeyframes,
  deriveMirroredRigName,
  hasCaseInsensitiveRigNameCollision,
  manageKeyframesParameters,
  requireValidPlannedKeyframeTimes,
  requireValidPlannedPasteChannelTimes,
  resolveUniqueKeyframeMatchIndexes,
  wouldCreateRigHierarchyCycle,
} from "@/server/tools/animation";

describe("animation mutation contract", () => {
  test("manage_keyframes rejects an empty target list", () => {
    const result = manageKeyframesParameters.safeParse({
      action: "create",
      bone_name: "root",
      channel: "rotation",
      keyframes: [],
    });
    expect(result.success).toBe(false);
  });

  test("manage_keyframes preserves explicit Molang transform strings without widening create_animation", async () => {
    const expression = "math.sin(query.life_time*180)*2";
    expect(
      manageKeyframesParameters.safeParse({
        action: "create",
        bone_name: "root",
        channel: "rotation",
        keyframes: [{ time: 0, values: [expression, 0, "-variable.attack_body_rot_y"] }],
      }).success
    ).toBe(true);
    expect(
      manageKeyframesParameters.safeParse({
        action: "edit",
        bone_name: "root",
        channel: "scale",
        keyframes: [{ time: 1, values: expression }],
      }).success
    ).toBe(true);
    expect(
      manageKeyframesParameters.safeParse({
        action: "create",
        bone_name: "root",
        channel: "rotation",
        keyframes: [{ time: 0, values: ["   ", 0, 0] }],
      }).success
    ).toBe(false);
    expect(
      createAnimationParameters.safeParse({
        name: "expression_probe",
        bones: { root: [{ time: 0, rotation: [expression, 0, 0] }] },
      }).success
    ).toBe(false);

    const [animationSource, inspectionSource] = await Promise.all([
      Bun.file("server/tools/animation/keyframes.ts").text(),
      Bun.file("server/tools/animation/inspection.ts").text(),
    ]);
    expect(animationSource).toContain("values: number | string | Array<number | string> | undefined");
    expect(animationSource).toContain('typeof values === "number" || typeof values === "string"');
    expect(animationSource).not.toContain("MolangParser.parse(");
    expect(animationSource).not.toContain("risky_eval");
    expect(inspectionSource).toContain("keyframe.getArray(index)");
  });

  test("timeline loop requires an explicit loop mode", () => {
    expect(animationTimelineParameters.safeParse({ action: "loop" }).success).toBe(false);
    expect(
      animationTimelineParameters.safeParse({ action: "loop", loop_mode: "loop" }).success
    ).toBe(true);
  });

  test("batch operations reject incomplete or effective no-op requests", () => {
    expect(
      batchKeyframeOperationsParameters.safeParse({ operation: "offset" }).success
    ).toBe(false);
    expect(
      batchKeyframeOperationsParameters.safeParse({
        operation: "offset",
        parameters: { offset_time: 0, offset_values: [0, 0, 0] },
      }).success
    ).toBe(false);
    expect(
      batchKeyframeOperationsParameters.safeParse({
        operation: "offset",
        parameters: { offset_time: 0.25 },
      }).success
    ).toBe(true);
    expect(
      batchKeyframeOperationsParameters.safeParse({ operation: "scale" }).success
    ).toBe(false);
    expect(
      batchKeyframeOperationsParameters.safeParse({
        operation: "scale",
        parameters: { scale_factor: 1 },
      }).success
    ).toBe(false);
    expect(
      batchKeyframeOperationsParameters.safeParse({
        operation: "scale",
        parameters: { scale_factor: 1.5 },
      }).success
    ).toBe(true);
    expect(
      batchKeyframeOperationsParameters.safeParse({
        selection: "range",
        operation: "reverse",
      }).success
    ).toBe(false);
    expect(
      batchKeyframeOperationsParameters.safeParse({
        selection: "pattern",
        operation: "reverse",
      }).success
    ).toBe(false);
  });

  test("copy/paste contract rejects empty channel intent and detects empty clipboard data", () => {
    expect(
      animationCopyPasteParameters.safeParse({
        action: "copy",
        source: { bone: "root", channels: [] },
      }).success
    ).toBe(false);
    expect(
      animationCopyPasteParameters.safeParse({
        action: "paste",
        target: { bone: "root", time_offset: Infinity },
      }).success
    ).toBe(false);
    expect(countAnimationClipboardKeyframes({})).toBe(0);
    expect(countAnimationClipboardKeyframes({ rotation: [], position: [] })).toBe(0);
    expect(countAnimationClipboardKeyframes({ rotation: [{ time: 0 }] })).toBe(1);
  });

  test("set_ik rejects empty updates while allowing target-only state preservation", async () => {
    expect(
      boneRiggingParameters.safeParse({
        action: "set_ik",
        bone_data: { name: "arm" },
      }).success
    ).toBe(false);
    expect(
      boneRiggingParameters.safeParse({
        action: "set_ik",
        bone_data: { name: "arm", ik_target: "hand_target" },
      }).success
    ).toBe(true);
    expect(
      boneRiggingParameters.safeParse({
        action: "set_ik",
        bone_data: { name: "arm", ik_enabled: false },
      }).success
    ).toBe(true);

    const source = await Bun.file("server/tools/animation/rigging.ts").text();
    expect(source).toContain("if (bone_data.ik_enabled !== undefined)");
    expect(source).not.toContain("bone_data.ik_enabled ?? false");
  });

  test("rig parent preflight rejects self, descendant, and already-cyclic parent chains", () => {
    const hierarchy = new Map<string, string | null>([
      ["root-bone", null],
      ["mid-bone", "root-bone"],
      ["leaf-bone", "mid-bone"],
    ]);
    expect(
      wouldCreateRigHierarchyCycle("root-bone", "root-bone", hierarchy)
    ).toBe(true);
    expect(
      wouldCreateRigHierarchyCycle("root-bone", "leaf-bone", hierarchy)
    ).toBe(true);
    expect(
      wouldCreateRigHierarchyCycle("leaf-bone", "root-bone", hierarchy)
    ).toBe(false);

    const corruptHierarchy = new Map<string, string | null>([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(wouldCreateRigHierarchyCycle("target", "a", corruptHierarchy)).toBe(true);
  });

  test("rig bone names reject case-insensitive collisions while allowing self case-only rename", async () => {
    const groups = [
      { uuid: "arm-id", name: "Arm" },
      { uuid: "leg-id", name: "Leg" },
    ];
    expect(hasCaseInsensitiveRigNameCollision(groups, "arm")).toBe(true);
    expect(hasCaseInsensitiveRigNameCollision(groups, "ARM")).toBe(true);
    expect(
      hasCaseInsensitiveRigNameCollision(groups, "arm", "arm-id")
    ).toBe(false);
    expect(hasCaseInsensitiveRigNameCollision(groups, "hand")).toBe(false);

    const source = await Bun.file("server/tools/animation/rigging.ts").text();
    expect(source).toContain("hasCaseInsensitiveRigNameCollision(Group.all, boneName)");
    expect(source).toContain("bone_data.new_name === targetBone.name");
    expect(source).not.toContain("group.name === bone_data.new_name");
  });

  test("mirror derives its bone name before mutation so identity collisions can be rejected", async () => {
    expect(deriveMirroredRigName("left_arm")).toBe("right_arm");
    expect(deriveMirroredRigName("right_leg")).toBe("left_leg");
    expect(deriveMirroredRigName("head")).toBe("head_mirrored");

    const source = await Bun.file("server/tools/animation/rigging.ts").text();
    expect(source).toContain("mirroredBoneName = deriveMirroredRigName(targetBone.name)");
    expect(source).toContain("mirroredBone.name = mirroredBoneName!");
    expect(source).not.toContain("mirroredBone.name = targetBone!.name.includes");
  });

  test("copy/paste actions require their explicit source, target, and mirror axis", async () => {
    expect(animationCopyPasteParameters.safeParse({ action: "copy" }).success).toBe(false);
    expect(animationCopyPasteParameters.safeParse({ action: "paste" }).success).toBe(false);
    expect(
      animationCopyPasteParameters.safeParse({
        action: "mirror_paste",
        target: { bone: "arm" },
      }).success
    ).toBe(false);
    expect(
      animationCopyPasteParameters.safeParse({
        action: "mirror_paste",
        target: { bone: "arm", mirror_axis: "z" },
      }).success
    ).toBe(true);

    const source = await Bun.file("server/tools/animation/batch.ts").text();
    expect(source).toContain("action === \"mirror_paste\" ? target.mirror_axis! : null");
    expect(source).not.toContain("target.mirror_axis || \"x\"");
  });

  test("manage_keyframes preserves partial edit intent and validates target times", async () => {
    const parsedEdit = manageKeyframesParameters.parse({
      action: "edit",
      bone_name: "root",
      channel: "rotation",
      keyframes: [{ time: 1, values: [10, 20, 30] }],
    });
    expect(parsedEdit.keyframes[0].interpolation).toBeUndefined();
    expect(
      manageKeyframesParameters.safeParse({
        action: "edit",
        bone_name: "root",
        channel: "rotation",
        keyframes: [{ time: 1 }],
      }).success
    ).toBe(false);
    expect(
      manageKeyframesParameters.safeParse({
        action: "create",
        bone_name: "root",
        channel: "rotation",
        keyframes: [{ time: -0.1, values: [0, 0, 0] }],
      }).success
    ).toBe(false);
    expect(
      manageKeyframesParameters.safeParse({
        action: "edit",
        bone_name: "root",
        channel: "rotation",
        keyframes: [{ time: 1, bezier_handles: { left_time: [-0.1, 0, 0] } }],
      }).success
    ).toBe(false);

    expect(resolveUniqueKeyframeMatchIndexes([0, 1, 2], [1])).toEqual([1]);
    expect(resolveUniqueKeyframeMatchIndexes([0, 1, 2], [1.0005])).toEqual([1]);
    expect(() => resolveUniqueKeyframeMatchIndexes([0, 1, 2], [3])).toThrow(
      "No existing keyframe matches requested time 3"
    );
    expect(() =>
      resolveUniqueKeyframeMatchIndexes([1, 1.0005], [1.00025])
    ).toThrow("ambiguously matches");
    expect(() => resolveUniqueKeyframeMatchIndexes([1], [1, 1.0005])).toThrow(
      "same existing keyframe"
    );

    const source = await Bun.file("server/tools/animation/keyframes.ts").text();
    expect(source).toContain("interpolation: kf.interpolation ?? \"linear\"");
    expect(source).toContain("const targetKeyframes = action === \"create\" ? [] : resolveRequestedTargets()");
  });

  test("manage_keyframes returns exact affected identity/time state and preflights snapped create times", async () => {
    const source = await Bun.file("server/tools/animation/keyframes.ts").text();
    const block = source;

    expect(source).toContain("function keyframeContinuationState(keyframe: BBKeyframe)");
    expect(source).toContain("uuid: keyframe.uuid");
    expect(source).toContain("time: keyframe.time");
    expect(source).toContain("interpolation: keyframe.interpolation");
    expect(block).toContain("const plannedCreateTimes =");
    expect(block).toContain("Timeline.snapTime(keyframe.time, animation)");
    expect(block).toContain('"manage_keyframes create"');
    expect(block).toContain("time: plannedCreateTimes[index]");
    expect(block).toContain("affected_keyframes: affectedKeyframes");
    expect(block).toContain("structuredContent: result");
    expect(block).toContain("return buildResult(targetKeyframes.map(keyframeContinuationState));");
    expect(block).not.toContain("inspect_animation");
  });

  test("batch offset/scale plans stay inside native keyframe time bounds", async () => {
    expect(() =>
      requireValidPlannedKeyframeTimes([0, 1.5, 10000], "test")
    ).not.toThrow();
    expect(() => requireValidPlannedKeyframeTimes([-0.001], "test")).toThrow(
      "0..10000"
    );
    expect(() => requireValidPlannedKeyframeTimes([10000.001], "test")).toThrow(
      "0..10000"
    );
    expect(() =>
      requireValidPlannedKeyframeTimes([1, 1], "test scale", true)
    ).toThrow("collapse multiple selected keyframes");

    const source = await Bun.file("server/tools/animation/batch.ts").text();
    expect(source).toContain("keyframe.time + parameters.offset_time!");
    expect(source).toContain("keyframe.time = plannedTimes[index]");
    expect(source).toContain("\"Batch keyframe scale\",");
  });

  test("batch offset mirrors native time-drag collision cleanup and Undo casualty ownership", async () => {
    const source = await Bun.file("server/tools/animation/batch.ts").text();
    const block = source;
    const offsetStart = block.indexOf('if (operation === "offset" || operation === "mirror")');
    const offsetEnd = block.indexOf('if (operation === "bake")', offsetStart);
    const offsetBlock = block.slice(offsetStart, offsetEnd);

    expect(offsetBlock).toContain('operation === "offset" && (parameters.offset_time ?? 0) !== 0');
    expect(offsetBlock).toContain("const replacedKeyframes: BBKeyframe[] = [];");
    expect(offsetBlock).toContain("if (movesTime) {");
    expect(offsetBlock).toContain("kf.replaceOthers(replacedKeyframes);");
    expect(offsetBlock).toContain("Undo.addKeyframeCasualties(replacedKeyframes);");
    expect(offsetBlock).toContain("animation.setLength();");
    expect(offsetBlock.indexOf("kf.replaceOthers(replacedKeyframes);")).toBeLessThan(
      offsetBlock.indexOf("Undo.addKeyframeCasualties(replacedKeyframes);")
    );
    expect(offsetBlock.indexOf("Undo.addKeyframeCasualties(replacedKeyframes);")).toBeLessThan(
      offsetBlock.indexOf("Undo.finishEdit")
    );
    expect(offsetBlock).toContain("source_keyframes: keyframes.length");
    expect(offsetBlock).toContain("overwritten_keyframes: replacedKeyframes.length");
    expect(offsetBlock).toContain("structuredContent: result");
    expect(offsetBlock).not.toContain("affected_keyframes");
    expect(offsetBlock).not.toContain("inspect_animation");
  });

  test("batch mirror maps schema axis to native numeric flip index and excludes native no-op keyframes", async () => {
    const source = await Bun.file("server/tools/animation/batch.ts").text();
    const block = source;
    const mirrorStart = block.indexOf('if (operation === "offset" || operation === "mirror")');
    const mirrorEnd = block.indexOf('if (operation === "bake")', mirrorStart);
    const mirrorBlock = block.slice(mirrorStart, mirrorEnd);

    expect(mirrorBlock).toContain("const mirrorKeyframes =");
    expect(mirrorBlock).toContain("planMirroredBatchKeyframes(keyframes)");
    expect(await Bun.file("lib/animation/batchPlanning.ts").text()).toContain('Boolean(keyframe.transform) && keyframe.channel !== "scale"');
    const { planMirroredBatchKeyframes } = await import("../lib/animation/batchPlanning");
    expect(() => planMirroredBatchKeyframes([{ transform: true, channel: "scale" }]))
      .toThrow("No position or rotation transform keyframes");
    expect(mirrorBlock.indexOf("planMirroredBatchKeyframes(keyframes)")).toBeLessThan(
      mirrorBlock.indexOf("Undo.initEdit")
    );
    expect(mirrorBlock).toContain('keyframes: operation === "mirror" ? mirrorKeyframes : keyframes');
    expect(mirrorBlock).toContain("const mirrorAxisIndex =");
    expect(mirrorBlock).toContain('mirrorAxis === "x" ? 0 : mirrorAxis === "y" ? 1 : 2');
    expect(mirrorBlock).toContain("kf.flip(mirrorAxisIndex);");
    expect(mirrorBlock).not.toContain("kf.flip(mirrorAxis);");
    expect(mirrorBlock).toContain("mirrorKeyframes.length");
  });

  test("batch scale reports bounded overwrite count from native replaceOthers", async () => {
    const source = await Bun.file("server/tools/animation/batch.ts").text();
    const block = source;
    const scaleStart = block.indexOf('if (operation === "scale")');
    const scaleEnd = block.indexOf('if (operation === "reverse")', scaleStart);
    const scaleBlock = block.slice(scaleStart, scaleEnd);

    expect(scaleBlock).toContain("const replacedKeyframes: BBKeyframe[] = [];");
    expect(scaleBlock.indexOf("const replacedKeyframes: BBKeyframe[] = [];")).toBeLessThan(
      scaleBlock.indexOf("Undo.initEdit")
    );
    expect(scaleBlock).toContain("keyframe.replaceOthers(replacedKeyframes);");
    expect(scaleBlock).toContain("planBatchScaleOverwriteTargets(");
    expect(scaleBlock).toContain("animations: [animation]");
    expect(scaleBlock).toContain("actualOverwrites.size !== expectedOverwrites.length");
    expect(scaleBlock).toContain("source_keyframes: keyframes.length");
    expect(scaleBlock).toContain("overwritten_keyframes: replacedKeyframes.length");
    expect(scaleBlock).toContain("structuredContent: result");
    expect(scaleBlock).not.toContain("affected_keyframes");
    expect(scaleBlock).not.toContain("inspect_animation");
  });

  test("batch bake reports actual created keyframes without returning an unbounded keyframe list", async () => {
    const source = await Bun.file("server/tools/animation/batch.ts").text();
    const block = source;
    const bakeStart = block.indexOf('if (operation === "bake")');
    const bakeEnd = block.indexOf('if (operation === "scale")', bakeStart);
    const bakeBlock = block.slice(bakeStart, bakeEnd);

    expect(bakeBlock).toContain("source_keyframes: keyframes.length");
    expect(bakeBlock).toContain("created_keyframes: bakeSamples.length");
    expect(bakeBlock).toContain("structuredContent: result");
    expect(bakeBlock).toContain("bakeSamples.length");
    expect(bakeBlock).not.toContain("affected_keyframes");
    expect(bakeBlock).not.toContain("inspect_animation");
  });

  test("paste planned times reject out-of-range and same-channel collapse before Undo", async () => {
    expect(() =>
      requireValidPlannedPasteChannelTimes({
        rotation: [0, 1, 2],
        position: [0.5, 1.5],
      })
    ).not.toThrow();
    expect(() =>
      requireValidPlannedPasteChannelTimes({ rotation: [10000.001] })
    ).toThrow("0..10000");
    expect(() =>
      requireValidPlannedPasteChannelTimes({ rotation: [1, 1] })
    ).toThrow("collapse multiple selected keyframes");

    const source = await Bun.file("server/tools/animation/batch.ts").text();
    expect(source).toContain("requireValidPlannedPasteChannelTimes(plannedPasteTimesByChannel)");
    expect(source).toContain("plannedPasteTimesByChannel[channel][index]");
  });

  test("animation paste reports bounded pasted/overwrite counts from native replaceOthers", async () => {
    const source = await Bun.file("server/tools/animation/batch.ts").text();
    const block = source;

    expect(block).toContain("const pastedKeyframeCount = countAnimationClipboardKeyframes(");
    expect(block).toContain("const replacedKeyframes: BBKeyframe[] = [];");
    expect(block).toContain("keyframe.replaceOthers(replacedKeyframes);");
    expect(block).toContain("pasted_keyframes: pastedKeyframeCount");
    expect(block).toContain("overwritten_keyframes: replacedKeyframes.length");
    expect(block).toContain("structuredContent: result");
    expect(block).not.toContain("affected_keyframes");
    expect(block).not.toContain("inspect_animation");
  });

  test("animation copy snapshots Bezier handles instead of retaining live source references", async () => {
    const source = await Bun.file("server/tools/animation/batch.ts").text();
    const block = source;

    expect(block).toContain("bezier_left_time: toArrayVector3(kf.bezier_left_time)");
    expect(block).toContain("bezier_left_value: toArrayVector3(kf.bezier_left_value)");
    expect(block).toContain("bezier_right_time: toArrayVector3(kf.bezier_right_time)");
    expect(block).toContain("bezier_right_value: toArrayVector3(kf.bezier_right_value)");
    expect(block).not.toContain("bezier_left_time: kf.bezier_left_time,");
    expect(block).not.toContain("bezier_left_value: kf.bezier_left_value,");
    expect(block).not.toContain("bezier_right_time: kf.bezier_right_time,");
    expect(block).not.toContain("bezier_right_value: kf.bezier_right_value,");
  });

  test("animation copy/paste preserves every transform data point without widening clipboard payload", async () => {
    const source = await Bun.file("server/tools/animation/batch.ts").text();
    const block = source;

    expect(block).toContain("data_points: kf.data_points.map((_, dataPointIndex) => {");
    expect(block).toContain("const [x, y, z] = kf.getArray(dataPointIndex);");
    expect(block).toContain("const dataPoints = kfData.data_points.map(");
    expect(block).toContain("data_points: dataPoints,");
    expect(block).not.toContain("values: kf.getArray(),");
    expect(block).not.toContain("const values = [...kfData.values];");
    expect(block).not.toContain("kf.getUndoCopy(");
  });

  test("mirror_paste delegates transform and Bezier mirroring to native Keyframe.flip without mutating clipboard handles", async () => {
    const source = await Bun.file("server/tools/animation/batch.ts").text();
    const block = source;

    expect(block).toContain("const mirrorAxisIndex =");
    expect(block).toContain('mirrorAxis === "z" ? 2 : null');
    expect(block).not.toContain("values[axisIndex] *= -1");
    expect(block).toContain("keyframe.bezier_left_time = [...kfData.bezier_left_time]");
    expect(block).toContain("keyframe.bezier_left_value = [...kfData.bezier_left_value]");
    expect(block).toContain("keyframe.bezier_right_time = [...kfData.bezier_right_time]");
    expect(block).toContain("keyframe.bezier_right_value = [...kfData.bezier_right_value]");
    expect(block).toContain("if (mirrorAxisIndex !== null) {");
    expect(block).toContain("keyframe.flip(mirrorAxisIndex);");
    expect(block.indexOf("keyframe.bezier_right_value = [...kfData.bezier_right_value]")).toBeLessThan(
      block.indexOf("keyframe.flip(mirrorAxisIndex);")
    );
  });

  test("bone create child adoption rejects parent/ancestor cycles before Undo", async () => {
    const hierarchy = new Map<string, string | null>([
      ["root-bone", null],
      ["mid-bone", "root-bone"],
      ["leaf-bone", "mid-bone"],
    ]);
    expect(
      wouldCreateRigHierarchyCycle("root-bone", "leaf-bone", hierarchy)
    ).toBe(true);
    expect(
      wouldCreateRigHierarchyCycle("leaf-bone", "root-bone", hierarchy)
    ).toBe(false);

    const source = await Bun.file("server/tools/animation/rigging.ts").text();
    expect(source).toContain("const createParentByUuid = new Map<string, string | null>");
    expect(source).toContain("child instanceof Group &&");
    expect(source).toContain("child.uuid,");
    expect(source).toContain("parentBone.uuid,");
  });

  test("bone_rigging returns bounded continuation state and deletion receipt", async () => {
    const block = await Bun.file("server/tools/animation/rigging.ts").text();

    expect(block).toContain("const boneIdentity = (group: Group) =>");
    expect(block).toContain("const boneState = (group: Group) =>");
    expect(block).toContain('group.parent instanceof Group ? group.parent.uuid : "root"');
    expect(block).toContain("origin: [...group.origin]");
    expect(block).toContain("rotation: [...group.rotation]");
    expect(block).toContain("ik_enabled: group.ik_enabled === true");
    expect(block).toContain("affectedBone = group;");
    expect(block).toContain("affectedBone = mirroredBone;");
    expect(block).toContain("bone: boneState(affectedBone)");
    expect(block).toContain("const deletionReceipt =");
    expect(block).toContain("removed_root: boneIdentity(targetBone)");
    expect(block).toContain("total_nodes: deleteGroups.length + deleteElements.length");
    expect(block).toContain("affected_animations: deleteAnimations.length");
    expect(block.indexOf("const deletionReceipt =")).toBeLessThan(
      block.indexOf("Undo.initEdit")
    );
    expect(block).toContain("structuredContent: result");
    expect(block).not.toContain("inspectElement(");
  });

  test("bone delete Undo covers descendants and affected animations before recursive removal", async () => {
    const source = await Bun.file("server/tools/animation/rigging.ts").text();
    expect(source).toContain("deleteGroups = [targetBone]");
    expect(source).toContain("targetBone.forEachChild((element: any) =>");
    expect(source).toContain("const deleteGroupUuids = new Set(");
    expect(source).toContain("deleteAnimations = AnimationItem.all.filter");
    expect(source).toContain("animations: deleteAnimations");
    expect(source).toContain("targetBone!.remove(false)");
    expect(source).toContain("deleteElements.length = 0");
    expect(source).toContain("deleteGroups.length = 0");
    expect(source).not.toContain("targetBone!.remove();");
  });
});
