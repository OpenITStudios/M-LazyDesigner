import { createHash } from "node:crypto";
import type { UvLayoutPlan } from "@/lib/uv/contracts";
import type { UvDryRunReport } from "@/lib/uv/dryRun";

export type UvStoredPlan = {
  plan_id: string;
  source_fingerprint: string;
  plan: UvLayoutPlan;
  report: UvDryRunReport;
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
    report: UvDryRunReport
  ): UvStoredPlan {
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          source_fingerprint: sourceFingerprint,
          plan,
        })
      )
      .digest("hex");
    const planId = "uvplan:" + digest;
    const stored: UvStoredPlan = {
      plan_id: planId,
      source_fingerprint: sourceFingerprint,
      plan,
      report,
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
   * Claim a handle once before any native apply. The same plan cannot be
   * replayed after interruption, a failed Undo commit or a successful write.
   * Source/receipt checks remain in the caller before this destructive claim.
   */
  consume(planId: string): UvStoredPlan {
    const stored = this.get(planId);
    this.entries.delete(planId);
    return stored;
  }

  size(): number {
    return this.entries.size;
  }
}
