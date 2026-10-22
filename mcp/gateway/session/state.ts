import type { ControlExecutionState } from "../control/orchestration";
import {
  seedCapabilityFacts,
  type CapabilityFactState,
} from "../capabilities/graph";
import { gatewayOrchestrationRecoveryState } from "./orchestrationRecoveryState";

export class GatewaySessionState {
  private executionState: ControlExecutionState | null = null;
  private capabilityFacts: CapabilityFactState = seedCapabilityFacts({});
  private capabilityFactsProjectUuid: string | null = null;
  private runtimeUnavailable = false;

  get facts(): CapabilityFactState {
    return this.capabilityFacts;
  }

  get projectUuid(): string | null {
    return this.capabilityFactsProjectUuid;
  }

  get controlExecutionState(): ControlExecutionState | null {
    return this.executionState;
  }

  set controlExecutionState(value: ControlExecutionState | null) {
    this.executionState = value;
  }

  onRuntimeUnavailable(): void {
    // The first handshake can succeed after an unverified status without a
    // generation-change event. New facts may then be written while this flag
    // is still set; a later outage must invalidate those facts again.
    if (this.runtimeUnavailable &&
        this.executionState === null &&
        Object.keys(this.capabilityFacts).length === 1 &&
        this.capabilityFacts.project_bound === "unknown" &&
        // Runtime facts can stay UNKNOWN while fresh visual evidence was
        // captured. A later outage must still retire those new handles.
        gatewayOrchestrationRecoveryState.evidence.size() === 0) return;
    this.runtimeUnavailable = true;
    this.executionState = null;
    // Keep the old UUID only as an untrusted reconnect target. Neither that
    // UUID nor prior authoring results count as readiness while Runtime is lost.
    this.capabilityFacts = seedCapabilityFacts({});
    gatewayOrchestrationRecoveryState.invalidateRuntimeGeneration();
  }

  onVerifiedRuntimeStatus(projectUuid: string | null): void {
    this.runtimeUnavailable = false;
    this.synchronizeProject(projectUuid);
  }

  onRuntimeGenerationChange(verifiedProjectUuid: string | null): void {
    this.runtimeUnavailable = false;
    // The replacement Runtime already proved its project affinity before
    // this callback. Do not keep an outdated Control UUID if that binding
    // was retired, and do not assume a previously unbound project was adopted.
    this.synchronizeProject(verifiedProjectUuid);
    gatewayOrchestrationRecoveryState.invalidateRuntimeGeneration();
    this.executionState = null;
    // Only the exact verified binding survives. Geometry, Texture, UV,
    // Animation and visual evidence must be established again in this Runtime.
    this.capabilityFacts = seedCapabilityFacts({
      projectBound: verifiedProjectUuid === null ? null : true,
    });
  }

  synchronizeProject(projectUuid: string | null): void {
    const orchestrationProjectChanged =
      gatewayOrchestrationRecoveryState.synchronizeProjectAffinity(projectUuid);
    if (orchestrationProjectChanged) {
      this.executionState = null;
    }

    if (projectUuid !== this.capabilityFactsProjectUuid) {
      this.capabilityFactsProjectUuid = projectUuid;
      this.capabilityFacts = seedCapabilityFacts({
        projectBound: projectUuid !== null,
      });
      return;
    }

    this.capabilityFacts = {
      ...this.capabilityFacts,
      ...seedCapabilityFacts({ projectBound: projectUuid !== null }),
    };
  }

  replaceFacts(facts: CapabilityFactState): void {
    this.capabilityFacts = facts;
  }
}
