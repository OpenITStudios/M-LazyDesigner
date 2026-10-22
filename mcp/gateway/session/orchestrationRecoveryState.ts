import { randomUUID } from "node:crypto";
import { VerificationEvidenceRegistry } from "@/lib/orchestration/evidenceRegistry";
import { CorrectionLoopRegistry } from "@/lib/orchestration/correctionLoop";

export class GatewayOrchestrationRecoveryState {
  readonly evidence = new VerificationEvidenceRegistry();
  readonly corrections = new CorrectionLoopRegistry();
  private readonly processSessionIdentity: string;
  private invalidationCount = 0;
  private projectResetCount = 0;
  private projectAffinityInitialized = false;
  private projectUuid: string | null = null;
  private projectEpoch = 0;

  constructor(processSessionIdentity: string = randomUUID()) {
    if (!processSessionIdentity) {
      throw new Error("Gateway process session identity must be non-empty.");
    }
    this.processSessionIdentity = processSessionIdentity;
    const scopeIdentity =
      "process:" + processSessionIdentity + ":project:unbound:epoch:0";
    this.evidence.setScopeIdentity(scopeIdentity);
    this.corrections.setScopeIdentity(scopeIdentity);
  }

  synchronizeProjectAffinity(projectUuid: string | null): boolean {
    if (
      this.projectAffinityInitialized &&
      this.projectUuid === projectUuid
    ) {
      return false;
    }

    const wasInitialized = this.projectAffinityInitialized;
    this.projectAffinityInitialized = true;
    this.projectUuid = projectUuid;
    this.projectEpoch += 1;
    const scopeIdentity =
      "process:" +
      this.processSessionIdentity +
      ":project:" +
      (projectUuid ?? "unbound") +
      ":epoch:" +
      this.projectEpoch;

    this.evidence.setScopeIdentity(scopeIdentity);
    this.corrections.setScopeIdentity(scopeIdentity);

    if (wasInitialized) {
      this.projectResetCount += 1;
      return true;
    }
    return false;
  }

  invalidateRuntimeGeneration(): void {
    // Keep active correction loops, but require their evidence to be
    // recovered. Fresh evidence with identical contents must not reproduce
    // a handle from a retired Runtime generation.
    this.corrections.invalidateRuntimeGeneration();
    this.invalidationCount += 1;
    this.evidence.setScopeIdentity(
      "process:" + this.processSessionIdentity +
      ":project:" + (this.projectUuid ?? "unbound") +
      ":epoch:" + this.projectEpoch +
      ":runtime:" + this.invalidationCount
    );
  }

  snapshot(): {
    invalidation_count: number;
    project_reset_count: number;
    project_uuid: string | null;
    project_epoch: number;
    evidence_entries: number;
    correction_loops: number;
  } {
    return {
      invalidation_count: this.invalidationCount,
      project_reset_count: this.projectResetCount,
      project_uuid: this.projectUuid,
      project_epoch: this.projectEpoch,
      evidence_entries: this.evidence.size(),
      correction_loops: this.corrections.size(),
    };
  }
}

export const gatewayOrchestrationRecoveryState =
  new GatewayOrchestrationRecoveryState();
