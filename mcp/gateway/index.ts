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

const session = new GatewaySessionState();

const backend = new BlockitRuntimeBackend(undefined, undefined, {
  onRuntimeGenerationChange: () => session.onRuntimeGenerationChange(),
});
const localCapabilities = new LocalCapabilityRegistry();
const benchmarkTrace = BenchmarkTraceRecorder.fromEnvironment();
const executor = new GatewayCapabilityExecutor(
  backend,
  localCapabilities,
  session,
  benchmarkTrace
);

// Runtime resources and prompts are not proxied. Stable-four remains the
// production default; Hybrid-4 is an explicit experimental startup profile.
const GATEWAY_INSTRUCTIONS =
  "LazyDesigner Gateway. Call status only when orientation is unknown or stale; reuse Control/context handles. Assets: pass reference_package_path. Control returns Skill/profile handles, not Skill contents. Load active Skill; reuse only while content survives compaction. stage_context.reference_recovery: call status(reference_fact_request) with fingerprint; page as needed. Development: task_mode=SYSTEM_DEVELOPMENT + task_intent. Known capability: invoke directly. Unknown/stale capability: search, describe branch. READY=usable, UNKNOWN=unresolved, BLOCKED=resolve prerequisites. Real schema uncertainty: describe. Before bulk form/style/motion check smallest judgeable sample; do not use a successful receipt as visual approval. Cohorts: task_context_id, cohort_boundary=CONTINUE then COMPLETE. Obey control_delta: receipt_only=no confirmation read; focused_read=inspect only if returned state is insufficient; visual=refresh only decision-changing visual evidence. Geometry/Texturing share AUTHORING; Animation handoff. Never auto-retry an interrupted mutation.";

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
