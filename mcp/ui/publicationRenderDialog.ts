/// <reference types="blockbench-types" />
import { dirname, join } from "node:path";
import {
  publicationImageSizeForPreset,
  type PublicationImageAspect,
  type PublicationRenderRequest,
} from "@/lib/publication/contracts";
import {
  startPublicationRender,
  getPublicationRenderJobStatus,
  cancelPublicationRenderJob,
} from "@/server/publication/jobs";
import {
  getRuntimeLifecycleSnapshot,
  isRuntimeGenerationCurrent,
  runRuntimeOperationExclusive,
} from "@/lib/runtime/lifecycle";

let dialog: Dialog | null = null;
let epoch = 0;
let submitting = false;
let lastJobId: string | null = null;

function initialOutputPath(): string {
  if (!Project) return "";
  const projectFile = Project.save_path || Project.export_path;
  if (!projectFile) return "";
  const name = String(Project.name || "asset").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 72);
  return join(dirname(projectFile), name + "_publication.png");
}

function showError(error: unknown): void {
  Blockbench.showMessageBox({
    title: "LazyDesigner Render",
    icon: "warning",
    message: error instanceof Error ? error.message : String(error),
    buttons: ["Close"],
  });
}

function withCurrentRuntime<T>(work: () => T | Promise<T>): Promise<T> {
  const generation = getRuntimeLifecycleSnapshot().owner_generation;
  if (generation === null) {
    return Promise.reject(new Error("Native LazyDesigner runtime is not ready."));
  }
  return runRuntimeOperationExclusive(generation, async () => {
    if (!isRuntimeGenerationCurrent(generation)) {
      throw new Error("LazyDesigner runtime reloaded. Inspect the current render job again.");
    }
    return await work();
  });
}

export function openPublicationRenderDialog(): void {
  if (!Project || Project.format?.id !== "bedrock") {
    showError(new Error("Open an active Bedrock Entity project first."));
    return;
  }
  if (submitting) {
    Blockbench.showQuickMessage("Publication render request is being submitted.", 2500);
    return;
  }
  dialog?.hide();
  const currentEpoch = ++epoch;
  const project = Project;
  dialog = new Dialog({
    id: "lazydesigner_publication_render",
    title: "Publication Render — Blender Cycles",
    width: 500,
    lines: [
      "<p>Renders real Blockbench geometry, UV and source pixels. This is not AI image generation.</p>",
      "<p>Blender runs outside the Gateway call. Use Render Status to inspect the job; only a validated output receives a DRAFT PNG receipt.</p>",
      "<p>Supported: opaque Cube geometry with standard/PBR color, MER and normal maps. Unsupported alpha, height, or non-Cube surfaces are rejected.</p>",
    ],
    form: {
      blender_executable: {
        label: "Blender executable (absolute path)",
        type: "text",
        value: "",
        description: "A user-authorized installed Blender 5.2 executable; no remote render service.",
      },
      output_path: {
        label: "Save PNG (absolute path)",
        type: "text",
        value: initialOutputPath(),
        description: "Existing PNGs are never overwritten.",
      },
      quality: {
        label: "Render quality",
        type: "select",
        value: "publication",
        options: { preview: "Preview (640px)", publication: "Publication (2048px)", high: "High (3200px)" },
      },
      environment_mode: {
        label: "Environment lighting",
        type: "select", value: "studio",
        options: {
          studio: "Procedural studio (no external assets)",
          hdri: "User-provided HDRI (.hdr / .exr)",
        },
      },
      hdri_path: {
        label: "HDRI file (only if selected above)",
        type: "text", value: "",
        description: "Absolute local path. One-time read permission; file is never modified.",
      },
      device: {
        label: "Cycles device",
        type: "select", value: "auto",
        options: { auto: "Auto GPU (CPU fallback)", cpu: "CPU (reproducible)" },
      },
      view_transform: {
        label: "Color response",
        type: "select", value: "AgX",
        options: { AgX: "AgX (highlight rolloff)", Standard: "Standard (source color)" },
      },
      aspect: {
        label: "Image composition",
        type: "select",
        value: "square",
        options: {
          square: "Square (1:1)",
          landscape_16_9: "Landscape (16:9)",
          landscape_4_3: "Landscape (4:3)",
          portrait_4_5: "Portrait (4:5)",
        },
      },
      background: {
        label: "Studio background",
        type: "select",
        value: "dark",
        options: { dark: "Dark", light: "Light", transparent: "Transparent" },
      },
      projection: {
        label: "Projection",
        type: "select",
        value: "perspective",
        options: { perspective: "Perspective", orthographic: "Orthographic" },
      },
      camera_mode: {
        label: "Camera direction",
        type: "select",
        value: "auto",
        options: {
          auto: "Auto — evaluate geometry views",
          manual: "Manual — use exact yaw/elevation",
        },
      },
      framing_padding: {
        label: "Camera breathing room",
        type: "number", value: 1.28, min: 1.08, max: 2.2, step: 0.05,
      },
      yaw_degrees: {
        label: "Camera yaw (degrees)",
        type: "number", value: 38, min: -180, max: 180, step: 1,
      },
      elevation_degrees: {
        label: "Camera elevation (degrees)",
        type: "number", value: 18, min: -30, max: 80, step: 1,
      },
      key: {
        label: "Key light",
        type: "number", value: 1, min: 0.2, max: 2.5, step: 0.05,
      },
      fill: {
        label: "Fill light",
        type: "number", value: 1, min: 0, max: 2, step: 0.05,
      },
      rim: {
        label: "Rim light",
        type: "number", value: 1, min: 0, max: 2, step: 0.05,
      },
      softness: {
        label: "Shadow softness",
        type: "number", value: 1, min: 0.5, max: 2.5, step: 0.05,
      },
      environment: {
        label: "Environment lighting",
        type: "number", value: 1, min: 0, max: 2, step: 0.05,
      },
      exposure_ev: {
        label: "Exposure (EV)",
        type: "number", value: 0, min: -3, max: 3, step: 0.1,
      },
      glow_strength: {
        label: "Soft highlight glow",
        type: "number", value: 0.08, min: 0, max: 0.35, step: 0.01,
      },
      glow_threshold: {
        label: "Glow highlight threshold",
        type: "number", value: 2, min: 0.5, max: 20, step: 0.1,
      },
      glow_size: {
        label: "Glow spread",
        type: "number", value: 0.45, min: 0.1, max: 0.8, step: 0.05,
      },
    },
    buttons: ["Start Render", "Cancel"],
    confirmIndex: 0,
    cancelIndex: 1,
    onConfirm(form) {
      if (submitting || epoch !== currentEpoch) return;
      const quality = String(form.quality || "publication") as PublicationRenderRequest["quality"];
      const aspect = String(form.aspect || "square") as PublicationImageAspect;
      let dimensions: { width: number; height: number };
      try {
        dimensions = publicationImageSizeForPreset(quality, aspect);
      } catch (error) {
        showError(error);
        return;
      }
      submitting = true;
      void withCurrentRuntime(() => {
        if (Project !== project) throw new Error("Project changed before render was queued.");
        return startPublicationRender({
          blender_executable: String(form.blender_executable || ""),
          output_path: String(form.output_path || ""),
          quality,
          ...dimensions,
          background: String(form.background || "dark"),
          environment: String(form.environment_mode || "studio") === "hdri"
            ? { mode: "hdri", hdri_path: String(form.hdri_path || "") }
            : { mode: "studio" },
          device: String(form.device || "auto"),
          view_transform: String(form.view_transform || "AgX"),
          camera: {
            mode: String(form.camera_mode || "auto"),
            framing_padding: Number(form.framing_padding ?? 1.28),
            yaw_degrees: Number(form.yaw_degrees ?? 38),
            elevation_degrees: Number(form.elevation_degrees ?? 18),
            projection: String(form.projection || "perspective"),
          },
          look: {
            key: Number(form.key ?? 1),
            fill: Number(form.fill ?? 1),
            rim: Number(form.rim ?? 1),
            softness: Number(form.softness ?? 1),
            environment: Number(form.environment ?? 1),
            exposure_ev: Number(form.exposure_ev ?? 0),
            glow_strength: Number(form.glow_strength ?? 0.08),
            glow_threshold: Number(form.glow_threshold ?? 2),
            glow_size: Number(form.glow_size ?? 0.45),
          },
        });
      }).then(status => {
        lastJobId = status.job_id;
        Blockbench.showMessageBox({
          title: "LazyDesigner Render Started",
          icon: "info",
          message: "Blender Cycles job: " + status.job_id +
            "\nStatus: " + status.state +
            "\nUse Render Status to check completion. A started job is not a completed PNG.",
          buttons: ["Close"],
        });
      }).catch(showError).finally(() => { submitting = false; });
    },
  });
  dialog.show();
}

/** Explicit review action, no poll timer and no native project mutation. */
export function reviewPublicationRenderStatus(): void {
  const id = lastJobId;
  if (!id) {
    Blockbench.showQuickMessage("No publication render job started in this plugin session.", 3000);
    return;
  }
  void withCurrentRuntime(() => getPublicationRenderJobStatus(id))
    .then(status => {
      Blockbench.showMessageBox({
        title: "LazyDesigner Render Status",
        icon: status.state === "RENDERED_DRAFT" ? "check" : "info",
        message: "Job: " + status.job_id + "\nState: " + status.state +
          (status.receipt
            ? "\nPNG: " + status.receipt.output_path +
              "\nSHA-256: " + status.receipt.output_png_sha256 +
              "\nCycles device: " + status.receipt.diagnostics.renderer.device.actual +
              "\nCamera yaw: " + status.receipt.diagnostics.camera.resolved_yaw_degrees +
              "\nMeasured exposure/alpha: available in MCP receipt" +
              (status.receipt.diagnostics.warnings.length
                ? "\nDiagnostics: " + status.receipt.diagnostics.warnings.join(", ")
                : "")
            : "") +
          (status.error_code ? "\nDetail: " + status.error_code : "") +
          "\nThis is not an artistic or QA approval.",
        buttons: ["Close"],
      });
    }).catch(showError);
}

/** Cancelling is an explicit user action; completion requires observed process exit. */
export function cancelPublicationRender(): void {
  const id = lastJobId;
  if (!id) return;
  void withCurrentRuntime(() => cancelPublicationRenderJob(id))
    .then(status => {
      Blockbench.showQuickMessage(
        "Render job " + status.job_id + ": " + status.state + ". Check status for final exit.",
        4500,
      );
    }).catch(showError);
}

export function publicationRenderDialogTeardown(): void {
  epoch += 1;
  dialog?.hide();
  dialog = null;
  // This closes UI only. The Runtime owns the active process/job and its exit.
}
