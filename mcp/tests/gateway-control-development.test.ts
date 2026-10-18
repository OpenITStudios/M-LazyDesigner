import { GatewayOperationQueue } from "@/gateway/runtime/operationQueue";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildControlPacket,
  projectControlPacketForGateway,
  resolveDevelopmentIntent,
} from "@/gateway/control";
import type { GatewayRuntimeStatus } from "@/gateway/backend";

const status: GatewayRuntimeStatus = {
  gateway: "ready",
  affinity: { project_uuid: "project-a", authoring_phase: "geometry" },
  runtime: {
    online: true, endpoint: "http://127.0.0.1:3000/bb-mcp", mcp_client_ready: true,
    catalog_stale: false, runtime_signature: "runtime-a", connected_signature: "runtime-a", catalog_count: 47,
    health: { build_identity: "sha256:build-a", product: { authoring_phase: "geometry" }, project_context: { active_project_uuid: "project-a", requested_project_uuid: "project-a", requested_project_available: true, open_project_count: 1 } },
  },
  connection: {
    state: "ready", generation: 1, reconnect_count: 0, catalog_refresh_count: 1,
    last_ready_at: "2026-09-12T00:00:00.000Z", last_transition_at: "2026-09-12T00:00:00.000Z",
    reconnect: { failures: 0, retry_after_ms: 0 },
  },
  operations: {
    ...new GatewayOperationQueue(8).snapshot(), active: 0, queued: 0, max_queue_depth: 8, completed: 0, failed: 0, timed_out: 0, rejected_busy: 0 },
  last_error: null,
};

const representativeIntents = [
  "animasi keyframe terlalu kaku", "texture uv atlas bermasalah", "geometry cube melayang",
  "particle snowstorm semantics", "project affinity salah project", "dev:sync stale build setelah plugin reload",
  "gateway capability catalog bermasalah", "control continuation routing bermasalah", "navigator routing perlu diaudit",
  "runtime plugin lifecycle error",
] as const;

function repoPath(path: string): string { return resolve(process.cwd(), "..", path); }

describe("LazyDesigner Control system-development intent", () => {
  test("explicit capability names bypass heuristic scoring with exact ownership", () => {
    const uv = resolveDevelopmentIntent(
      "audit manage_uv_layout stale receipt handling"
    );
    expect(uv).toMatchObject({
      domain: "GEOMETRY",
      confidence: "EXACT",
      context_strategy: "DIRECT_SOURCE_OWNERS",
      matched_terms: ["manage_uv_layout"],
    });
    expect(uv.source_owners).toEqual([
      {
        source: "mcp/server/runtime/uv/layoutService.ts",
        specialist: ".agents/skills/lazydesigner-modelling/SKILL.md",
        anchor_test: "mcp/tests/uv-registration-readiness.test.ts",
      },
    ]);

    const particle = resolveDevelopmentIntent("manage_particle receipt bug");
    expect(particle.domain).toBe("PARTICLE");
    expect(particle.confidence).toBe("EXACT");
    expect(particle.source_owners[0]?.source).toBe(
      "mcp/server/tools/particle/manage.ts"
    );
  });

  test("exact source and anchor-test paths outrank keyword heuristics", () => {
    const sourcePath = resolveDevelopmentIntent(
      "texture bug stack: mcp/server/tools/geometry/cubes.ts:418"
    );
    expect(sourcePath.domain).toBe("GEOMETRY");
    expect(sourcePath.confidence).toBe("EXACT");
    expect(sourcePath.matched_terms).toContain(
      "path:mcp/server/tools/geometry/cubes.ts"
    );

    const windowsPath = resolveDevelopmentIntent(
      String.raw`C:\\repo\\mcp\\server\\tools\\geometry\\cubes.ts:418`
    );
    expect(windowsPath.domain).toBe("GEOMETRY");
    expect(windowsPath.confidence).toBe("EXACT");

    const anchorPath = resolveDevelopmentIntent(
      "failure in mcp/tests/particle-tool-contract.test.ts"
    );
    expect(anchorPath.domain).toBe("PARTICLE");
    expect(anchorPath.confidence).toBe("EXACT");
  });

  test("conflicting exact capability and source evidence fails ambiguous", () => {
    const result = resolveDevelopmentIntent(
      "manage_particle failed in mcp/server/tools/geometry/cubes.ts"
    );
    expect(result.domain).toBe("UNRESOLVED");
    expect(result.confidence).toBe("AMBIGUOUS");
    expect(result.context_strategy).toBe("BOUNDED_SYMBOL_MAP");
    expect(result.matched_terms).toEqual(
      expect.arrayContaining([
        "manage_particle",
        "path:mcp/server/tools/geometry/cubes.ts",
      ])
    );
  });

  test("multiple exact capabilities in one domain remain exact but preserve all owners", () => {
    const result = resolveDevelopmentIntent(
      "manage_keyframes and animation_timeline integration"
    );
    expect(result.domain).toBe("ANIMATION");
    expect(result.confidence).toBe("EXACT");
    expect(result.source_owners.length).toBeGreaterThanOrEqual(2);
  });

  test("animation quality wording routes directly to animation quality owners", () => {
    const result = resolveDevelopmentIntent("animasi keyframe terlalu kaku");
    expect(result).toMatchObject({
      task_class: "SYSTEM_DEVELOPMENT",
      domain: "ANIMATION",
      confidence: "STRONG",
      context_strategy: "DIRECT_SOURCE_OWNERS",
    });
    expect(result.source_owners.some((entry) => entry.source === "mcp/lib/animation/motionDynamics.ts")).toBe(true);
    expect(result.source_owners.some((entry) => entry.source === "mcp/lib/animation/quality.ts")).toBe(true);
    expect(result.required_context_paths).toContain(".agents/skills/lazydesigner-animation/SKILL.md");
  });

  test("build sync wording stays out of authoring owners", () => {
    const result = resolveDevelopmentIntent("dev:sync stale build setelah plugin reload");
    expect(result.domain).toBe("BUILD_SYNC");
    expect(result.source_owners.map((entry) => entry.source)).toEqual([
      "mcp/build/index.ts", "mcp/build/watch-policy.ts", "mcp/scripts/operations/deploy-local.ts",
    ]);
    expect(result.required_context_paths).not.toContain(".agents/skills/lazydesigner-modelling/SKILL.md");
  });

  test("control and retired navigator wording route to canonical active Control owners", () => {
    for (const intent of ["control continuation routing bermasalah", "navigator routing perlu diaudit"]) {
      const result = resolveDevelopmentIntent(intent);
      expect(result.domain, intent).toBe("GATEWAY");
      expect(result.confidence, intent).toBe("STRONG");
      expect(result.source_owners.some((entry) => entry.source === "mcp/gateway/control/packet.ts"), intent).toBe(true);
      expect(result.source_owners.some((entry) => entry.source === "mcp/gateway/control/routingPolicy.ts"), intent).toBe(true);
      expect(result.source_owners.some((entry) => entry.source === "mcp/gateway/control/delta/engine.ts"), intent).toBe(true);
      expect(result.source_owners.some((entry) => entry.source.includes("gateway/navigator")), intent).toBe(false);
    }
  });

  test("controller wording does not leak into Gateway through the control substring", () => {
    const result = resolveDevelopmentIntent("controller bug");
    expect(result.domain).toBe("ANIMATION");
    expect(result.confidence).toBe("STRONG");
    expect(result.matched_terms).toEqual(["controller"]);
    expect(
      result.source_owners.some((entry) =>
        entry.source === "mcp/gateway/control/packet.ts"
      )
    ).toBe(false);
  });

  test("rigging follows the canonical Geometry ownership boundary", () => {
    for (const intent of ["rigging issue", "bone rig pivot problem"]) {
      const result = resolveDevelopmentIntent(intent);
      expect(result.domain, intent).toBe("GEOMETRY");
      expect(result.confidence, intent).toBe("STRONG");
      expect(
        result.source_owners.some((entry) =>
          entry.source === "mcp/server/tools/animation/rigging.ts"
        ),
        intent
      ).toBe(true);
      expect(result.required_context_paths, intent).toContain(
        ".agents/skills/lazydesigner-modelling/SKILL.md"
      );
    }
  });

  test("particle development uses the focused particle capability owner", () => {
    const result = resolveDevelopmentIntent("particle snowstorm semantics");
    expect(result.domain).toBe("PARTICLE");
    expect(result.source_owners[0]?.source).toBe("mcp/server/tools/particle/manage.ts");
    expect(result.source_owners[0]?.specialist).toBe(".agents/skills/lazydesigner-animation/SKILL.md");
  });

  test("ambiguous equal-score wording refuses to invent a single domain", () => {
    const result = resolveDevelopmentIntent("geometry texture");
    expect(result.domain).toBe("UNRESOLVED");
    expect(result.confidence).toBe("AMBIGUOUS");
    expect(result.context_strategy).toBe("BOUNDED_SYMBOL_MAP");
    expect(result.source_owners.length).toBeGreaterThan(0);
  });

  test("fallback source ownership can never create exact development confidence", () => {
    const result = resolveDevelopmentIntent(
      "future_unknown_tool failed near registration"
    );

    expect(result.confidence).not.toBe("EXACT");
    expect(result.domain).toBe("UNRESOLVED");
    expect(result.source_owners).toEqual([]);
    expect(
      result.source_owners.some(
        (owner) => owner.resolution === "FALLBACK"
      )
    ).toBe(false);
  });

  test("unknown development wording stays unresolved and bounded", () => {
    const result = resolveDevelopmentIntent("something unusual elsewhere");
    expect(result.domain).toBe("UNRESOLVED");
    expect(result.confidence).toBe("UNRESOLVED");
    expect(result.context_strategy).toBe("TARGETED_SEARCH");
    expect(result.source_owners).toEqual([]);
    expect(result.required_context_paths).toEqual(["AGENTS.md", "mcp/AGENTS.md"]);
  });

  test("every development owner and regression path returned by representative routing exists", () => {
    for (const intent of representativeIntents) {
      const result = resolveDevelopmentIntent(intent);
      expect(result.confidence, intent).toBe("STRONG");
      for (const entry of result.source_owners) {
        expect(existsSync(repoPath(entry.source)), `${intent}: ${entry.source}`).toBe(true);
        if (entry.anchor_test) expect(existsSync(repoPath(entry.anchor_test)), `${intent}: ${entry.anchor_test}`).toBe(true);
        if (entry.specialist) expect(existsSync(repoPath(entry.specialist)), `${intent}: ${entry.specialist}`).toBe(true);
      }
      for (const path of result.required_context_paths) expect(existsSync(repoPath(path)), `${intent}: context ${path}`).toBe(true);
    }
  });

  test("Gateway development projection removes request echoes while preserving exact routing decisions", async () => {
    const internal = await buildControlPacket(status, {
      taskMode: "SYSTEM_DEVELOPMENT",
      taskIntent: "gateway capability catalog bermasalah",
    });
    const projected = projectControlPacketForGateway(internal);
    const development = projected.development!;

    expect(internal.development?.confidence).toBe("STRONG");
    expect(development).toMatchObject({
      domain: "GATEWAY",
      confidence: "STRONG",
      context_strategy: "DIRECT_SOURCE_OWNERS",
    });
    expect(development.source_owners.length).toBeGreaterThan(0);
    expect(development.source_owners[0]).toHaveProperty("anchor_test");
    expect(development.source_owners[0]).toMatchObject({
      ownership_resolution: "EXPLICIT",
    });
    expect(development.source_owners[0]).not.toHaveProperty("test_owner");
    expect(development.required_context_paths).toEqual(["AGENTS.md", "mcp/AGENTS.md"]);
    expect(development).not.toHaveProperty("task_class");
    expect(development).not.toHaveProperty("intent");
    expect(development).not.toHaveProperty("avoid_context_classes");
    expect(development).not.toHaveProperty("matched_terms");
    expect(JSON.stringify(development).length).toBeLessThan(
      JSON.stringify(internal.development).length
    );
  });

  test("ambiguous development projection keeps matched terms needed to resolve ownership", async () => {
    const internal = await buildControlPacket(status, {
      taskMode: "SYSTEM_DEVELOPMENT",
      taskIntent: "geometry texture",
    });
    const projected = projectControlPacketForGateway(internal);

    expect(projected.development).toMatchObject({
      domain: "UNRESOLVED",
      confidence: "AMBIGUOUS",
      context_strategy: "BOUNDED_SYMBOL_MAP",
    });
    expect(projected.development?.matched_terms).toEqual(
      expect.arrayContaining(["geometry", "texture"])
    );
    expect(projected.development).not.toHaveProperty("intent");
    expect(projected.development).not.toHaveProperty("avoid_context_classes");
  });

  test("development packet skips workspace/reference parsing and authoring Skill retransmission", async () => {
    const packet = await buildControlPacket(status, {
      taskMode: "SYSTEM_DEVELOPMENT",
      taskIntent: "gateway capability catalog bermasalah",
      knownContextIds: ["ctx:skill/modelling@old"],
      workspacePath: "/path/that/must/not/be/read",
      referencePackagePath: "/path/that/must/not-be-read",
    });
    expect(packet.mode).toBe("SYSTEM_DEVELOPMENT");
    expect(packet.development?.domain).toBe("GATEWAY");
    expect(packet.workspace.available).toBe(false);
    expect(packet.reference.available).toBe(false);
    expect(packet.stage_context).toBeNull();
    expect(packet.context.required).toEqual([]);
    expect(packet.context.optional).toEqual([]);
    expect(packet.context.invalidated_ids).toEqual([]);
    expect(packet.task_context_id).toMatch(/^task:[a-f0-9]{20}$/);
    expect(JSON.stringify(packet).length).toBeLessThan(7000);
  });
});
