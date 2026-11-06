import { describe, expect, test } from "bun:test";
import {
  applyParticleOperations,
  createParticleDocument,
  type JsonObject,
} from "../lib/bedrockParticleDocument";
import { parseClientEntityDocument } from "../lib/bedrockParticleBinding";
import { analyzeBedrockParticlePack } from "../lib/bedrockParticlePackGraph";

function nestedParticle(identifier: string, target?: string) {
  let document = createParticleDocument({ identifier, preset: "burst" });
  if (target) {
    document = applyParticleOperations(document, [
      {
        op: "set_event",
        name: "chain",
        value: {
          particle_effect: {
            effect: target,
            type: "emitter",
          },
        },
      },
      {
        op: "set_component",
        component: "minecraft:particle_lifetime_events",
        value: { expiration_event: "chain" },
      },
    ]);
  }
  return document;
}

describe("Bedrock particle pack dependency analysis", () => {
  test("builds deterministic nested dependency edges for a resolved pack", () => {
    const a = nestedParticle("blockit:a", "blockit:b");
    const b = nestedParticle("blockit:b", "blockit:c");
    const c = nestedParticle("blockit:c");
    const result = analyzeBedrockParticlePack({ particles: [c, a, b].map((document) => ({ document })) });

    expect(result.identifiers).toEqual(["blockit:a", "blockit:b", "blockit:c"]);
    expect(result.dependency_edges).toEqual([
      { from: "blockit:a", to: "blockit:b" },
      { from: "blockit:b", to: "blockit:c" },
    ]);
    expect(result.dependency_cycles).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("composed workload reuses bounded source estimates without inventing runtime peaks", () => {
    const root = nestedParticle("blockit:root", "blockit:spark");
    const spark = nestedParticle("blockit:spark");
    const result = analyzeBedrockParticlePack({
      particles: [root, spark].map(document => ({ document })),
    });
    expect(result.composition_workload).toMatchObject({
      state: "single_instance_numeric", numeric_effect_count: 2,
      unevaluated_effect_count: 0, known_single_instance_particle_sum: 24,
      child_dependency_count: 1, runtime_fps_verified: false,
    });
  });

  test("missing MoLang count and cycle paths remain reviewable, not fabricated FPS", () => {
    const dynamic = applyParticleOperations(nestedParticle("blockit:dynamic"), [
      { op: "patch", path: ["components", "minecraft:particle_lifetime_expression", "max_lifetime"],
        value: "variable.dynamic_lifetime" },
    ]);
    const partial = analyzeBedrockParticlePack({ particles: [
      { document: nestedParticle("blockit:root", "blockit:dynamic") },
      { document: dynamic },
    ] });
    expect(partial.composition_workload).toMatchObject({
      state: "partial", numeric_effect_count: 1, unevaluated_effect_count: 1,
      known_single_instance_particle_sum: 12, runtime_fps_verified: false,
    });
    const cycle = analyzeBedrockParticlePack({ particles: [
      { document: nestedParticle("blockit:a", "blockit:b") },
      { document: nestedParticle("blockit:b", "blockit:a") },
    ] });
    expect(cycle.composition_workload).toMatchObject({
      state: "cycle_review", budget_review: true, runtime_fps_verified: false,
    });
  });

  test("detects cross-file dependency cycles without treating them as structural invalidity", () => {
    const result = analyzeBedrockParticlePack({
      particles: [
        { document: nestedParticle("blockit:a", "blockit:b") },
        { document: nestedParticle("blockit:b", "blockit:c") },
        { document: nestedParticle("blockit:c", "blockit:a") },
      ],
    });

    expect(result.dependency_cycles).toEqual([["blockit:a", "blockit:b", "blockit:c"]]);
    expect(result.diagnostics.map((entry) => entry.code)).toContain("particle_dependency_cycle");
    expect(result.valid).toBe(true);
  });

  test("duplicate identifiers are blocking pack errors", () => {
    const result = analyzeBedrockParticlePack({
      particles: [
        { document: nestedParticle("blockit:same"), source_path: "/rp/particles/a.particle.json" },
        { document: nestedParticle("blockit:same"), source_path: "/rp/particles/b.particle.json" },
      ],
    });

    expect(result.diagnostics.map((entry) => entry.code)).toContain("duplicate_particle_identifier");
    expect(result.valid).toBe(false);
  });

  test("propagates blocking diagnostics from an invalid particle document", () => {
    const document = nestedParticle("blockit:invalid") as JsonObject;
    const effect = document.particle_effect as JsonObject;
    const components = effect.components as JsonObject;
    components["minecraft:emitter_local_space"] = {
      position: false,
      rotation: true,
    };

    const result = analyzeBedrockParticlePack({
      particles: [
        { document, source_path: "/rp/particles/invalid.particle.json" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      result.diagnostics.some(
        (entry) =>
          entry.severity === "error" &&
          entry.source_path === "/rp/particles/invalid.particle.json"
      )
    ).toBe(true);
  });

  test("reports unresolved nested particles and unresolved client-entity targets separately", () => {
    const client = parseClientEntityDocument(`{
      "minecraft:client_entity": {
        "description": {
          "identifier": "blockit:test",
          "particle_effects": {
            "known": "blockit:a",
            "missing": "blockit:not_here"
          }
        }
      }
    }`);
    const result = analyzeBedrockParticlePack({
      particles: [{ document: nestedParticle("blockit:a", "blockit:nested_missing") }],
      client_entities: [{ document: client, source_path: "/rp/entity/test.entity.json" }],
    });

    expect(result.diagnostics.map((entry) => entry.code)).toContain("unresolved_nested_particle");
    expect(result.diagnostics.map((entry) => entry.code)).toContain("unresolved_client_entity_particle");
    expect(result.valid).toBe(false);
  });

  test("propagates client-entity particle binding diagnostics", () => {
    const client = parseClientEntityDocument(`{
      "minecraft:client_entity": {
        "description": {
          "identifier": "blockit:test",
          "particle_effects": { "broken": 12 }
        }
      }
    }`);
    const result = analyzeBedrockParticlePack({
      particles: [{ document: nestedParticle("blockit:a") }],
      client_entities: [
        { document: client, source_path: "/rp/entity/test.entity.json" },
      ],
    });

    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "non_string_particle_binding"
    );
    expect(result.valid).toBe(false);
  });

  test("checks texture and sound dependencies only when inventories are supplied", () => {
    let document = nestedParticle("blockit:deps");
    document = applyParticleOperations(document, [
      {
        op: "set_event",
        name: "sound",
        value: { sound_effect: { event_name: "blockit.particle.pop" } },
      },
    ]);

    const withoutInventory = analyzeBedrockParticlePack({ particles: [{ document }] });
    expect(withoutInventory.diagnostics.map((entry) => entry.code)).not.toContain("unresolved_particle_texture");
    expect(withoutInventory.diagnostics.map((entry) => entry.code)).not.toContain("unresolved_particle_sound_event");

    const missingInventory = analyzeBedrockParticlePack({
      particles: [{ document }],
      available_textures: [],
      available_sound_events: [],
    });
    expect(missingInventory.texture_dependencies).toContain("textures/particle/particles");
    expect(missingInventory.sound_dependencies).toContain("blockit.particle.pop");
    expect(missingInventory.diagnostics.map((entry) => entry.code)).toContain("unresolved_particle_texture");
    expect(missingInventory.diagnostics.map((entry) => entry.code)).toContain("unresolved_particle_sound_event");
  });

  test("accepts resolved texture, sound and client-entity dependencies", () => {
    const client = parseClientEntityDocument(`{
      "minecraft:client_entity": {
        "description": {
          "identifier": "blockit:test",
          "particle_effects": { "fx": "blockit:a" }
        }
      }
    }`);
    let document = nestedParticle("blockit:a");
    document = applyParticleOperations(document, [
      {
        op: "set_event",
        name: "sound",
        value: { sound_effect: { event_name: "blockit.particle.pop" } },
      },
    ]);
    const result = analyzeBedrockParticlePack({
      particles: [{ document }],
      client_entities: [{ document: client }],
      available_textures: ["textures/particle/particles"],
      available_sound_events: ["blockit.particle.pop"],
    });

    expect(result.valid).toBe(true);
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  });
});
