import { describe, expect, test } from "bun:test";
import { createParticleDocument, serializeParticleDocument } from "../lib/particle/document";
import { tools } from "../lib/factories";
import { getActiveMcpAuthoringStage, setActiveMcpAuthoringStage } from "../lib/capabilities/authoringStage";
import {
  studioDefaults, studioOutputPath, studioBootstrapOperations, readStudioEffect,
  studioChangeOperations, compileStudioDraft,
  startStudioPreview, stopStudioPreview, studioPreviewStatus,
  type StudioSettings,
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
    expect(ops).toContainEqual({
      op: "patch",
      path: ["components", "minecraft:particle_appearance_billboard", "uv"],
      value: { texture_width: 128, texture_height: 128, uv: [40, 80], uv_size: [8, 8] },
    });
    expect(ops).toHaveLength(6);
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

  test("live draft is lossless, does not modify source, and rejects advanced expression overwrite", () => {
    const original = JSON.parse(serialized(sample()));
    original.particle_effect.extensions = { future_component: ["do_not_touch"] };
    original.particle_effect.components["minecraft:particle_motion_dynamic"] = {
      linear_acceleration: [0, 0.25, 0], linear_drag_coefficient: 0.1,
    };
    const content = JSON.stringify(original);
    const loaded = readStudioEffect("/model/particles/magic_flame.particle.json", content);
    const result = compileStudioDraft(loaded, { ...loaded.settings, size: 0.25 });
    const effect = result.document.particle_effect as Record<string, any>;
    expect(result.dirty).toBe(true);
    expect(effect.extensions).toEqual({ future_component: ["do_not_touch"] });
    expect(effect.components["minecraft:particle_motion_dynamic"]).toEqual(
      original.particle_effect.components["minecraft:particle_motion_dynamic"]);
    expect(effect.components["minecraft:particle_appearance_billboard"].size).toEqual([0.25, 0.25]);
    expect(loaded.content).toBe(content);
    expect(compileStudioDraft(loaded, loaded.settings).dirty).toBe(false);

    original.particle_effect.components["minecraft:particle_appearance_billboard"].size =
      ["0.1 + variable.particle_age", "0.1 + variable.particle_age"];
    const advanced = readStudioEffect("/model/particles/magic_flame.particle.json", JSON.stringify(original));
    expect(() => compileStudioDraft(advanced, { ...advanced.settings, size: 0.5 }))
      .toThrow(/advanced-authored/);
  });

  test("live viewport uses an isolated Wintersky config, never mutates file or Animation source", () => {
    const originalKeys = ["Project", "Animator", "Wintersky", "WinterskyScene", "Locator", "requireNativeModule"];
    const before = originalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    const beforeTool = Object.getOwnPropertyDescriptor(tools, "manage_particle");
    const beforeStage = getActiveMcpAuthoringStage();
    const settings = sample();
    const loaded = readStudioEffect("/model/particles/magic_flame.particle.json", serialized(settings));
    const project = { format: { id: "bedrock" } };
    const existingConfig = Object.freeze({ texture_source_category: "built_in", sentinel: "animation-unchanged" });
    const constructed: any[] = [];
    let live = 0, disposed = 0, deleted = 0, written = 0;
    const define = (key: string, value: unknown) =>
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    class FakeConfig {
      texture_source_category = "built_in";
      texture = { dispose: () => { disposed += 1; } };
      constructor(_scene: unknown, readonly document: Record<string, any>, readonly options: { path: string }) {
        constructed.push(this);
      }
    }
    class FakeEmitter {
      enabled = false;
      particles: unknown[] = [];
      parent_mode = "entity";
      local_space = {};
      global_space = {};
      constructor(_scene: unknown, readonly config: FakeConfig) { live += 1; }
      playLoop() { this.enabled = true; this.particles = [{}]; }
      stopLoop() { this.enabled = false; }
      delete() { deleted += 1; live -= 1; }
    }
    try {
      Object.defineProperty(tools, "manage_particle",
        { configurable: true, value: { enabled: true }, writable: true });
      setActiveMcpAuthoringStage("animation");
      define("Project", project);
      define("Locator", { all: [] });
      define("Animator", {
        open: true,
        particle_effects: { [loaded.path]: { config: existingConfig } },
      });
      define("WinterskyScene", { global_options: { tick_rate: 30 } });
      define("Wintersky", { Config: FakeConfig, Emitter: FakeEmitter });
      define("requireNativeModule", (name: string) => name === "fs"
        ? { existsSync: () => true, readFileSync: () => loaded.content,
            writeFileSync: () => { written += 1; } }
        : name === "path" ? { dirname: () => "/model", join: (...args: string[]) => args.join("/") } : undefined);
      expect(startStudioPreview(project as never, loaded, "", { ...settings, size: 0.3 }))
        .toContain("not saved");
      expect(live).toBe(1);
      expect((constructed[0].document.particle_effect.components as any)
        ["minecraft:particle_appearance_billboard"].size).toEqual([0.3, 0.3]);
      expect(existingConfig.sentinel).toBe("animation-unchanged");
      expect(written).toBe(0);
      expect(() => startStudioPreview(project as never, loaded, "", { ...settings, size: 9 }))
        .toThrow(/Size must be/);
      expect(live).toBe(1); // Invalid draft retains the last valid preview.
      expect(startStudioPreview(project as never, loaded, "", { ...settings, size: 0.4 }))
        .toContain("not saved");
      expect(live).toBe(1);
      expect(deleted).toBe(1);
      expect(disposed).toBe(1);
      expect(studioPreviewStatus(project as never)).toContain("unsaved preview");
      stopStudioPreview();
      expect(live).toBe(0);
      expect(deleted).toBe(2);
      expect(disposed).toBe(2);
      expect(written).toBe(0);
    } finally {
      stopStudioPreview();
      setActiveMcpAuthoringStage(beforeStage);
      if (beforeTool) Object.defineProperty(tools, "manage_particle", beforeTool);
      else Reflect.deleteProperty(tools, "manage_particle");
      for (const [key, desc] of before) {
        if (desc) Object.defineProperty(globalThis, key, desc);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
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
    expect(panel.match(/@input="studioLiveChanged"/g)).toHaveLength(5);
    expect(panel).toContain('studioRevert');
    expect(ui).toContain('cancelStudioLivePreview()');
    expect(ui).toContain('studioLiveExecuting');
    expect(ui).toContain('startPanelParticlePreview(');
    expect(studio).toContain("new host.Wintersky.Config(scene, draft.document");
    expect(ui).toContain('release("Particle Studio preview", stopStudioPreview)');
    expect(studio).toContain('getAllToolDefinitions().manage_particle');
    expect(studio).toContain('getAllToolDefinitions().manage_animation_effects');
    expect(studio).not.toContain("setActiveMcpAuthoringStage(");
    expect(studio).not.toContain("setInterval(");
  });
});
