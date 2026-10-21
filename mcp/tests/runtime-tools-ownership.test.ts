import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

// Static ownership evidence; runtime behavior is exercised by lifecycle/registration suites.
describe("Runtime registration ownership boundaries", () => {
  test("server/tools.ts remains a thin compatibility facade", async () => {
    const text = await source("server/tools.ts");

    expect(text).toContain('from "./runtime/registration"');
    expect(text).toContain('from "./runtime/consolidatedTools"');
    expect(text).toContain('from "./runtime/phaseControl"');
    expect(text).not.toContain("function registerConsolidatedInspectionTool");
    expect(text).not.toContain("const registrationFunctions");
    expect(text).not.toContain("const stageSurfaceCache");
    expect(text).not.toContain("z.object(");
  });

  test("registration state has one runtime owner", async () => {
    const text = await source("server/runtime/registration.ts");

    expect(text).toContain("const registeredFamilies");
    expect(text).toContain("const toolRegistrationFamily");
    expect(text).toContain("const catalogToolEnabled");
    expect(text).toContain("const stageSurfaceCache");
    expect(text).toContain("registerConsolidatedTools(updateCatalogTool)");
  });

  test("phase control owns its handler and tool contract", async () => {
    const text = await source("server/runtime/phaseControl.ts");

    expect(text).toContain("let stageSwitchHandler");
    expect(text).toContain("export const phaseControlToolDocs");
    expect(text).toContain("export function registerPhaseControlTool");
  });

  test("server.ts delegates intelligence wiring to one bootstrap", async () => {
    const text = await source("server/server.ts");

    expect(text).toContain("initializeRuntimeCapabilityWiring();");
    expect(text).not.toContain("wireAuthoringQualityIntelligence();");
    expect(text).not.toContain("wireTextureQualityRuntime();");
    expect(text).not.toContain("wireAnimationNativeIntelligence();");
    expect(text).not.toContain("describeMcpSurfaceToolNames(profile, phase)");
  });

  test("bootstrap delegates extension composition to registration", async () => {
    const [bootstrap, registration, extensions] = await Promise.all([
      source("server/runtime/bootstrap.ts"),
      source("server/runtime/registration.ts"),
      source("server/runtime/extensions.ts"),
    ]);

    expect(bootstrap).not.toContain("wireTextureQualityRuntime");
    expect(bootstrap).not.toContain("wireAnimationNativeIntelligence");

    expect(registration).toContain("applyRuntimeExtensionPipeline();");
    expect(extensions).toContain("RUNTIME_EXTENSION_PIPELINE");
    expect(extensions).toContain('id: "texture-contracts"');
    expect(extensions).toContain('id: "animation-contracts"');
  });
});
