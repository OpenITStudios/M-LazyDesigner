import { prompts, tools } from "@/lib/factories";
import { initPromptLoader } from "@/lib/prompts/loader";
import {
  resolveMcpRegistrationProfile,
  type McpRegistrationProfile,
} from "@/lib/capabilities/registrationProfile";
import type { McpAuthoringPhase } from "@/lib/capabilities/authoringStage";
import { resources } from "@/server";
import { registerReferenceModelsResource } from "@/server/resources";
import { applyMcpRegistrationProfile } from "@/server/runtime/registration";
import {
  setupProjectNavigationSnapshot,
  teardownProjectNavigationSnapshot,
} from "@/plugin/projectNavigationSnapshot";
import { uiSetup, uiTeardown } from "@/ui";
import { retirePublicationRenderJobsOnPluginUnload } from "@/server/publication/jobs";
import { setupI18n } from "@/ui/i18n";
import {
  isExtendedMcpFamiliesEnabled,
  setExtendedMcpProfileHandler,
  settingsSetup,
  settingsTeardown,
} from "@/ui/settings";

export type BlockbenchIntegrationOptions = {
  generation: number;
  isGenerationCurrent(generation: number): boolean;
};

export class BlockbenchIntegration {
  private generation: number | null = null;
  private isGenerationCurrent: ((generation: number) => boolean) | null = null;

  setupBase(options: BlockbenchIntegrationOptions): McpRegistrationProfile {
    this.generation = options.generation;
    this.isGenerationCurrent = options.isGenerationCurrent;

    setupI18n();
    settingsSetup();
    // Model navigation is advisory. Native FS/timer/event changes in a new
    // Blockbench release must not prevent the core AI Runtime from starting.
    try {
      setupProjectNavigationSnapshot();
    } catch (error) {
      try {
        teardownProjectNavigationSnapshot();
      } catch (cleanupError) {
        console.warn("[LazyDesigner] Optional project navigation cleanup failed", cleanupError);
      }
      console.warn("[LazyDesigner] Optional project navigation unavailable; native Runtime continues", error);
    }

    const profile = resolveMcpRegistrationProfile(
      isExtendedMcpFamiliesEnabled()
    );

    setExtendedMcpProfileHandler((enabled) => {
      const generation = this.generation;
      if (
        generation === null ||
        !this.isGenerationCurrent?.(generation)
      ) {
        return;
      }
      applyMcpRegistrationProfile(resolveMcpRegistrationProfile(enabled));
    });

    // Runtime-conditional integration. The resource joins the canonical MCP
    // resource registry only when the external Reference Models plugin exists.
    registerReferenceModelsResource();
    return profile;
  }

  async loadPrompts(): Promise<boolean> {
    await initPromptLoader();
    const generation = this.generation;
    return Boolean(
      generation !== null && this.isGenerationCurrent?.(generation)
    );
  }

  setupUi(profile: McpRegistrationProfile, phase: McpAuthoringPhase): void {
    // Human UI is optional for AI authoring. A changed Blockbench Panel API
    // should degrade only the panel, not the local authoring Runtime.
    try {
      uiSetup({
        tools,
        resources,
        prompts,
        profile,
        phase,
      });
    } catch (error) {
      console.warn("[LazyDesigner] Optional editor panel unavailable; Runtime continues", error);
      try {
        uiTeardown();
      } catch (cleanupError) {
        console.warn("[LazyDesigner] Optional editor panel cleanup failed", cleanupError);
      }
    }
  }

  teardown(): void {
    // Stop active Blender subprocess on actual plugin unload. This is NOT
    // called by uiSetup's normal idempotent panel reconstruction.
    try { retirePublicationRenderJobsOnPluginUnload(); }
    catch (error) { console.warn("[LazyDesigner] Publication render teardown failed", error); }
    // Release independent owners even when an upstream optional API throws.
    try { uiTeardown(); }
    catch (error) { console.warn("[LazyDesigner] Editor panel cleanup failed", error); }
    try { teardownProjectNavigationSnapshot(); }
    catch (error) { console.warn("[LazyDesigner] Project navigation cleanup failed", error); }
    try { settingsTeardown(); }
    catch (error) { console.warn("[LazyDesigner] Settings cleanup failed", error); }
    this.generation = null;
    this.isGenerationCurrent = null;
  }
}