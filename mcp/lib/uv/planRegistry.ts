import { createHash } from "node:crypto";
import type { UvLayoutPlan } from "@/lib/uv/contracts";
import type { UvDryRunReport } from "@/lib/uv/dryRun";

/** Automatic native atlas dimensions/identity are plan inputs, not public UV state. */
export type UvAutoBitmapSource = Readonly<{
  width: number;
  height: number;
  atlas_uuid?: string;
}>;

export type UvStoredPlan = {
  plan_id: string;
  source_fingerprint: string;
  plan: UvLayoutPlan;
  report: UvDryRunReport;
  /** Absent for explicit pre-atlas bitmap dimensions. */
  auto_bitmap_source?: UvAutoBitmapSource;
};

export class UvPlanRegistry {
  private readonly entries = new Map<string, UvStoredPlan>();

  constructor(private readonly maxEntries = 16) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("UV plan registry maxEntries must be a positive integer.");
    }
  }

  put(
    plan: UvLayoutPlan,
    sourceFingerprint: string,
    report: UvDryRunReport,
    autoBitmapSource?: UvAutoBitmapSource
  ): UvStoredPlan {
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          source_fingerprint: sourceFingerprint,
          plan,
          ...(autoBitmapSource ? { auto_bitmap_source: autoBitmapSource } : {}),
        })
      )
      .digest("hex");
    const planId = "uvplan:" + digest;
    const stored: UvStoredPlan = {
      plan_id: planId,
      source_fingerprint: sourceFingerprint,
      plan,
      report,
      ...(autoBitmapSource ? { auto_bitmap_source: { ...autoBitmapSource } } : {}),
    };

    this.entries.delete(planId);
    this.entries.set(planId, stored);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== "string") break;
      this.entries.delete(oldest);
    }
    return stored;
  }

  get(planId: string): UvStoredPlan {
    const stored = this.entries.get(planId);
    if (!stored) {
      throw new Error(
        "UV_PLAN_NOT_FOUND: plan handle expired or belongs to a previous Runtime session; create a fresh plan."
      );
    }
    this.entries.delete(planId);
    this.entries.set(planId, stored);
    return stored;
  }

  /**
   * Claim a source revision once before native apply. Every competing plan
   * built from the same UV snapshot is invalidated, not only this plan ID:
   * another operation or a failed Undo must not be replayable using a
   * different plan from the old source. Different source revisions survive.
   * The caller must validate the chosen plan before claiming it.
   */
  consume(planId: string): UvStoredPlan {
    const stored = this.get(planId);
    for (const [candidateId, candidate] of this.entries) {
      if (candidate.source_fingerprint === stored.source_fingerprint) {
        this.entries.delete(candidateId);
      }
    }
    return stored;
  }

  size(): number {
    return this.entries.size;
  }
}
