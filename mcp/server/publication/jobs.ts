import { randomBytes } from "node:crypto";
import { publicationRenderParameters } from "@/lib/publication/contracts";
import {
  renderPublication,
  type PublicationRenderReceipt,
} from "./execute";

/**
 * Process-local, one-job publication adapter for the fixed four-tool Gateway.
 * A Cycles render may outlive the Gateway's ~120s capability call timeout;
 * START must therefore return after scheduling, not after rendering.
 *
 * This is not a generalized workflow state machine or durable render queue.
 * It holds at most ONE current job in the installed plugin process. Plugin
 * reload/restart can invalidate its handle; uncertain subprocess exit blocks
 * further jobs until an explicit native recovery/restart.
 */
export type PublicationRenderJobState =
  | "RUNNING"
  | "CANCELLING"
  | "RENDERED_DRAFT"
  | "FAILED"
  | "CANCELLED"
  | "EXIT_UNCONFIRMED";

type RenderJobRecord = {
  job_id: string;
  state: PublicationRenderJobState;
  started_at: string;
  controller: AbortController;
  receipt: PublicationRenderReceipt | null;
  error_code: string | null;
};

export type PublicationRenderJobStatus = {
  job_id: string;
  state: PublicationRenderJobState;
  started_at: string;
  receipt: PublicationRenderReceipt | null;
  error_code: string | null;
  output_is_visual_qa: false;
};

let current: RenderJobRecord | null = null;

function projectJob(job: RenderJobRecord): PublicationRenderJobStatus {
  return {
    job_id: job.job_id,
    state: job.state,
    started_at: job.started_at,
    receipt: job.receipt,
    error_code: job.error_code,
    output_is_visual_qa: false,
  };
}

function requireJob(jobId: string): RenderJobRecord {
  if (!/^render_[a-f0-9]{24}$/.test(jobId) || !current ||
      current.job_id !== jobId) {
    throw new Error("PUBLICATION_RENDER_JOB_NOT_FOUND_OR_EXPIRED");
  }
  return current;
}

export function startPublicationRender(input: unknown): PublicationRenderJobStatus {
  const request = publicationRenderParameters.parse(input);
  if (current && (
    current.state === "RUNNING" ||
    current.state === "CANCELLING" ||
    current.state === "EXIT_UNCONFIRMED"
  )) {
    throw new Error(
      "PUBLICATION_RENDER_JOB_BUSY: a render is still running, stopping, or has unconfirmed process exit.",
    );
  }
  const job: RenderJobRecord = {
    job_id: "render_" + randomBytes(12).toString("hex"),
    state: "RUNNING",
    started_at: new Date().toISOString(),
    controller: new AbortController(),
    receipt: null,
    error_code: null,
  };
  current = job;
  void renderPublication(request, job.controller.signal).then(receipt => {
    job.state = "RENDERED_DRAFT";
    job.receipt = receipt;
  }).catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    job.error_code = message.slice(0, 800);
    job.state = message.startsWith("PUBLICATION_BLENDER_EXIT_UNCONFIRMED")
      ? "EXIT_UNCONFIRMED"
      : job.controller.signal.aborted
        ? "CANCELLED"
        : "FAILED";
  });
  return projectJob(job);
}

export function getPublicationRenderJobStatus(jobId: string): PublicationRenderJobStatus {
  return projectJob(requireJob(jobId));
}

export function cancelPublicationRenderJob(jobId: string): PublicationRenderJobStatus {
  const job = requireJob(jobId);
  if (job.state === "RUNNING") {
    job.state = "CANCELLING";
    job.controller.abort();
  }
  return projectJob(job);
}
