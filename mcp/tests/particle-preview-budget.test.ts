import { describe, expect, test } from "bun:test";
import {
  createParticleDocument, applyParticleOperations, inspectParticleDocument,
} from "../lib/particle/document";

function withComponent(id: string, preset: "steady" | "burst", component: string, value: never) {
  return applyParticleOperations(createParticleDocument({ identifier: id, preset }),
    [{ op: "set_component", component, value }]);
}
describe("single-emitter authoring viewport workload (no FPS claims)", () => {
  test("small numeric emitter is cheap to inspect and leaves input unchanged", () => {
    const doc = createParticleDocument({ identifier: "test:small", preset: "steady" });
    const original = JSON.stringify(doc);
    expect(inspectParticleDocument(doc).preview_workload).toMatchObject({
      state: "within_budget", estimated_active_particles: 16,
      scope: "single_emitter_static_heuristic",
    });
    expect(JSON.stringify(doc)).toBe(original);
  });
  test("medium burst requires manual Play, huge burst refuses native preview", () => {
    const medium = withComponent("test:medium", "burst",
      "minecraft:emitter_rate_instant", { num_particles: 500 } as never);
    const huge = withComponent("test:huge", "burst",
      "minecraft:emitter_rate_instant", { num_particles: 1200 } as never);
    expect(inspectParticleDocument(medium).preview_workload).toMatchObject({
      state: "manual_only", estimated_active_particles: 500,
    });
    expect(inspectParticleDocument(huge).preview_workload).toMatchObject({
      state: "blocked", estimated_active_particles: 1200,
    });
  });
  test("high spawn rate remains a risk even when population has a low cap", () => {
    const medium = withComponent("test:rate", "steady",
      "minecraft:emitter_rate_steady", { spawn_rate: 1000, max_particles: 32 } as never);
    const huge = withComponent("test:rate_huge", "steady",
      "minecraft:emitter_rate_steady", { spawn_rate: 6000, max_particles: 32 } as never);
    expect(inspectParticleDocument(medium).preview_workload).toMatchObject({
      estimated_active_particles: 32, state: "manual_only",
    });
    expect(inspectParticleDocument(huge).preview_workload.state).toBe("blocked");
  });
  test("MoLang lifetime cannot be estimated from an unexecuted expression", () => {
    const doc = applyParticleOperations(createParticleDocument({ identifier: "test:dynamic" }), [
      { op: "patch",
        path: ["components", "minecraft:particle_lifetime_expression", "max_lifetime"],
        value: "variable.dynamic_lifetime" },
    ]);
    expect(inspectParticleDocument(doc).preview_workload).toMatchObject({
      state: "unestimated", estimated_active_particles: null,
    });
  });
  test("game review detects blended overdraw independently of preview admission", () => {
    const source = applyParticleOperations(createParticleDocument({
      identifier: "test:large_smoke", preset: "steady", material: "particles_blend",
    }), [
      { op: "patch", path: ["components", "minecraft:emitter_rate_steady", "spawn_rate"], value: 48 },
      { op: "patch", path: ["components", "minecraft:emitter_rate_steady", "max_particles"], value: 200 },
      { op: "patch", path: ["components", "minecraft:particle_lifetime_expression", "max_lifetime"], value: 3 },
      { op: "patch", path: ["components", "minecraft:particle_appearance_billboard", "size"], value: [1, 1] },
    ]);
    const original = JSON.stringify(source);
    const result = inspectParticleDocument(source);
    expect(result.preview_workload.state).toBe("within_budget");
    expect(result.game_cost).toMatchObject({
      state: "REVIEW_FACTORS", estimated_single_emitter_particles: 144,
      scope: "single_effect_source_only", device_fps_verified: false,
      visual_quality_verified: false, scene_concurrency_verified: false,
    });
    expect(result.game_cost.cost_drivers).toContain("translucent_billboard_overdraw_potential");
    expect(result.game_cost.cost_drivers).toContain("high_single_emitter_population");
    expect(JSON.stringify(source)).toBe(original);
  });

  test("game review identifies costly effects without auto-changing required visuals", () => {
    const source = applyParticleOperations(createParticleDocument({ identifier: "test:math" }), [
      { op: "set_component", component: "minecraft:particle_motion_collision",
        value: { enabled: true, collision_radius: 0.1 } },
      { op: "set_component", component: "minecraft:particle_initialization",
        value: { per_render_expression: "variable.a = math.sin(variable.particle_age);" } },
      { op: "set_component", component: "minecraft:particle_motion_parametric",
        value: { relative_position: [0, "variable.particle_age", 0] } },
      { op: "remove_component", component: "minecraft:particle_motion_dynamic" },
    ]);
    const drivers = inspectParticleDocument(source).game_cost.cost_drivers;
    expect(drivers).toContain("particle_collision_cost");
    expect(drivers).toContain("parametric_motion_update_cost");
    expect(drivers).toContain("render_expression_or_curve_cost");
  });

  test("game review refuses to treat unknown Molang counts as low game cost", () => {
    const dynamic = applyParticleOperations(createParticleDocument({
      identifier: "test:unknown", preset: "steady",
    }), [
      { op: "patch", path: ["components", "minecraft:emitter_rate_steady", "spawn_rate"],
        value: "variable.spawn_from_host" },
      { op: "patch", path: ["components", "minecraft:emitter_rate_steady", "max_particles"],
        value: "variable.cap_from_host" },
    ]);
    const review = inspectParticleDocument(dynamic).game_cost;
    expect(review.state).toBe("REVIEW_FACTORS");
    expect(review.estimated_single_emitter_particles).toBeNull();
    expect(review.cost_drivers).toContain("numeric_emission_unestimated");
    expect(review.cost_drivers).toContain("steady_cap_not_numeric");
    expect(review.device_fps_verified).toBe(false);
    expect(inspectParticleDocument(createParticleDocument({
      identifier: "test:ordinary",
    })).game_cost).toMatchObject({
      state: "NO_STATIC_RISKS_FLAGGED", device_fps_verified: false,
    });
  });

  test("short repeat loops estimate burst overlap and work rate rather than single count", () => {
    const doc = applyParticleOperations(createParticleDocument({
      identifier: "test:burst_overlap", preset: "burst",
    }), [
      { op: "set_component", component: "minecraft:emitter_lifetime_looping",
        value: { active_time: 0.1, sleep_time: 0 } },
      { op: "remove_component", component: "minecraft:emitter_lifetime_once" },
    ]);
    const result = inspectParticleDocument(doc);
    expect(result.preview_workload).toMatchObject({
      instant_burst_particles: 12,
      looped_burst_particles_per_second: 120,
      estimated_active_particles: 72,
      state: "within_budget",
    });
    expect(result.game_cost.cost_drivers).toContain("high_repeating_burst_rate");
    const uncertain = applyParticleOperations(doc, [
      { op: "patch", path: ["components", "minecraft:emitter_lifetime_looping", "active_time"],
        value: "variable.delay" },
    ]);
    expect(inspectParticleDocument(uncertain).preview_workload).toMatchObject({
      state: "manual_only", estimated_active_particles: null,
    });
    const invalid = applyParticleOperations(doc, [
      { op: "patch", path: ["components", "minecraft:emitter_lifetime_looping", "active_time"],
        value: 0 },
    ]);
    expect(inspectParticleDocument(invalid).preview_workload.state).toBe("blocked");
  });

  test("fast low-population loops still respect spawn-work budgets and remain finite", () => {
    const base = applyParticleOperations(createParticleDocument({
      identifier: "test:rapid_small", preset: "burst",
    }), [
      { op: "patch", path: ["components", "minecraft:emitter_rate_instant", "num_particles"],
        value: 1 },
      { op: "set_component", component: "minecraft:emitter_lifetime_looping",
        value: { active_time: 0.001, sleep_time: 0 } },
      { op: "remove_component", component: "minecraft:emitter_lifetime_once" },
      { op: "patch", path: ["components", "minecraft:particle_lifetime_expression", "max_lifetime"],
        value: 0.001 },
    ]);
    const manual = inspectParticleDocument(base).preview_workload;
    expect(manual).toMatchObject({
      estimated_active_particles: 1, looped_burst_particles_per_second: 1000,
      state: "manual_only",
    });
    const blocked = applyParticleOperations(base, [
      { op: "patch", path: ["components", "minecraft:emitter_lifetime_looping", "active_time"],
        value: 0.0001 },
    ]);
    expect(inspectParticleDocument(blocked).preview_workload.state).toBe("blocked");
    const hugeRange = applyParticleOperations(base, [
      { op: "patch", path: ["components", "minecraft:emitter_rate_instant", "num_particles"],
        value: 0 },
      { op: "patch", path: ["components", "minecraft:particle_lifetime_expression", "max_lifetime"],
        value: 1e308 },
      { op: "patch", path: ["components", "minecraft:emitter_lifetime_looping", "active_time"],
        value: 1e-308 },
    ]);
    const finite = inspectParticleDocument(hugeRange).preview_workload;
    expect(finite.estimated_active_particles).toBe(0);
    expect(finite.looped_burst_particles_per_second).toBe(0);
    expect(Number.isFinite(finite.estimated_active_particles)).toBe(true);
  });

  test("repeating bursts are game-cost risks even with a tiny per-burst population", () => {
    const source = applyParticleOperations(createParticleDocument({
      identifier: "test:loop_burst", preset: "burst",
    }), [
      { op: "set_component", component: "minecraft:emitter_lifetime_looping",
        value: { active_time: 0.1, sleep_time: 0 } },
      { op: "remove_component", component: "minecraft:emitter_lifetime_once" },
    ]);
    const prior = JSON.stringify(source);
    const summary = inspectParticleDocument(source);
    expect(summary.preview_workload.estimated_active_particles).toBe(72);
    expect(summary.game_cost.cost_drivers).toContain("repeating_burst_emission");
    expect(summary.game_cost.device_fps_verified).toBe(false);
    expect(JSON.stringify(source)).toBe(prior);
  });

  test("child fan-out risks follow triggering event names instead of unrelated components", () => {
    const root = createParticleDocument({ identifier: "test:event_owners", preset: "ambient" });
    const base = applyParticleOperations(root, [
      { op: "set_event", name: "emit_child", value: {
        particle_effect: { effect: "test:child", type: "emitter" },
      } },
      { op: "set_event", name: "harmless", value: { expression: "variable.a = 1;" } },
      { op: "set_component", component: "minecraft:emitter_lifetime_events",
        value: { creation_event: "emit_child" } },
      { op: "set_component", component: "minecraft:particle_lifetime_events",
        value: { creation_event: "harmless" } },
    ]);
    const first = inspectParticleDocument(base).game_cost.cost_drivers;
    expect(first).toContain("nested_effect_activation_cost");
    expect(first).toContain("repeating_emitter_child_events");
    expect(first).not.toContain("per_particle_nested_event_risk");

    const repeatPerParticle = applyParticleOperations(base, [
      { op: "patch", path: ["components", "minecraft:particle_lifetime_events", "creation_event"],
        value: "emit_child" },
    ]);
    expect(inspectParticleDocument(repeatPerParticle).game_cost.cost_drivers)
      .toContain("per_particle_nested_event_risk");

    const detachedEmitter = applyParticleOperations(base, [
      { op: "patch", path: ["components", "minecraft:emitter_lifetime_events", "creation_event"],
        value: "harmless" },
    ]);
    expect(inspectParticleDocument(detachedEmitter).game_cost.cost_drivers)
      .not.toContain("repeating_emitter_child_events");
  });

  test("nested effects require manual review and direct recursion blocks native preview", () => {
    const nested = (target: string) => applyParticleOperations(
      createParticleDocument({ identifier: "test:root", preset: "burst" }), [
        { op: "set_event", name: "child", value: {
          particle_effect: { effect: target, type: "emitter" },
        } },
        { op: "set_component", component: "minecraft:emitter_lifetime_events",
          value: { creation_event: "child" } },
      ]);
    expect(inspectParticleDocument(nested("test:child")).preview_workload.state)
      .toBe("manual_only");
    expect(inspectParticleDocument(nested("test:root")).preview_workload.state)
      .toBe("blocked");
  });
});
