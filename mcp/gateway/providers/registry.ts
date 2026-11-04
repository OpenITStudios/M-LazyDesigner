import { summarizeCapability } from "../capabilities/catalog";
import { BLENDER_RENDER_TOOL, BlenderRenderProvider, shouldProbeBlenderRender } from "./blenderRender";
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
  private readonly blender = new BlenderRenderProvider();

  constructor() {
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
    return provider.invoke(args);
  }
}
