/// <reference types="blockbench-types" />
import { getAllToolDefinitions, tools } from "@/lib/factories";
import { isVerifiedParticleWriteReceipt } from "@/lib/receipts/particleMutation";
import { getActiveMcpAuthoringStage } from "@/lib/capabilities/authoringStage";
import { getRuntimeLifecycleSnapshot, isRuntimeGenerationCurrent, runRuntimeOperationExclusive } from "@/lib/runtime/lifecycle";
import {
  applyParticleOperations, createParticleDocument, inspectParticleDocument,
  parseParticleDocument, serializeParticleDocument,
  type JsonObject, type ParticleMutationOperation,
} from "@/lib/particle/document";
import { isAbsoluteFilesystemPath } from "@/lib/core/path";
import { isCanonicalParticleTextureReference } from "@/lib/particle/resourceLayout";
import type { ParticlePreviewWorkload } from "@/lib/particle/previewBudget";
import { loadNativeParticlePreview } from "@/server/tools/particle/inspection";

/** Human controls over existing Particle and Animation executors, not a second authoring engine. */
export const STUDIO_PRESETS = ["steady", "burst", "trail", "ambient", "collision_splash"] as const;
export type StudioPreset = (typeof STUDIO_PRESETS)[number];
export type StudioField = "emission" | "speed" | "size" | "lifetime" | "color" | "opacity" | "radius" | "vertical_acceleration";
export type StudioSettings = {
  identifier: string;
  preset: StudioPreset;
  emission: number;
  speed: number;
  size: number;
  lifetime: number;
  color: string;
  opacity: number;
  radius: number;
  vertical_acceleration: number;
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
    emission: 16, speed: 0.5, size: 0.1, lifetime: 1, color: "#ffffff",
    opacity: 1, radius: 0.25, vertical_acceleration: 0 };
}

/** Only filesystem operations actually exposed by Blockbench ScopedFS. */
type StudioDirent = {
  name: string;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};
type StudioFs = {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  readdirSync(path: string, options: { withFileTypes: true }): StudioDirent[];
  readFileSync(path: string, encoding: "utf8"): string;
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
  // Use canonical receipt proof, including the matching atomic writes[] entry.
  if (!isVerifiedParticleWriteReceipt(receipt) || receipt.wrote_to_path !== path) {
    throw new Error("Particle was not committed: " +
      String(receipt.preview_error || "check the verified particle write receipt"));
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
  const alpha = Array.isArray(tint.color) && tint.color.length === 4
    ? numeric(tint.color[3]) : null;
  const opacityValue = "minecraft:particle_appearance_tinting" in components
    ? alpha !== null && alpha >= 0 && alpha <= 1 && colorValue !== null ? alpha : null
    : 1;
  const shape = object(components["minecraft:emitter_shape_sphere"] ??
    components["minecraft:emitter_shape_disc"]);
  const rawRadius = numeric(shape.radius);
  const radiusValue = rawRadius !== null && rawRadius >= 0.01 && rawRadius <= 2
    ? rawRadius : null;
  const dynamics = object(components["minecraft:particle_motion_dynamic"]);
  const acceleration = dynamics.linear_acceleration;
  const rawVertical = Array.isArray(acceleration) && acceleration.length === 3
    ? numeric(acceleration[1]) : null;
  const verticalValue = rawVertical !== null && rawVertical >= -8 && rawVertical <= 8
    ? rawVertical : null;
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
      opacity: opacityValue ?? defaults.opacity,
      radius: radiusValue ?? defaults.radius,
      vertical_acceleration: verticalValue ?? defaults.vertical_acceleration,
    },
    editable: {
      emission: emissionValue !== null, speed: speedValue !== null, size: sizeValue !== null,
      lifetime: lifetimeValue !== null, color: colorValue !== null,
      opacity: opacityValue !== null, radius: radiusValue !== null,
      vertical_acceleration: verticalValue !== null,
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
      value: { color: [...rgb(settings.color), finite(settings.opacity, 0, 1, "Opacity")] } },
  ];
}
export function studioChangeOperations(loaded: StudioEffect, next: StudioSettings): object[] {
  if (loaded.settings.identifier !== next.identifier) {
    throw new Error("A particle identifier cannot be renamed from the quick controls.");
  }
  const fields: StudioField[] = ["emission", "speed", "size", "lifetime", "color", "opacity", "radius", "vertical_acceleration"];
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
    } else if (field === "radius") {
      const shape = "minecraft:emitter_shape_sphere" in components
        ? "minecraft:emitter_shape_sphere" : "minecraft:emitter_shape_disc";
      operations.push(patch(shape, "radius", finite(next.radius, 0.01, 2, "Radius")));
    } else if (field === "vertical_acceleration") {
      const dynamics = object(components["minecraft:particle_motion_dynamic"]);
      const source = dynamics.linear_acceleration;
      // Retain horizontal MoLang/forces and every unrelated dynamic field.
      if (!Array.isArray(source) || source.length !== 3)
        throw new Error("Vertical acceleration cannot replace an advanced motion vector.");
      operations.push(patch("minecraft:particle_motion_dynamic", "linear_acceleration",
        [source[0], finite(next.vertical_acceleration, -8, 8, "Vertical acceleration"), source[2]]));
    }
  }
  if (changes.includes("color") || changes.includes("opacity")) {
    const tint = object(components["minecraft:particle_appearance_tinting"]);
    const previous = tint.color;
    const sourceRgb = Array.isArray(previous) && previous.length >= 3
      ? previous.slice(0, 3) : rgb(loaded.settings.color);
    const sourceAlpha = Array.isArray(previous) && previous.length === 4 ? previous[3] : 1;
    const color = [
      ...(changes.includes("color") ? rgb(next.color) : sourceRgb),
      changes.includes("opacity") ? finite(next.opacity, 0, 1, "Opacity") : sourceAlpha,
    ];
    // A simultaneous RGB+alpha edit is one coherent patch, never two writes
    // that each reuse stale original tint values.
    operations.push("minecraft:particle_appearance_tinting" in components
      ? patch("minecraft:particle_appearance_tinting", "color", color)
      : { op: "set_component", component: "minecraft:particle_appearance_tinting", value: { color } });
  }
  return operations;
}
/**
 * ScopedFS does not expose lstatSync. A directory entry supplies its
 * non-following file kind, so symlink leaves can be rejected safely.
 */
export function isRegularStudioFile(
  fs: Pick<StudioFs, "existsSync" | "readdirSync">,
  path: StudioPath,
  file: string,
): boolean {
  if (!fs.existsSync(file)) return false;
  const name = path.basename(file);
  return fs.readdirSync(path.dirname(file), { withFileTypes: true }).some(
    entry => entry.name === name && entry.isFile() && !entry.isSymbolicLink(),
  );
}

function requireStudioExistingFile(
  project: ModelProject, fs: StudioFs, path: StudioPath, file: string,
): void {
  const folders = studioFolders(project, path).discovery;
  if (!folders.includes(path.dirname(file)) ||
      !/^[a-z0-9_.-]+\.particle\.json$/.test(path.basename(file)) ||
      !isRegularStudioFile(fs, path, file)) {
    throw new Error("Particle path is outside this project's regular files. Choose an effect from this project.");
  }
}

export function listStudioParticles(project: ModelProject): StudioFile[] {
  requireStudioProject(project);
  const { fs, path } = nativeFiles();
  const folders = studioFolders(project, path).discovery;
  const found: StudioFile[] = [];
  for (const directory of folders) {
    if (!fs.existsSync(directory)) continue;
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.isSymbolicLink() &&
        /^[a-z0-9_.-]+\.particle\.json$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      found.push({
        path: path.join(directory, entry.name),
        label: entry.name.replace(/\.particle\.json$/, "") +
          (directory === folders[0] ? "" : " (previous location)"),
      });
      if (found.length >= 64) return found;
    }
  }
  return found;
}
function readFileEffect(fs: StudioFs, path: StudioPath, file: string): StudioEffect {
  if (!isRegularStudioFile(fs, path, file)) {
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
    await canonicalParticleWrite({
      create: { identifier: draft.settings.identifier, preset: draft.settings.preset,
        texture: "textures/particle/particles", material: "particles_alpha" },
      operations: studioBootstrapOperations(settings), output: { path: file }, preview: false,
    }, file);
    // A rejected write must not destroy the current preview. Only a verified
    // committed write may retire the draft emitter.
    stopStudioPreview();
    return readFileEffect(fs, path, file);
  });
}
export async function openStudioParticle(project: ModelProject, file: string): Promise<StudioEffect> {
  return inStudioQueue(project, async () => {
    const { fs, path } = nativeFiles();
    requireStudioExistingFile(project, fs, path, file);
    // Reading a particle must not depend on native rendering or touch an
    // Animation registry. Attachment explicitly loads the effect when needed.
    return readFileEffect(fs, path, file);
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
    const { fs, path } = nativeFiles();
    // The 64-item UI listing is not an authority to reject a saved effect.
    requireStudioExistingFile(project, fs, path, loaded.path);
    if (fs.readFileSync(loaded.path, "utf8") !== loaded.content) {
      throw new Error("The particle file changed outside Particle Studio. Reopen it before editing.");
    }
    const operations = studioChangeOperations(loaded, next);
    if (!operations.length) throw new Error("No particle settings changed.");
    await canonicalParticleWrite({
      source: { path: loaded.path }, operations,
      output: { path: loaded.path }, preview: false,
    }, loaded.path);
    // No preview/lifecycle mutation before the canonical receipt confirms Save.
    stopStudioPreview();
    const updated = readFileEffect(fs, path, loaded.path);
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
): { document: JsonObject; dirty: boolean; preview_workload: ParticlePreviewWorkload } {
  const operations = studioChangeOperations(loaded, next) as ParticleMutationOperation[];
  const document = applyParticleOperations(parseParticleDocument(loaded.content), operations);
  const summary = inspectParticleDocument(document);
  const errors = summary.diagnostics.filter(d => d.severity === "error");
  if (errors.length) {
    throw new Error("Particle draft is invalid: " + errors[0].message);
  }
  return { document, dirty: operations.length > 0, preview_workload: summary.preview_workload };
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
  source_content: string;
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
function studioPreviewSignature(
  loaded: StudioEffect, settings: StudioSettings, locatorName: string,
): string {
  return JSON.stringify([loaded.path, loaded.content, locatorName, settings]);
}

export function startStudioPreview(
  project: ModelProject, loaded: StudioEffect, locatorName: string,
  settings: StudioSettings = loaded.settings,
  replay = false,
): string {
  requireStudioProject(project);
  // The hot path is intentionally filesystem-free. External file changes are
  // checked before Save/Attach, never once per slider tick.
  const draft = compileStudioDraft(loaded, settings);
  if (draft.preview_workload.state === "blocked") {
    throw new Error("Native preview blocked by authoring budget: " +
      draft.preview_workload.reason + ". The particle JSON remains savable.");
  }
  if (draft.preview_workload.state === "manual_only" && !replay) {
    throw new Error("Automatic preview paused by authoring budget: " +
      draft.preview_workload.reason + ". Use Play / Replay to preview explicitly.");
  }
  const signature = studioPreviewSignature(loaded, settings, locatorName);
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
    preview = {
      project, file: loaded.path, source_content: loaded.content,
      signature, dirty: draft.dirty, emitter, config,
    };
  } catch (error) {
    if (emitter) disposeStudioEmitter(emitter, config);
    else config.texture?.dispose();
    throw error;
  }
  return draft.dirty
    ? "Live preview updated. Changes are not saved yet."
    : "Standalone emitter started. Viewport appearance is still unverified.";
}

const STUDIO_BUILTIN_TEXTURES = new Set([
  "textures/particle/particles",
  "textures/flame_atlas",
  "textures/particle/flame_atlas",
  "textures/particle/soul",
  "textures/particle/campfire_smoke",
]);

/** Match native Blockbench's nearest particles/ parent, never arbitrary paths. */
export function studioExpectedTexturePath(
  particlePath: string, textureReference: string, path: StudioPath,
): string | null {
  if (!isAbsoluteFilesystemPath(particlePath) ||
      !isCanonicalParticleTextureReference(textureReference) ||
      STUDIO_BUILTIN_TEXTURES.has(textureReference)) return null;
  const particleFolder = path.dirname(particlePath);
  if (path.basename(particleFolder).toLowerCase() !== "particles") return null;
  return path.join(path.dirname(particleFolder), ...textureReference.split("/")) + ".png";
}

/**
 * Explicit read-only preflight for the already-selected asset. Preview
 * invocation and an emitter count are never promoted into visible-pixel proof.
 */
export function studioPreviewStatus(
  project: ModelProject, loaded?: StudioEffect | null,
  settings: StudioSettings | null = loaded?.settings ?? null,
  locatorName = "",
): string {
  if (!loaded || !settings) return "Choose a particle or prepare a new effect before checking preview.";
  // Diagnose the currently requested draft, not just the saved JSON. The
  // renderer may still show the last valid preview when a slider edit fails.
  const draft = compileStudioDraft(loaded, settings);
  const summary = inspectParticleDocument(draft.document);
  const invalid = summary.diagnostics.find(entry => entry.severity === "error");
  if (invalid) return "Particle document invalid: " + invalid.message;

  if (loaded.path) {
    const { fs, path } = nativeFiles();
    if (!fs.existsSync(loaded.path)) return "Particle JSON file is missing. Reopen or locate the effect.";
    if (!isRegularStudioFile(fs, path, loaded.path)) {
      return "Particle JSON is not a regular file. Reopen an existing effect.";
    }
    if (fs.readFileSync(loaded.path, "utf8") !== loaded.content) {
      return "Particle file changed outside Studio. Reopen it before editing or attaching.";
    }
    const textureRef = summary.texture;
    if (textureRef) {
      const expected = studioExpectedTexturePath(loaded.path, textureRef, path);
      if (expected && !fs.existsSync(expected)) {
        return "Custom texture missing: " + textureRef + ".png. Place it under the corresponding Resource Pack textures/particle folder.";
      }
      if (expected && !isRegularStudioFile(fs, path, expected)) {
        return "Particle texture reference points to a non-regular file: " + textureRef + ".png.";
      }
    }
  }
  const active = preview;
  if (summary.preview_workload.state === "blocked") {
    return "Native preview blocked by authoring budget: " + summary.preview_workload.reason +
      ". Particle JSON may still be saved.";
  }
  if (summary.preview_workload.state === "manual_only" &&
      (!active || active.signature !== studioPreviewSignature(loaded, settings, locatorName))) {
    return "Automatic preview paused by authoring budget: " + summary.preview_workload.reason +
      ". Use Play / Replay explicitly.";
  }
  if (!active || active.project !== project || active.file !== loaded.path ||
      active.source_content !== loaded.content ||
      active.signature !== studioPreviewSignature(loaded, settings, locatorName)) {
    return "Particle draft preflight clear; preview not active for current draft/locator. Play it to inspect.";
  }
  if (active.config.texture_source_category === "placeholder") {
    return "Renderer texture unresolved or still loading: " +
      (summary.texture ?? "unknown") + ". Check the texture asset and native preview.";
  }
  const count = Array.isArray(active.emitter.particles) ? active.emitter.particles.length : 0;
  if (!active.emitter.enabled || count === 0) {
    return "No active particles at this instant. Check emitter lifetime, emission and timeline.";
  }
  const gameCostNote = summary.game_cost.cost_drivers.length > 0
    ? " Game cost review: " + summary.game_cost.cost_drivers.slice(0, 3).join(", ") +
      (summary.game_cost.cost_drivers.length > 3 ? " (more in inspector)" : "") + "."
    : " No obvious static game-cost risk flagged; FPS is still unverified.";
  return count + " active particle(s)" + (active.dirty ? " (unsaved preview)" : "") +
    "; actual viewport appearance remains unverified." + gameCostNote;
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
