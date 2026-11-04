import { randomBytes } from "node:crypto";
import {
  preparePublicationRender,
  renderPreparedPublication,
  getPublicationEvidenceBytes,
  type PreparedPublicationRender,
  type PublicationRenderReceipt,
  type PublicationRenderPhase,
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
  phase: PublicationRenderPhase;
  started_at: string;
  controller: AbortController;
  receipt: PublicationRenderReceipt | null;
  error_code: string | null;
};

export type PublicationRenderJobStatus = {
  job_id: string;
  state: PublicationRenderJobState;
  phase: PublicationRenderPhase;
  started_at: string;
  receipt: PublicationRenderReceipt | null;
  error_code: string | null;
  output_is_visual_qa: false;
};

type PublicationRunner = (
  prepared: PreparedPublicationRender,
  signal: AbortSignal,
  onPhase?: (phase: PublicationRenderPhase) => void,
) => Promise<PublicationRenderReceipt>;
type PublicationPreparer = (input: unknown) => Promise<PreparedPublicationRender>;

function projectJob(job: RenderJobRecord): PublicationRenderJobStatus {
  return {
    job_id: job.job_id,
    state: job.state,
    phase: job.phase,
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
  private preparing = false;
  private retired = false;

  constructor(
    private readonly run: PublicationRunner = renderPreparedPublication,
    private readonly prepare: PublicationPreparer = preparePublicationRender,
  ) {}

  private requireJob(jobId: string): RenderJobRecord {
    if (!/^render_[a-f0-9]{24}$/.test(jobId) || !this.current ||
        this.current.job_id !== jobId) {
      throw new Error("PUBLICATION_RENDER_JOB_NOT_FOUND_OR_EXPIRED");
    }
    return this.current;
  }

  async start(input: unknown): Promise<PublicationRenderJobStatus> {
    if (this.retired) throw new Error("PUBLICATION_RENDER_RUNTIME_RETIRED");
    if (this.preparing || (this.current && (
      this.current.state === "RUNNING" ||
      this.current.state === "CANCELLING" ||
      this.current.state === "EXIT_UNCONFIRMED"
    ))) {
      throw new Error(
        "PUBLICATION_RENDER_JOB_BUSY: a render is preparing, running, stopping, or process exit is unconfirmed.",
      );
    }
    this.preparing = true;
    let prepared: PreparedPublicationRender;
    try {
      // This await stays INSIDE the Runtime native request queue. The GLB
      // exporter must finish against one coherent project before start replies.
      prepared = await this.prepare(input);
    } finally {
      this.preparing = false;
    }
    if (this.retired) throw new Error("PUBLICATION_RENDER_RUNTIME_RETIRED");
    const job: RenderJobRecord = {
      job_id: "render_" + randomBytes(12).toString("hex"),
      state: "RUNNING",
      phase: "PREPARING_ASSETS",
      started_at: new Date().toISOString(),
      controller: new AbortController(),
      receipt: null,
      error_code: null,
    };
    this.current = job;
    // No long await inside the Gateway capability call. Asynchronous work
    // is tied to this installed plugin process, NOT to a background ChatGPT task.
    void Promise.resolve().then(() => this.run(
      prepared, job.controller.signal,
      phase => {
        // Cancellation is an authoritative user instruction. An outstanding
        // Blender callback may not turn CANCELLING back into RUNNING.
        if (job.state === "RUNNING") job.phase = phase;
      },
    ))
      .then(receipt => {
        // An accepted cancel must not be overwritten by a late worker success.
        if (job.controller.signal.aborted || job.state === "CANCELLING") {
          job.state = "CANCELLED";
          job.phase = "CANCELLED";
          job.receipt = null;
          return;
        }
        job.state = "RENDERED_DRAFT";
        job.phase = "FINISHED";
        job.receipt = receipt;
      }).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        job.error_code = message.slice(0, 800);
        job.state = message.startsWith("PUBLICATION_BLENDER_EXIT_UNCONFIRMED")
          ? "EXIT_UNCONFIRMED"
          : job.controller.signal.aborted
            ? "CANCELLED"
            : "FAILED";
        job.phase = job.state === "CANCELLED" ? "CANCELLED" : "FAILED";
      });
    return projectJob(job);
  }

  status(jobId: string): PublicationRenderJobStatus {
    return projectJob(this.requireJob(jobId));
  }

  /** Latest job shared with AI; no parallel panel-owned registry. */
  latestJobId(): string | null {
    return this.current?.job_id ?? null;
  }

  evidence(jobId: string): { status: PublicationRenderJobStatus; png: Buffer } {
    const job = this.requireJob(jobId);
    if (job.state !== "RENDERED_DRAFT" || !job.receipt) {
      throw new Error("PUBLICATION_RENDER_EVIDENCE_NOT_READY: render has not completed.");
    }
    return {
      status: projectJob(job),
      png: getPublicationEvidenceBytes(job.receipt),
    };
  }

  /** Re-enable the same process-local owner after legitimate plugin reload. */
  reactivate(): void {
    // Active/uncertain old workers remain protected by existing busy gates.
    this.retired = false;
  }

  /** Called by plugin teardown, never by ordinary panel reconstruction. */
  retire(): void {
    this.retired = true;
    const job = this.current;
    if (job && job.state === "RUNNING" && job.phase !== "PUBLISHING") {
      job.state = "CANCELLING";
      job.phase = "CANCELLING";
      job.controller.abort();
    }
  }

  cancel(jobId: string): PublicationRenderJobStatus {
    const job = this.requireJob(jobId);
    if (job.state === "RUNNING" && job.phase !== "PUBLISHING") {
      job.state = "CANCELLING";
      job.phase = "CANCELLING";
      job.controller.abort();
    }
    return projectJob(job);
  }
}

const productionJobs = new PublicationRenderJobs();

export function startPublicationRender(input: unknown): Promise<PublicationRenderJobStatus> {
  return productionJobs.start(input);
}
export function getPublicationRenderJobStatus(jobId: string): PublicationRenderJobStatus {
  return productionJobs.status(jobId);
}
export function getCurrentPublicationRenderJobId(): string | null {
  return productionJobs.latestJobId();
}
export function cancelPublicationRenderJob(jobId: string): PublicationRenderJobStatus {
  return productionJobs.cancel(jobId);
}

export function getPublicationRenderEvidence(
  jobId: string,
): { status: PublicationRenderJobStatus; png: Buffer } {
  return productionJobs.evidence(jobId);
}

export function retirePublicationRenderJobsOnPluginUnload(): void {
  productionJobs.retire();
}

export function activatePublicationRenderJobsAfterPluginLoad(): void {
  productionJobs.reactivate();
}
