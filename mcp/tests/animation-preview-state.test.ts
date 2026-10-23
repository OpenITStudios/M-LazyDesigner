import { describe, expect, test } from "bun:test";
import { analyzeGeometryPoseSequence } from "@/lib/geometrySurfaceEvidence";
import {
  withTemporaryAnimationPreview,
  captureTemporaryAnimationPoseSequence,
  type AnimationPreviewPort,
} from "@/lib/animationPreviewState";

type FixtureAnimation = {
  name: string;
  selected?: boolean;
  playing?: boolean;
};

function fixture(previousPlaying = true) {
  const idle: FixtureAnimation = {
    name: "idle",
    selected: true,
    playing: previousPlaying,
  };
  const walk: FixtureAnimation = {
    name: "walk",
    selected: false,
    playing: false,
  };
  let selected: FixtureAnimation | null = idle;
  let previewCalls = 0;
  let defaultPoseCalls = 0;
  let effectsSuspended = false;

  const timeline = {
    time: 4,
    playing: true as boolean | undefined,
    setTime(value: number) {
      this.time = value;
    },
  };

  const port: AnimationPreviewPort<FixtureAnimation> = {
    animations: [idle, walk],
    timeline,
    getSelectedAnimation() {
      return selected;
    },
    setSelectedAnimation(animation) {
      selected = animation;
    },
    preview() {
      previewCalls += 1;
    },
    showDefaultPose() {
      defaultPoseCalls += 1;
    },
    suspendEffects() {
      effectsSuspended = true;
      return () => {
        effectsSuspended = false;
      };
    },
  };

  return {
    idle,
    walk,
    timeline,
    port,
    selected: () => selected,
    previewCalls: () => previewCalls,
    defaultPoseCalls: () => defaultPoseCalls,
    effectsSuspended: () => effectsSuspended,
  };
}

describe("temporary animation preview state", () => {
  test("poses one animation only inside observation and restores prior playing state", async () => {
    const state = fixture(true);

    const observed = await withTemporaryAnimationPreview(
      state.port,
      state.walk,
      0.75,
      () => ({
        selected: state.selected()?.name,
        idleSelected: state.idle.selected,
        idlePlaying: state.idle.playing,
        walkSelected: state.walk.selected,
        walkPlaying: state.walk.playing,
        time: state.timeline.time,
        timelinePlaying: state.timeline.playing,
        effectsSuspended: state.effectsSuspended(),
      })
    );

    expect(observed).toEqual({
      selected: "walk",
      idleSelected: false,
      idlePlaying: false,
      walkSelected: true,
      walkPlaying: true,
      time: 0.75,
      timelinePlaying: false,
      effectsSuspended: true,
    });

    expect(state.selected()).toBe(state.idle);
    expect(state.idle.selected).toBe(true);
    expect(state.idle.playing).toBe(true);
    expect(state.walk.selected).toBe(false);
    expect(state.walk.playing).toBe(false);
    expect(state.timeline.time).toBe(4);
    expect(state.timeline.playing).toBe(true);
    expect(state.effectsSuspended()).toBe(false);
    expect(state.previewCalls()).toBe(2);
    expect(state.defaultPoseCalls()).toBe(0);
  });

  test("restores state when observation throws", async () => {
    const state = fixture(true);

    await expect(
      withTemporaryAnimationPreview(
        state.port,
        state.walk,
        1.25,
        () => {
          throw new Error("capture failed");
        }
      )
    ).rejects.toThrow("capture failed");

    expect(state.selected()).toBe(state.idle);
    expect(state.idle.selected).toBe(true);
    expect(state.idle.playing).toBe(true);
    expect(state.walk.selected).toBe(false);
    expect(state.walk.playing).toBe(false);
    expect(state.timeline.time).toBe(4);
    expect(state.timeline.playing).toBe(true);
    expect(state.effectsSuspended()).toBe(false);
  });

  test("restores default pose when no animation was previously playing", async () => {
    const state = fixture(false);

    await withTemporaryAnimationPreview(
      state.port,
      state.walk,
      0.5,
      () => "captured"
    );

    expect(state.previewCalls()).toBe(1);
    expect(state.defaultPoseCalls()).toBe(1);
    expect(state.idle.playing).toBe(false);
    expect(state.walk.playing).toBe(false);
  });

  test("bounded geometry pose samples restore animation flags and timeline between reads", async () => {
    const state = fixture(true);
    const liveValue = { center: [0, 0, 0] };
    const results = await captureTemporaryAnimationPoseSequence(
      state.port, state.walk, 1, [0, 0.5, 1], (time) => {
        liveValue.center[0] = time * 10;
        expect(state.timeline.time).toBe(time);
        expect(state.effectsSuspended()).toBe(true);
        expect(state.selected()).toBe(state.walk);
        return liveValue;
      }
    );
    expect(results).toEqual([
      { time_seconds: 0, value: { center: [0, 0, 0] } },
      { time_seconds: 0.5, value: { center: [5, 0, 0] } },
      { time_seconds: 1, value: { center: [10, 0, 0] } },
    ]);
    expect(state.timeline.time).toBe(4);
    expect(state.selected()).toBe(state.idle);
    expect(state.idle.playing).toBe(true);
    expect(state.walk.playing).toBe(false);
    expect(state.effectsSuspended()).toBe(false);
  });

  test("temporary pose observations feed the existing Geometry multi-pose comparator", async () => {
    const state = fixture(true);
    const cube = (uuid: string, center: [number, number, number],
      halfSizes: [number, number, number]) => ({
      uuid, name: uuid, parent_id: "body",
      obb: {
        center, halfSizes,
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [
          [number, number, number],
          [number, number, number],
          [number, number, number],
        ],
      },
    });
    const frames = await captureTemporaryAnimationPoseSequence(
      state.port, state.walk, 1, [0, 1], (time) => ({
        project_uuid: "sample", animation_uuid: "walk",
        time_seconds: time,
        cubes: [
          cube("body", [0, 0, 0], [5, 5, 5]),
          cube("detail", [time * 6, 0, 0], [1, 1, 1]),
        ],
      })
    );
    const report = analyzeGeometryPoseSequence(
      frames.map((frame) => frame.value),
      { target_cube_ids: ["detail"],
        sampling_window: { start: 0, end: 1, max_gap_seconds: 1 } }
    );
    expect(report.pose_dependent_retain_count).toBe(1);
    expect(report.geometry_mutation_authorized).toBe(false);
    expect(state.timeline.time).toBe(4);
    expect(state.selected()).toBe(state.idle);
    expect(state.effectsSuspended()).toBe(false);
  });

  test("temporary pose sequence fails on mid-sample error and restores prior UI state", async () => {
    const state = fixture(true);
    await expect(captureTemporaryAnimationPoseSequence(
      state.port, state.walk, 1, [0, 0.5, 1], (time) => {
        if (time === 0.5) throw new Error("frame unavailable");
        return { pose: time };
      }
    )).rejects.toThrow("frame unavailable");
    expect(state.timeline.time).toBe(4);
    expect(state.selected()).toBe(state.idle);
    expect(state.effectsSuspended()).toBe(false);
    const untouched = fixture(true);
    await expect(captureTemporaryAnimationPoseSequence(
      untouched.port, untouched.walk, 1, [0, 0.5, 0.5],
      () => "never"
    )).rejects.toThrow("strictly ascending");
    expect(untouched.previewCalls()).toBe(0);
    expect(untouched.timeline.time).toBe(4);
  });

  test("rejects invalid time or foreign target before changing state", async () => {
    const state = fixture(true);
    const foreign: FixtureAnimation = { name: "foreign" };

    await expect(
      withTemporaryAnimationPreview(
        state.port,
        state.walk,
        Number.NaN,
        () => "never"
      )
    ).rejects.toThrow();

    await expect(
      withTemporaryAnimationPreview(
        state.port,
        foreign,
        0,
        () => "never"
      )
    ).rejects.toThrow();

    expect(state.selected()).toBe(state.idle);
    expect(state.timeline.time).toBe(4);
    expect(state.previewCalls()).toBe(0);
    expect(state.effectsSuspended()).toBe(false);
  });
});
