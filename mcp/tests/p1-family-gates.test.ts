import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_MCP_REGISTRATION_PROFILE,
  EXTENDED_LEGACY_REGISTRATION_FAMILIES,
  MCP_EXTENDED_FAMILIES_SETTING_ID,
  getRegistrationFamilies,
  resolveMcpRegistrationProfile,
} from "@/lib/registrationProfile";

describe("P1.2 MCP family gates", () => {
  test("internal extended compatibility still requires explicit boolean opt-in", () => {
    expect(resolveMcpRegistrationProfile(undefined)).toBe(DEFAULT_MCP_REGISTRATION_PROFILE);
    expect(resolveMcpRegistrationProfile(false)).toBe(DEFAULT_MCP_REGISTRATION_PROFILE);
    expect(resolveMcpRegistrationProfile("true")).toBe(DEFAULT_MCP_REGISTRATION_PROFILE);
    expect(resolveMcpRegistrationProfile(true)).toBe("extended");
  });

  test("extended compatibility adds only legacy fallback families", () => {
    expect(EXTENDED_LEGACY_REGISTRATION_FAMILIES).toEqual(["import", "ui"]);
    expect(getRegistrationFamilies("extended")).toEqual([
      ...getRegistrationFamilies("bedrock_entity"),
      ...EXTENDED_LEGACY_REGISTRATION_FAMILIES,
    ]);
  });

  test("Blockbench integration owns developer-only legacy compatibility selection", async () => {
    const [settingsSource, integrationSource, indexSource] = await Promise.all([
      readFile(new URL("../ui/settings.ts", import.meta.url), "utf8"),
      readFile(new URL("../plugin/blockbenchIntegration.ts", import.meta.url), "utf8"),
      readFile(new URL("../index.ts", import.meta.url), "utf8"),
    ]);

    expect(settingsSource).toContain(`new Setting(MCP_EXTENDED_FAMILIES_SETTING_ID, {`);
    expect(settingsSource).toContain('name: "Legacy Compatibility (Developer)"');
    expect(settingsSource).toContain("Troubleshooting support for older or generic Blockbench workflows");
    expect(settingsSource).toContain("Leave this off for normal use");
    expect(settingsSource).toContain("value: false");

    expect(integrationSource).toContain("settingsSetup();");
    expect(integrationSource).toContain("isExtendedMcpFamiliesEnabled()");
    expect(integrationSource).toContain("setExtendedMcpProfileHandler");
    expect(integrationSource).toContain("applyMcpRegistrationProfile");

    expect(indexSource).toContain("blockbenchIntegration.setupBase");
    expect(indexSource).toContain("registerMcpProfile(registrationProfile)");
    expect(indexSource).toContain("runtimeHost.start(generation, currentBuildIdentity())");
    expect(indexSource).not.toContain("settingsSetup();");
    expect(indexSource).not.toContain("isExtendedMcpFamiliesEnabled()");
  });

  test("runtime registration owner keeps family registration idempotent", async () => {
    const [registrationSource, facadeSource] = await Promise.all([
      readFile(new URL("../server/runtime/registration.ts", import.meta.url), "utf8"),
      readFile(new URL("../server/tools.ts", import.meta.url), "utf8"),
    ]);
    expect(registrationSource).toContain("const registeredFamilies = new Set<McpRegistrationFamily>();");
    expect(registrationSource).toContain("if (registeredFamilies.has(family)) return false;");
    expect(registrationSource).toContain("registeredFamilies.add(family);");
    expect(facadeSource).toContain("registerMcpProfile(DEFAULT_MCP_REGISTRATION_PROFILE);");
  });

  test("dangerous fallback tools remain disabled", async () => {
    const [importSource, uiSource] = await Promise.all([
      readFile(new URL("../server/tools/io/import.ts", import.meta.url), "utf8"),
      readFile(new URL("../server/tools/interaction/ui.ts", import.meta.url), "utf8"),
    ]);
    expect(importSource).toContain("importToolDocs[0].status, false");
    expect(uiSource).toContain("uiToolDocs[1].status");
    expect(uiSource).toContain("false");
  });

  test("setting identifier remains compatible", () => {
    expect(MCP_EXTENDED_FAMILIES_SETTING_ID).toBe("mcp_extended_families_enabled");
  });
});
