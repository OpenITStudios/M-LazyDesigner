import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { BlockitRuntimeBackend } from "./runtime/backend";
import {
  GATEWAY_NAME,
  GATEWAY_VERSION,
} from "./contracts/protocol";
import { LocalCapabilityRegistry } from "./providers/registry";
import {
  isExperimentalGatewaySurface,
  resolveGatewaySurfaceProfile,
} from "./surface/profile";
import { registerCoreGatewayTools } from "./handlers/registerCoreTools";
import { GatewaySessionState } from "./session/state";
import { publishManagedGatewayLeaseEvidence } from "./session/leaseEvidence";
import type { GatewayToolContext } from "./execution/gatewayErrors";
import { GatewayCapabilityExecutor } from "./execution/capabilityExecutor";
import { BenchmarkTraceRecorder } from "./execution/benchmarkTrace";
import { ProjectObservationRecorder } from "./execution/projectObservation";

const session = new GatewaySessionState();

const backend = new BlockitRuntimeBackend(undefined, undefined, {
  onRuntimeGenerationChange: (event) => session.onRuntimeGenerationChange(event.project_uuid),
  onRuntimeUnavailable: () => session.onRuntimeUnavailable(),
});
const localCapabilities = new LocalCapabilityRegistry();
const benchmarkTrace = BenchmarkTraceRecorder.fromEnvironment();
const projectObservation = ProjectObservationRecorder.fromEnvironment();
const executor = new GatewayCapabilityExecutor(
  backend,
  localCapabilities,
  session,
  benchmarkTrace,
  projectObservation
);

// Gateway retains its four-tool surface; Runtime resources and prompts are not proxied.
// Hybrid-4 remains an explicit experimental startup profile.
const GATEWAY_INSTRUCTIONS =
  "LazyDesigner Gateway. status only for missing/stale orientation; assets pass reference_package_path. Load active Skill/profile via Control handles; reuse while content survives compaction. Geometry/Texturing share AUTHORING; Animation handoff. Known capability/schema: invoke directly. Unknown: search; uncertain schema: describe required branch. READY=usable; UNKNOWN=Runtime-check; BLOCKED=prerequisites. Cohorts: copy current control.task_context_id into OUTER invoke_capability.task_context_id for CONTINUE and COMPLETE; without it use standalone COMPLETE. Reorient after user intent, reference, project or context-compaction changes. Never auto-switch models or reasoning effort. Follow control_delta: receipt_only=no reread; focused_read=missing evidence only; visual=decision-changing evidence. Sample before bulk visual edits; status READY or mutation receipt is not artistic PASS. At stage review, scope PASS/FAIL/UNVERIFIED to fresh approved-reference/model evidence; partial face coverage is UNVERIFIED. Never auto-retry interrupted mutations. Development: status(task_mode=SYSTEM_DEVELOPMENT,task_intent). Omitted reference facts: paged status(reference_fact_request) with fingerprint.";

type ExperimentalHybridRegistrar = (input: {
  server: McpServer;
  profile: "hybrid_4_experimental";
  invoke: (capability: string, args: Record<string, unknown>, context?: unknown) => Promise<unknown>;
}) => string[];

function buildGatewayServer(
  experimentalRegistrar: ExperimentalHybridRegistrar | null
): McpServer {
  const surfaceProfile = resolveGatewaySurfaceProfile(
    process.env.LAZYDESIGNER_GATEWAY_SURFACE_PROFILE
  );
  let registeredExperimentalTools: string[] = [];
  const server = new McpServer(
    {
      name: GATEWAY_NAME,
      version: GATEWAY_VERSION,
    },
    {
      instructions: GATEWAY_INSTRUCTIONS,
    }
  );

  registerCoreGatewayTools({
    server,
    backend,
    localCapabilities,
    session,
    surfaceProfile,
    experimentalTools: () => registeredExperimentalTools,
    trace: benchmarkTrace,
    projectObservation,
    onGatewayToolRequest: () => {
      publishManagedGatewayLeaseEvidence(backend.observedManagedCatalogEvidence());
    },
    invoke: (capability, args, context, controlOptions) =>
      executor.invoke(capability, args, context, controlOptions),
  });

  if (isExperimentalGatewaySurface(surfaceProfile)) {
    if (!experimentalRegistrar) {
      throw new Error("Experimental Gateway profile selected without registrar.");
    }
    registeredExperimentalTools = experimentalRegistrar({
      server,
      profile: surfaceProfile,
      invoke: (capability, args, context) =>
        executor.invoke(
          capability,
          args,
          context as GatewayToolContext | undefined
        ),
    });
  }
  return server;
}

let stdioHandle: StdioServerHandle | null = null;
let shuttingDown = false;

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await backend.close();
    await benchmarkTrace.flush();
    await projectObservation.flush(true);
    await stdioHandle?.close();
  } finally {
    process.exit(exitCode);
  }
}

async function main(): Promise<void> {
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  process.stdin.on("close", () => void shutdown(0));

  const requestedProfile = resolveGatewaySurfaceProfile(
    process.env.LAZYDESIGNER_GATEWAY_SURFACE_PROFILE
  );
  const experimentalRegistrar: ExperimentalHybridRegistrar | null =
    isExperimentalGatewaySurface(requestedProfile)
      ? (await import("./experimental/hybridRegistration"))
          .registerExperimentalHybrid4 as ExperimentalHybridRegistrar
      : null;

  stdioHandle = serveStdio(() => buildGatewayServer(experimentalRegistrar), {
    onerror: (error) => {
      console.error("[LazyDesigner Gateway] stdio:", error);
    },
  });
}

main().catch((error) => {
  console.error("[LazyDesigner Gateway] fatal:", error);
  void shutdown(1);
});
