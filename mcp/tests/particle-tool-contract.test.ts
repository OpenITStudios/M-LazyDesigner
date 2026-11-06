import { describe, expect, test } from "bun:test";
import {
  PARTICLE_VALIDATION_SCOPE,
  inspectParticleParameters,
  manageParticleParameters,
  particleToolDocs,
} from "../server/tools/particle";
import {
  PARTICLE_REFERENCE_IDS,
  getParticleReferencePayload,
  particleReferenceResourceDocs,
} from "../server/resources/particle";

describe("particle MCP contract", () => {
  test("keeps the authoring surface to two focused tools", () => {
    expect(particleToolDocs.map((tool) => tool.name)).toEqual([
      "inspect_particle",
      "manage_particle",
    ]);
  });

  test("supports one-call create, save intent and native preview request", () => {
    const parsed = manageParticleParameters.safeParse({
      create: {
        identifier: "blockit:engine_smoke",
        preset: "trail",
        texture: "textures/particle/engine_smoke",
      },
      operations: [
        {
          op: "patch",
          path: ["components", "minecraft:emitter_rate_steady", "spawn_rate"],
          value: 18,
        },
      ],
      output: {
        path: "C:\\packs\\example\\particles\\engine_smoke.particle.json",
      },
      preview: true,
    });

    expect(parsed.success).toBe(true);
  });

  test("requires explicit texture authority for new particle creation", () => {
    expect(
      manageParticleParameters.safeParse({
        create: { identifier: "blockit:implicit_texture" },
      }).success
    ).toBe(false);

    expect(
      manageParticleParameters.safeParse({
        create: { identifier: "blockit:explicit_texture" },
        operations: [
          {
            op: "set_render",
            texture: "textures/particle/explicit_texture",
          },
        ],
      }).success
    ).toBe(true);
  });

  test("reports current-stable compatibility without claiming target-version proof", () => {
    expect(PARTICLE_VALIDATION_SCOPE).toEqual({
      schema: "CURRENT_STABLE_COMPATIBILITY",
      target_version_verified: false,
      note: expect.stringContaining("do not prove exact field/default availability"),
    });
    expect(particleToolDocs[0].description).toContain(
      "do not by themselves prove exact target-version"
    );
  });

  test("keeps client-entity mutation outside the particle authoring surface", () => {
    expect(
      manageParticleParameters.safeParse({
        create: {
          identifier: "blockit:test",
          texture: "textures/particle/particles",
        },
        client_entity_binding: {
          source: {
            content: JSON.stringify({
              "minecraft:client_entity": {
                description: { identifier: "blockit:test_entity" },
              },
            }),
          },
          shortname: "engine_smoke",
        },
      }).success
    ).toBe(false);
    expect(particleToolDocs[1].description).not.toContain("client-entity");
    expect(particleToolDocs[1].description).toContain(
      "Downstream runtime binding remains owned by existing animation/controller tools"
    );
  });

  test("accepts future component payloads as JSON while keeping authored identity strict", () => {
    const futureComponent = manageParticleParameters.safeParse({
      create: {
        identifier: "blockit:future",
        texture: "textures/particle/particles",
      },
      operations: [
        {
          op: "set_component",
          component: "vendor:future_component",
          value: {
            numeric_zero: 0,
            molang: "variable.power * 20",
            nested: [true, null, { future: "value" }],
          },
        },
      ],
    });
    const badIdentifier = manageParticleParameters.safeParse({
      create: {
        identifier: "Bad Namespace:Particle",
        texture: "textures/particle/particles",
      },
    });

    expect(futureComponent.success).toBe(true);
    expect(badIdentifier.success).toBe(false);
  });

  test("requires one source form and keeps full inspection opt-in", () => {
    expect(
      inspectParticleParameters.safeParse({
        source: { content: "{\"particle_effect\":{}}" },
      }).success
    ).toBe(true);
    expect(
      inspectParticleParameters.safeParse({
        source: {
          path: "/tmp/example.particle.json",
          content: "{\"particle_effect\":{}}",
        },
      }).success
    ).toBe(false);
  });

  test("rejects ambiguous patch payloads before runtime mutation", () => {
    expect(
      manageParticleParameters.safeParse({
        create: {
          identifier: "blockit:test",
          texture: "textures/particle/particles",
        },
        operations: [
          {
            op: "patch",
            path: ["components", "x"],
            remove: true,
            value: {},
          },
        ],
      }).success
    ).toBe(false);

    expect(
      manageParticleParameters.safeParse({
        create: {
          identifier: "blockit:test",
          texture: "textures/particle/particles",
        },
        operations: [
          {
            op: "set_render",
          },
        ],
      }).success
    ).toBe(false);
  });
});

describe("particle reference resource contract", () => {
  test("keeps one lazy resource with bounded sections", () => {
    expect(particleReferenceResourceDocs.map((resource) => resource.name)).toEqual([
      "particle-reference",
    ]);
    expect(PARTICLE_REFERENCE_IDS).toEqual([
      "components",
      "materials",
      "curves",
      "events",
      "presets",
      "molang",
      "workflow",
    ]);
    expect((getParticleReferencePayload("materials") as any).materials.particles_base).toBeTruthy();
    expect((getParticleReferencePayload("molang") as any).variables["variable.particle_age"]).toBeTruthy();
    const composed = (getParticleReferencePayload("workflow") as any).composed_effects;
    expect(composed.mode).toBe("SMALL_EXISTING_EVENT_GRAPH_NO_AUTOMATIC_MULTI_PREVIEW");
    expect(composed.author.join(" ")).toContain("minecraft:emitter_lifetime_events");
    expect(composed.efficiency.join(" ")).toContain("One native Studio preview owner");
  });
});
