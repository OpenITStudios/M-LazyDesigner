import { describe, expect, test } from "bun:test";
import { getCapabilityMetadata } from "../lib/capabilities/metadata";
import { searchCapabilityCatalog } from "./capabilities/catalog";
import {
  decorateCapabilities,
  projectCapabilitiesForSearch,
} from "./control/capabilities";

const tool = (name: string, description = "") => ({
  name,
  description,
  annotations: {},
});

describe("canonical capability metadata", () => {
  test("preserves tier ownership outside Gateway", () => {
    expect(getCapabilityMetadata("manage_cubes").tier).toBe("primary");
    expect(getCapabilityMetadata("manage_geometry_reference").tier).toBe("support");
    expect(getCapabilityMetadata("risky_eval").tier).toBe("maintenance");
    expect(getCapabilityMetadata("unknown_future_tool").tier).toBe("support");
  });

  test("search consumes canonical aliases", () => {
    const results = searchCapabilityCatalog(
      [
        tool("manage_animation_controller", "Authors animation controllers."),
        tool("manage_cubes", "Authors cubes."),
      ],
      "state machine",
      4
    );

    expect(results[0]?.capability_id).toBe("manage_animation_controller");
  });

  test("AI search projection keeps capability hints bounded", () => {
    const projected = projectCapabilitiesForSearch(
      decorateCapabilities([
        {
          capability_id: "manage_cubes",
          description:
            "Create or update Bedrock cubes with explicit identity and many implementation details that should not all be repeated during capability discovery.",
          tier: "primary",
          read_only: false,
          destructive: true,
          idempotent: false,
        },
      ])
    );

    expect(projected).toHaveLength(1);
    expect(projected[0].capability_id).toBe("manage_cubes");
    expect(projected[0].hint?.length ?? 0).toBeLessThanOrEqual(96);
    expect(projected[0]).not.toHaveProperty("description");
  });

  test("AI-facing search preserves uncertain future prerequisites from compound routing", () => {
    const candidates = searchCapabilityCatalog([
      tool("manage_cubes", "Create and update cubes."),
      tool("manage_uv_layout", "Plan or apply UV layout."),
    ], "move cube then apply uv plan", 4, {
      authoringPhase: "geometry",
      facts: {
        project_bound: true,
        geometry_available: true,
        uv_plan_available: true,
      },
    });
    const projected = projectCapabilitiesForSearch(candidates);
    expect(projected).toHaveLength(2);
    expect(projected[0]?.capability_id).toBe("manage_cubes");
    expect(projected[1]).toMatchObject({
      capability_id: "manage_uv_layout",
      eligibility: "UNKNOWN",
      requires: ["uv_plan_available"],
      why: expect.stringContaining("verify receipt"),
      predecessor: {
        capability: "manage_uv_layout",
        branch: { field: "operation", value: "plan" },
      },
    });
  });

  test("declares affinity changes while transport refresh remains conservative", () => {
    const project = getCapabilityMetadata("create_project").effects;
    expect(project.projectAffinity).toBe("adopt_created_project");
    expect(project.phaseAffinity).toBe("preserve");
    expect(project.invalidateCatalog).toBe(true);

    const phase = getCapabilityMetadata("switch_authoring_phase").effects;
    expect(phase.projectAffinity).toBe("preserve");
    expect(phase.phaseAffinity).toBe("update_from_result");
    expect(phase.invalidateCatalog).toBe(true);

    const ordinary = getCapabilityMetadata("manage_cubes").effects;
    expect(ordinary.projectAffinity).toBe("preserve");
    expect(ordinary.phaseAffinity).toBe("preserve");
    expect(ordinary.invalidateCatalog).toBe(false);
  });
});
