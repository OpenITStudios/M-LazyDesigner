import { describe, expect, test } from "bun:test";
import { createParticleDocument, serializeParticleDocument } from "../lib/particle/document";
import { tools } from "../lib/factories";
import { getActiveMcpAuthoringStage, setActiveMcpAuthoringStage } from "../lib/capabilities/authoringStage";
import {
  studioDefaults, studioOutputPath, studioBootstrapOperations, readStudioEffect,
  studioChangeOperations, compileStudioDraft, prepareStudioParticleDraft,
  requireStudioCommittedWrite,
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

  test("file Save remains successful even if optional native preview fails", () => {
    const path = "/model/particles/blue.particle.json";
    expect(() => requireStudioCommittedWrite({
      valid: true,
      artifact_ready: true,
      wrote_to_path: path,
      preview_load_call: "ERROR",
      preview_error: "Texture preview did not load",
    }, path)).not.toThrow();
    expect(() => requireStudioCommittedWrite({
      valid: true, artifact_ready: true, wrote_to_path: null,
      preview_load_call: "INVOKED", preview_error: null,
    }, path)).toThrow(/not committed/);
    expect(() => requireStudioCommittedWrite({
      valid: false, artifact_ready: false, wrote_to_path: path,
    }, path)).toThrow(/not committed/);
  });

  test("new effects are previewable drafts without filesystem writes or project save paths", () => {
    const originalKeys = ["Project", "requireNativeModule"];
    const descriptors = originalKeys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    const originalTool = Object.getOwnPropertyDescriptor(tools, "manage_particle");
    const originalStage = getActiveMcpAuthoringStage();
    const project = { format: { id: "bedrock" } };
    let fileAccess = 0;
    try {
      Object.defineProperty(globalThis, "Project", {
        configurable: true, value: project,
      });
      Object.defineProperty(globalThis, "requireNativeModule", {
        configurable: true, value: () => { fileAccess++; throw new Error("not permitted"); },
      });
      Object.defineProperty(tools, "manage_particle", {
        configurable: true, value: { enabled: true },
      });
      setActiveMcpAuthoringStage("animation");

      const initial = sample({ identifier: "mivubi:splash", preset: "collision_splash", size: 0.2 });
      const draft = prepareStudioParticleDraft(project as never, initial);
      expect(draft.path).toBe("");
      expect(draft.settings.preset).toBe("collision_splash");
      expect(draft.settings.size).toBe(0.2);
      expect(draft.content).toContain('"minecraft:particle_motion_collision"');
      expect(fileAccess).toBe(0);
    } finally {
      setActiveMcpAuthoringStage(originalStage);
      if (originalTool) Object.defineProperty(tools, "manage_particle", originalTool);
      else Reflect.deleteProperty(tools, "manage_particle");
      originalKeys.forEach((key, index) => {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
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
    let live = 0, disposed = 0, deleted = 0, written = 0, fileReads = 0;
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
        // Standalone preview must not require native Animation file registration.
        particle_effects: {},
      });
      define("WinterskyScene", { global_options: { tick_rate: 30 } });
      define("Wintersky", { Config: FakeConfig, Emitter: FakeEmitter });
      define("requireNativeModule", (name: string) => name === "fs"
        ? { existsSync: () => true, readFileSync: () => { fileReads += 1; return loaded.content; },
            writeFileSync: () => { written += 1; } }
        : name === "path" ? { dirname: () => "/model", join: (...args: string[]) => args.join("/") } : undefined);
      expect(startStudioPreview(project as never, loaded, "", { ...settings, size: 0.3 }))
        .toContain("not saved");
      expect(live).toBe(1);
      expect((constructed[0].document.particle_effect.components as any)
        ["minecraft:particle_appearance_billboard"].size).toEqual([0.3, 0.3]);
      expect(existingConfig.sentinel).toBe("animation-unchanged");
      expect(written).toBe(0);
      expect(fileReads).toBe(0); // Slider preview must not synchronously read disk.
      expect(() => startStudioPreview(project as never, loaded, "", { ...settings, size: 9 }))
        .toThrow(/Size must be/);
      expect(live).toBe(1); // Invalid draft retains the last valid preview.
      expect(startStudioPreview(project as never, loaded, "", { ...settings, size: 0.4 }))
        .toContain("not saved");
      expect(live).toBe(1);
      expect(deleted).toBe(1);
      expect(disposed).toBe(1);
      expect(studioPreviewStatus(project as never)).toContain("unsaved preview");
      expect(startStudioPreview(project as never, loaded, "", { ...settings, size: 0.4 }))
        .toContain("up to date");
      expect(deleted).toBe(1); // Identical slider values are coalesced.
      expect(startStudioPreview(project as never, loaded, "", { ...settings, size: 0.4 }, true))
        .toContain("not saved"); // Explicit Replay resets even with identical settings.
      expect(deleted).toBe(2);
      stopStudioPreview();
      expect(live).toBe(0);
      expect(deleted).toBe(3);
      expect(disposed).toBe(3);
      expect(written).toBe(0);
      expect(fileReads).toBe(0);
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
    expect(panel).toContain("Preview New Effect");
    expect(panel).toContain("Save Particle");
    expect(ui).toContain("prepareStudioParticleDraft(project");
    expect(ui).toContain("() => true, true");
    expect(studio).toContain("preview: false");
    expect(studio).not.toContain('preview_load_call !== "INVOKED"');
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
