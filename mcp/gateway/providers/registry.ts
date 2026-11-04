import { summarizeCapability } from "../capabilities/catalog";
import { BLENDER_RENDER_TOOL, BlenderRenderProvider, blenderRenderControlParameters, shouldProbeBlenderRender } from "./blenderRender";
import { startAutomaticPublication, type NativePublicationHandoff } from "../execution/renderOrchestration";
import type {
  BackendTool,
  CapabilitySummary,
  JsonRecord,
} from "../contracts/protocol";
import {
  VANILLA_ENTITY_REFERENCE_TOOL,
  VanillaEntityReferenceProvider,
  shouldProbeVanillaEntityReference,
} from "./vanillaEntityReference";

export type LocalCapabilityCallResult = JsonRecord & {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
};

type LocalCapabilityProvider = {
  tool: BackendTool;
  shouldProbe(query: string): boolean;
  isAvailable(): Promise<boolean>;
  invoke(args: JsonRecord): Promise<LocalCapabilityCallResult>;
};

export class LocalCapabilityRegistry {
  private readonly providers: readonly LocalCapabilityProvider[];
  private readonly blender: BlenderRenderProvider;

  constructor(private readonly prepareNativeHandoff?: NativePublicationHandoff) {
    this.blender = new BlenderRenderProvider();
    const vanilla = new VanillaEntityReferenceProvider();
    this.providers = [
      {
        tool: VANILLA_ENTITY_REFERENCE_TOOL,
        shouldProbe: shouldProbeVanillaEntityReference,
        isAvailable: () => vanilla.isAvailable(),
        invoke: (args) => vanilla.invoke(args),
      },
      {
        tool: BLENDER_RENDER_TOOL,
        shouldProbe: shouldProbeBlenderRender,
        isAvailable: () => this.blender.isAvailable(),
        invoke: async args => this.blender.invoke(args),
      },
    ];
  }

  /** Blender-owned capabilities remain discoverable if Blockbench is closed. */
  canSearchWithoutRuntime(query: string): boolean {
    return shouldProbeBlenderRender(query);
  }

  async close(): Promise<void> {
    await this.blender.close();
  }

  private providerFor(capability: string): LocalCapabilityProvider | null {
    return this.providers.find((provider) => provider.tool.name === capability) ?? null;
  }

  owns(capability: string): boolean {
    return this.providerFor(capability) !== null;
  }

  readOnlyHint(capability: string): boolean | null {
    const provider = this.providerFor(capability);
    return provider ? provider.tool.annotations?.readOnlyHint === true : null;
  }

  async search(
    query: string,
    runtimeCapabilities: readonly CapabilitySummary[],
    limit: number
  ): Promise<CapabilitySummary[]> {
    const local: CapabilitySummary[] = [];
    for (const provider of this.providers) {
      if (!provider.shouldProbe(query)) continue;
      if (!(await provider.isAvailable())) continue;
      local.push(summarizeCapability(provider.tool));
    }

    if (local.length === 0) return [...runtimeCapabilities].slice(0, limit);
    const localNames = new Set(local.map((item) => item.capability_id));
    return [
      ...local,
      ...runtimeCapabilities.filter((item) => !localNames.has(item.capability_id)),
    ].slice(0, limit);
  }

  async describe(capability: string): Promise<BackendTool | null> {
    const provider = this.providerFor(capability);
    if (!provider || !(await provider.isAvailable())) return null;
    return provider.tool;
  }

  async invoke(
    capability: string,
    args: JsonRecord
  ): Promise<LocalCapabilityCallResult | null> {
    const provider = this.providerFor(capability);
    if (!provider) return null;
    if (capability === BLENDER_RENDER_TOOL.name && args.operation === "auto") {
      const command = blenderRenderControlParameters.parse(args);
      if (command.operation !== "auto") {
        throw new Error("PUBLICATION_AUTO_SCHEMA_BRANCH_MISMATCH");
      }
      const started = startAutomaticPublication(
        this.blender, this.prepareNativeHandoff, command.options,
      );
      return {
        content: [{
          type: "text",
          text: "Automatic Blockbench-to-Blender Cycles job started: " + started.job_id +
            ". Check blender_render operation=status and request one real PNG preview when complete.",
        }],
        structuredContent: started,
      };
    }
    return provider.invoke(args);
  }
}
