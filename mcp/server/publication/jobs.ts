import { randomBytes } from "node:crypto";
import { publicationRenderParameters, type PublicationRenderRequest } from "@/lib/publication/contracts";
import {
  renderPublication,
  type PublicationRenderReceipt,
} from "./execute";

/**
 * Process-local, one-job publication controller for the fixed four-tool Gateway.
 * A Cycles render may outlive the Gateway's 120s capability timeout; start
 * returns a job ID without waiting for Blender. No persistent queue/cloud jobs.
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

type PublicationRunner = (
  request: PublicationRenderRequest, signal: AbortSignal,
) => Promise<PublicationRenderReceipt>;

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

/**
 * One production instance. Injectable runner exists only to test its actual
 * async cancellation/status semantics with no Blender or editor mutation.
 */
export class PublicationRenderJobs {
  private current: RenderJobRecord | null = null;

  constructor(private readonly run: PublicationRunner = renderPublication) {}

  private requireJob(jobId: string): RenderJobRecord {
    if (!/^render_[a-f0-9]{24}$/.test(jobId) || !this.current ||
        this.current.job_id !== jobId) {
      throw new Error("PUBLICATION_RENDER_JOB_NOT_FOUND_OR_EXPIRED");
    }
    return this.current;
  }

  start(input: unknown): PublicationRenderJobStatus {
    const request = publicationRenderParameters.parse(input);
    if (this.current && (
      this.current.state === "RUNNING" ||
      this.current.state === "CANCELLING" ||
      this.current.state === "EXIT_UNCONFIRMED"
    )) {
      throw new Error(
        "PUBLICATION_RENDER_JOB_BUSY: a render is running, stopping, or process exit is unconfirmed.",
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
    this.current = job;
    // No long await inside the Gateway capability call. Asynchronous work
    // is tied to this installed plugin process, NOT to a background ChatGPT task.
    void Promise.resolve().then(() => this.run(request, job.controller.signal))
      .then(receipt => {
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

  status(jobId: string): PublicationRenderJobStatus {
    return projectJob(this.requireJob(jobId));
  }

  cancel(jobId: string): PublicationRenderJobStatus {
    const job = this.requireJob(jobId);
    if (job.state === "RUNNING") {
      job.state = "CANCELLING";
      job.controller.abort();
    }
    return projectJob(job);
  }
}

const productionJobs = new PublicationRenderJobs();

export function startPublicationRender(input: unknown): PublicationRenderJobStatus {
  return productionJobs.start(input);
}
export function getPublicationRenderJobStatus(jobId: string): PublicationRenderJobStatus {
  return productionJobs.status(jobId);
}
export function cancelPublicationRenderJob(jobId: string): PublicationRenderJobStatus {
  return productionJobs.cancel(jobId);
}
