import type { IMCPTool, IMCPPrompt, IMCPResource } from "@/types";
import type { McpRegistrationProfile } from "@/lib/registrationProfile";
import type { McpAuthoringPhase } from "@/lib/authoringPhase";
import {
  canReloadLazyDesignerPlugin,
  reloadLazyDesignerPlugin,
} from "@/plugin/reload";
import {
  BLOCKIT_RUNTIME_STATUS_CHANGED,
  getStatusBarState,
  statusBarSetup,
  statusBarTeardown,
  type BlockItRuntimeStatusDetail,
  type McpServerStatus,
} from "@/ui/statusBar";
import { toolTestDialogTeardown } from "@/ui/toolTestDialog";
import { promptPreviewDialogTeardown } from "@/ui/promptPreviewDialog";
import { overrideDialogTeardown } from "@/ui/promptOverrideDialog";
import panelCSS from "@/ui/panel.css";
import template from "@/ui/panel.html";
import {
  inspectGeometryIssues,
  locateGeometryIssue,
  locateExactGeometryTarget,
  type GeometryIssue,
  type GeometryIssueReview,
} from "@/ui/authoringTools";
import {
  reviewCurrentGeometryEdit,
  requireCurrentGeometryEditReview,
  type GeometryEditCubeDiff,
  type GeometryEditReview,
} from "@/ui/geometryChangeReview";
import {
  canOpenCubeCleanup,
  openCubeCleanupDialog,
  cubeCleanupDialogTeardown,
} from "@/ui/geometryCleanupDialog";
import {
  getRuntimeLifecycleSnapshot,
  isRuntimeGenerationCurrent,
  runRuntimeOperationExclusive,
} from "@/lib/runtime/lifecycle";
import { getActiveMcpAuthoringStage } from "@/lib/capabilities/authoringStage";
import {
  studioDefaults, listStudioParticles, prepareStudioParticleDraft,
  createStudioParticle, openStudioParticle,
  saveStudioParticle, studioChangeOperations, startStudioPreview,
  stopStudioPreview, studioPreviewStatus, attachStudioParticle,
  type StudioEffect, type StudioFile, type StudioSettings,
} from "@/ui/particleStudio";

let panel: Panel | undefined;
let runtimeStatusListener: (() => void) | undefined;
let projectStateListener: (() => void) | undefined;
let panelCssHandle: { delete(): void } | undefined;
let toolsMenuAction: Action | undefined;
let uiEpoch = 0;
// One coalesced, bounded live-preview request for the one native docked panel.
// The existing Runtime operation queue remains the only native operation owner.
let studioLiveTimer: ReturnType<typeof setTimeout> | null = null;
let studioLiveGeneration = 0;
let studioLiveInputs = 0;
let studioLiveExecuting = false;
let studioLivePendingVM: HumanPanelContext | null = null;

function cancelStudioLivePreview(): void {
  studioLiveGeneration += 1;
  studioLiveInputs += 1;
  studioLivePendingVM = null;
  if (studioLiveTimer !== null) clearTimeout(studioLiveTimer);
  studioLiveTimer = null;
}

type UiSetupInput = {
  tools: Record<string, IMCPTool>;
  resources: Record<string, IMCPResource>;
  prompts: Record<string, IMCPPrompt>;
  profile: McpRegistrationProfile;
  phase: McpAuthoringPhase;
};

type HumanProjectState = {
  open: boolean;
  name: string;
  hasFolder: boolean;
  isBedrock: boolean;
};

type HumanPanelContext = {
  runtime: {
    state: McpServerStatus;
    detail: string;
  };
  project: HumanProjectState;
  review: GeometryIssueReview | null;
  editReview: GeometryEditReview | null;
  busy: boolean;
  error: string;
  selectionLabel: string;
  canCleanup: boolean;
  inspectionVersion: number;
  studioSettings: StudioSettings;
  studioLoaded: StudioEffect | null;
  studioFiles: StudioFile[];
  studioChoice: string;
  studioLocator: string;
  studioLocators: string[];
  studioBusy: boolean;
  studioError: string;
  studioNote: string;
  studioPlaying: boolean;
};

function readHumanProjectState(): HumanProjectState {
  if (typeof Project === "undefined" || !Project) {
    return { open: false, name: "No project open", hasFolder: false, isBedrock: false };
  }

  const rawName = String(Project.name ?? "").trim();
  return {
    open: true,
    name: rawName || "Untitled project",
    hasFolder: Boolean(Project.save_path || Project.export_path),
    isBedrock: Project.format?.id === "bedrock",
  };
}

function readHumanSelection(): string {
  if (typeof Project === "undefined" || !Project) return "No project selected";
  const cubes = typeof Cube === "undefined" ? 0 : Cube.selected?.length ?? 0;
  // Group.selection is instance-owned in the native API; Group.selected is not a static registry.
  const groups = typeof Group === "undefined" || !Array.isArray(Group.all)
    ? 0 : Group.all.filter((group) => group.selected === true).length;
  if (cubes) return `${cubes} Cube${cubes === 1 ? "" : "s"} selected`;
  if (groups) return `${groups} Group${groups === 1 ? "" : "s"} selected`;
  if (typeof AnimationItem !== "undefined" && AnimationItem.selected) {
    return `Animation: ${AnimationItem.selected.name}`;
  }
  return "Nothing selected";
}

function subscribeProjectState(callback: (event: string) => void): () => void {
  const events = [
    "select_project",
    "new_project",
    "setup_project",
    "load_project",
    "save_project",
    "close_project",
    "update_project_settings",
    "update_selection",
    "added_to_selection",
    "update_keyframe_selection",
    "update_texture_selection",
    "select_animation",
    "select_mode",
    "update_project_resolution",
    "finished_edit",
    "undo",
    "redo",
  ] as const;

  const listeners = events.map((event) => {
    const listener = () => callback(event);
    Blockbench.on(event, listener);
    return { event, listener };
  });
  return () => {
    for (const { event, listener } of listeners) {
      Blockbench.removeListener(event, listener);
    }
  };
}

async function copyPlainText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the DOM copy fallback below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function startPanelParticlePreview(
  project: ModelProject, effect: StudioEffect, locator: string,
  settings: StudioSettings = effect.settings, stillCurrent: () => boolean = () => true,
  replay = false,
): Promise<string> {
  const generation = getRuntimeLifecycleSnapshot().owner_generation;
  if (generation === null) throw new Error("LazyDesigner Runtime is unavailable.");
  return runRuntimeOperationExclusive(generation, async () => {
    if (!isRuntimeGenerationCurrent(generation) || Project !== project || !stillCurrent()) {
      throw new Error("Particle preview request became stale before playback.");
    }
    return startStudioPreview(project, effect, locator, settings, replay);
  });
}

function scheduleStudioLivePreview(vm: HumanPanelContext): void {
  const project = typeof Project === "undefined" ? null : Project;
  const loaded = vm.studioLoaded;
  if (!project || !loaded || vm.studioBusy) return;
  studioLivePendingVM = vm;
  studioLiveInputs += 1;
  if (studioLiveTimer !== null || studioLiveExecuting) return;
  const generation = studioLiveGeneration;
  const mountedEpoch = uiEpoch;
  // Rate limit during drag, but do not defer indefinitely until mouse release.
  studioLiveTimer = setTimeout(() => {
    studioLiveTimer = null;
    if (studioLiveGeneration !== generation || mountedEpoch !== uiEpoch ||
        Project !== project || vm.studioLoaded !== loaded || vm.studioBusy) return;
    const sequence = studioLiveInputs;
    studioLivePendingVM = null;
    const settings = { ...vm.studioSettings };
    const locator = vm.studioLocator;
    studioLiveExecuting = true;
    void startPanelParticlePreview(
      project, loaded, locator, settings,
      () => studioLiveGeneration === generation &&
        mountedEpoch === uiEpoch && vm.studioLoaded === loaded && !vm.studioBusy,
    ).then(note => {
      if (studioLiveGeneration === generation && mountedEpoch === uiEpoch &&
          Project === project && vm.studioLoaded === loaded && sequence === studioLiveInputs) {
        vm.studioNote = note;
        vm.studioError = "";
        vm.studioPlaying = true;
      }
    }).catch(error => {
      if (studioLiveGeneration === generation && mountedEpoch === uiEpoch &&
          Project === project && vm.studioLoaded === loaded && sequence === studioLiveInputs) {
        vm.studioError = error instanceof Error ? error.message : String(error);
        vm.studioPlaying = false;
      }
    }).finally(() => {
      studioLiveExecuting = false;
      const next = studioLivePendingVM;
      // A newer project/editor may have queued its first edit while a retired
      // request was still draining. Do not starve that latest input.
      if (next && studioLiveTimer === null) {
        studioLivePendingVM = null;
        scheduleStudioLivePreview(next);
      }
    });
  }, 100);
}

/** User-triggered Create/Open/Replay may enter native Animate mode, not a Stage switch. */
function enterNativeAnimateMode(): void {
  const host = globalThis as unknown as {
    Animator?: { open?: boolean };
    Modes?: { options?: { animate?: { trigger?: () => void } } };
  };
  if (!host.Animator?.open) host.Modes?.options?.animate?.trigger?.();
}

export function uiSetup(input: UiSetupInput) {
  // Keep the public setup contract stable even though normal human UI no longer
  // exposes Runtime registries or AI workflow internals.
  void input.tools;
  void input.resources;
  void input.prompts;

  // Blockbench reload order is not guaranteed to be perfectly serialized.
  // Make setup idempotent by clearing every UI/listener owner before rebuilding.
  uiTeardown();

  panelCssHandle = Blockbench.addCSS(panelCSS);
  statusBarSetup();

  panel = new Panel("mcp_panel", {
    id: "mcp_panel",
    icon: "robot",
    name: "LazyDesigner",
    default_side: "right",
    resizable: true,
    component: {
      mounted() {
        // @ts-ignore - Vue component context
        const vm = this;

        const statusHandler = (event: Event) => {
          const detail = (event as CustomEvent<BlockItRuntimeStatusDetail>).detail;
          if (!detail) return;
          vm.runtime.state = detail.state;
          vm.runtime.detail = detail.detail ?? "";
        };
        document.addEventListener(BLOCKIT_RUNTIME_STATUS_CHANGED, statusHandler);
        // Catch any transition that happened before this panel mounted.
        const current = getStatusBarState();
        vm.runtime.state = current.state;
        vm.runtime.detail = current.detail;
        runtimeStatusListener?.();
        runtimeStatusListener = () =>
          document.removeEventListener(BLOCKIT_RUNTIME_STATUS_CHANGED, statusHandler);

        const refreshProject = (event?: string) => {
          const next = readHumanProjectState();
          vm.project.open = next.open;
          vm.project.name = next.name;
          vm.project.hasFolder = next.hasFolder;
          vm.project.isBedrock = next.isBedrock;
          vm.selectionLabel = readHumanSelection();
          vm.canCleanup = canOpenCubeCleanup();
          vm.studioLocators = next.isBedrock && typeof Locator !== "undefined"
            ? [...new Set(Locator.all.map(locator => locator.name).filter(Boolean))].sort()
            : [];
          if (event === "select_mode") {
            cancelStudioLivePreview();
            stopStudioPreview();
            vm.studioPlaying = false;
          }
          if (["select_project", "new_project", "setup_project", "load_project", "close_project"].includes(event ?? "")) {
            cancelStudioLivePreview();
            stopStudioPreview();
            vm.studioLoaded = null;
            vm.studioSettings = studioDefaults();
            vm.studioFiles = [];
            vm.studioChoice = "";
            vm.studioLocator = "";
            vm.studioPlaying = false;
            vm.studioNote = "";
            vm.studioError = "";
            vm.studioBusy = false;
          }
          // Selecting a diagnosed object is navigation, not a geometry edit.
          // Keep the issue list so the user can locate several findings in sequence.
          // Saving or selecting does not invalidate a reviewed geometry edit.
          if (event === "save_project" || event === "update_selection" || event === "added_to_selection" ||
              event === "update_keyframe_selection" ||
              event === "update_texture_selection" ||
              event === "select_animation" || event === "select_mode") return;
          vm.inspectionVersion += 1;
          vm.busy = false;
          vm.review = null;
          vm.editReview = null;
          vm.error = "";
        };
        projectStateListener?.();
        projectStateListener = subscribeProjectState(refreshProject);
        refreshProject();
      },
      beforeDestroy() {
        cancelStudioLivePreview();
        stopStudioPreview();
        runtimeStatusListener?.();
        runtimeStatusListener = undefined;
        projectStateListener?.();
        projectStateListener = undefined;
      },
      data: () => ({
        runtime: getStatusBarState(),
        project: readHumanProjectState(),
        canReload: canReloadLazyDesignerPlugin(),
        selectionLabel: readHumanSelection(),
        canCleanup: canOpenCubeCleanup(),
        busy: false,
        error: "",
        review: null as GeometryIssueReview | null,
        editReview: null as GeometryEditReview | null,
        inspectionVersion: 0,
        studioSettings: studioDefaults(),
        studioLoaded: null as StudioEffect | null,
        studioFiles: [] as StudioFile[],
        studioChoice: "",
        studioLocator: "",
        studioLocators: [] as string[],
        studioBusy: false,
        studioError: "",
        studioNote: "",
        studioPlaying: false,
      }),
      methods: {
        studioLiveChanged(this: HumanPanelContext): void {
          scheduleStudioLivePreview(this);
        },
        studioRevert(this: HumanPanelContext): void {
          if (this.studioBusy || !this.studioLoaded) return;
          cancelStudioLivePreview();
          this.studioSettings = { ...this.studioLoaded.settings };
          this.studioError = "";
          this.studioNote = "Unsaved changes discarded; restoring the saved preview.";
          scheduleStudioLivePreview(this);
        },
        studioStageReady(this: HumanPanelContext): boolean {
          return this.project.isBedrock && getActiveMcpAuthoringStage() === "animation";
        },
        studioHasChanges(this: HumanPanelContext): boolean {
          const loaded = this.studioLoaded;
          if (!loaded) return false;
          if (!loaded.path) return true; // New draft has never been saved.
          // This runs during Vue rendering; never parse JSON on every drag tick.
          return (["identifier", "emission", "speed", "size", "lifetime", "color"] as const)
            .some(field => loaded.settings[field] !== this.studioSettings[field]);
        },
        studioRefresh(this: HumanPanelContext): void {
          try {
            if (!Project) throw new Error("Open a Bedrock model first.");
            if (!this.project.hasFolder) {
              this.studioFiles = [];
              this.studioNote = "Save the model first to browse its particle files. New effects can already be previewed.";
              return;
            }
            this.studioFiles = listStudioParticles(Project);
            this.studioError = "";
            this.studioNote = this.studioFiles.length
              ? "Choose an existing particle, or create a new one."
              : "No particle files found beside this model. Create one below.";
          } catch (error) {
            this.studioError = error instanceof Error ? error.message : String(error);
          }
        },
        studioReset(this: HumanPanelContext): void {
          if (this.studioBusy) return;
          cancelStudioLivePreview();
          stopStudioPreview();
          this.studioSettings = studioDefaults();
          this.studioLoaded = null;
          this.studioChoice = "";
          this.studioPlaying = false;
          this.studioError = "";
          this.studioNote = "Ready to create a new particle.";
        },
        async studioCreate(this: HumanPanelContext): Promise<void> {
          if (this.studioBusy || !Project) return;
          cancelStudioLivePreview();
          const project = Project;
          const epoch = uiEpoch;
          this.studioBusy = true;
          this.studioError = "";
          this.studioNote = "";
          try {
            const loaded = prepareStudioParticleDraft(project, { ...this.studioSettings });
            if (epoch !== uiEpoch || Project !== project) return;
            stopStudioPreview();
            this.studioLoaded = loaded;
            this.studioSettings = { ...loaded.settings };
            this.studioChoice = "";
            this.studioNote = "Unsaved particle draft ready. Adjust it and Save Particle when satisfied.";
            try {
              enterNativeAnimateMode();
              this.studioNote = await startPanelParticlePreview(project, loaded, this.studioLocator);
              this.studioPlaying = true;
            } catch (error) {
              this.studioNote += " Preview: " + (error instanceof Error ? error.message : String(error));
              this.studioPlaying = false;
            }
          } catch (error) {
            if (epoch === uiEpoch && Project === project) {
              this.studioError = error instanceof Error ? error.message : String(error);
            }
          } finally {
            if (epoch === uiEpoch && Project === project) this.studioBusy = false;
          }
        },
        async studioOpen(this: HumanPanelContext): Promise<void> {
          if (this.studioBusy || !Project || !this.studioChoice) return;
          cancelStudioLivePreview();
          const project = Project, epoch = uiEpoch;
          this.studioBusy = true;
          this.studioError = "";
          try {
            const loaded = await openStudioParticle(project, this.studioChoice);
            if (epoch !== uiEpoch || Project !== project) return;
            this.studioLoaded = loaded;
            this.studioSettings = { ...loaded.settings };
            this.studioNote = "Particle file loaded. Unsupported advanced fields are preserved.";
            try {
              enterNativeAnimateMode();
              this.studioNote = await startPanelParticlePreview(project, loaded, this.studioLocator);
              this.studioPlaying = true;
            } catch (error) {
              this.studioNote += " Preview: " + (error instanceof Error ? error.message : String(error));
              this.studioPlaying = false;
            }
          } catch (error) {
            if (epoch === uiEpoch && Project === project) {
              this.studioError = error instanceof Error ? error.message : String(error);
            }
          } finally {
            if (epoch === uiEpoch && Project === project) this.studioBusy = false;
          }
        },
        async studioSave(this: HumanPanelContext): Promise<void> {
          if (this.studioBusy || !Project || !this.studioLoaded) return;
          cancelStudioLivePreview();
          const project = Project, epoch = uiEpoch;
          const loaded = this.studioLoaded;
          const changes = { ...this.studioSettings };
          this.studioBusy = true;
          this.studioError = "";
          try {
            if (!this.project.hasFolder) {
              throw new Error("Save the model as a .bbmodel before saving the particle file.");
            }
            const newParticle = !loaded.path;
            const updated = newParticle
              ? await createStudioParticle(project, changes)
              : await saveStudioParticle(project, loaded, changes);
            if (epoch !== uiEpoch || Project !== project) return;
            this.studioLoaded = updated;
            this.studioSettings = { ...updated.settings };
            this.studioChoice = updated.path;
            if (newParticle) {
              this.studioFiles = [...this.studioFiles, {
                path: updated.path, label: updated.settings.identifier.split(":")[1],
              }].sort((a, b) => a.label.localeCompare(b.label));
            }
            this.studioNote = "Particle file saved. Preview remains separate from disk writes.";
            this.studioPlaying = false;
            try {
              this.studioNote = await startPanelParticlePreview(project, updated, this.studioLocator);
              this.studioPlaying = true;
            } catch (error) {
              this.studioNote += " Preview: " + (error instanceof Error ? error.message : String(error));
            }
          } catch (error) {
            if (epoch === uiEpoch && Project === project) {
              this.studioError = error instanceof Error ? error.message : String(error);
              this.studioPlaying = false;
            }
          } finally {
            if (epoch === uiEpoch && Project === project) this.studioBusy = false;
          }
        },
        async studioPlay(this: HumanPanelContext): Promise<void> {
          if (this.studioBusy || !Project || !this.studioLoaded) return;
          cancelStudioLivePreview();
          const project = Project, epoch = uiEpoch;
          this.studioBusy = true;
          this.studioError = "";
          try {
            enterNativeAnimateMode();
            const note = await startPanelParticlePreview(
              project, this.studioLoaded, this.studioLocator, { ...this.studioSettings },
              () => true, true,
            );
            if (epoch === uiEpoch && Project === project) {
              this.studioPlaying = true;
              this.studioNote = note;
            }
          } catch (error) {
            if (epoch === uiEpoch && Project === project) {
              this.studioPlaying = false;
              this.studioError = error instanceof Error ? error.message : String(error);
            }
          } finally {
            if (epoch === uiEpoch && Project === project) this.studioBusy = false;
          }
        },
        studioStop(this: HumanPanelContext): void {
          cancelStudioLivePreview();
          stopStudioPreview();
          this.studioPlaying = false;
          this.studioNote = "Standalone preview stopped.";
        },
        studioCheck(this: HumanPanelContext): void {
          if (!Project) return;
          this.studioNote = studioPreviewStatus(Project);
        },
        async studioAttach(this: HumanPanelContext): Promise<void> {
          if (this.studioBusy || !Project || !this.studioLoaded) return;
          cancelStudioLivePreview();
          const project = Project, epoch = uiEpoch;
          this.studioBusy = true;
          this.studioError = "";
          try {
            if (!this.studioLoaded.path) {
              throw new Error("Save this particle before attaching to an Animation.");
            }
            if (studioChangeOperations(this.studioLoaded, this.studioSettings).length) {
              throw new Error("Save your changes before attaching this particle.");
            }
            const note = await attachStudioParticle(project, this.studioLoaded, this.studioLocator);
            if (epoch === uiEpoch && Project === project) this.studioNote = note;
          } catch (error) {
            if (epoch === uiEpoch && Project === project) {
              this.studioError = error instanceof Error ? error.message : String(error);
            }
          } finally {
            if (epoch === uiEpoch && Project === project) this.studioBusy = false;
          }
        },
        async inspectActive(this: HumanPanelContext): Promise<void> {
          if (this.busy) return;
          const project = typeof Project !== "undefined" ? Project : null;
          const generation = getRuntimeLifecycleSnapshot().owner_generation;
          if (!project || generation === null) {
            this.error = "Open a Bedrock project in an active LazyDesigner plugin.";
            return;
          }
          const requestVersion = ++this.inspectionVersion;
          const mountedEpoch = uiEpoch;
          this.busy = true;
          this.review = null;
          this.editReview = null;
          this.error = "";
          try {
            const result = await runRuntimeOperationExclusive(generation, async () => {
              if (!isRuntimeGenerationCurrent(generation) || Project !== project) {
                throw new Error("Project or plugin changed before inspection.");
              }
              return inspectGeometryIssues();
            });
            if (requestVersion === this.inspectionVersion && mountedEpoch === uiEpoch &&
                isRuntimeGenerationCurrent(generation) &&
                Project === project) {
              this.review = result;
            }
          } catch (error) {
            if (requestVersion === this.inspectionVersion && mountedEpoch === uiEpoch &&
                Project === project) {
              this.error = error instanceof Error ? error.message : String(error);
            }
          } finally {
            if (requestVersion === this.inspectionVersion && mountedEpoch === uiEpoch) {
              this.busy = false;
            }
          }
        },
        async inspectLatestEdit(this: HumanPanelContext): Promise<void> {
          if (this.busy) return;
          const project = typeof Project !== "undefined" ? Project : null;
          const generation = getRuntimeLifecycleSnapshot().owner_generation;
          if (!project || generation === null) {
            this.error = "Open a Bedrock project before reviewing an edit.";
            return;
          }
          const version = ++this.inspectionVersion;
          const epoch = uiEpoch;
          this.busy = true;
          this.review = null;
          this.editReview = null;
          this.error = "";
          try {
            const result = await runRuntimeOperationExclusive(generation, async () => {
              if (epoch !== uiEpoch || !isRuntimeGenerationCurrent(generation) ||
                  Project !== project) {
                throw new Error("Project or plugin changed before the edit was reviewed.");
              }
              return reviewCurrentGeometryEdit();
            });
            if (epoch === uiEpoch && version === this.inspectionVersion &&
                Project === project) {
              this.editReview = result;
            }
          } catch (error) {
            if (epoch === uiEpoch && version === this.inspectionVersion) {
              this.error = error instanceof Error ? error.message : String(error);
            }
          } finally {
            if (epoch === uiEpoch && version === this.inspectionVersion) this.busy = false;
          }
        },
        async locateEditedCube(this: HumanPanelContext, change: GeometryEditCubeDiff): Promise<void> {
          const reviewed = this.editReview;
          if (this.busy || !reviewed || !change.canLocate ||
              !reviewed.cubes.some(c => c.uuid === change.uuid && c.kind === change.kind)) return;
          const project = typeof Project !== "undefined" ? Project : null;
          const generation = getRuntimeLifecycleSnapshot().owner_generation;
          if (!project || generation === null) {
            this.error = "Open the original project and review the edit again.";
            return;
          }
          const version = this.inspectionVersion;
          const epoch = uiEpoch;
          this.busy = true;
          this.error = "";
          try {
            await runRuntimeOperationExclusive(generation, async () => {
              if (epoch !== uiEpoch || !isRuntimeGenerationCurrent(generation) ||
                  Project !== project) {
                throw new Error("Project or plugin changed. Review the latest edit again.");
              }
              requireCurrentGeometryEditReview(reviewed);
              locateExactGeometryTarget("cube", change.uuid, project);
            });
          } catch (error) {
            if (epoch === uiEpoch && version === this.inspectionVersion) {
              this.error = error instanceof Error ? error.message : String(error);
            }
          } finally {
            if (epoch === uiEpoch && version === this.inspectionVersion) this.busy = false;
          }
        },
        openCleanup(): void {
          openCubeCleanupDialog();
        },
        async locateIssue(this: HumanPanelContext, issue: GeometryIssue): Promise<void> {
          if (this.busy || !this.review) return;
          const project = typeof Project !== "undefined" ? Project : null;
          const generation = getRuntimeLifecycleSnapshot().owner_generation;
          if (!project || generation === null) {
            this.error = "Open a Bedrock project before locating an issue.";
            return;
          }
          const version = this.inspectionVersion;
          const epoch = uiEpoch;
          this.busy = true;
          this.error = "";
          try {
            await runRuntimeOperationExclusive(generation, async () => {
              if (epoch !== uiEpoch || !isRuntimeGenerationCurrent(generation) ||
                  Project !== project) {
                throw new Error("Project or plugin changed. Run Find Geometry Issues again.");
              }
              const current = inspectGeometryIssues();
              if (!current.issues.some((entry) =>
                entry.kind === issue.kind && entry.uuid === issue.uuid && entry.code === issue.code)) {
                throw new Error("This finding is no longer current. Run Find Geometry Issues again.");
              }
              locateGeometryIssue(issue, project);
            });
          } catch (error) {
            if (epoch === uiEpoch && version === this.inspectionVersion) {
              this.error = error instanceof Error ? error.message : String(error);
            }
          } finally {
            if (epoch === uiEpoch && version === this.inspectionVersion) {
              this.busy = false;
            }
          }
        },
        runtimeStatusLabel(state: McpServerStatus): string {
          if (state === "starting") return "Starting";
          if (state === "failed") return "Needs attention";
          return "Runtime ready";
        },
        runtimeStatusMessage(state: McpServerStatus): string {
          if (state === "starting") return "Preparing AI authoring...";
          if (state === "failed") return "AI authoring is not available right now.";
          return "Local Runtime is ready. AI client connection is managed separately.";
        },
        openProjectFolder(): void {
          if (!Project || (!Project.save_path && !Project.export_path)) {
            Blockbench.showQuickMessage(
              "Save this project once to open its folder.",
              3000
            );
            return;
          }

          const action = (BarItems as unknown as {
            open_model_folder?: {
              trigger(): unknown;
              conditionMet?: () => boolean;
            };
          }).open_model_folder;

          if (!action || (action.conditionMet && !action.conditionMet())) {
            Blockbench.showQuickMessage(
              "The project folder is not available yet.",
              3000
            );
            return;
          }
          action.trigger();
        },
        reloadLazyDesigner(): void {
          if (reloadLazyDesignerPlugin()) return;
          Blockbench.showQuickMessage(
            "Reload is not available for this installation. Restart Blockbench instead.",
            4000
          );
        },
        async copyErrorDetails(this: HumanPanelContext): Promise<void> {
          const detail = String(this.runtime.detail || "").trim();
          const text = [
            "LazyDesigner support details",
            `Status: ${this.runtime.state}`,
            `Blockbench: ${Blockbench.version}`,
            `Project: ${this.project.open ? this.project.name : "No project open"}`,
            `Authoring stage: ${getActiveMcpAuthoringStage()}`,
            `Message: ${detail || "No additional error detail was reported."}`,
          ].join("\n");

          if (await copyPlainText(text)) {
            Blockbench.showQuickMessage("Error details copied.", 2500);
          } else {
            Blockbench.showQuickMessage(
              "Could not copy the error details. Check the console instead.",
              3500
            );
          }
        },
      },
      name: "mcp_panel",
      template,
    },
    expand_button: true,
  });

  // One discoverable menu entry; all authoring controls stay inside the docked panel.
  try {
    toolsMenuAction = new Action("lazydesigner_tools_panel", {
      name: "LazyDesigner Tools",
      icon: "build",
      click() {
        const current = Panels.mcp_panel as Panel | undefined;
        if (!current) return;
        if (current.folded) current.fold(false);
        if (current.slot === "float") current.moveToFront();
      },
    });
    MenuBar.addAction(toolsMenuAction, "tools");
  } catch (error) {
    toolsMenuAction?.delete();
    toolsMenuAction = undefined;
    console.warn("[LazyDesigner] Optional Tools menu shortcut unavailable", error);
  }

  return panel;
}

export function uiTeardown(): void {
  cancelStudioLivePreview();
  uiEpoch += 1; // Retire all queued inspector callbacks before any UI resource disposal.
  const release = (label: string, cleanup: () => void) => {
    try { cleanup(); }
    catch (error) { console.warn(`[LazyDesigner] ${label} cleanup failed`, error); }
  };
  release("Runtime status listener", () => runtimeStatusListener?.());
  runtimeStatusListener = undefined;
  release("Project event listeners", () => projectStateListener?.());
  projectStateListener = undefined;

  // A broken optional legacy dialog must not prevent current Panel/Action cleanup.
  release("Prompt override dialog", () => overrideDialogTeardown());
  release("Cube cleanup dialog", () => cubeCleanupDialogTeardown());
  release("Particle Studio preview", stopStudioPreview);
  release("Tool test dialog", () => toolTestDialogTeardown());
  release("Prompt preview dialog", () => promptPreviewDialogTeardown());

  release("Tools menu shortcut", () => toolsMenuAction?.delete());
  toolsMenuAction = undefined;
  release("Status indicator", statusBarTeardown);
  release("Authoring panel", () => panel?.delete());
  panel = undefined;
  release("Panel CSS", () => panelCssHandle?.delete());
  panelCssHandle = undefined;
}
