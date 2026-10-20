export type AnimationEffectChannel = "sound" | "particle" | "timeline";

export type EffectPointSnapshot = {
  effect: string;
  locator: string;
  bind_to_actor: boolean;
  script: string;
  file: string;
};

export type AnimationEffectPayload = {
  effect?: string;
  locator?: string | null;
  bind_to_actor?: boolean | null;
  pre_effect_script?: string | null;
  script?: string;
};

export function effectPointSnapshot(
  point: KeyframeDataPoint
): EffectPointSnapshot {
  return {
    effect: typeof point.effect === "string" ? point.effect : "",
    locator: typeof point.locator === "string" ? point.locator : "",
    bind_to_actor: point.bind_to_actor !== false,
    script: typeof point.script === "string" ? point.script : "",
    file: typeof point.file === "string" ? point.file : "",
  };
}

export function normalizeEffectiveParticleScript(
  script: string | null | undefined
): string | null {
  if (!script || !script.replace(/[\n\s;.]+/g, "")) return null;
  return script.match(/;$/) ? script : `${script};`;
}

export function effectiveTimelineScriptLines(
  script: string | null | undefined
): string[] {
  if (typeof script !== "string") return [];

  return script
    .split("\n")
    .filter((line) => Boolean(line.replace(/[\s;]/g, "")))
    .map((line) =>
      line.match(/;\s*$/) || line.startsWith("/")
        ? line
        : `${line};`
    );
}

export function snapshotsEffectivelyEqual(
  channel: AnimationEffectChannel,
  left: EffectPointSnapshot,
  right: EffectPointSnapshot
): boolean {
  if (channel === "timeline") {
    return (
      JSON.stringify(effectiveTimelineScriptLines(left.script)) ===
      JSON.stringify(effectiveTimelineScriptLines(right.script))
    );
  }

  if (
    left.effect !== right.effect ||
    left.locator !== right.locator
  ) {
    return false;
  }

  if (channel === "sound") return true;

  return (
    left.bind_to_actor === right.bind_to_actor &&
    normalizeEffectiveParticleScript(left.script) ===
      normalizeEffectiveParticleScript(right.script)
  );
}

export function applyEffectPayload(
  channel: AnimationEffectChannel,
  current: EffectPointSnapshot,
  operation: AnimationEffectPayload
): EffectPointSnapshot {
  if (channel === "timeline") {
    return {
      ...current,
      ...(operation.script !== undefined
        ? { script: operation.script }
        : {}),
    };
  }

  const next = {
    ...current,
    ...(operation.effect !== undefined
      ? { effect: operation.effect }
      : {}),
    ...(operation.locator !== undefined
      ? { locator: operation.locator ?? "" }
      : {}),
  };

  if (channel === "particle") {
    if (operation.bind_to_actor !== undefined) {
      next.bind_to_actor = operation.bind_to_actor ?? true;
    }
    if (operation.pre_effect_script !== undefined) {
      next.script = operation.pre_effect_script ?? "";
    }
  }

  return next;
}

export function effectPointData(
  channel: AnimationEffectChannel,
  snapshot: EffectPointSnapshot
) {
  if (channel === "timeline") {
    return { script: snapshot.script };
  }

  if (channel === "sound") {
    return {
      effect: snapshot.effect,
      locator: snapshot.locator,
      ...(snapshot.file ? { file: snapshot.file } : {}),
    };
  }

  return {
    effect: snapshot.effect,
    locator: snapshot.locator,
    bind_to_actor: snapshot.bind_to_actor,
    script: snapshot.script,
    ...(snapshot.file ? { file: snapshot.file } : {}),
  };
}

export function animationEffectSameTime(
  left: number,
  right: number
): boolean {
  return Math.abs(left - right) < 0.001;
}

export function animationEffectContinuationState(
  channel: AnimationEffectChannel,
  keyframe: BBKeyframe,
  dataPointIndex: number | null
) {
  const point =
    dataPointIndex === null
      ? keyframe.data_points[0]
      : keyframe.data_points[dataPointIndex];

  const snapshot = point ? effectPointSnapshot(point) : null;

  return {
    channel,
    keyframe_uuid: keyframe.uuid,
    time: keyframe.time,
    data_point_index: dataPointIndex,
    ...(snapshot
      ? channel === "timeline"
        ? { script: snapshot.script }
        : channel === "sound"
          ? {
              effect: snapshot.effect,
              locator: snapshot.locator || null,
            }
          : {
              effect: snapshot.effect,
              preview_file: snapshot.file || null,
              locator: snapshot.locator || null,
              bind_to_actor:
                snapshot.bind_to_actor === false ? false : null,
              pre_effect_script:
                normalizeEffectiveParticleScript(snapshot.script),
            }
      : {}),
  };
}
