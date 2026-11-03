/// <reference types="blockbench-types" />
import { dirname, join } from "node:path";
import { renderPublication } from "@/server/publication/execute";
import {
  getRuntimeLifecycleSnapshot,
  isRuntimeGenerationCurrent,
  runRuntimeOperationExclusive,
} from "@/lib/runtime/lifecycle";

let dialog: Dialog | null = null;
let epoch = 0;
let running = false;

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

export function openPublicationRenderDialog(): void {
  if (!Project || Project.format?.id !== "bedrock") {
    showError(new Error("Open an active Bedrock Entity project first."));
    return;
  }
  if (running) {
    Blockbench.showQuickMessage("Publication renderer is busy.", 2500);
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
      "<p>Render the actual model, not an AI-generated image. Requires Blender 5.2.x installed and local file/process permissions.</p>",
      "<p>The image remains DRAFT until visual review. Supported color/MER/normal PBR channels are preserved; unsupported non-Cube, height or ambiguous-alpha content is blocked.</p>",
    ],
    form: {
      blender_executable: {
        label: "Blender executable (absolute path)",
        type: "text",
        value: "",
        description: "Select the installed Blender 5.2 executable. No downloads or remote servers.",
      },
      output_path: {
        label: "Save PNG (absolute path)",
        type: "text",
        value: initialOutputPath(),
        description: "Existing images are never overwritten.",
      },
      quality: {
        label: "Render quality",
        type: "select",
        value: "publication",
        options: { preview: "Preview (640px)", publication: "Publication (2048px)", high: "High (3200px)" },
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
    },
    buttons: ["Render PNG", "Cancel"],
    confirmIndex: 0,
    cancelIndex: 1,
    onConfirm(form) {
      if (running || epoch !== currentEpoch) return;
      const generation = getRuntimeLifecycleSnapshot().owner_generation;
      if (generation === null) {
        showError(new Error("Native LazyDesigner runtime is not ready."));
        return;
      }
      const quality = String(form.quality || "publication");
      const size = quality === "preview" ? 640 : quality === "high" ? 3200 : 2048;
      running = true;
      void runRuntimeOperationExclusive(generation, async () => {
        if (!isRuntimeGenerationCurrent(generation) || Project !== project) {
          throw new Error("Project/Runtime changed before render started.");
        }
        return renderPublication({
          blender_executable: String(form.blender_executable || ""),
          output_path: String(form.output_path || ""),
          quality,
          width: size, height: size,
          background: String(form.background || "dark"),
          camera: {
            yaw_degrees: 38,
            elevation_degrees: 18,
            projection: String(form.projection || "perspective"),
          },
        });
      }).then(receipt => {
        if (isRuntimeGenerationCurrent(generation)) {
          Blockbench.showMessageBox({
            title: "LazyDesigner Render — Draft Created",
            icon: "check",
            message: "Cycles PNG: " + receipt.output_path +
              "\nSHA-256: " + receipt.output_png_sha256 +
              "\nSource unchanged and rechecked. Visual quality has not yet been reviewed.",
            buttons: ["Close"],
          });
        }
      }).catch(showError).finally(() => { running = false; });
    },
  });
  dialog.show();
}

export function publicationRenderDialogTeardown(): void {
  epoch += 1;
  dialog?.hide();
  dialog = null;
}
