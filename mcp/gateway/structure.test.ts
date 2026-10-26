import { describe, expect, test } from "bun:test";

const WRAPPERS: Readonly<Record<string, string>> = {
  "gateway/contract.ts":
    'export * from "./contracts/protocol";\nexport * from "./presentation/resultCompaction";\nexport * from "./capabilities/catalog";\nexport * from "./runtime/identity";\nexport * from "./runtime/interruptionPolicy";\n',
  "gateway/controlReceipt.ts":
    'export * from "./control/receipt";\n',
  "gateway/capabilityManifest.ts":
    'export * from "./capabilities/manifest";\n',
  "gateway/capabilityIntelligence.ts":
    'export * from "./capabilities/intelligence";\n',
  "gateway/capabilityGraph.ts":
    'export * from "./capabilities/graph";\n',
  "gateway/schemaProjection.ts":
    'export * from "./capabilities/schemaProjection";\n',
  "gateway/capabilityEffects.ts":
    'export * from "./capabilities/effects";\n',
  "gateway/connectionManager.ts":
    'export * from "./runtime/connectionManager";\n',
  "gateway/reconnectPolicy.ts":
    'export * from "./runtime/reconnectPolicy";\n',
  "gateway/recovery.ts":
    'export * from "./runtime/recovery";\n',
  "gateway/runtimeSession.ts":
    'export * from "./runtime/runtimeSession";\n',
  "gateway/projectAffinity.ts":
    'export * from "../lib/runtime/affinity";\n',
  "gateway/localCapabilities.ts":
    'export * from "./providers/registry";\n',
  "gateway/vanillaEntityReference.ts":
    'export * from "./providers/vanillaEntityReference";\n',
  "gateway/control/delta.ts":
    'export * from "./delta/engine";\nexport * from "./delta/projection";\n',
  "gateway/control/capabilityManifest.ts":
    'export * from "./capabilityProjection";\n',
  "gateway/control/registry.ts":
    'export { contextForAuthoringDomain } from "./contexts";\nexport { authoringDomainForCapability, sourceOwnerForCapability } from "../development/sourceOwners";\nexport { getControlCapabilityProjection } from "./capabilityProjection";\n',
  "gateway/control/developmentIntent.ts":
    'export * from "../development/intent";\n',
  "gateway/control/sourceOwners.ts":
    'export * from "../development/sourceOwners";\n',
  "gateway/runtime/capabilityExecutor.ts":
    'export * from "../execution/capabilityExecutor";\n',
  "gateway/runtime/benchmarkTrace.ts":
    'export * from "../execution/benchmarkTrace";\n',
  "gateway/runtime/orchestrationRecoveryState.ts":
    'export * from "../session/orchestrationRecoveryState";\n',
  "gateway/runtime/gatewayErrors.ts":
    'export * from "../execution/gatewayErrors";\n',
  "gateway/runtime/projectAffinity.ts":
    'export * from "../../lib/runtime/affinity";\n',
};

describe("Gateway structural ownership", () => {
  test("migrated root modules remain compatibility-only wrappers", async () => {
    for (const [path, expected] of Object.entries(WRAPPERS)) {
      expect(await Bun.file(path).text()).toBe(expected);
    }
  });

  test("production composition imports canonical owner paths", async () => {
    const index = await Bun.file("gateway/index.ts").text();
    const registration = await Bun.file("gateway/handlers/registerCoreTools.ts").text();
    const backend = await Bun.file("gateway/runtime/backend.ts").text();
    const contract = await Bun.file("gateway/contract.ts").text();

    expect(index).toContain('"./runtime/backend"');
    expect(index).toContain('"./contracts/protocol"');
    expect(index).toContain('"./providers/registry"');
    expect(index).toContain('"./surface/profile"');
    expect(index).toContain('"./handlers/registerCoreTools"');
    expect(index).toContain('"./session/state"');
    expect(index).toContain('"./execution/capabilityExecutor"');

    expect(registration).toContain('"../capabilities/schemaProjection"');
    expect(registration).toContain('"../development/sourceOwners"');
    expect(registration).toContain('"../presentation/statusProjection"');
    expect(registration).toContain('"../contracts/outputSchemas"');

    expect(backend).toContain('"../../lib/runtime/affinity"');
    expect(backend).toContain('"./connectionManager"');
    expect(backend).toContain('"../capabilities/effects"');
    expect(backend).toContain('"./backendContract"');

    expect(contract).toContain('"./contracts/protocol"');
    expect(contract).toContain('"./presentation/resultCompaction"');
    expect(contract).toContain('"./capabilities/catalog"');
    expect(contract).toContain('"./runtime/identity"');
    expect(contract).toContain('"./runtime/interruptionPolicy"');

    const controlIndex = await Bun.file("gateway/control/index.ts").text();
    expect(controlIndex).toContain('"./delta/engine"');
    expect(controlIndex).toContain('"./delta/projection"');
    expect(controlIndex).toContain('"../development/sourceOwners"');
  });

  test("core named Stage ownership is manifest-backed", async () => {
    const authoringStage = await Bun.file("lib/capabilities/authoringStage.ts").text();
    const metadata = await Bun.file("lib/capabilities/metadata.ts").text();

    expect(authoringStage).toContain('from "./manifest"');
    expect(authoringStage).toContain("capabilityStageByName");
    expect(authoringStage).not.toContain("CORE_NAMED_CAPABILITIES");
    expect(authoringStage).not.toContain("TEXTURING_NAMED_CAPABILITIES");
    expect(metadata).toContain('from "./manifest"');
    expect(metadata).not.toContain("PRIMARY_CAPABILITIES");
  });
  test("Control delta engine stays assembly-only", async () => {
    const engine = await Bun.file("gateway/control/delta/engine.ts").text();
    expect(engine).toContain('from "./freshness"');
    expect(engine).toContain('from "./verification"');
    expect(engine).toContain('from "./receipts"');
    expect(engine).not.toContain("function locatorReceiptComplete");
    expect(engine).not.toContain("function mutationFreshness");
    expect(engine).not.toContain("function verificationClassForResult");
    expect(engine.split("\n").length).toBeLessThan(140);
  });

  test("Control capability metadata is projection-owned, not a second manifest", async () => {
    const registry = await Bun.file("gateway/control/registry.ts").text();
    const projection = await Bun.file("gateway/control/capabilityProjection.ts").text();
    expect(registry).toContain('from "./capabilityProjection"');
    expect(projection).toContain("getCapabilityMetadata");
    expect(projection).not.toContain("PRIMARY_CAPABILITIES");
  });

  test("Control registry stays a facade over context and Development ownership", async () => {
    const registry = await Bun.file("gateway/control/registry.ts").text();
    const packet = await Bun.file("gateway/control/packet.ts").text();
    const capabilities = await Bun.file("gateway/control/capabilities.ts").text();
    const deltaEngine = await Bun.file("gateway/control/delta/engine.ts").text();

    expect(registry.split("\n").length).toBeLessThan(5);
    expect(registry).toContain('from "../development/sourceOwners"');
    expect(packet).toContain('from "./contexts"');
    expect(capabilities).toContain('from "../development/sourceOwners"');
    expect(deltaEngine).toContain('from "../../development/sourceOwners"');
  });

  test("Development source-owner composition stays modular", async () => {
    const sourceOwners = await Bun.file("gateway/development/sourceOwners.ts").text();
    expect(sourceOwners).toContain('from "./sourceOwners/geometry"');
    expect(sourceOwners).toContain('from "./sourceOwners/texturing"');
    expect(sourceOwners).toContain('from "./sourceOwners/animation"');
    expect(sourceOwners).toContain('from "./sourceOwners/core"');
    expect(sourceOwners.split("\n").length).toBeLessThan(100);
  });

  test("Control packet stays orchestration-only", async () => {
    const packet = await Bun.file("gateway/control/packet.ts").text();
    expect(packet).toContain('from "./packetContext"');
    expect(packet).toContain('from "./readiness"');
    expect(packet).toContain('from "./packetData"');
    expect(packet).not.toContain("function lifecycleForDomain");
    expect(packet).not.toContain("function contextFamily");
    expect(packet.split("\n").length).toBeLessThan(230);
  });

  test("reference package IO stays separate from pure normalization", async () => {
    const io = await Bun.file("gateway/control/referencePackage.ts").text();
    const parser = await Bun.file("gateway/control/referenceParser.ts").text();
    expect(io).toContain("parseReferencePackage");
    expect(io).toContain("readFile");
    expect(io).toContain("stat");
    expect(io).not.toContain("function profileValue");
    expect(parser).toContain("function profileValue");
    expect(parser).not.toContain("readFile");
    expect(parser).not.toContain("stat(");
  });

  test("Gateway execution stays above Runtime transport", async () => {
    const executor = await Bun.file("gateway/execution/capabilityExecutor.ts").text();
    expect(executor).toContain('from "../runtime/backend"');
    expect(executor).toContain('from "../control/delta/engine"');
    expect(executor).toContain('from "../control/delta/projection"');
    expect(executor).toContain('from "../capabilities/graph"');
    expect(executor).toContain('from "../providers/registry"');
    expect(executor).toContain('from "../session/state"');
  });

  test("backend delegates queue and affinity policy to runtime modules", async () => {
    const backend = await Bun.file("gateway/runtime/backend.ts").text();
    expect(backend).toContain('from "./operationQueue"');
    expect(backend).toContain('from "./affinityPolicy"');
    expect(backend).not.toContain("private pendingOperations");
    expect(backend).not.toContain("private completedOperations");
    expect(backend).not.toContain(
      "Runtime did not honor this Gateway"
    );
    // Generation/catalog revalidation and passive-probe retirement added bounded
    // transport coordination; queue and affinity policy remain delegated above.
    expect(backend.split("\n").length).toBeLessThan(1_000);
  });

  test("Gateway protocol stays lower-level than capability engines", async () => {
    const protocol = await Bun.file("gateway/contracts/protocol.ts").text();
    expect(protocol).toContain('from "../capabilities/types"');
    expect(protocol).not.toContain('from "./capabilities/intelligence"');
    expect(protocol).not.toContain('from "./capabilities/graph"');
    expect(protocol.split("\n").length).toBeLessThan(100);
  });

  test("Gateway contract stays compatibility-only", async () => {
    const contract = await Bun.file("gateway/contract.ts").text();
    expect(contract.split("\n").length).toBeLessThan(10);
    expect(contract).not.toContain("function ");
    expect(contract).not.toContain("const GATEWAY_TOOLS");
  });

  test("Control receipt stays Control-owned", async () => {
    const executor = await Bun.file("gateway/execution/capabilityExecutor.ts").text();
    const receipt = await Bun.file("gateway/control/receipt.ts").text();
    expect(executor).toContain('from "../control/receipt"');
    expect(executor).not.toContain('from "../controlReceipt"');
    expect(receipt).toContain('from "../capabilities/effects"');
    expect(receipt).toContain('from "../../lib/runtime/affinity"');
  });

});
