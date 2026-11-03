/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { publicationRenderParameters } from "@/lib/publication/contracts";
import {
  startPublicationRender,
  getPublicationRenderJobStatus,
  cancelPublicationRenderJob,
} from "@/server/publication/jobs";

const jobId = z.string().regex(/^render_[a-f0-9]{24}$/);
export const publicationControlParameters = z.discriminatedUnion("operation", [
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
]);

/** One nonblocking native render service shared by AI Runtime and human UI. */
export const publicationRenderToolDoc: ToolSpec = {
  name: "render_publication",
  description: "Blender Cycles publication rendering of current source-faithful Blockbench model geometry and textures. operation=start schedules an independent local render and returns a job ID quickly; operation=status checks progress/PNG receipt; operation=cancel requests termination. No 15-minute blocking Gateway call. Requires an explicit local Blender 5.2 executable and authorized output. Results remain DRAFT pending visual review, never QA PASS.",
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
                  (status.receipt ? ". PNG saved at " + status.receipt.output_path : "") +
                  (status.error_code ? ". " + status.error_code : "") +
                  ". Not a visual QA verdict.",
              }],
              structuredContent: status,
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
