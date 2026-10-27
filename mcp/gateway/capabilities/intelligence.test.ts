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

  const authoringTools = [
    ...tools,
    tool("paint_texture_transaction", "Apply bounded pixel operations to a texture."),
    tool("paint_with_brush", "Paint texture with a brush."),
    tool("modify_group", "Move or rotate a group."),
  ];

  test.each([
    ["warnai tekstur", "paint_texture_transaction", undefined],
    ["Tolong warnai tekstur ini", "paint_texture_transaction", undefined],
    ["pindahkan grup ke induk", "reparent_element", undefined],
    ["buat kubus", "manage_cubes", "create"],
    ["pindahkan kubus", "manage_cubes", "update"],
  ] as const)("routes Indonesian intent %s without confusing painting, parenting and transforms", (query, capability, operation) => {
    const [result] = searchCapabilityCatalog(authoringTools, query, 2, {
      authoringPhase: "geometry",
      facts: { project_bound: false },
    });
    expect(result?.capability_id).toBe(capability);
    if (operation) expect(result?.branch).toEqual({ field: "operation", value: operation });
    if (capability === "paint_texture_transaction" || capability === "manage_cubes") {
      expect(result?.eligibility).toBe("BLOCKED");
      expect(result?.requires).toContain("project_bound");
    }
  });

  test.each(["cuaca hari ini", "transfer rekening bank"])("unrelated Indonesian intent %s does not invent an authoring route", query => {
    expect(searchCapabilityCatalog(authoringTools, query, 2, { authoringPhase: "geometry" })).toEqual([]);
  });

  test.each([
    "manage_uv_layout",
    "manage uv layout",
    "uv layout",
    "rapikan uv",
    "plan uv layout",
    "pack uv islands without overlap",
  ])("does not substitute a missing declared UV capability for %s", (query) => {
    const activeCatalog = authoringTools.filter(
      (candidate) => candidate.name !== "manage_uv_layout"
    );
    expect(searchCapabilityCatalog(activeCatalog, query, 4, {
      authoringPhase: "geometry",
      facts: { project_bound: true, geometry_available: true },
    })).toEqual([]);
  });

  test("declines a weak lexical substitute for an absent declared intent", () => {
    const misleading = [
      tool("list_textures", "Inspect UV atlas and island metadata."),
      tool("manage_cubes", "Create and update geometry cubes."),
    ];
    expect(searchCapabilityCatalog(misleading, "pack uv islands", 4))
      .toEqual([]);
  });

  test("limits substitutes to registered alternatives that advertise the operation", () => {
    const alternative = tool(
      "available_uv_packer", "Pack UV islands into an atlas."
    );
    const distractor = tool(
      "list_textures", "Inspect UV atlas islands and texture layout."
    );
    const results = searchCapabilityCatalog(
      [alternative, distractor], "pack uv islands", 4
    );
    expect(results.map((match) => match.capability_id))
      .toEqual(["available_uv_packer"]);
  });

  test("allows natural-language legacy names to find registered consolidated tools", () => {
    const active = [
      tool("manage_animation_timeline", "Manage animation timeline data."),
      tool("modify_group", "Modify a group transform."),
    ];
    expect(searchCapabilityCatalog(active, "animation timeline", 4)
      .map((match) => match.capability_id))
      .toEqual(["manage_animation_timeline"]);
    // Exact API identifiers are still authoritative, not aliases.
    expect(searchCapabilityCatalog(active, "animation_timeline", 4))
      .toEqual([]);
  });

  test("rejects read-only descriptions as substitutes for unavailable UV mutations", () => {
    const inspector: BackendTool = {
      ...tool("inspect_uv", "Apply UV plan for diagnostic preview."),
      annotations: { readOnlyHint: true },
    };
    expect(searchCapabilityCatalog([inspector], "apply uv plan", 4))
      .toEqual([]);
    const native = tool("manage_uv_layout", "Apply native UV plans.");
    expect(searchCapabilityCatalog([native, inspector], "apply uv plan", 4)[0])
      .toMatchObject({
        capability_id: "manage_uv_layout",
        branch: { field: "operation", value: "apply" },
      });
  });

  test("retains available intent, prerequisite evidence, and exact-name discovery", () => {
    const activeCatalog = authoringTools.filter(
      (candidate) => candidate.name !== "manage_uv_layout"
    );
    const [painting] = searchCapabilityCatalog(activeCatalog, "warnai tekstur", 4, {
      authoringPhase: "texturing", facts: { project_bound: false },
    });
    expect(painting).toMatchObject({
      capability_id: "paint_texture_transaction",
      eligibility: "BLOCKED",
      requires: ["project_bound"],
    });
    expect(searchCapabilityCatalog(authoringTools, "manage_uv_layout", 4))
      .toMatchObject([{ capability_id: "manage_uv_layout" }]);
    expect(searchCapabilityCatalog(activeCatalog, "texture", 4).length)
      .toBeGreaterThan(0);
    expect(searchCapabilityCatalog([
      tool("future_extension", "Custom third-party function."),
    ], "future_extension", 4)[0]?.capability_id).toBe("future_extension");
  });

  test("does not route an absent exact-only legacy name", () => {
    expect(searchCapabilityCatalog(authoringTools, "apply_texture", 4))
      .toEqual([]);
  });

  test.each([
    ["create a cube", "create"],
    ["move the cube", "update"],
    ["resize cube", "update"],
    ["simplify geometry", "simplify"],
  ] as const)("uses the declared action to choose %s without guessing", (query, branch) => {
    const [result] = searchCapabilityCatalog(
      [tool("manage_cubes", "Create and update cubes.")],
      query, 4, { authoringPhase: "geometry" }
    );
    expect(result).toMatchObject({
      capability_id: "manage_cubes",
      branch: { field: "operation", value: branch },
    });
  });

  test("does not invent branch operations from a shared object noun", () => {
    const [cube] = searchCapabilityCatalog(
      [tool("manage_cubes", "Create and update cubes.")],
      "cube", 4, { authoringPhase: "geometry" }
    );
    const [uv] = searchCapabilityCatalog(
      [tool("manage_uv_layout", "Plan or apply UV layout.")],
      "uv", 4, { authoringPhase: "geometry" }
    );
    expect(cube?.capability_id).toBe("manage_cubes");
    expect(cube?.branch).toBeUndefined();
    expect(uv?.capability_id).toBe("manage_uv_layout");
    expect(uv?.branch).toBeUndefined();
  });

  test("accepts a complete manifest intent even when its verb is not separately listed", () => {
    const [result] = searchCapabilityCatalog(
      [tool("manage_uv_layout", "Plan or apply UV layout.")],
      "set texel density", 4, { authoringPhase: "geometry" }
    );
    expect(result?.branch).toEqual({ field: "operation", value: "plan" });
  });

  test.each(["remove cube", "delete cube", "hapus kubus", "hapus grup"])(
    "prefers an element remover over Cube updates for %s", (query) => {
      const [result] = searchCapabilityCatalog([
        ...authoringTools,
        tool("remove_element", "Remove a model element."),
      ], query, 4, { authoringPhase: "geometry" });
      expect(result?.capability_id).toBe("remove_element");
      expect(result?.branch).toBeUndefined();
    }
  );

  test.each(["delete cube", "hapus kubus", "hapus grup"])(
    "does not substitute create/update for unavailable deletion %s", (query) => {
      expect(searchCapabilityCatalog(authoringTools, query, 4, {
        authoringPhase: "geometry",
      })).toEqual([]);
    }
  );

  test("will not select a read-only fake element deletion capability", () => {
    const inspector: BackendTool = {
      ...tool("inspect_remove_element", "Remove cube diagnostic guidance."),
      annotations: { readOnlyHint: true },
    };
    expect(searchCapabilityCatalog([
      inspector, tool("manage_cubes", "Create cubes."),
    ], "delete cube", 4, { authoringPhase: "geometry" })).toEqual([]);
  });

  test("allows an available extension that explicitly advertises Cube deletion", () => {
    const [result] = searchCapabilityCatalog([
      tool("vendor_remove_cube", "Remove model cubes safely."),
    ], "hapus kubus", 4, { authoringPhase: "geometry" });
    expect(result?.capability_id).toBe("vendor_remove_cube");
  });

  test.each([
    ["create cube then move it", "manage_cubes"],
    ["buat kubus lalu pindahkan", "manage_cubes"],
    ["plan uv layout then apply it", "manage_uv_layout"],
  ] as const)("does not misrepresent separate operations as one %s hint", (query, capability) => {
    const [result] = searchCapabilityCatalog(
      tools, query, 4, { authoringPhase: "geometry" }
    );
    expect(result?.capability_id).toBe(capability);
    expect(result?.branch).toBeUndefined();
    expect(result?.why).toBe("multiple operations; route each step separately");
  });

  test.each([
    ["move cube and resize it", "update"],
    ["create cube and group", "create"],
  ] as const)("retains one branch for a single actionable operation %s", (query, operation) => {
    const [result] = searchCapabilityCatalog(
      [tool("manage_cubes", "Create or update cubes.")],
      query, 4, { authoringPhase: "geometry" }
    );
    expect(result?.capability_id).toBe("manage_cubes");
    expect(result?.branch).toEqual({ field: "operation", value: operation });
  });

  test("retains existing explicit correction semantics without treating make as two steps", () => {
    const [result] = searchCapabilityCatalog(
      [tool("manage_cubes", "Create and update cubes.")],
      "make the chair leg taller", 4, { authoringPhase: "geometry" }
    );
    expect(result?.branch).toEqual({ field: "operation", value: "update" });
  });

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

  test("relevance-first ranking preserves READY, UNKNOWN and BLOCKED evidence", () => {
    const probe = (geometry_available: true | false | "unknown") =>
      searchCapabilityCatalog(
        [...tools, tool("emulate_clicks", "make the chair leg taller")],
        "make the chair leg taller",
        4,
        { authoringPhase: "geometry", facts: { project_bound: true, geometry_available } }
      );
    const ready = probe(true);
    const unknown = probe("unknown");
    const blocked = probe(false);
    for (const results of [ready, unknown, blocked]) {
      expect(results[0]?.capability_id).toBe("manage_cubes");
      expect(results[0]?.branch).toEqual({ field: "operation", value: "update" });
      // A lexically relevant maintenance candidate may follow native intent;
      // its tier must not change and it must never displace the authoring route.
      expect(results.findIndex(result => result.capability_id === "emulate_clicks"))
        .toBeGreaterThan(0);
      expect(results.find(result => result.capability_id === "emulate_clicks")?.tier)
        .toBe("maintenance");
    }
    expect(ready[0]?.eligibility).toBeUndefined();
    expect(unknown[0]).toMatchObject({
      eligibility: "UNKNOWN", requires: ["geometry_available"],
    });
    expect(blocked[0]).toMatchObject({
      eligibility: "BLOCKED", requires: ["geometry_available"],
    });
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
