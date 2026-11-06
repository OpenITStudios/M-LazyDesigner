/// <reference types="blockbench-types" />
import { getAllToolDefinitions, tools } from "@/lib/factories";
import { getActiveMcpAuthoringStage } from "@/lib/capabilities/authoringStage";
import { getRuntimeLifecycleSnapshot, isRuntimeGenerationCurrent, runRuntimeOperationExclusive } from "@/lib/runtime/lifecycle";
import {
  applyParticleOperations, createParticleDocument, inspectParticleDocument,
  parseParticleDocument, serializeParticleDocument,
  type JsonObject, type ParticleMutationOperation,
} from "@/lib/particle/document";
import { isAbsoluteFilesystemPath } from "@/lib/core/path";
import { loadNativeParticlePreview } from "@/server/tools/particle/inspection";

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
  /** A native animation refresh warning does not invalidate a committed file. */
  refresh_warning?: string;
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
  // The native path module is an unprivileged read-only utility; unlike fs
  // its documented requireNativeModule overload does not accept a dialog.
  const path = requireNativeModule("path") as StudioPath | undefined;
  if (!fs || !path) throw new Error("Particle Studio needs Blockbench desktop file access.");
  return { fs, path };
}
/**
 * Detect only unambiguous Bedrock Resource Pack layouts. Other project
 * locations stay beside the saved .bbmodel; never guess an arbitrary pack root.
 * The old sibling path remains a read-only discovery location.
 */
export function studioParticleFoldersForModel(modelPath: string, path: StudioPath): {
  output: string;
  discovery: string[];
} {
  if (!isAbsoluteFilesystemPath(modelPath)) {
    throw new Error("Save the Bedrock model as a .bbmodel first to persist particle files.");
  }
  const modelFolder = path.dirname(modelPath);
  const parentName = path.basename(modelFolder).toLowerCase();
  const grandparent = path.dirname(modelFolder);
  const canonicalRoot = parentName === "entity" &&
    path.basename(grandparent).toLowerCase() === "models"
    ? path.dirname(grandparent)
    : parentName === "models" ? grandparent : modelFolder;
  const output = path.join(canonicalRoot, "particles");
  const previousSibling = path.join(modelFolder, "particles");
  return {
    output,
    discovery: output === previousSibling ? [output] : [output, previousSibling],
  };
}

function studioFolders(project: ModelProject, path: StudioPath) {
  const modelPath = project.save_path || project.export_path;
  return studioParticleFoldersForModel(modelPath ?? "", path);
}
function studioEffectSlug(identifier: string): string {
  const match = /^[a-z0-9_.-]+:([a-z0-9_.-]+)$/.exec(identifier);
  if (!match) throw new Error("Use a lowercase particle identifier like mypack:blue_flame.");
  return match[1];
}

export function studioOutputPath(folder: string, identifier: string, path: StudioPath): string {
  return path.join(folder, studioEffectSlug(identifier) + ".particle.json");
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
/** A completed file write is independent of renderer success or failure. */
export function requireStudioCommittedWrite(receipt: Record<string, unknown>, path: string): void {
  if (receipt.valid !== true || receipt.artifact_ready !== true || receipt.wrote_to_path !== path) {
    throw new Error("Particle was not committed: " +
      String(receipt.preview_error || "check the structured write receipt and diagnostics"));
  }
}

async function canonicalParticleWrite(request: object, path: string): Promise<void> {
  const definition = getAllToolDefinitions().manage_particle;
  if (!definition || !tools.manage_particle?.enabled) throw new Error("Native Particle authoring is unavailable.");
  const receipt = receiptOf(await definition.execute(await definition.parameterSchema.parseAsync(request)));
  requireStudioCommittedWrite(receipt, path);
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
  const folders = studioFolders(project, path).discovery;
  const found: StudioFile[] = [];
  for (const directory of folders) {
    if (!fs.existsSync(directory)) continue;
    const entries = fs.readdirSync(directory)
      .filter(name => /^[a-z0-9_.-]+\.particle\.json$/.test(name))
      .sort();
    for (const name of entries) {
      const candidate = path.join(directory, name);
      if (!fs.lstatSync(candidate).isFile() || fs.lstatSync(candidate).isSymbolicLink()) continue;
      found.push({
        path: candidate,
        label: name.replace(/\.particle\.json$/, "") +
          (directory === folders[0] ? "" : " (previous location)"),
      });
      if (found.length >= 64) return found;
    }
  }
  return found;
}
function readFileEffect(fs: StudioFs, file: string): StudioEffect {
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    throw new Error("The selected particle file is missing or not a regular file.");
  }
  return readStudioEffect(file, fs.readFileSync(file, "utf8"));
}
/** A new particle exists only in memory until the user explicitly saves it. */
export function prepareStudioParticleDraft(project: ModelProject, settings: StudioSettings): StudioEffect {
  requireStudioProject(project);
  studioEffectSlug(settings.identifier);
  if (!STUDIO_PRESETS.includes(settings.preset)) throw new Error("Unknown Bedrock particle preset.");
  const source = createParticleDocument({
    identifier: settings.identifier, preset: settings.preset,
    texture: "textures/particle/particles", material: "particles_alpha",
  });
  const compiled = applyParticleOperations(
    source, studioBootstrapOperations(settings) as ParticleMutationOperation[],
  );
  const errors = inspectParticleDocument(compiled).diagnostics.filter(d => d.severity === "error");
  if (errors.length) throw new Error("Particle draft is invalid: " + errors[0].message);
  // The source JSON does not encode which quick-start family authored it.
  // Preserve the chosen family in the unsaved draft until the first Save.
  const draft = readStudioEffect("", serializeParticleDocument(compiled));
  return { ...draft, settings: { ...draft.settings, preset: settings.preset } };
}

export async function createStudioParticle(project: ModelProject, settings: StudioSettings): Promise<StudioEffect> {
  return inStudioQueue(project, async () => {
    // Same compiler as Preview; never save a second, subtly different effect.
    const draft = prepareStudioParticleDraft(project, settings);
    const { fs, path } = nativeFiles();
    const folders = studioFolders(project, path);
    const directory = folders.output;
    const file = studioOutputPath(directory, draft.settings.identifier, path);
    if (folders.discovery.some(folder =>
      fs.existsSync(studioOutputPath(folder, draft.settings.identifier, path)))) {
      throw new Error("This particle already exists in the project's current or previous folder. Open it instead.");
    }
    fs.mkdirSync(directory, { recursive: true });
    stopStudioPreview();
    await canonicalParticleWrite({
      create: { identifier: draft.settings.identifier, preset: draft.settings.preset,
        texture: "textures/particle/particles", material: "particles_alpha" },
      operations: studioBootstrapOperations(settings), output: { path: file }, preview: false,
    }, file);
    return readFileEffect(fs, file);
  });
}
export async function openStudioParticle(project: ModelProject, file: string): Promise<StudioEffect> {
  return inStudioQueue(project, async () => {
    if (!listStudioParticles(project).some(item => item.path === file)) {
      throw new Error("Choose a particle from this project's list.");
    }
    const { fs } = nativeFiles();
    // Reading a particle must not depend on native rendering or touch an
    // Animation registry. Attachment explicitly loads the effect when needed.
    return readFileEffect(fs, file);
  });
}
/** Refresh only an already native-loaded effect, without registering unrelated files. */
export function refreshRegisteredStudioParticle(path: string, content: string): string | null {
  const host = typeof Animator === "undefined" ? null : Animator as unknown as {
    particle_effects?: Record<string, unknown>;
  };
  if (!host?.particle_effects?.[path]) return null;
  try {
    loadNativeParticlePreview(path, content);
    return null;
  } catch (error) {
    // The file write has already succeeded; an optional native reload failure
    // is not permission to replay or roll back a committed transaction.
    return error instanceof Error ? error.message : String(error);
  }
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
    await canonicalParticleWrite({
      source: { path: loaded.path }, operations,
      output: { path: loaded.path }, preview: false,
    }, loaded.path);
    const updated = readFileEffect(fs, loaded.path);
    const refreshWarning = refreshRegisteredStudioParticle(loaded.path, updated.content);
    return refreshWarning ? { ...updated, refresh_warning: refreshWarning } : updated;
  });
}
/**
 * The live draft is compiled from the exact loaded JSON and never writes it.
 * Existing curves, events and unknown fields are retained by the same lossless
 * mutation owner used by manage_particle on Apply.
 */
export function compileStudioDraft(
  loaded: StudioEffect, next: StudioSettings,
): { document: JsonObject; dirty: boolean } {
  const operations = studioChangeOperations(loaded, next) as ParticleMutationOperation[];
  const document = applyParticleOperations(parseParticleDocument(loaded.content), operations);
  const errors = inspectParticleDocument(document).diagnostics.filter(d => d.severity === "error");
  if (errors.length) {
    throw new Error("Particle draft is invalid: " + errors[0].message);
  }
  return { document, dirty: operations.length > 0 };
}

type NativeStudioConfig = {
  texture_source_category?: string;
  texture?: { dispose(): void };
};
type NativeStudioEmitter = {
  enabled: boolean; particles: unknown[]; parent_mode: string;
  local_space: unknown; global_space: unknown;
  playLoop(): void; stopLoop(): void; delete(): void;
};
type StudioScene = { global_options: { tick_rate: number } };
type StudioPreview = {
  project: ModelProject;
  file: string;
  signature: string;
  dirty: boolean;
  emitter: NativeStudioEmitter;
  config: NativeStudioConfig;
};
let preview: StudioPreview | null = null;

function disposeStudioEmitter(emitter: NativeStudioEmitter, config: NativeStudioConfig): void {
  try { emitter.stopLoop(); }
  catch (error) { console.warn("[LazyDesigner] Particle preview stop failed", error); }
  try { emitter.delete(); }
  catch (error) { console.warn("[LazyDesigner] Particle preview disposal failed", error); }
  try { config.texture?.dispose(); }
  catch (error) { console.warn("[LazyDesigner] Particle preview texture cleanup failed", error); }
}

export function stopStudioPreview(): void {
  const active = preview;
  preview = null;
  if (active) disposeStudioEmitter(active.emitter, active.config);
}

/**
 * Preview gets its own Wintersky Config so an unsaved slider edit cannot touch
 * Animator.particle_effects (including any existing animation keyframes).
 * Blockbench's Animation mode mounts WinterskyScene.space and updates billboards.
 */
export function startStudioPreview(
  project: ModelProject, loaded: StudioEffect, locatorName: string,
  settings: StudioSettings = loaded.settings,
  replay = false,
): string {
  requireStudioProject(project);
  // The hot path is intentionally filesystem-free. External file changes are
  // checked before Save/Attach, never once per slider tick.
  const draft = compileStudioDraft(loaded, settings);
  const signature = JSON.stringify([loaded.path, loaded.content, locatorName, settings]);
  if (!replay && preview?.project === project && preview.signature === signature) {
    return draft.dirty ? "Live preview reflects unsaved changes." : "Preview is already up to date.";
  }
  const host = globalThis as unknown as {
    Wintersky?: {
      Config: new (scene: StudioScene, document: JsonObject, options: { path: string }) => NativeStudioConfig;
      Emitter: new (scene: StudioScene, config: NativeStudioConfig) => NativeStudioEmitter;
    };
    WinterskyScene?: StudioScene;
    Animator?: { open?: boolean };
  };
  const scene = host.WinterskyScene;
  if (!host.Animator?.open || !scene || !host.Wintersky?.Config || !host.Wintersky.Emitter) {
    throw new Error("Switch Blockbench to Animate mode to display Particle Studio preview.");
  }
  // New drafts have no file_path; vanilla textures still render from Wintersky.
  // Saved files retain their real path so native custom-texture resolution works.
  const config = new host.Wintersky.Config(scene, draft.document, { path: loaded.path });
  let emitter: NativeStudioEmitter | null = null;
  try {
    emitter = new host.Wintersky.Emitter(scene, config);
    if (locatorName) {
      const locators = typeof Locator === "undefined" ? [] : Locator.all.filter(l => l.name === locatorName);
      if (locators.length !== 1 || !locators[0].mesh) throw new Error("The selected locator no longer exists.");
      locators[0].mesh.add(emitter.local_space as never);
      emitter.parent_mode = "locator";
    } else {
      emitter.parent_mode = "entity";
    }
    // Native Emitter.start() mounts global_space into WinterskyScene.space.
    // Do not mount a second copy directly into the Blockbench Canvas scene.
    emitter.playLoop();
    stopStudioPreview();
    preview = { project, file: loaded.path, signature, dirty: draft.dirty, emitter, config };
  } catch (error) {
    if (emitter) disposeStudioEmitter(emitter, config);
    else config.texture?.dispose();
    throw error;
  }
  return draft.dirty
    ? "Live preview updated. Changes are not saved yet."
    : "Standalone emitter started. Viewport appearance is still unverified.";
}

export function studioPreviewStatus(project: ModelProject): string {
  if (!preview || preview.project !== project) return "Preview stopped.";
  const { emitter, config, dirty } = preview;
  if (config.texture_source_category === "placeholder") {
    return "Texture placeholder: the referenced PNG did not resolve.";
  }
  const count = Array.isArray(emitter.particles) ? emitter.particles.length : 0;
  if (!emitter.enabled || count === 0) {
    return "No active particles observed. Check emission, lifetime and playback.";
  }
  return count + " active particle(s)" + (dirty ? " (unsaved preview)" : "") +
    "; viewport appearance still requires visual review.";
}
export async function attachStudioParticle(project: ModelProject, loaded: StudioEffect, locatorName: string): Promise<string> {
  return inStudioQueue(project, async () => {
    if (!tools.manage_animation_effects?.enabled) throw new Error("Animation effects are unavailable in this stage.");
    if (!loaded.path) throw new Error("Save this particle before attaching it to an Animation.");
    const { fs } = nativeFiles();
    if (!fs.existsSync(loaded.path) || fs.readFileSync(loaded.path, "utf8") !== loaded.content) {
      throw new Error("Particle file changed. Reopen it before attaching to an Animation.");
    }
    const selected = typeof Animation !== "undefined" ? Animation.selected : null;
    if (!selected?.uuid) throw new Error("Select an Animation in Blockbench before attaching this particle.");
    if (locatorName) {
      const locators = typeof Locator === "undefined" ? [] : Locator.all.filter(l => l.name === locatorName);
      if (locators.length !== 1) throw new Error("The selected locator no longer exists.");
    }
    const def = getAllToolDefinitions().manage_animation_effects;
    if (!def) throw new Error("Native Animation effects tool is unavailable.");
    const time = typeof Timeline !== "undefined" ? Timeline.time : 0;
    const snappedTime = Timeline.snapTime(time, selected);
    const effectName = loaded.settings.identifier.split(":")[1];
    const registry = (Animator as unknown as {
      particle_effects?: Record<string, { config?: { identifier?: string } }>;
    }).particle_effects ?? {};
    const conflicts = Object.entries(registry).filter(([path, entry]) =>
      path !== loaded.path && entry.config?.identifier?.split(":")[1] === effectName);
    if (conflicts.length) {
      throw new Error("Another particle uses the same short name. Choose a unique identifier before attaching.");
    }
    // The global Animation registry is touched only at explicit attachment,
    // never by live authoring previews or opening an existing JSON file.
    loadNativeParticlePreview(loaded.path, loaded.content);
    const registered = registry[loaded.path]?.config?.identifier;
    if (registered !== loaded.settings.identifier) {
      throw new Error("Blockbench registered a different particle identifier. No Animation edit was applied.");
    }
    const keyframes = selected.animators.effects?.particle ?? [];
    const sameTime = keyframes.filter(key => Math.abs(key.time - snappedTime) < 0.001);
    if (sameTime.length > 1) {
      throw new Error("Multiple particle keyframes at this time. Resolve ambiguous tracks in Blockbench.");
    }
    const matches = sameTime.flatMap(key => key.data_points.map((point, index) =>
      ({ key, point, index }))).filter(entry =>
        entry.point.effect === effectName || entry.point.effect === loaded.settings.identifier);
    if (matches.length > 1) {
      throw new Error("This effect appears multiple times at the playhead. Select the intended keyframe manually.");
    }
    if (matches.length === 1 && matches[0].point.file === loaded.path &&
        (matches[0].point.locator || "") === locatorName) {
      return "Particle is already attached at the selected playhead.";
    }
    const operation = matches.length === 1
      ? { operation: "update", channel: "particle",
          keyframe_uuid: matches[0].key.uuid, data_point_index: matches[0].index,
          effect: matches[0].point.effect, locator: locatorName || null }
      : { operation: "add", channel: "particle",
          time: snappedTime, effect: effectName,
          ...(locatorName ? { locator: locatorName, bind_to_actor: true } : {}) };
    const request = await def.parameterSchema.parseAsync({
      animation_id: selected.uuid, operations: [operation],
    });
    const receipt = receiptOf(await def.execute(request));
    if (!Array.isArray(receipt.results)) {
      throw new Error("Animation edit was not confirmed. Inspect the native timeline before retrying.");
    }
    return (matches.length ? "Existing particle binding repaired at " : "Particle added at ") +
      snappedTime + "s. Minecraft export may require a client-entity short-name mapping.";
  });
}
