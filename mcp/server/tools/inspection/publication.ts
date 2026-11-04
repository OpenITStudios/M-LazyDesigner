/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { publicationRenderParameters } from "@/lib/publication/contracts";
import { preparePublicationHandoff, publicationHandoffParameters } from "@/server/publication/handoff";
import {
  startPublicationRender,
  getPublicationRenderJobStatus,
  getPublicationRenderEvidence,
  cancelPublicationRenderJob,
} from "@/server/publication/jobs";

const jobId = z.string().regex(/^render_[a-f0-9]{24}$/);
export const publicationControlParameters = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("handoff"),
    request: publicationHandoffParameters,
  }).strict(),
  z.object({
    operation: z.literal("start"),
    request: publicationRenderParameters,
  }).strict(),
  z.object({
    operation: z.literal("status"),
    job_id: jobId,
  }).strict(),
  z.object({
    operation: z.literal("cancel"),
    job_id: jobId,
  }).strict(),
  z.object({
    operation: z.literal("preview"),
    job_id: jobId,
  }).strict(),
]);

/** One nonblocking native render service shared by AI Runtime and human UI. */
export const publicationRenderToolDoc: ToolSpec = {
  name: "render_publication",
  description: "Blender Cycles rendering from a real MCP-authored Blockbench model. handoff creates an explicit verified GLB+manifest directory for the independent Gateway blender_render controller; existing start/status/preview/cancel remain as the Blockbench-owned legacy convenience path. The independent controller can continue rendering the frozen GLB after Blockbench closes while Gateway remains running. Neither path changes native geometry/Undo. Results remain DRAFT, not visual QA PASS.",
  annotations: {
    title: "Render Publication PNG (Blender Cycles)",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  parameters: publicationControlParameters,
  status: STATUS_EXPERIMENTAL,
};

export function registerPublicationRenderTool(): void {
  createTool(
    publicationRenderToolDoc.name,
    {
      ...publicationRenderToolDoc,
      async execute(args) {
        switch (args.operation) {
          case "handoff": {
            const handoff = await preparePublicationHandoff(args.request);
            return {
              content: [{
                type: "text" as const,
                text: "Verified Blockbench snapshot exported to " + handoff.handoff_path +
                  ". To render independently, call Gateway blender_render operation=start " +
                  "with this handoff_path and an authorized Blender executable. " +
                  "Handoff files are immutable inputs; manage their retention explicitly.",
              }],
              structuredContent: handoff,
            };
          }
          case "start": {
            const status = await startPublicationRender(args.request);
            return {
              content: [{
                type: "text" as const,
                text: "Publication Cycles job started: " + status.job_id +
                  ". Poll render_publication operation=status for the actual output. " +
                  "This does not certify visual quality or successful PNG export.",
              }],
              structuredContent: status,
            };
          }
          case "status": {
            const status = getPublicationRenderJobStatus(args.job_id);
            return {
              content: [{
                type: "text" as const,
                text: "Publication render " + status.job_id + ": " + status.state +
                  " (phase: " + status.phase + ")" +
                  (status.receipt ? ". PNG saved at " + status.receipt.output_path +
                    ". Source revision at publication: " + status.receipt.source_revision_at_publication
                    : "") +
                  (status.error_code ? ". " + status.error_code : "") +
                  ". Not a visual QA verdict.",
              }],
              structuredContent: status,
            };
          }
          case "preview": {
            const evidence = getPublicationRenderEvidence(args.job_id);
            const receipt = evidence.status.receipt!;
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Actual Blender Cycles preview for " + evidence.status.job_id +
                    " (" + receipt.visual_evidence.width + "x" +
                    receipt.visual_evidence.height + "). Inspect lighting, silhouette, " +
                    "material and composition visually. This is a downsample of the final " +
                    "PNG from snapshot " + receipt.source_sha256.slice(0, 12) +
                    " (source revision at publication: " + receipt.source_revision_at_publication +
                    "), NOT AI-generated and NOT an automated quality PASS.",
                },
                {
                  type: "image" as const,
                  data: evidence.png.toString("base64"),
                  mimeType: "image/png",
                },
              ],
              structuredContent: {
                job_id: evidence.status.job_id,
                state: "RENDERED_DRAFT" as const,
                visual_evidence: receipt.visual_evidence,
                diagnostics: receipt.diagnostics,
                visual_review: "NOT_EVALUATED" as const,
              },
            };
          }
          case "cancel": {
            const status = cancelPublicationRenderJob(args.job_id);
            return {
              content: [{
                type: "text" as const,
                text: "Publication render " + status.job_id + ": " + status.state +
                  ". Cancellation does not imply the Blender process has exited until confirmed.",
              }],
              structuredContent: status,
            };
          }
        }
      },
    },
    publicationRenderToolDoc.status,
  );
}
