/// <reference types="three" />
/// <reference types="blockbench-types" />
import { VERSION } from "@/lib/constants";
import { DEFAULT_MCP_AUTHORING_STAGE } from "@/lib/capabilities/authoringStage";
import { setStatusBarState } from "@/ui/statusBar";
import { PRODUCT_ABOUT } from "@/lib/product/productIdentity";
import {
  applyMcpToolSurface,
  getActiveMcpRegistrationProfile,
  registerMcpProfile,
} from "@/server/runtime/registration";
import { setMcpPhaseSwitchHandler } from "@/server/runtime/phaseControl";
import {
  MCP_AUTHORING_PHASE_SETTING_ID,
  resolveMcpAuthoringStage,
  type McpAuthoringStage,
} from "@/lib/capabilities/authoringStage";
import {
  claimRuntimeGeneration,
  isRuntimeGenerationCurrent,
  markRuntimeGenerationState,
  type RuntimeGenerationClaim,
} from "@/lib/runtime/lifecycle";
import {
  BLOCKBENCH_MIN_VERSION,
  evaluateBlockbenchCompatibility,
} from "@/lib/blockbench/compatibility";
import { getIcon } from "@/macros/getIcon" with { type: "macro" };
import { normalizeRuntimeEndpoint } from "@/lib/runtime/connection";
import {
  setupLocalDevAutoReload,
  stopLocalDevAutoReload,
} from "@/plugin/devSync";
import { RuntimeHost } from "@/plugin/runtimeHost";
import { BlockbenchIntegration } from "@/plugin/blockbenchIntegration";
import {
  registerAuthoringRecipeOwnershipProperties,
  unregisterAuthoringRecipeOwnershipProperties,
} from "@/server/runtime/recipes/authoring/ownership";

const runtimeHost = new RuntimeHost();
const blockbenchIntegration = new BlockbenchIntegration();
let runtimeGeneration: number | null = null;
let initializationInProgress: Promise<void> | null = null;

function currentBuildIdentity(): string | null {
  return (
    (
      globalThis as typeof globalThis & {
        __LAZYDESIGNER_BUILD_ID__?: unknown;
      }
    ).__LAZYDESIGNER_BUILD_ID__ as string | undefined
  ) ?? null;
}

function beginBlockItRuntimeTeardown(
  generation: number | null = runtimeGeneration
): void {
  if (generation === null || runtimeGeneration !== generation) return;
  if (generation !== null && runtimeGeneration === generation) {
    runtimeGeneration = null;
  }
  initializationInProgress = null;

  // Blockbench does not await plugin onunload(). Detach integration callbacks
  // synchronously, then let RuntimeHost + the lifecycle coordinator drain native
  // work and listener shutdown before a new generation binds.
  // A changed Blockbench native API can throw while releasing optional UI,
  // recipe, or dev-watcher ownership. None may prevent the listener teardown
  // barrier that the next bundle generation must await.
  try { stopLocalDevAutoReload(); }
  catch (error) { console.warn("[MCP] Development watcher cleanup failed", error); }
  try { unregisterAuthoringRecipeOwnershipProperties(); }
  catch (error) { console.warn("[MCP] Recipe ownership cleanup failed", error); }
  try { setMcpPhaseSwitchHandler(undefined); }
  catch (error) { console.warn("[MCP] Stage handler cleanup failed", error); }
  try { blockbenchIntegration.teardown(); }
  catch (error) { console.warn("[MCP] Blockbench integration cleanup failed", error); }
  runtimeHost.teardown(generation);
}

async function initializeBlockItRuntime(
  claim: RuntimeGenerationClaim
): Promise<void> {
  const { generation, priorTeardown } = claim;
  await priorTeardown;
  if (!isRuntimeGenerationCurrent(generation)) return;
  // Make the status panel available even when native Runtime startup fails.
  setStatusBarState("starting");
  const registrationProfile = blockbenchIntegration.setupBase({
    generation,
    isGenerationCurrent: isRuntimeGenerationCurrent,
  });
  registerMcpProfile(registrationProfile);

  let authoringStage: McpAuthoringStage;
  try {
    authoringStage = resolveMcpAuthoringStage(
      Settings.get(MCP_AUTHORING_PHASE_SETTING_ID)
    );
  } catch (error) {
    blockbenchIntegration.setupUi(registrationProfile, DEFAULT_MCP_AUTHORING_STAGE);
    markRuntimeGenerationState(generation, "failed");
    setStatusBarState("failed", "Invalid startup focus. Restore the default in Blockbench settings.");
    console.error("[MCP] Invalid authoring phase setting - server will not start", error);
    Blockbench.showQuickMessage("LazyDesigner couldn't start. Check its startup settings.", 4000);
    return;
  }
  // Human UI does not depend on a running server or loaded prompts.
  blockbenchIntegration.setupUi(registrationProfile, authoringStage);

  const rawPort = Number(Settings.get("mcp_port") || 3000);
  if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
    markRuntimeGenerationState(generation, "failed");
    setStatusBarState("failed", "Invalid port. Enter a number from 1 to 65535.");
    console.error(`[MCP] Invalid mcp_port value "${Settings.get("mcp_port")}" - server will not start. Set a port between 1 and 65535 in plugin settings.`);
    Blockbench.showQuickMessage("LazyDesigner couldn't start. Check its connection settings.", 4000);
    return;
  }

  if (!runtimeHost.acquireNativeNetwork(generation)) return;
  applyMcpToolSurface(registrationProfile, authoringStage);
  setMcpPhaseSwitchHandler((targetPhase) => {
    if (!isRuntimeGenerationCurrent(generation)) return;
    const activeProfile = getActiveMcpRegistrationProfile();
    applyMcpToolSurface(activeProfile, targetPhase);
  });

  if (!(await blockbenchIntegration.loadPrompts())) return;

  let runtimeEndpoint: string;
  try {
    runtimeEndpoint = normalizeRuntimeEndpoint(Settings.get("mcp_endpoint"));
  } catch (error) {
    markRuntimeGenerationState(generation, "failed");
    setStatusBarState("failed", "Invalid connection path. Restore the default in Blockbench settings.");
    console.error("[MCP] Invalid mcp_endpoint value - server will not start", error);
    Blockbench.showQuickMessage(
      "LazyDesigner couldn't start. Check its connection settings.",
      4000
    );
    return;
  }

  runtimeHost.setConfig({
    port: rawPort,
    endpoint: runtimeEndpoint,
  });

  if (!(await runtimeHost.start(generation, currentBuildIdentity()))) return;
  if (!isRuntimeGenerationCurrent(generation)) return;

  setupLocalDevAutoReload(generation, currentBuildIdentity());
}

BBPlugin.register("lazydesigner_mcp", {
  version: VERSION,
  title: "LazyDesigner",
  author: "Anonymous",
  description: PRODUCT_ABOUT,
  about: PRODUCT_ABOUT,
  tags: ["MCP", "AI"],
  repository: "",
  bug_tracker: "",
  icon: getIcon(),
  variant: "desktop",
  min_version: BLOCKBENCH_MIN_VERSION,

  onload() {
    if (
      initializationInProgress ||
      (runtimeGeneration !== null &&
        isRuntimeGenerationCurrent(runtimeGeneration))
    ) {
      console.error(
        "[MCP] Plugin onload called while this generation is already active."
      );
      return;
    }

    const compatibility = evaluateBlockbenchCompatibility(
      Blockbench.version,
      currentBuildIdentity()
    );
    if (
      compatibility.status === "unsupported" ||
      compatibility.status === "invalid"
    ) {
      console.error("[MCP] Blockbench compatibility gate blocked startup", compatibility);
      Blockbench.showQuickMessage(
        `LazyDesigner requires Blockbench ${compatibility.minimumVersion} or newer.`,
        6000
      );
      return;
    }

    if (compatibility.status === "review-required") {
      console.warn("[MCP] Blockbench version requires compatibility review", compatibility);
      Blockbench.showQuickMessage(
        `Blockbench ${compatibility.version} has not been compatibility-validated for LazyDesigner yet.`,
        6000
      );
    } else if (compatibility.status === "compatible-unverified") {
      console.info("[MCP] Blockbench version is allowed but not exact-live-validated", compatibility);
    }

    const claim = claimRuntimeGeneration(currentBuildIdentity(), beginBlockItRuntimeTeardown);
    runtimeGeneration = claim.generation;
    registerAuthoringRecipeOwnershipProperties();
    const initialization = initializeBlockItRuntime(claim);
    initializationInProgress = initialization;
    void initialization
      .catch((error) => {
        if (!isRuntimeGenerationCurrent(claim.generation)) return;
        markRuntimeGenerationState(claim.generation, "failed");
        setStatusBarState("failed", "Runtime initialization failed. See console for details.");
        console.error("[MCP] LazyDesigner runtime initialization failed", error);
        Blockbench.showQuickMessage(
          "LazyDesigner couldn't start. Technical details are available in the console.",
          5000
        );
      })
      .finally(() => {
        if (initializationInProgress === initialization) {
          initializationInProgress = null;
        }
      });
  },

  onunload() {
    beginBlockItRuntimeTeardown();
  },

  oninstall() {
    Blockbench.showQuickMessage("LazyDesigner installed", 2000);
  },

  onuninstall() {
    Blockbench.showQuickMessage("LazyDesigner removed", 2000);
    beginBlockItRuntimeTeardown();
  },
});
