import { describe, expect, test } from "bun:test";
import { searchCapabilityCatalog } from "./catalog";
import {
  bestSemanticMatchForTool,
  bm25CapabilityScores,
  capabilityQueryTokens,
  semanticMatchesForTool,
} from "./intelligence";
import type { BackendTool } from "../contracts/protocol";

const tool = (name: string, description = ""): BackendTool => ({
  name,
  description,
  annotations: {},
});

describe("capability intelligence routing", () => {
  const tools = [
    tool("manage_cubes", "Create and update Bedrock cubes."),
    tool("reparent_element", "Move an element to another parent."),
    tool("manage_uv_layout", "Plan or apply UV layout."),
    tool("gradient_tool", "Apply a texture gradient."),
    tool("manage_animation_timeline", "Manage animation timeline data."),
  ];

  test("shared scoring retains branch order and Stage evidence for IK", () => {
    const ikTool = tool("bone_rigging", "Advanced IK and bone mirroring.");
    const active = semanticMatchesForTool(
      ikTool, "set ik target", { authoringPhase: "geometry" }
    );
    const foreign = semanticMatchesForTool(
      ikTool, "set ik target", { authoringPhase: "animation" }
    );
    expect(active.map((match) => match.branch?.value)).toEqual([
      "set_ik", "set_ik_controller", "mirror",
    ]);
    expect(active[0]?.matched).toBe(true);
    expect(active[0]?.score).toBeGreaterThan(foreign[0]?.score ?? 0);
    expect(active[0]?.reason).toContain("active phase");
    expect(active.map((match) => match.branch)).toEqual(
      foreign.map((match) => match.branch)
    );
  });

  test("prepared query tokens preserve direct semantic and BM25 results", () => {
    const query = "move this cube under another bone";
    const prepared = capabilityQueryTokens(query);
    for (const candidate of tools) {
      const direct = semanticMatchesForTool(candidate, query, {
        authoringPhase: "geometry",
      });
      const shared = semanticMatchesForTool(candidate, query, {
        authoringPhase: "geometry",
      }, prepared);
      expect(shared).toEqual(direct);
      expect(bestSemanticMatchForTool(candidate, query, {
        authoringPhase: "geometry",
      }, prepared)).toEqual(bestSemanticMatchForTool(candidate, query, {
        authoringPhase: "geometry",
      }));
    }
    expect([...bm25CapabilityScores(tools, query, prepared)])
      .toEqual([...bm25CapabilityScores(tools, query)]);
    expect(semanticMatchesForTool(
      tool("foreign_unsupported_tool", "no authoring intents"), query,
      undefined, prepared
    )).toEqual(semanticMatchesForTool(
      tool("foreign_unsupported_tool", "no authoring intents"), query
    ));
  });

  test("selects semantic operation branches without loading schemas", () => {
    const [result] = searchCapabilityCatalog(
      tools,
      "make the chair leg taller",
      4,
      { authoringPhase: "geometry" }
    );

    expect(result?.capability_id).toBe("manage_cubes");
    expect(result?.branch).toEqual({ field: "operation", value: "update" });
    expect(result?.why).toContain("action");
  });

  test("distinguishes hierarchy changes from transform mutations", () => {
    const [result] = searchCapabilityCatalog(
      tools,
      "move this cube under another bone",
      4,
      { authoringPhase: "geometry" }
    );

    expect(result?.capability_id).toBe("reparent_element");
  });

  test("selects UV planning branch for layout intent", () => {
    const [result] = searchCapabilityCatalog(
      tools,
      "pack uv islands without overlap",
      4,
      { authoringPhase: "texturing" }
    );

    expect(result?.capability_id).toBe("manage_uv_layout");
    expect(result?.branch).toEqual({ field: "operation", value: "plan" });
  });

  test("uses active phase as a ranking prior rather than a hard filter", () => {
    const results = searchCapabilityCatalog(
      tools,
      "edit timeline keyframe",
      4,
      { authoringPhase: "animation" }
    );

    expect(results[0]?.capability_id).toBe("manage_animation_timeline");
  });

  test("keeps exact capability lookup branch-free and deterministic", () => {
    const [result] = searchCapabilityCatalog(
      tools,
      "manage_cubes",
      4,
      { authoringPhase: "texturing" }
    );

    expect(result?.capability_id).toBe("manage_cubes");
    expect(result?.branch).toBeUndefined();
    expect(result?.why).toBeUndefined();
  });
});
