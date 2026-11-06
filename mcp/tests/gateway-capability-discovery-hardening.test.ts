import { describe, expect, test } from "bun:test";
import { projectCapabilitiesForSearch } from "@/gateway/control/capabilities";
import { gatewaySearchSuccessOutputSchema } from "@/gateway/contracts/outputSchemas";
import {
  classifyCapabilityTier,
  searchCapabilityCatalog,
  type BackendTool,
} from "@/gateway/contract";

describe("BlockIT Gateway capability discovery hardening", () => {
  const tools: BackendTool[] = [
    {
      name: "manage_cubes",
      description: "Create and update Bedrock geometry cubes.",
    },
    {
      name: "create_brush_preset",
      description: "Create a reusable texture brush preset.",
    },
    {
      name: "emulate_clicks",
      description: "Emulate Blockbench UI clicks for maintenance.",
    },
  ];

  test("unrelated developer-console intent is not promoted by generic action metadata", () => {
    const accidentalMatch: BackendTool[] = [
      { name: "manage_cubes", description: "Create and update Bedrock geometry cubes; return action receipts." },
      { name: "create_brush_preset", description: "Apply a texture brush action." },
    ];
    expect(searchCapabilityCatalog(accidentalMatch, "developer tools console action", 4))
      .toEqual([]);
    expect(searchCapabilityCatalog(accidentalMatch, "tools and actions", 4))
      .toEqual([]);
  });

  test("short Bedrock and Blockbench terms remain searchable without inventing capabilities", () => {
    const cases: readonly [string, BackendTool][] = [
      ["UV", { name: "uv_fixture", description: "Inspect UV mapping." }],
      ["IK", { name: "ik_fixture", description: "Inspect IK targets." }],
      ["3D", { name: "three_dimensional_fixture", description: "Inspect 3D model views." }],
      ["UI", { name: "interface_fixture", description: "Inspect UI state." }],
      ["FX", { name: "effects_fixture", description: "Inspect FX channel." }],
    ];
    for (const [query, tool] of cases) {
      expect(searchCapabilityCatalog([tool], query, 4).map((item) => item.capability_id), query)
        .toContain(tool.name);
      expect(searchCapabilityCatalog([tool], `tolong cari tools untuk ${query}`, 4)
        .map((item) => item.capability_id), query)
        .toContain(tool.name);
    }
    // An unsupported query must still return no candidate, not a fabricated tool.
    expect(searchCapabilityCatalog([
      { name: "manage_cubes", description: "Create a Bedrock cube." },
    ], "FX", 4)).toEqual([]);
  });

  test("semantic authoring examples survive generic-word filtering", () => {
    // The semantic example 'make four table legs' is not in the tool's
    // description or name. A keyword-only filter incorrectly loses this route.
    const result = searchCapabilityCatalog(tools, "make four table legs", 4);
    expect(result.map((entry) => entry.capability_id)).toContain("manage_cubes");
    expect(searchCapabilityCatalog(tools, "tool to create geometry cubes", 4)
      .map((entry) => entry.capability_id)).toContain("manage_cubes");
  });

  test("no-result discovery is not presented as Runtime failure or a suggested UI fallback", async () => {
    const source = await Bun.file("gateway/handlers/registerCoreTools.ts").text();
    expect(source).toContain("No relevant capability found.");
    expect(source).toContain("structuredContent: { capabilities }");
  });

  test("specific alias, exact name and real authoring intent remain discoverable", () => {
    expect(searchCapabilityCatalog(tools, "manage_cubes", 5))
      .toHaveLength(1);
    expect(searchCapabilityCatalog(tools, "buat kubus baru untuk badan model", 5)
      .map((entry) => entry.capability_id)).toContain("manage_cubes");
    expect(searchCapabilityCatalog(tools, "create geometry cubes", 5)
      .map((entry) => entry.capability_id)).toContain("manage_cubes");
  });

  test("search projection never implies READY for an unresolved operation branch", () => {
    // This is a registered capability. The exact-name catalog result has no
    // operation discriminator, while the manifest has branch-specific facts.
    const [exact] = searchCapabilityCatalog(tools, "manage_cubes", 5);
    expect(exact).toBeDefined();
    const [unresolved] = projectCapabilitiesForSearch([exact!]);
    expect(unresolved?.capability_id).toBe("manage_cubes");
    expect(unresolved?.eligibility).toBe("UNKNOWN");
    expect(unresolved?.why).toContain("use a known operation directly");
    expect(unresolved?.why).toContain("when its schema is unknown");
    expect(gatewaySearchSuccessOutputSchema.safeParse({
      capabilities: [unresolved],
    }).success).toBe(true);

    // Unsupported explicit branches are not promoted by branchless fallback.
    const [unknown] = projectCapabilitiesForSearch([{
      ...exact!,
      branch: { field: "operation", value: "future_unsupported" },
      eligibility: "READY",
    }]);
    expect(unknown?.eligibility).toBe("UNKNOWN");
    expect(unknown?.branch).toEqual({
      field: "operation",
      value: "future_unsupported",
    });

    // A known selected operation remains focused and does not need a
    // redundant UNKNOWN banner when its existing graph says READY.
    const [known] = projectCapabilitiesForSearch([{
      ...exact!,
      branch: { field: "operation", value: "create" },
      eligibility: "READY",
    }]);
    expect(known?.eligibility).toBeUndefined();
    expect(known?.why).toBeUndefined();

    // An authoritative blocked condition cannot be softened by projection.
    const [blocked] = projectCapabilitiesForSearch([{
      ...exact!,
      eligibility: "BLOCKED",
      requires: ["project_bound"],
    }]);
    expect(blocked?.eligibility).toBe("BLOCKED");
    expect(blocked?.requires).toEqual(["project_bound"]);

    // A capability with no branch-qualified graph stays unchanged.
    const [plain] = projectCapabilitiesForSearch([{
      capability_id: "get_project_info",
      description: "Inspect the project.",
      tier: "support",
      read_only: true,
      destructive: false,
      idempotent: true,
      eligibility: "READY",
    }]);
    expect(plain?.eligibility).toBeUndefined();
  });

  test("branchless Animation fallback does not certify an unselected operation", () => {
    // The timeline has both explicit operation graphs and a generic
    // branchless graph. Exact-name search still has no selected operation.
    const [exact] = searchCapabilityCatalog([
      { name: "manage_animation_timeline",
        description: "Edit animation timeline and keyframes." },
    ], "manage_animation_timeline", 4);
    expect(exact).toBeDefined();
    expect(exact?.branch).toBeUndefined();
    const [unselected] = projectCapabilitiesForSearch([exact!]);
    expect(unselected?.eligibility).toBe("UNKNOWN");
    expect(unselected?.why).toContain("use a known operation directly");
    expect(gatewaySearchSuccessOutputSchema.safeParse({
      capabilities: [unselected],
    }).success).toBe(true);

    // A manifest-known operation is not masked by the search safeguard.
    const [selected] = projectCapabilitiesForSearch([{
      ...exact!, branch: { field: "operation", value: "keyframes" },
      eligibility: "READY",
    }]);
    expect(selected?.eligibility).toBeUndefined();
    expect(selected?.why).toBeUndefined();

    // Branchless fallback also cannot validate a fabricated operation.
    const [unsupported] = projectCapabilitiesForSearch([{
      ...exact!, branch: { field: "operation", value: "future_nonexistent" },
      eligibility: "READY",
    }]);
    expect(unsupported?.eligibility).toBe("UNKNOWN");
    expect(unsupported?.operation_class).toBe("UNKNOWN");
    const [borrowedBlock] = projectCapabilitiesForSearch([{
      ...exact!, branch: { field: "operation", value: "future_nonexistent" },
      eligibility: "BLOCKED", requires: ["animation_available"],
      predecessor: { capability: "create_animation" },
    }]);
    expect(borrowedBlock?.eligibility).toBe("UNKNOWN");
    expect(borrowedBlock?.requires).toBeUndefined();
    expect(borrowedBlock?.predecessor).toBeUndefined();

    // A known failed prerequisite remains BLOCKED, never downgraded.
    const [blocked] = projectCapabilitiesForSearch([{
      ...exact!, eligibility: "BLOCKED", requires: ["animation_available"],
    }]);
    expect(blocked?.eligibility).toBe("BLOCKED");
    expect(blocked?.requires).toEqual(["animation_available"]);

    // Branch-independent graph tools retain their existing presentation.
    const [independent] = projectCapabilitiesForSearch([{
      capability_id: "create_animation", description: "Create animation.",
      tier: "primary", read_only: false, destructive: false, idempotent: false,
      eligibility: "READY",
    }]);
    expect(independent?.eligibility).toBeUndefined();
  });
  test("unsupported explicit branches without graph prerequisites remain UNKNOWN", () => {
    // Material-instance branches are canonical semantic operations but
    // intentionally have no dependency graphs. An invented operation is
    // not silently validated by a branchless metadata fallback.
    const base = {
      capability_id: "manage_material_instances",
      description: "Inspect or set material instances.",
      tier: "primary" as const,
      read_only: false, destructive: false, idempotent: false,
    };
    const [unsupported] = projectCapabilitiesForSearch([{
      ...base, branch: { field: "operation", value: "future_unsupported" },
      eligibility: "READY",
    }]);
    expect(unsupported?.eligibility).toBe("UNKNOWN");
    expect(unsupported?.why).toContain("verify the Runtime schema");
    expect(gatewaySearchSuccessOutputSchema.safeParse({
      capabilities: [unsupported],
    }).success).toBe(true);

    // Known branch semantics and confirmed negative evidence survive.
    const [known] = projectCapabilitiesForSearch([{
      ...base, branch: { field: "operation", value: "list" },
      eligibility: "READY",
    }]);
    expect(known?.eligibility).toBeUndefined();
    // Unsupported identities must not borrow false Graph prerequisites.
    const [unrecognized] = projectCapabilitiesForSearch([{
      ...base, branch: { field: "operation", value: "future_unsupported" },
      eligibility: "BLOCKED", requires: ["project_bound"],
      predecessor: { capability: "create_project" },
    }]);
    expect(unrecognized?.eligibility).toBe("UNKNOWN");
    expect(unrecognized?.requires).toBeUndefined();
    expect(unrecognized?.predecessor).toBeUndefined();
    expect(unrecognized?.operation_class).toBe("UNKNOWN");
    expect(gatewaySearchSuccessOutputSchema.safeParse({
      capabilities: [unrecognized],
    }).success).toBe(true);

    // Proven missing prerequisites for an exact valid branch still block.
    const [blocked] = projectCapabilitiesForSearch([{
      ...base, branch: { field: "operation", value: "set" },
      eligibility: "BLOCKED", requires: ["project_bound"],
    }]);
    expect(blocked?.eligibility).toBe("BLOCKED");
    expect(blocked?.requires).toEqual(["project_bound"]);

    // No branch manifest means there is no reason to infer a new gate.
    const [branchIndependent] = projectCapabilitiesForSearch([{
      capability_id: "get_project_info", description: "Inspect project.",
      tier: "support" as const, read_only: true,
      destructive: false, idempotent: true,
      branch: { field: "operation", value: "caller_specific" },
      eligibility: "READY",
    }]);
    expect(branchIndependent?.eligibility).toBeUndefined();
  });
  test("graphless mutation readiness stays UNKNOWN while resolved read branches stay lightweight", () => {
    const base = {
      capability_id: "manage_material_instances",
      description: "Inspect or assign face materials.",
      tier: "primary" as const,
      read_only: false,
      destructive: false,
      idempotent: false,
    };
    // An exact-name result without operation cannot claim selected readiness,
    // even if every declared operation lacks graph prerequisites.
    const [unselected] = projectCapabilitiesForSearch([{
      ...base, eligibility: "READY",
    }]);
    expect(unselected?.eligibility).toBe("UNKNOWN");
    expect(unselected?.why).toContain("use a known operation directly");

    // Read-only list/get do not need invented dependency checks or status calls.
    for (const operation of ["list", "get"]) {
      const [query] = projectCapabilitiesForSearch([{
        ...base,
        branch: { field: "operation", value: operation },
        eligibility: "READY",
      }]);
      expect(query?.eligibility).toBeUndefined();
      expect(query?.operation_class).toBe("QUERY");
      expect(query?.why).toBeUndefined();
    }

    // Valid native mutation branches do not become READY only because the
    // semantic graph declares no prerequisites. This is not a Runtime block.
    for (const operation of ["set", "bulk_set", "clear"]) {
      const [mutation] = projectCapabilitiesForSearch([{
        ...base,
        branch: { field: "operation", value: operation },
        eligibility: "READY",
      }]);
      expect(mutation?.eligibility).toBe("UNKNOWN");
      expect(mutation?.operation_class).toBe("MUTATION");
      expect(mutation?.why).toContain("prerequisites are not declared");
      expect(gatewaySearchSuccessOutputSchema.safeParse({
        capabilities: [mutation],
      }).success).toBe(true);
    }
    const [channel] = projectCapabilitiesForSearch([{
      ...base,
      capability_id: "manage_material",
      branch: { field: "operation", value: "assign_channel" },
      eligibility: "READY",
    }]);
    expect(channel?.eligibility).toBe("UNKNOWN");

    // Native/Graph facts that really block are not softened by the search UI.
    const [blocked] = projectCapabilitiesForSearch([{
      ...base,
      branch: { field: "operation", value: "set" },
      eligibility: "BLOCKED",
      requires: ["project_bound" as const],
    }]);
    expect(blocked?.eligibility).toBe("BLOCKED");
    expect(blocked?.requires).toEqual(["project_bound"]);

    // Explicitly graphed operations retain their existing READY presentation.
    const [graphed] = projectCapabilitiesForSearch([{
      ...base,
      capability_id: "manage_cubes",
      branch: { field: "operation", value: "create" },
      eligibility: "READY",
    }]);
    expect(graphed?.eligibility).toBeUndefined();
  });

  test("exact capability name short-circuits to exactly one result", () => {
    const exact = searchCapabilityCatalog(tools, "manage_cubes", 50);
    expect(exact).toHaveLength(1);
    expect(exact[0]).toMatchObject({
      capability_id: "manage_cubes",
      tier: "primary",
    });
  });

  test("exact matching is case-insensitive and near names fall back to ranked discovery", () => {
    expect(searchCapabilityCatalog(tools, "MANAGE_CUBES", 50)).toHaveLength(1);
    expect(searchCapabilityCatalog(tools, "manage_cube", 50)[0]?.capability_id)
      .toBe("manage_cubes");
  });

  test("primary capability outranks comparable lower-tier semantic matches", () => {
    const ranked = searchCapabilityCatalog(tools, "geometry create", 4);
    expect(ranked[0]).toMatchObject({
      capability_id: "manage_cubes",
      tier: "primary",
    });
  });

  test("empty discovery excludes maintenance fallback", () => {
    const ids = searchCapabilityCatalog(tools, "", 10)
      .map((entry) => entry.capability_id);
    expect(ids).not.toContain("emulate_clicks");
  });

  test("maintenance remains available only when explicitly targeted", () => {
    const exact = searchCapabilityCatalog(tools, "emulate_clicks", 10);
    expect(exact).toEqual([
      expect.objectContaining({
        capability_id: "emulate_clicks",
        tier: "maintenance",
      }),
    ]);
  });

  test("retired 3D-assisted names receive no active experimental priority", () => {
    expect(classifyCapabilityTier({
      name: "manage_geometry_reference",
      description: "Retired compatibility name only.",
    })).toBe("support");
  });
});
