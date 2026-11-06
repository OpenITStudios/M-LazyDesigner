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
