/// <reference types="blockbench-types" />
import { getAllToolDefinitions, tools } from "@/lib/factories";
import { getActiveMcpAuthoringStage } from "@/lib/capabilities/authoringStage";
import { getRuntimeLifecycleSnapshot, isRuntimeGenerationCurrent, runRuntimeOperationExclusive } from "@/lib/runtime/lifecycle";
import { inspectParticleDocument, parseParticleDocument } from "@/lib/particle/document";
import { isAbsoluteFilesystemPath } from "@/lib/core/path";

/** Human controls over existing Particle and Animation executors, not a second authoring engine. */
export const STUDIO_PRESETS = ["steady", "burst", "trail", "ambient", "collision_splash"] as const;
export type StudioPreset = (typeof STUDIO_PRESETS)[number];
export type StudioField = "emission" | "speed" | "size" | "lifetime" | "color";
export type StudioSettings = {
  identifier: string;
  preset: StudioPreset;
  emission: number;
  speed: number;
  size: number;
  lifetime: number;
  color: string;
};
export type StudioEffect = {
  path: string;
  content: string;
  settings: StudioSettings;
  editable: Record<StudioField, boolean>;
};
export type StudioFile = { path: string; label: string };

export function studioDefaults(): StudioSettings {
  return { identifier: "lazydesigner:magic_flame", preset: "steady",
    emission: 16, speed: 0.5, size: 0.1, lifetime: 1, color: "#ffffff" };
}

type StudioFs = {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: "utf8"): string;
  lstatSync(path: string): { isFile(): boolean; isSymbolicLink(): boolean };
};
type StudioPath = { dirname(path: string): string; join(...paths: string[]): string; basename(path: string): string };
function nativeFiles(): { fs: StudioFs; path: StudioPath } {
  // @ts-ignore - Blockbench desktop provides the permission-gated native module API.
  const fs = requireNativeModule("fs", { message: "LazyDesigner Particle Studio reads and saves particles beside the current model." }) as StudioFs | undefined;
  // @ts-ignore - Native path module belongs to the same desktop-only filesystem boundary.
  const path = requireNativeModule("path", { message: "LazyDesigner Particle Studio resolves the current model folder." }) as StudioPath | undefined;
  if (!fs || !path) throw new Error("Particle Studio needs Blockbench desktop file access.");
  return { fs, path };
}
function studioFolder(project: ModelProject, path: StudioPath): string {
  const file = project.save_path || project.export_path;
  if (!file || !isAbsoluteFilesystemPath(file)) {
    throw new Error("Save the Bedrock model as a .bbmodel first; Particle Studio then uses its folder.");
  }
  return path.join(path.dirname(file), "particles");
}
export function studioOutputPath(folder: string, identifier: string, path: StudioPath): string {
  if (!/^[a-z0-9_.-]+:[a-z0-9_.-]+$/.test(identifier)) {
    throw new Error("Use a lowercase particle identifier like mypack:blue_flame.");
  }
  return path.join(folder, identifier.split(":")[1] + ".particle.json");
}
function requireStudioProject(project: ModelProject): void {
  if (typeof Project === "undefined" || Project !== project || project.format?.id !== "bedrock") {
    throw new Error("Open the original Bedrock Model project before using Particle Studio.");
  }
  if (getActiveMcpAuthoringStage() !== "animation" || !tools.manage_particle?.enabled) {
    throw new Error("Particle authoring requires the Animation stage. Switch through the normal LazyDesigner handoff.");
  }
}
async function inStudioQueue<T>(project: ModelProject, work: () => Promise<T>): Promise<T> {
  const generation = getRuntimeLifecycleSnapshot().owner_generation;
  if (generation === null) throw new Error("LazyDesigner Runtime is not active.");
  return runRuntimeOperationExclusive(generation, async () => {
    if (!isRuntimeGenerationCurrent(generation)) throw new Error("LazyDesigner was reloaded. Reopen Particle Studio.");
    requireStudioProject(project);
    return work();
  });
}
function receiptOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || !("structuredContent" in value)) {
    throw new Error("Particle executor did not return a structured receipt.");
  }
  const receipt = (value as { structuredContent?: unknown }).structuredContent;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("Particle executor returned an incomplete receipt.");
  }
  return receipt as Record<string, unknown>;
}
async function canonicalParticle(request: object): Promise<void> {
  const definition = getAllToolDefinitions().manage_particle;
  if (!definition || !tools.manage_particle?.enabled) throw new Error("Native Particle authoring is unavailable.");
  const receipt = receiptOf(await definition.execute(await definition.parameterSchema.parseAsync(request)));
  if (receipt.valid !== true || receipt.artifact_ready !== true ||
      receipt.preview_load_call !== "INVOKED" || receipt.preview_error !== null) {
    throw new Error("Particle was not ready for native preview: " +
      String(receipt.preview_error || "check texture dependency and particle diagnostics"));
  }
}
function finite(value: unknown, min: number, max: number, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(label + " must be between " + min + " and " + max + ".");
  }
  return number;
}
function rgb(color: string): number[] {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("Choose a six-digit RGB color.");
  return [1, 3, 5].map(i => Math.round(parseInt(color.slice(i, i + 2), 16) / 255 * 10000) / 10000);
}
function hex(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 3 || value.slice(0, 3)
    .some(x => typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1)) return null;
  return "#" + value.slice(0, 3).map((v: number) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readStudioEffect(path: string, content: string): StudioEffect {
  const document = parseParticleDocument(content);
  const diagnostics = inspectParticleDocument(document);
  if (diagnostics.diagnostics.some(d => d.severity === "error")) {
    throw new Error("Particle contains validation errors. Use the AI particle inspector before editing it.");
  }
  const effect = object(document.particle_effect);
  const description = object(effect.description);
  const components = object(effect.components);
  const steady = object(components["minecraft:emitter_rate_steady"]);
  const burst = object(components["minecraft:emitter_rate_instant"]);
  const emissionComponent = "minecraft:emitter_rate_steady" in components ? steady
    : "minecraft:emitter_rate_instant" in components ? burst : null;
  const emissionValue = emissionComponent === steady && "minecraft:emitter_rate_steady" in components
    ? numeric(steady.spawn_rate) : emissionComponent ? numeric(burst.num_particles) : null;
  const billboard = object(components["minecraft:particle_appearance_billboard"]);
  const sizeValue = Array.isArray(billboard.size) && billboard.size.length === 2 &&
    numeric(billboard.size[0]) !== null && billboard.size[0] === billboard.size[1]
    ? billboard.size[0] as number : null;
  const lifetimeValue = numeric(object(components["minecraft:particle_lifetime_expression"]).max_lifetime);
  const speedValue = numeric(components["minecraft:particle_initial_speed"]);
  const tint = object(components["minecraft:particle_appearance_tinting"]);
  const colorValue = "minecraft:particle_appearance_tinting" in components
    ? hex(tint.color) : "#ffffff";
  const defaults = studioDefaults();
  return {
    path, content,
    settings: {
      ...defaults,
      identifier: String(description.identifier ?? ""),
      preset: "minecraft:emitter_rate_instant" in components ? "burst" : "steady",
      emission: emissionValue ?? defaults.emission,
      speed: speedValue ?? defaults.speed,
      size: sizeValue ?? defaults.size,
      lifetime: lifetimeValue ?? defaults.lifetime,
      color: colorValue ?? defaults.color,
    },
    editable: {
      emission: emissionValue !== null, speed: speedValue !== null, size: sizeValue !== null,
      lifetime: lifetimeValue !== null, color: colorValue !== null,
    },
  };
}
function patch(component: string, field: string, value: unknown) {
  return { op: "patch", path: ["components", component, field], value };
}
export function studioBootstrapOperations(settings: StudioSettings): object[] {
  const burst = settings.preset === "burst" || settings.preset === "collision_splash";
  return [
    patch(burst ? "minecraft:emitter_rate_instant" : "minecraft:emitter_rate_steady",
      burst ? "num_particles" : "spawn_rate", finite(settings.emission, 1, 120, "Emission")),
    { op: "patch", path: ["components", "minecraft:particle_initial_speed"],
      value: finite(settings.speed, 0, 8, "Speed") },
    patch("minecraft:particle_lifetime_expression", "max_lifetime",
      finite(settings.lifetime, 0.1, 10, "Lifetime")),
    patch("minecraft:particle_appearance_billboard", "size",
      Array(2).fill(finite(settings.size, 0.01, 2, "Size"))),
    // The built-in particles texture is a 128x128 atlas, not a 16x16 sprite.
    // Select the documented 8x8 trail cell instead of displaying the whole sheet.
    patch("minecraft:particle_appearance_billboard", "uv",
      { texture_width: 128, texture_height: 128, uv: [40, 80], uv_size: [8, 8] }),
    { op: "set_component", component: "minecraft:particle_appearance_tinting",
      value: { color: [...rgb(settings.color), 1] } },
  ];
}
export function studioChangeOperations(loaded: StudioEffect, next: StudioSettings): object[] {
  if (loaded.settings.identifier !== next.identifier) {
    throw new Error("A particle identifier cannot be renamed from the quick controls.");
  }
  const fields: StudioField[] = ["emission", "speed", "size", "lifetime", "color"];
  const changes = fields.filter(field => loaded.settings[field] !== next[field]);
  for (const field of changes) {
    if (!loaded.editable[field]) throw new Error(field + " is advanced-authored. Edit it through the AI particle tools.");
  }
  const operations: object[] = [];
  const document = parseParticleDocument(loaded.content);
  const components = object(object(document.particle_effect).components);
  for (const field of changes) {
    if (field === "emission") {
      const instant = "minecraft:emitter_rate_instant" in components;
      operations.push(patch(instant ? "minecraft:emitter_rate_instant" : "minecraft:emitter_rate_steady",
        instant ? "num_particles" : "spawn_rate", finite(next.emission, 1, 120, "Emission")));
    } else if (field === "speed") {
      operations.push({ op: "patch", path: ["components", "minecraft:particle_initial_speed"],
        value: finite(next.speed, 0, 8, "Speed") });
    } else if (field === "size") {
      operations.push(patch("minecraft:particle_appearance_billboard", "size",
        Array(2).fill(finite(next.size, 0.01, 2, "Size"))));
    } else if (field === "lifetime") {
      operations.push(patch("minecraft:particle_lifetime_expression", "max_lifetime",
        finite(next.lifetime, 0.1, 10, "Lifetime")));
    } else if (field === "color") {
      const tint = object(components["minecraft:particle_appearance_tinting"]);
      const previous = Array.isArray(tint.color) && tint.color.length === 4 ? tint.color[3] : 1;
      const color = [...rgb(next.color), previous];
      operations.push("minecraft:particle_appearance_tinting" in components
        ? patch("minecraft:particle_appearance_tinting", "color", color)
        : { op: "set_component", component: "minecraft:particle_appearance_tinting", value: { color } });
    }
  }
  return operations;
}
export function listStudioParticles(project: ModelProject): StudioFile[] {
  requireStudioProject(project);
  const { fs, path } = nativeFiles();
  const directory = studioFolder(project, path);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter(name => /^[a-z0-9_.-]+\.particle\.json$/.test(name))
    .sort()
    .slice(0, 64)
    .map(name => ({ path: path.join(directory, name), label: name.replace(/\.particle\.json$/, "") }));
}
function readFileEffect(fs: StudioFs, file: string): StudioEffect {
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    throw new Error("The selected particle file is missing or not a regular file.");
  }
  return readStudioEffect(file, fs.readFileSync(file, "utf8"));
}
export async function createStudioParticle(project: ModelProject, settings: StudioSettings): Promise<StudioEffect> {
  return inStudioQueue(project, async () => {
    if (!STUDIO_PRESETS.includes(settings.preset)) throw new Error("Unknown Bedrock particle preset.");
    const { fs, path } = nativeFiles();
    const directory = studioFolder(project, path);
    const file = studioOutputPath(directory, settings.identifier, path);
    if (fs.existsSync(file)) throw new Error("This particle already exists. Open it instead of replacing it.");
    const operations = studioBootstrapOperations(settings);
    fs.mkdirSync(directory, { recursive: true });
    stopStudioPreview();
    await canonicalParticle({
      create: { identifier: settings.identifier, preset: settings.preset,
        texture: "textures/particle/particles", material: "particles_alpha" },
      operations, output: { path: file }, preview: true,
    });
    return readFileEffect(fs, file);
  });
}
export async function openStudioParticle(project: ModelProject, file: string): Promise<StudioEffect> {
  return inStudioQueue(project, async () => {
    if (!listStudioParticles(project).some(item => item.path === file)) {
      throw new Error("Choose a particle from this project's list.");
    }
    const { fs } = nativeFiles();
    const loaded = readFileEffect(fs, file);
    stopStudioPreview();
    await canonicalParticle({ source: { path: file }, preview: true });
    return loaded;
  });
}
export async function saveStudioParticle(project: ModelProject, loaded: StudioEffect, next: StudioSettings): Promise<StudioEffect> {
  return inStudioQueue(project, async () => {
    if (!listStudioParticles(project).some(item => item.path === loaded.path)) {
      throw new Error("Particle file is no longer in the current project.");
    }
    const { fs } = nativeFiles();
    if (fs.readFileSync(loaded.path, "utf8") !== loaded.content) {
      throw new Error("The particle file changed outside Particle Studio. Reopen it before editing.");
    }
    const operations = studioChangeOperations(loaded, next);
    if (!operations.length) throw new Error("No particle settings changed.");
    stopStudioPreview();
    await canonicalParticle({
      source: { path: loaded.path }, operations,
      output: { path: loaded.path }, preview: true,
    });
    return readFileEffect(fs, loaded.path);
  });
}
type NativeStudioEmitter = {
  enabled: boolean; particles: unknown[]; parent_mode: string;
  local_space: unknown; global_space: unknown;
  playLoop(): void; stopLoop(): void; delete(): void;
};
type StudioScene = { global_options: { tick_rate: number } };
let preview: { project: ModelProject; file: string; emitter: NativeStudioEmitter; config: Record<string, unknown> } | null = null;

export function stopStudioPreview(): void {
  const active = preview;
  preview = null;
  if (!active) return;
  try { active.emitter.stopLoop(); }
  catch (error) { console.warn("[LazyDesigner] Particle preview stop failed", error); }
  try { active.emitter.delete(); }
  catch (error) { console.warn("[LazyDesigner] Particle preview disposal failed", error); }
}
export function startStudioPreview(project: ModelProject, loaded: StudioEffect, locatorName: string): string {
  requireStudioProject(project);
  stopStudioPreview();
  const { fs } = nativeFiles();
  if (!fs.existsSync(loaded.path) || fs.readFileSync(loaded.path, "utf8") !== loaded.content) {
    throw new Error("Particle source changed. Reopen the effect before starting preview.");
  }
  const host = globalThis as unknown as {
    Wintersky?: { Emitter: new (scene: StudioScene, config: Record<string, unknown>) => NativeStudioEmitter };
    WinterskyScene?: StudioScene;
    Animator?: { particle_effects?: Record<string, { config: Record<string, unknown> }> };
    Canvas?: { scene: { add(node: unknown): void } };
  };
  const scene = host.WinterskyScene;
  const source = host.Animator?.particle_effects?.[loaded.path];
  if (!scene || !host.Wintersky?.Emitter || !source?.config || !host.Canvas?.scene) {
    throw new Error("Blockbench's Wintersky preview is unavailable. Open this effect again in Blockbench desktop.");
  }
  if (source.config.texture_source_category === "placeholder") {
    throw new Error("Particle texture is unresolved in Blockbench. Check its texture path or use a built-in texture.");
  }
  const emitter = new host.Wintersky.Emitter(scene, source.config);
  try {
    if (locatorName) {
      const locators = typeof Locator === "undefined" ? [] : Locator.all.filter(l => l.name === locatorName);
      if (locators.length !== 1 || !locators[0].mesh) throw new Error("The selected locator no longer exists.");
      locators[0].mesh.add(emitter.local_space as never);
      emitter.parent_mode = "locator";
    } else {
      emitter.parent_mode = "entity";
    }
    host.Canvas.scene.add(emitter.global_space);
    emitter.playLoop();
    preview = { project, file: loaded.path, emitter, config: source.config };
  } catch (error) {
    emitter.stopLoop();
    emitter.delete();
    throw error;
  }
  return "Standalone emitter started. Viewport visibility is not yet verified.";
}
export function studioPreviewStatus(project: ModelProject): string {
  if (!preview || preview.project !== project) return "Preview stopped.";
  const { emitter, config } = preview;
  if (config.texture_source_category === "placeholder") {
    return "Texture placeholder: the referenced PNG did not resolve.";
  }
  const count = Array.isArray(emitter.particles) ? emitter.particles.length : 0;
  if (!emitter.enabled || count === 0) {
    return "No active particles observed. Check emission, lifetime and playback.";
  }
  return count + " active particle(s); viewport appearance still requires visual review.";
}
export async function attachStudioParticle(project: ModelProject, loaded: StudioEffect, locatorName: string): Promise<string> {
  return inStudioQueue(project, async () => {
    if (!tools.manage_animation_effects?.enabled) throw new Error("Animation effects are unavailable in this stage.");
    const selected = typeof Animation !== "undefined" ? Animation.selected : null;
    if (!selected?.uuid) throw new Error("Select an Animation in Blockbench before attaching this particle.");
    if (locatorName) {
      const locators = typeof Locator === "undefined" ? [] : Locator.all.filter(l => l.name === locatorName);
      if (locators.length !== 1) throw new Error("The selected locator no longer exists.");
    }
    const def = getAllToolDefinitions().manage_animation_effects;
    if (!def) throw new Error("Native Animation effects tool is unavailable.");
    const time = typeof Timeline !== "undefined" ? Timeline.time : 0;
    const request = await def.parameterSchema.parseAsync({
      animation_id: selected.uuid,
      operations: [{ operation: "add", channel: "particle",
        time, effect: loaded.settings.identifier.split(":")[1],
        ...(locatorName ? { locator: locatorName, bind_to_actor: true } : {}) }],
    });
    const receipt = receiptOf(await def.execute(request));
    if (!Array.isArray(receipt.results)) {
      throw new Error("Animation edit was not confirmed. Inspect the native timeline before retrying.");
    }
    return "Particle added at " + time + "s. Minecraft export may require a client-entity short-name mapping.";
  });
}
