import { describe, expect, test } from "bun:test";
import { createParticleDocument, serializeParticleDocument } from "../lib/particle/document";
import {
  studioDefaults, studioOutputPath, studioBootstrapOperations, readStudioEffect,
  studioChangeOperations, type StudioSettings,
} from "../ui/particleStudio";

const sample = (overrides: Partial<StudioSettings> = {}) =>
  ({ ...studioDefaults(), ...overrides });
const serialized = (input: StudioSettings) => serializeParticleDocument(createParticleDocument({
  identifier: input.identifier, preset: input.preset, texture: "textures/particle/particles",
}));

describe("Particle Studio quick authoring contracts", () => {
  test("rejects traversal and formats a fixed sibling particle path", () => {
    const path = { join: (...s: string[]) => s.join("/") };
    expect(studioOutputPath("/model/particles", "mivubi:blue_flame", path as never))
      .toBe("/model/particles/blue_flame.particle.json");
    expect(() => studioOutputPath("/model", "mivubi:../../evil", path as never)).toThrow();
    expect(() => studioOutputPath("/model", "MIVUBI:Blue", path as never)).toThrow();
  });

  test("bootstrap writes only known preset component fields", () => {
    const ops = studioBootstrapOperations(sample({ preset: "burst", emission: 20, speed: 1.5 }));
    expect(ops).toContainEqual({
      op: "patch", path: ["components", "minecraft:emitter_rate_instant", "num_particles"], value: 20,
    });
    expect(ops).toContainEqual({
      op: "patch", path: ["components", "minecraft:particle_initial_speed"], value: 1.5,
    });
    expect(ops).toHaveLength(5);
  });

  test("editing tint cannot accidentally rewrite speed, emission or motion", () => {
    const loaded = readStudioEffect("/model/particles/magic_flame.particle.json", serialized(sample()));
    const next = sample({ color: "#8040ff" });
    const ops = studioChangeOperations(loaded, next);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "set_component", component: "minecraft:particle_appearance_tinting" });
  });

  test("advanced Molang speed remains read-only while other fields can be edited", () => {
    const raw = JSON.parse(serialized(sample()));
    raw.particle_effect.components["minecraft:particle_initial_speed"] = "math.sin(variable.particle_age)";
    const loaded = readStudioEffect("/model/particles/magic_flame.particle.json", JSON.stringify(raw));
    expect(loaded.editable.speed).toBe(false);
    expect(() => studioChangeOperations(loaded, { ...loaded.settings, speed: 2 })).toThrow(/advanced-authored/);
    expect(studioChangeOperations(loaded, { ...loaded.settings, size: 0.2 })).toHaveLength(1);
  });

  test("changing identifiers is not silently treated as a particle edit", () => {
    const loaded = readStudioEffect("/model/particles/magic_flame.particle.json", serialized(sample()));
    expect(() => studioChangeOperations(loaded, { ...loaded.settings, identifier: "other:new" })).toThrow();
  });

  test("panel keeps preview and attachment user-facing without a fourth Stage or Gateway", async () => {
    const [panel, ui, studio] = await Promise.all([
      Bun.file("ui/panel.html").text(), Bun.file("ui/index.ts").text(),
      Bun.file("ui/particleStudio.ts").text(),
    ]);
    expect(panel).toContain('aria-label="Particle Studio"');
    for (const action of ["studioCreate", "studioSave", "studioPlay", "studioStop", "studioAttach"]) {
      expect(panel).toContain('@click="' + action + '"');
    }
    expect(ui).toContain("runRuntimeOperationExclusive(generation");
    expect(ui).toContain('release("Particle Studio preview", stopStudioPreview)');
    expect(studio).toContain('getAllToolDefinitions().manage_particle');
    expect(studio).toContain('getAllToolDefinitions().manage_animation_effects');
    expect(studio).not.toContain("setActiveMcpAuthoringStage(");
    expect(studio).not.toContain("setInterval(");
  });
});
