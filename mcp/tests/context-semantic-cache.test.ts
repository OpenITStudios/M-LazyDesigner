import { describe, expect, test } from "bun:test";
import { CAPABILITY_SEMANTIC_CATALOG_REVISIONS } from "../gateway/capabilities/semanticRegistry";
import { semanticFingerprint } from "../gateway/capabilities/semanticRegistry";
import { filterContext } from "../gateway/control/packetContext";
import type { ControlContextHandle, ControlSnapshot } from "../gateway/control/types";

function semanticRevision(
  dependencies: ControlContextHandle["semantic_dependencies"]
): string {
  return semanticFingerprint(
    Object.fromEntries(
      dependencies.map((dimension) => [
        dimension,
        CAPABILITY_SEMANTIC_CATALOG_REVISIONS[dimension],
      ])
    )
  );
}

function handle(
  id: string,
  dependencies: ControlContextHandle["semantic_dependencies"],
  revision = semanticRevision(dependencies)
): ControlContextHandle {
  return {
    id,
    path: ".agents/skills/test.md",
    sha256: "a".repeat(64),
    semantic_dependencies: dependencies,
    semantic_revision: revision,
  };
}

function snapshot(required: ControlContextHandle[]): ControlSnapshot {
  return {
    protocol: "lazydesigner-control-v1",
    system: "READY",
    mode: "ASSET_AUTHORING",
    project: {
      affinity_uuid: null,
      active_uuid: null,
      open_project_count: 0,
      binding: "UNBOUND",
    },
    authoring: {
      phase: null,
      domain: "GEOMETRY",
      next_intent: "test",
    },
    runtime: {
      online: false,
      build_identity: null,
      runtime_signature: null,
      catalog_count: 0,
      catalog_stale: false,
    },
    context: { required, optional: [] },
    blockers: [],
  };
}

describe("semantic-aware context cache", () => {
  test("fresh cached handle stays cached", () => {
    const current = handle(
      "ctx:skill/modelling@aaaaaaaaaaaa.bbbbbbbbbbbb",
      ["routing", "graph"]
    );
    const result = filterContext(snapshot([current]), [current.id], "ASSET_AUTHORING");
    expect(result.required).toEqual([]);
    expect(result.cached_ids).toEqual([current.id]);
    expect(result.invalidated_ids).toEqual([]);
  });

  test("stale semantic dependency forces only that handle to reload", () => {
    const current = handle(
      "ctx:skill/modelling@aaaaaaaaaaaa.bbbbbbbbbbbb",
      ["routing", "graph"],
      "0".repeat(64)
    );
    const result = filterContext(snapshot([current]), [current.id], "ASSET_AUTHORING");
    expect(result.required).toEqual([current]);
    expect(result.cached_ids).toEqual([]);
    expect(result.invalidated_ids).toEqual([current.id]);
  });

  test("Runtime replacement keeps unchanged static Skill handles cached", () => {
    const current = handle(
      "ctx:skill/modelling@aaaaaaaaaaaa.bbbbbbbbbbbb",
      ["routing", "graph"]
    );
    const original = snapshot([current]);
    const replacement: ControlSnapshot = {
      ...original,
      runtime: {
        ...original.runtime,
        build_identity: "sha256:same-build",
        runtime_signature: "different-instance",
      },
    };
    const delivery = filterContext(replacement, [current.id], "ASSET_AUTHORING");

    expect(delivery.required).toEqual([]);
    expect(delivery.cached_ids).toEqual([current.id]);
    expect(delivery.invalidated_ids).toEqual([]);
  });

  test("schema-only changes do not invalidate routing+graph context", () => {
    const current = handle(
      "ctx:profile/vehicle@aaaaaaaaaaaa.bbbbbbbbbbbb",
      ["routing", "graph"]
    );
    expect(current.semantic_dependencies).not.toContain("schema_projection");
    const result = filterContext(snapshot([current]), [current.id], "ASSET_AUTHORING");
    expect(result.cached_ids).toEqual([current.id]);
  });
});
