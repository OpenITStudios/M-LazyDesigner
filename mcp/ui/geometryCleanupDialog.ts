/// <reference types="blockbench-types" />
import { getAllToolDefinitions, tools } from "@/lib/factories";
import { getActiveMcpAuthoringStage } from "@/lib/capabilities/authoringStage";
import {
  getRuntimeLifecycleSnapshot,
  isRuntimeGenerationCurrent,
  runRuntimeOperationExclusive,
} from "@/lib/runtime/lifecycle";
import { requireBedrockEditorProject } from "@/ui/authoringTools";

type CleanupField = "bounds" | "rotation";
type CleanupRequest = {
  operation: "simplify";
  ids: string[];
  increment: number;
  fields: CleanupField[];
  dry_run: boolean;
};
type CleanupFidelity = {
  mapped_texture_stretch_risk_count: number;
  incomplete_face_inventory_count: number;
  box_uv_template_review_count: number;
};
type CleanupPlan = {
  project: object;
  generation: number;
  request: CleanupRequest;
  source: string;
  updates: Record<string, unknown>[];
  updatesSignature: string;
  fidelity: CleanupFidelity;
};
let inputDialog: Dialog | null = null;
let reviewDialog: Dialog | null = null;
let dialogEpoch = 0;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function selectedIds(): string[] {
  const ids = (typeof Cube === "undefined" ? [] : Cube.selected ?? [])
    .map((cube) => cube.uuid);
  if (ids.length < 1 || ids.length > 32 || new Set(ids).size !== ids.length) {
    throw new Error("Select 1–32 distinct Cubes before running Safe Cube Cleanup.");
  }
  return ids;
}

function assertCurrentTarget(project: object, ids: readonly string[]): void {
  requireBedrockEditorProject();
  if (Project !== project) throw new Error("Project changed. Review the cleanup again.");
  if (getActiveMcpAuthoringStage() !== "geometry" || !tools.manage_cubes?.enabled) {
    throw new Error("Geometry authoring is not active. Finish the current AI Stage before editing.");
  }
  if (JSON.stringify(selectedIds()) !== JSON.stringify(ids)) {
    throw new Error("Selection changed. Review the cleanup again.");
  }
}

/** Bind review to parent transforms as well as Cube/UV state; a stale proposal must not apply. */
function captureParentChain(cube: Cube) {
  const chain: Array<{
    uuid: string;
    origin: number[];
    rotation: number[];
    visibility: boolean;
  }> = [];
  let parent: unknown = cube.parent;
  const seen = new Set<string>();
  while (typeof Group !== "undefined" && parent instanceof Group) {
    if (seen.has(parent.uuid)) throw new Error("Cyclic Group ancestry; cleanup is not safe.");
    seen.add(parent.uuid);
    chain.push({
      uuid: parent.uuid,
      origin: [...parent.origin],
      rotation: [...parent.rotation],
      visibility: parent.visibility,
    });
    parent = parent.parent;
  }
  return chain;
}

/** Exact bounded review inputs, not a saved model/visual-quality fingerprint. */
export function captureCubeCleanupSource(ids: readonly string[]): string {
  requireBedrockEditorProject();
  return JSON.stringify({
    project: {
      uuid: Project.uuid,
      format: Project.format?.id,
      box_uv: Project.box_uv,
      texture_width: Project.texture_width,
      texture_height: Project.texture_height,
    },
    cubes: ids.map((id) => {
      const matches = Cube.all.filter((cube) => cube.uuid === id);
      if (matches.length !== 1) throw new Error("Cube identity changed. Review the cleanup again.");
      const cube = matches[0];
      const faces = Object.entries(cube.faces ?? {}).map(([name, face]) => {
        const entry = face as CubeFace;
        return [name, entry?.uv ? [...entry.uv] : null,
          entry?.texture ?? null, entry?.rotation ?? null, entry?.enabled ?? null,
          entry?.material_name ?? null];
      });
      return {
        id, parent_chain: captureParentChain(cube),
        from: [...cube.from], to: [...cube.to], origin: [...cube.origin],
        rotation: [...cube.rotation], inflate: cube.inflate ?? 0, box_uv: cube.box_uv,
        mirror_uv: cube.mirror_uv, uv_offset: [...cube.uv_offset],
        autouv: cube.autouv, visibility: cube.visibility, faces,
      };
    }),
  });
}

function captureTargetSource(ids: readonly string[]): string {
  return captureCubeCleanupSource(ids);
}

/** Missing or malformed UV-risk evidence cannot authorize Apply. */
export function requireCleanupFidelity(receipt: Record<string, unknown>): CleanupFidelity {
  const raw = receipt.simplification_fidelity;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Cleanup fidelity evidence is unavailable. No change was authorized.");
  }
  const data = raw as Record<string, unknown>;
  const keys = [
    "mapped_texture_stretch_risk_count",
    "incomplete_face_inventory_count",
    "box_uv_template_review_count",
  ] as const;
  for (const key of keys) {
    if (!Number.isSafeInteger(data[key]) || (data[key] as number) < 0) {
      throw new Error("Cleanup fidelity evidence is incomplete or invalid: " + key);
    }
  }
  return {
    mapped_texture_stretch_risk_count: data.mapped_texture_stretch_risk_count as number,
    incomplete_face_inventory_count: data.incomplete_face_inventory_count as number,
    box_uv_template_review_count: data.box_uv_template_review_count as number,
  };
}

function requireStructuredResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || !("structuredContent" in value)) {
    throw new Error("The native Cube tool did not return a structured receipt.");
  }
  const structured = value.structuredContent;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) {
    throw new Error("Native Cube receipt is incomplete; no new edit was authorized.");
  }
  return structured as Record<string, unknown>;
}

async function callCanonicalCubeTool(request: CleanupRequest): Promise<Record<string, unknown>> {
  const definition = getAllToolDefinitions().manage_cubes;
  if (!definition) throw new Error("Native Cube authoring is unavailable.");
  const validated = await definition.parameterSchema.parseAsync(request);
  return requireStructuredResult(await definition.execute(validated));
}

async function withNativeQueue<T>(generation: number, work: () => Promise<T>): Promise<T> {
  return runRuntimeOperationExclusive(generation, async () => {
    if (!isRuntimeGenerationCurrent(generation)) {
      throw new Error("LazyDesigner was reloaded. Reopen the tool.");
    }
    return work();
  });
}

function showFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  Blockbench.showMessageBox({
    title: "Safe Cube Cleanup",
    icon: "warning",
    message: message + " No automatic retry was attempted.",
    buttons: ["Close"],
  });
}

async function applyReviewedPlan(plan: CleanupPlan, epoch: number): Promise<void> {
  if (epoch !== dialogEpoch || !isRuntimeGenerationCurrent(plan.generation)) return;
  try {
    const receipt = await withNativeQueue(plan.generation, async () => {
      if (epoch !== dialogEpoch) throw new Error("Review has been superseded.");
      assertCurrentTarget(plan.project, plan.request.ids);
      if (captureTargetSource(plan.request.ids) !== plan.source) {
        throw new Error("Cube, hierarchy, or UV state changed after review. Run Preview again.");
      }
      if (typeof Undo !== "undefined" && Undo.current_save) {
        throw new Error("Finish the current Blockbench edit before applying Cube Cleanup.");
      }
      const current = await callCanonicalCubeTool(plan.request);
      if (!Array.isArray(current.updates) ||
        JSON.stringify(current.updates) !== plan.updatesSignature) {
        throw new Error("The cleanup plan changed after review. Run Preview again.");
      }
      const currentFidelity = requireCleanupFidelity(current);
      if (JSON.stringify(currentFidelity) !== JSON.stringify(plan.fidelity) ||
          currentFidelity.mapped_texture_stretch_risk_count > 0 ||
          currentFidelity.incomplete_face_inventory_count > 0 ||
          currentFidelity.box_uv_template_review_count > 0) {
        throw new Error("Cleanup safety review changed or requires an explicit UV decision.");
      }
      if (epoch !== dialogEpoch || captureTargetSource(plan.request.ids) !== plan.source) {
        throw new Error("Review or authored state changed while validating. Run Preview again.");
      }
      // The existing native executor rechecks all UV ownership and texture safety gates.
      return callCanonicalCubeTool({ ...plan.request, dry_run: false });
    });
    if (epoch !== dialogEpoch || !isRuntimeGenerationCurrent(plan.generation)) return;
    if (receipt.execution === "applied") {
      Blockbench.showQuickMessage("Cube cleanup applied. Use Blockbench Undo to revert.", 4000);
    } else if (receipt.execution === "unchanged") {
      Blockbench.showQuickMessage("No Cube changes were applied.", 3000);
    } else {
      showFailure(new Error("Native result is uncertain. Inspect current Cube state before another edit."));
    }
  } catch (error) {
    if (epoch === dialogEpoch) showFailure(error);
  }
}

function showPlan(plan: CleanupPlan, epoch: number): void {
  if (epoch !== dialogEpoch || !isRuntimeGenerationCurrent(plan.generation)) return;
  if (plan.updates.length === 0) {
    Blockbench.showQuickMessage("Selected Cubes already match this increment.", 3000);
    return;
  }
  const riskCount = plan.fidelity.mapped_texture_stretch_risk_count;
  const incomplete = plan.fidelity.incomplete_face_inventory_count;
  const templateReview = plan.fidelity.box_uv_template_review_count;
  const blocked = riskCount > 0 || incomplete > 0 || templateReview > 0;
  const details = plan.updates.slice(0, 6).map((update) =>
    `<li><code>${escapeHtml(String(update.id ?? "Cube"))}</code>: ${escapeHtml(
      JSON.stringify({ from: update.from, to: update.to, rotation: update.rotation })
    )}</li>`
  ).join("");
  reviewDialog?.hide();
  let submitted = false;
  reviewDialog = new Dialog({
    id: "lazydesigner_cleanup_review",
    title: "Review Cube Changes",
    width: 480,
    lines: [
      `<p>${plan.updates.length} Cube correction(s) proposed. No edit has been made.</p>`,
      `<ul style="max-height:180px;overflow:auto">${details}</ul>`,
      plan.updates.length > 6 ? "<p>Additional corrections are omitted from this preview.</p>" : "",
      blocked
        ? "<p><strong>Apply blocked:</strong> UV ownership, painted-face scaling, or Box UV template changes require an explicit UV review.</p>"
        : "<p>Applying will create one native Undo entry. This is not a visual-quality approval.</p>",
    ],
    buttons: blocked ? ["Close"] : ["Apply", "Cancel"],
    singleButton: blocked,
    confirmIndex: 0,
    cancelIndex: blocked ? 0 : 1,
    onConfirm() {
      if (!blocked && !submitted && epoch === dialogEpoch) {
        submitted = true;
        void applyReviewedPlan(plan, epoch);
      }
    },
    onCancel() {
      if (epoch === dialogEpoch) dialogEpoch += 1;
    },
  });
  reviewDialog.show();
}

async function preparePlan(
  project: object, ids: string[], request: CleanupRequest, epoch: number
): Promise<void> {
  const generation = getRuntimeLifecycleSnapshot().owner_generation;
  if (generation === null) {
    showFailure(new Error("Native plugin lifecycle is unavailable."));
    return;
  }
  try {
    const plan = await withNativeQueue(generation, async () => {
      assertCurrentTarget(project, ids);
      const source = captureTargetSource(ids);
      const receipt = await callCanonicalCubeTool(request);
      if (!Array.isArray(receipt.updates) ||
          (receipt.execution !== "planned" && receipt.execution !== "unchanged")) {
        throw new Error("Native dry-run did not return a valid Cube correction plan.");
      }
      const fidelity = requireCleanupFidelity(receipt);
      if (epoch !== dialogEpoch || captureTargetSource(ids) !== source) {
        throw new Error("Cube or project state changed during review preparation.");
      }
      return {
        project, generation, request, source,
        updates: receipt.updates as Record<string, unknown>[],
        updatesSignature: JSON.stringify(receipt.updates),
        fidelity,
      } satisfies CleanupPlan;
    });
    showPlan(plan, epoch);
  } catch (error) {
    if (epoch === dialogEpoch) showFailure(error);
  }
}

export function canOpenCubeCleanup(): boolean {
  return Boolean(
    typeof Project !== "undefined" && Project?.format?.id === "bedrock" &&
    typeof Cube !== "undefined" && Array.isArray(Cube.selected) &&
    Cube.selected.length > 0 && Cube.selected.length <= 32 &&
    getActiveMcpAuthoringStage() === "geometry" && tools.manage_cubes?.enabled
  );
}

export function openCubeCleanupDialog(): void {
  try {
    requireBedrockEditorProject();
    const ids = selectedIds();
    if (!Project) throw new Error("No project is open.");
    const project = Project;
    if (!canOpenCubeCleanup()) {
      throw new Error("Select 1–32 Cubes in the active Geometry Stage.");
    }
    // Retire prior preview/apply callbacks before constructing a new dialog.
    inputDialog?.hide();
    reviewDialog?.hide();
    reviewDialog = null;
    const epoch = ++dialogEpoch;
    inputDialog = new Dialog({
      id: "lazydesigner_cleanup_input",
      title: "Safe Cube Cleanup",
      width: 420,
      form: {
        increment: {
          label: "Grid increment (model units)",
          type: "number", value: 0.25, min: 0.01, max: 16,
          description: "Round coordinates without changing Cube count.",
        },
        fields: {
          label: "Adjust",
          type: "select", value: "bounds",
          options: { bounds: "Cube bounds", rotation: "Rotation", both: "Bounds and rotation" },
        },
      },
      buttons: ["Review Changes", "Cancel"],
      confirmIndex: 0,
      cancelIndex: 1,
      onConfirm(form) {
        const choice = String(form.fields ?? "bounds");
        const fields: CleanupField[] = choice === "both"
          ? ["bounds", "rotation"] : choice === "rotation" ? ["rotation"] : ["bounds"];
        const increment = Number(form.increment);
        // Full canonical Zod validation runs inside the serialized native queue.
        void preparePlan(project, ids, {
          operation: "simplify", ids, increment, fields, dry_run: true,
        }, epoch);
      },
      onCancel() {
        if (epoch === dialogEpoch) dialogEpoch += 1;
      },
    });
    inputDialog.show();
  } catch (error) {
    showFailure(error);
  }
}

export function cubeCleanupDialogTeardown(): void {
  dialogEpoch += 1;
  inputDialog?.hide();
  inputDialog = null;
  reviewDialog?.hide();
  reviewDialog = null;
}
