import { describe, expect, test } from "bun:test";
import { GatewaySessionState } from "./state";

describe("Gateway Runtime-generation session recovery", () => {
  test("verified same-project reconnect retains only the proven binding fact", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-a");
    session.replaceFacts({
      ...session.facts,
      geometry_available: true,
      texture_available: true,
      uv_layout_current: true,
      animation_available: true,
    });
    session.controlExecutionState = { revision: 41 } as never;

    session.onRuntimeGenerationChange("project-a");

    expect(session.projectUuid).toBe("project-a");
    expect(session.facts).toEqual({ project_bound: true });
    expect(session.controlExecutionState).toBeNull();
  });

  test("replacement Runtime's different verified project replaces old Control binding", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-old");
    session.replaceFacts({ ...session.facts, geometry_available: true });

    session.onRuntimeGenerationChange("project-new");

    expect(session.projectUuid).toBe("project-new");
    expect(session.facts).toEqual({ project_bound: true });
    expect(session.facts.geometry_available).toBeUndefined();
  });

  test("lost or unbound project is not treated as verified after reload", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-closed");
    session.replaceFacts({ ...session.facts, animation_available: true });

    session.onRuntimeGenerationChange(null);

    expect(session.projectUuid).toBeNull();
    expect(session.facts).toEqual({ project_bound: "unknown" });
    expect(session.facts.animation_available).toBeUndefined();
  });

  test("subsequent bound status preserves fresh Runtime facts without repeating project reset", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("project-a");
    session.onRuntimeGenerationChange("project-a");
    session.replaceFacts({ ...session.facts, geometry_available: true });

    session.synchronizeProject("project-a");

    expect(session.facts).toEqual({
      project_bound: true,
      geometry_available: true,
    });
  });
});
