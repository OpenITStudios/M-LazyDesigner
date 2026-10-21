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

  onRuntimeGenerationChange(verifiedProjectUuid: string | null): void {
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
