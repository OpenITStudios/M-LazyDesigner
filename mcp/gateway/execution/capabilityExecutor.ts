import type { BlockitRuntimeBackend } from "../runtime/backend";
import { GatewayBackendError } from "../runtime/backendContract";
import type { JsonRecord } from "../contracts/protocol";
import {
  compactGatewayCapabilityContent,
  compactGatewayCapabilityStructuredContent,
  shouldAttachGatewayControlDelta,
} from "../presentation/resultCompaction";
import { buildControlDelta } from "../control/delta/engine";
import { projectControlDeltaForGateway } from "../control/delta/projection";
import { reduceControlExecutionState } from "../control/orchestration";
import {
  capabilityNeedsPhaseSnapshot,
  deriveControlReceipt,
} from "../control/receipt";
import {
  applyCapabilityGraphOutcome,
  capabilityBranchFromArguments,
  evaluateCapabilityPreconditions,
} from "../capabilities/graph";
import {
  manifestEntryForBranch,
  nestedOperationClassForArguments,
} from "../capabilities/manifest";
import type { LocalCapabilityRegistry } from "../providers/registry";
import type { GatewaySessionState } from "../session/state";
import {
  gatewayErrorResult,
  traceMetaFromContext,
  type GatewayToolContext,
} from "./gatewayErrors";
import type { BenchmarkTraceRecorder } from "./benchmarkTrace";

export class GatewayCapabilityExecutor {
  constructor(
    private readonly backend: BlockitRuntimeBackend,
    private readonly localCapabilities: LocalCapabilityRegistry,
    private readonly session: GatewaySessionState,
    private readonly trace: BenchmarkTraceRecorder | null = null
  ) {}

  private directPreconditionBlockedResult(
    capability: string,
    args: JsonRecord
  ): {
    isError: true;
    content: Array<{ type: "text"; text: string }>;
    structuredContent: JsonRecord;
  } | null {
    const branch = capabilityBranchFromArguments(args);
    const evaluation = evaluateCapabilityPreconditions(
      capability,
      branch,
      this.session.facts
    );
    if (evaluation.eligibility !== "BLOCKED") return null;

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `CAPABILITY_PRECONDITION_BLOCKED: ${capability} requires ${evaluation.missing.join(", ")}.`,
        },
      ],
      structuredContent: {
        code: "CAPABILITY_PRECONDITION_BLOCKED",
        capability,
        eligibility: evaluation.eligibility,
        requires: evaluation.missing,
        ...(evaluation.predecessor
          ? { predecessor: evaluation.predecessor }
          : {}),
        recovery: {
          category: "CAPABILITY",
          safe_to_retry: false,
          state_uncertain: false,
          requires_status_refresh: false,
          requires_user_action: false,
          action: evaluation.predecessor
            ? `resolve predecessor ${evaluation.predecessor.capability} before direct invoke`
            : "satisfy the returned capability prerequisites before retrying",
        },
      },
    };
  }

  async invoke(
    capability: string,
    args: JsonRecord,
    context?: GatewayToolContext,
    controlOptions?: {
      taskContextId?: string | null;
      cohortBoundary?: "CONTINUE" | "COMPLETE";
    }
  ): Promise<unknown> {
    const startedAt = this.trace?.startedAt() ?? 0;
    try {
      // Both stable invoke_capability and explicit experimental direct tools
      // enforce only proven-missing prerequisites; UNKNOWN stays Runtime-owned.
      const blocked = this.directPreconditionBlockedResult(capability, args);
      if (blocked) {
        // The AI paid for this call even though no Runtime mutation occurred.
        // Benchmark-only recording is a zero-write no-op when disabled.
        this.trace?.record({
          startedAt,
          kind: "recovery",
          capability,
          success: false,
          result: blocked,
          readOnly: null,
          verificationClass: null,
        });
        return blocked;
      }

      const traceMeta = traceMetaFromContext(context);
      const branch = capabilityBranchFromArguments(args);
      const phaseBefore = capabilityNeedsPhaseSnapshot(capability)
        ? (await this.backend.getStatus()).affinity.authoring_phase
        : null;

      if (context?.mcpReq?.signal?.aborted) {
        throw new GatewayBackendError(
          "GATEWAY_QUEUE_CANCELLED",
          "Gateway request was cancelled before native execution began.",
          true,
          { executed: false }
        );
      }
      const localResult = await this.localCapabilities.invoke(capability, args);
      const runtimeInvocation = localResult
        ? null
        : await this.backend.invokeCapabilityWithMetadata(
            capability,
            args,
            traceMeta,
            context?.mcpReq?.signal
          );
      const result = localResult ?? runtimeInvocation!.result;
      const readOnly =
        localResult !== null
          ? this.localCapabilities.readOnlyHint(capability) === true
          : runtimeInvocation!.readOnly;
      const nestedOperationClass =
        nestedOperationClassForArguments(capability, args);
      const branchReadOnly =
        nestedOperationClass === "QUERY" ||
        manifestEntryForBranch(capability, branch)?.operationClass === "QUERY";
      const branchControl = nestedOperationClass === "CONTROL";
      const effectiveReadOnly = readOnly || branchReadOnly;

      const succeeded = result.isError !== true;
      const receipt = deriveControlReceipt(
        capability,
        result.structuredContent,
        succeeded,
        phaseBefore
      );

      if (
        receipt.projectUuid !== null &&
        receipt.projectUuid !== this.session.projectUuid
      ) {
        this.session.synchronizeProject(receipt.projectUuid);
      }

      this.session.replaceFacts(
        applyCapabilityGraphOutcome(
          this.session.facts,
          capability,
          args,
          succeeded,
          result.structuredContent
        )
      );

      const controlDelta = buildControlDelta({
        capability,
        branch,
        phaseBefore: receipt.phaseBefore,
        phaseAfter: receipt.phaseAfter,
        projectUuid: receipt.projectUuid,
        succeeded,
        result: result.structuredContent,
      });

      const attachControlDelta = shouldAttachGatewayControlDelta(
        succeeded,
        effectiveReadOnly || branchControl
      );
      const orchestration = attachControlDelta
        ? reduceControlExecutionState(
            this.session.controlExecutionState,
            controlDelta,
            {
              taskContextId: controlOptions?.taskContextId,
              cohortBoundary: controlOptions?.cohortBoundary,
            }
          )
        : null;
      if (orchestration) {
        this.session.controlExecutionState = orchestration.state;
      }

      const gatewayControlDelta = {
        ...projectControlDeltaForGateway(controlDelta),
        ...(orchestration
          ? { continuation: orchestration.continuation }
          : {}),
      };

      if (result.structuredContent === undefined) {
        const response = {
          ...result,
          ...(attachControlDelta
            ? { structuredContent: { control_delta: gatewayControlDelta } }
            : {}),
        };
        this.trace?.record({
          startedAt,
          kind:
            capability === "capture_model_views"
              ? "verify"
              : effectiveReadOnly
                ? "inspect"
                : "mutate",
          capability,
          success: succeeded,
          result: response,
          readOnly: effectiveReadOnly,
          verificationClass: controlDelta.verification_class,
        });
        return response;
      }

      const compacted = compactGatewayCapabilityStructuredContent(
        capability,
        result.structuredContent,
        controlDelta.verification_class,
        succeeded
      );
      const compactedContent = compactGatewayCapabilityContent(
        capability,
        result.structuredContent,
        result.content,
        controlDelta.verification_class,
        effectiveReadOnly,
        succeeded
      );

      const response = {
        ...result,
        content: compactedContent as typeof result.content,
        structuredContent:
          compacted &&
          typeof compacted === "object" &&
          !Array.isArray(compacted)
            ? {
                ...(compacted as JsonRecord),
                ...(attachControlDelta
                  ? { control_delta: gatewayControlDelta }
                  : {}),
              }
            : {
                runtime_result: compacted,
                ...(attachControlDelta
                  ? { control_delta: gatewayControlDelta }
                  : {}),
              },
      };
      this.trace?.record({
        startedAt,
        kind:
          capability === "capture_model_views"
            ? "verify"
            : effectiveReadOnly
              ? "inspect"
              : "mutate",
        capability,
        success: succeeded,
        result: response,
        readOnly: effectiveReadOnly,
        verificationClass: controlDelta.verification_class,
      });
      return response;
    } catch (error) {
      const response = gatewayErrorResult(error);
      this.trace?.record({
        startedAt,
        kind: "recovery",
        capability,
        success: false,
        result: response,
        readOnly: null,
        verificationClass: null,
      });
      return response;
    }
  }
}
