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
  type AuthoringCategory,
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
import { openPublicationRenderDialog, publicationRenderDialogTeardown } from "@/ui/publicationRenderDialog";

let panel: Panel | undefined;
let runtimeStatusListener: (() => void) | undefined;
let projectStateListener: (() => void) | undefined;
let panelCssHandle: { delete(): void } | undefined;
let toolsMenuAction: Action | undefined;
let uiEpoch = 0;

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
};

type HumanPanelContext = {
  runtime: {
    state: McpServerStatus;
    detail: string;
  };
  project: HumanProjectState;
  activeCategory: AuthoringCategory;
  review: GeometryIssueReview | null;
  editReview: GeometryEditReview | null;
  busy: boolean;
  error: string;
  selectionLabel: string;
  canCleanup: boolean;
  inspectionVersion: number;
};

function readHumanProjectState(): HumanProjectState {
  if (typeof Project === "undefined" || !Project) {
    return { open: false, name: "No project open", hasFolder: false };
  }

  const rawName = String(Project.name ?? "").trim();
  return {
    open: true,
    name: rawName || "Untitled project",
    hasFolder: Boolean(Project.save_path || Project.export_path),
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
          vm.selectionLabel = readHumanSelection();
          vm.canCleanup = canOpenCubeCleanup();
          // Selecting a diagnosed object is navigation, not a geometry edit.
          // Keep the issue list so the user can locate several findings in sequence.
          if (event === "update_selection" || event === "added_to_selection" ||
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
        runtimeStatusListener?.();
        runtimeStatusListener = undefined;
        projectStateListener?.();
        projectStateListener = undefined;
      },
      data: () => ({
        runtime: getStatusBarState(),
        project: readHumanProjectState(),
        canReload: canReloadLazyDesignerPlugin(),
        activeCategory: "geometry" as AuthoringCategory,
        selectionLabel: readHumanSelection(),
        canCleanup: canOpenCubeCleanup(),
        busy: false,
        error: "",
        review: null as GeometryIssueReview | null,
        editReview: null as GeometryEditReview | null,
        inspectionVersion: 0,
      }),
      methods: {
        selectCategory(this: HumanPanelContext, category: AuthoringCategory): void {
          this.activeCategory = category;
          this.canCleanup = canOpenCubeCleanup();
          this.inspectionVersion += 1;
          this.busy = false;
          this.review = null;
          this.editReview = null;
          this.error = "";
        },
        categoryLabel(category: AuthoringCategory): string {
          return category === "geometry" ? "Geometry" :
            category === "texture" ? "Texture" : "Animation";
        },
        cycleCategory(this: HumanPanelContext & { selectCategory(category: AuthoringCategory): void }, step: number): void {
          const categories: AuthoringCategory[] = ["geometry", "texture", "animation"];
          const current = categories.indexOf(this.activeCategory);
          const next = categories[(current + step + categories.length) % categories.length];
          this.selectCategory(next);
          document.getElementById("ld-tab-" + next)?.focus();
        },
        async inspectActive(this: HumanPanelContext): Promise<void> {
          if (this.busy || this.activeCategory !== "geometry") return;
          const category = this.activeCategory;
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
                Project === project && this.activeCategory === category) {
              this.review = result;
            }
          } catch (error) {
            if (requestVersion === this.inspectionVersion && mountedEpoch === uiEpoch &&
                Project === project && this.activeCategory === category) {
              this.error = error instanceof Error ? error.message : String(error);
            }
          } finally {
            if (requestVersion === this.inspectionVersion && mountedEpoch === uiEpoch) {
              this.busy = false;
            }
          }
        },
        async inspectLatestEdit(this: HumanPanelContext): Promise<void> {
          if (this.busy || this.activeCategory !== "geometry") return;
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
                Project === project && this.activeCategory === "geometry") {
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
              this.activeCategory !== "geometry" ||
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
          if (this.busy || !this.review || this.activeCategory !== "geometry") return;
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
        openPublicationRender(): void { openPublicationRenderDialog(); },
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
  release("Publication Render dialog", publicationRenderDialogTeardown);
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
