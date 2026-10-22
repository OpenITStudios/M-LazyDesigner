import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  readRuntimeAuthoringPhase,
  readRuntimeProjectHealth,
  type BlockitAuthoringPhaseAffinity,
} from "../../lib/runtime/affinity";
import {
  buildRuntimeAffinityHeaders,
  isCatalogFresh,
} from "./backendState";
import {
  resolveAuthoringPhaseAffinity,
  resolveProjectAffinity,
} from "./affinityPolicy";
import {
  GATEWAY_VERSION,
  type BackendTool,
  type CapabilitySummary,
  type CapabilitySearchContext,
  type JsonRecord,
} from "../contracts/protocol";
import {
  DEFAULT_RUNTIME_URL,
  createRuntimeSignature,
  verifyRuntimeBuildIdentity,
  normalizeRuntimeUrl,
} from "./identity";
import { classifyInterruptedCall } from "./interruptionPolicy";
import { searchCapabilityCatalog } from "../capabilities/catalog";
import { GatewayConnectionManager } from "./connectionManager";
import { GatewayOperationQueue } from "./operationQueue";
import {
  resolveGatewayCapabilityEffects,
  validateGatewayCapabilityEffectReceipt,
} from "../capabilities/effects";
import { getCapabilityMetadata } from "../../lib/capabilities/metadata";
import { runtimeFetch } from "../../lib/runtime/fetch";

import {
  GatewayBackendError,
  errorMessage,
  isRecord,
  isRequestTimeoutError,
  isRuntimeProjectContextError,
  normalizeGatewayManagedResult,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  normalizeRuntimeCallResult,
  type BlockitRuntimeBackendOptions,
  type GatewayRuntimeCallResult,
  type GatewayRuntimeInvocation,
  type GatewayRuntimeStatus,
  type HealthProbe,
  type RuntimeGenerationChangeEvent,
} from "./backendContract";

export {
  GatewayBackendError,
  type GatewayBackendErrorCode,
  type GatewayRuntimeCallResult,
  type GatewayRuntimeInvocation,
  type GatewayRuntimeStatus,
  type BlockitRuntimeBackendOptions,
  type RuntimeGenerationChangeEvent,
} from "./backendContract";

export class BlockitRuntimeBackend {
  readonly runtimeUrl: string;
  private readonly healthTimeoutMs: number;
  private readonly expectedRuntimeBuildIdentity: string | null;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly catalogLeaseMs: number;
  private readonly onRuntimeGenerationChange:
    | ((event: RuntimeGenerationChangeEvent) => void)
    | undefined;
  private readonly onRuntimeUnavailable: (() => void) | undefined;
  private readonly connection = new GatewayConnectionManager();
  private readonly operationQueue: GatewayOperationQueue;
  private client: Client | null = null;
  private connectedProtocolEra: "modern" | "legacy" | null = null;
  private connectedSignature: string | null = null;
  private catalog = new Map<string, BackendTool>();
  private catalogValidatedAt = 0;
  private projectUuid: string | null = null;
  private authoringPhase: BlockitAuthoringPhaseAffinity | null = null;
  private lastError: string | null = null;
  private lastVerifiedHealthSignature: string | null = null;
  private lastVerifiedHealthAt = 0;
  // All backend-changing operations use the existing serialized Gateway queue.
  // A passive /health reply cannot commit across one of these boundaries.
  private backendRevision = 0;
  private passiveStatusSequence = 0;

  constructor(
    runtimeUrl?: string,
    healthTimeoutMs: number = Number(process.env.LAZYDESIGNER_RUNTIME_TIMEOUT_MS ?? 1500),
    options: BlockitRuntimeBackendOptions = {}
  ) {
    this.runtimeUrl = normalizeRuntimeUrl(
      runtimeUrl ?? process.env.LAZYDESIGNER_RUNTIME_URL ?? DEFAULT_RUNTIME_URL
    );
    const expectedBuild = process.env.LAZYDESIGNER_EXPECTED_RUNTIME_BUILD_ID ?? null;
    if (expectedBuild !== null && !/^sha256:[a-f0-9]{64}$/.test(expectedBuild)) {
      throw new Error("Configured LazyDesigner Runtime build identity is invalid.");
    }
    this.expectedRuntimeBuildIdentity = expectedBuild;
    // The normal long-lived Gateway is configured through LAZYDESIGNER_RUNTIME_URL.
    // Never silently downgrade that connection to cleartext HTTP. Isolated
    // protocol fixtures may still pass an explicit loopback HTTP URL in code.
    if (runtimeUrl === undefined && new URL(this.runtimeUrl).protocol !== "https:") {
      throw new Error(
        "LazyDesigner Gateway requires HTTPS for its configured Runtime URL. Explicit HTTP URLs are reserved for isolated protocol tests."
      );
    }
    this.healthTimeoutMs = normalizePositiveInteger(healthTimeoutMs, 1500, 100);
    this.connectTimeoutMs = normalizePositiveInteger(
      options.connectTimeoutMs ??
        Number(process.env.LAZYDESIGNER_RUNTIME_CONNECT_TIMEOUT_MS ?? 5000),
      5000,
      250
    );
    this.callTimeoutMs = normalizePositiveInteger(
      options.callTimeoutMs ??
        Number(process.env.LAZYDESIGNER_RUNTIME_CALL_TIMEOUT_MS ?? 120000),
      120000,
      1000
    );
    this.closeTimeoutMs = normalizePositiveInteger(
      options.closeTimeoutMs ??
        Number(process.env.LAZYDESIGNER_RUNTIME_CLOSE_TIMEOUT_MS ?? 2000),
      2000,
      100
    );
    this.operationQueue = new GatewayOperationQueue(
      normalizeNonNegativeInteger(
        options.maxQueueDepth ??
          Number(process.env.LAZYDESIGNER_GATEWAY_MAX_QUEUE_DEPTH ?? 8),
        8
      ),
      normalizePositiveInteger(
        options.maxQueueWaitMs ??
          Number(process.env.LAZYDESIGNER_GATEWAY_MAX_QUEUE_WAIT_MS ?? 30_000),
        30_000,
        1
      )
    );
    this.catalogLeaseMs = normalizePositiveInteger(
      options.catalogLeaseMs ??
        Number(process.env.LAZYDESIGNER_GATEWAY_CATALOG_LEASE_MS ?? 1000),
      1000,
      100
    );
    this.onRuntimeGenerationChange = options.onRuntimeGenerationChange;
    this.onRuntimeUnavailable = options.onRuntimeUnavailable;
  }

  private runExclusive<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.operationQueue.run(async () => {
      this.backendRevision += 1;
      try {
        return await operation();
      } finally {
        this.backendRevision += 1;
      }
    }, { signal });
  }

  private operationStatus(): GatewayRuntimeStatus["operations"] {
    return this.operationQueue.snapshot();
  }

  /** Do not return an old Stage/project catalog while queued work may change it. */
  private hasUncontendedFreshCatalog(): boolean {
    const { active, queued } = this.operationStatus();
    return active === 0 && queued === 0 && this.hasFreshCatalog();
  }

  private hasFreshCatalog(now: number = Date.now()): boolean {
    // Do not reuse a seemingly fresh local catalog after any unverified
    // transport failure, even when Runtime health returns the same signature.
    if (this.connection.needsMcpRevalidation()) return false;
    return isCatalogFresh({
      clientReady: Boolean(this.client),
      connectedSignature: this.connectedSignature,
      catalogCount: this.catalog.size,
      catalogValidatedAt: this.catalogValidatedAt,
      catalogLeaseMs: this.catalogLeaseMs,
      now,
    });
  }

  /** Cached evidence from the last Runtime health probe; no confirmation call. */
  observedManagedCatalogEvidence(): { catalog_ready: boolean; runtime_build_identity: string | null } {
    const freshHealth = this.lastVerifiedHealthSignature !== null
      && Date.now() - this.lastVerifiedHealthAt <= this.catalogLeaseMs + 500;
    return {
      catalog_ready: this.expectedRuntimeBuildIdentity !== null
        && freshHealth
        && this.client !== null
        && this.connectedSignature === this.lastVerifiedHealthSignature
        && this.catalog.size > 0
        && this.hasFreshCatalog()
        && this.connection.snapshot().state === "ready",
      runtime_build_identity: this.expectedRuntimeBuildIdentity,
    };
  }

  private runtimeRequestHeaders(): Headers {
    return buildRuntimeAffinityHeaders(this.projectUuid, this.authoringPhase);
  }

  private async probeHealth(
    requestedProjectUuid?: string,
    passive: boolean = false
  ): Promise<HealthProbe> {
    if (!passive) {
      this.lastVerifiedHealthSignature = null;
      this.lastVerifiedHealthAt = 0;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.healthTimeoutMs);

    try {
      const response = await runtimeFetch(`${this.runtimeUrl}/health`, {
        method: "GET",
        headers: requestedProjectUuid === undefined
          ? this.runtimeRequestHeaders()
          : buildRuntimeAffinityHeaders(requestedProjectUuid, this.authoringPhase),
        signal: controller.signal,
      });
      if (response.status !== 200) {
        return {
          online: false,
          error: `Runtime health returned HTTP ${response.status}.`,
        };
      }

      const body: unknown = await response.json();
      if (!isRecord(body)) {
        return { online: false, error: "Runtime health returned non-object JSON." };
      }

      const identityIssue = verifyRuntimeBuildIdentity(body, this.expectedRuntimeBuildIdentity);
      if (identityIssue) {
        return { online: false, error: identityIssue };
      }
      const signature = createRuntimeSignature(body);
      if (!passive) {
        this.lastVerifiedHealthSignature = signature;
        this.lastVerifiedHealthAt = Date.now();
        this.connection.markAvailable();
      }
      return {
        online: true,
        health: body,
        signature,
      };
    } catch (error) {
      return { online: false, error: errorMessage(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  private syncAuthoringPhaseFromHealth(health: JsonRecord): boolean {
    const resolution = resolveAuthoringPhaseAffinity(
      this.authoringPhase,
      health
    );
    this.authoringPhase = resolution.value;
    return resolution.changed;
  }

  private syncProjectAffinityFromHealth(
    health: JsonRecord,
    bindIfUnset: boolean,
    allowMissingBoundProject: boolean = false
  ): boolean {
    const resolution = resolveProjectAffinity(
      this.projectUuid, health, bindIfUnset, allowMissingBoundProject
    );
    this.projectUuid = resolution.value;
    return resolution.changed;
  }

  private async closeClientBestEffort(client: Client): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.close(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.closeTimeoutMs);
        }),
      ]);
    } catch {
      // A dead backend is already disconnected; cleanup remains best-effort.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async closeConnectionUnsafe(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connectedProtocolEra = null;
    this.connectedSignature = null;
    this.catalog.clear();
    this.catalogValidatedAt = 0;
    this.lastVerifiedHealthSignature = null;
    this.lastVerifiedHealthAt = 0;

    if (client) {
      await this.closeClientBestEffort(client);
    }
  }

  private async listAllTools(client: Client): Promise<BackendTool[]> {
    const tools: BackendTool[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      const listed = await client.listTools(
        cursor ? { cursor } : undefined,
        { timeout: this.connectTimeoutMs }
      );
      tools.push(...(listed.tools as BackendTool[]));
      cursor = typeof listed.nextCursor === "string" ? listed.nextCursor : undefined;
      pages += 1;
      if (pages > 100) {
        throw new Error("Runtime tools/list exceeded the 100-page safety bound.");
      }
    } while (cursor);

    return tools;
  }

  /**
   * A Runtime can reload between the initial /health probe and the MCP
   * initialize/tools/list exchange. Confirm the same generation and bound
   * project/Stage before advertising that tool catalog to the Gateway.
   * This is read-only and runs inside the existing Gateway operation queue.
   */
  private async verifyPostHandshakeRuntimeUnsafe(signature: string): Promise<void> {
    const confirmed = await this.probeHealth(undefined, true);
    if (!confirmed.online) {
      throw new GatewayBackendError(
        "BACKEND_UNAVAILABLE",
        `LazyDesigner Runtime disappeared during MCP handshake: ${confirmed.error}`,
        true
      );
    }
    if (confirmed.signature !== signature) {
      throw new GatewayBackendError(
        "BACKEND_UNAVAILABLE",
        "LazyDesigner Runtime generation or exposed tool surface changed during MCP handshake. Reconnect before using the catalog.",
        true,
        { initial_signature: signature, confirmed_signature: confirmed.signature }
      );
    }
    // Both affinity verifiers are pure: failed confirmation must not silently
    // adopt a different Blockbench tab or Stage after Runtime replacement.
    resolveAuthoringPhaseAffinity(this.authoringPhase, confirmed.health);
    resolveProjectAffinity(this.projectUuid, confirmed.health, false);
  }

  private async connectFreshUnsafe(signature: string): Promise<void> {
    const previousSignature = this.connectedSignature;
    const hadReadyRuntime = this.connection.session.hasBeenReady();
    await this.closeConnectionUnsafe();
    this.connection.beginConnect();

    const client = new Client(
      { name: "lazydesigner-gateway-runtime-client", version: GATEWAY_VERSION },
      {
        capabilities: {},
        versionNegotiation: { mode: "auto" },
      }
    );
    const transport = new StreamableHTTPClientTransport(new URL(this.runtimeUrl), {
      fetch: runtimeFetch,
      requestInit: { headers: this.runtimeRequestHeaders() },
    });

    try {
      await client.connect(transport, { timeout: this.connectTimeoutMs });
      const tools = await this.listAllTools(client);
      await this.verifyPostHandshakeRuntimeUnsafe(signature);
      // Publishing is synchronous after the second identity/affinity check:
      // no changed Runtime generation may be paired with the old catalog.
      this.client = client;
      this.connectedProtocolEra = client.getProtocolEra() ?? null;
      this.connectedSignature = signature;
      this.catalog = new Map(tools.map((tool) => [tool.name, tool]));
      this.catalogValidatedAt = Date.now();
      this.lastError = null;
      this.connection.markReady({ catalogRefreshed: true });
      if (hadReadyRuntime) {
        const snapshot = this.connection.snapshot();
        this.onRuntimeGenerationChange?.({
          previous_signature: previousSignature,
          next_signature: signature,
          project_uuid: this.projectUuid,
          connection_generation: snapshot.generation,
          reconnect_count: snapshot.reconnect_count,
        });
      }
    } catch (error) {
      // A Control generation-change observer may itself throw after the
      // client was published. Always withdraw the catalog as well as the
      // connection before recording a failed handshake.
      if (this.client === client) await this.closeConnectionUnsafe();
      else await this.closeClientBestEffort(client);
      const message = errorMessage(error);
      const timedOut = isRequestTimeoutError(error);
      const retryAfterMs = this.connection.markDegraded();
      this.lastError = message;
      this.onRuntimeUnavailable?.();
      // Affinity drift is not an ordinary transport retry: preserve the
      // explicit rebind requirement and non-retryable error classification.
      if (error instanceof GatewayBackendError && !error.safeToRetry) {
        throw error;
      }
      throw new GatewayBackendError(
        "BACKEND_UNAVAILABLE",
        `LazyDesigner Runtime MCP connection failed: ${message}`,
        true,
        {
          ...(timedOut ? { timeout_ms: this.connectTimeoutMs } : {}),
          retry_after_ms: retryAfterMs,
        }
      );
    }
  }

  private async ensureCatalogUnsafe(
    bindProject: boolean = false,
    allowMissingBoundProject: boolean = false
  ): Promise<void> {
    if (!this.client && !this.connection.canAttempt()) {
      const retryAfterMs = this.connection.retryAfterMs();
      throw new GatewayBackendError(
        "BACKEND_UNAVAILABLE",
        `LazyDesigner Runtime reconnect is cooling down for ${retryAfterMs}ms after a recent connection failure.`,
        true,
        { retry_after_ms: retryAfterMs }
      );
    }

    this.connection.beginProbe();
    const probe = await this.probeHealth();
    if (!probe.online) {
      await this.closeConnectionUnsafe();
      const retryAfterMs = this.connection.markOffline();
      this.lastError = probe.error;
      this.onRuntimeUnavailable?.();
      throw new GatewayBackendError(
        "BACKEND_UNAVAILABLE",
        `LazyDesigner Runtime is unavailable: ${probe.error}`,
        true,
        { retry_after_ms: retryAfterMs }
      );
    }

    let affinityChanged = false;
    try {
      // Validate phase and project together before committing either affinity.
      // A mismatched/missing project on the first probe must not pin an
      // unrelated Runtime phase and block a later correct profile.
      const phase = resolveAuthoringPhaseAffinity(this.authoringPhase, probe.health);
      // Validate phase before binding project; rejected phase never
      // leaves an unrelated or partially adopted Runtime affinity.
      const projectChanged = this.syncProjectAffinityFromHealth(
        probe.health, bindProject, allowMissingBoundProject
      );
      affinityChanged = phase.changed || projectChanged;
      this.authoringPhase = phase.value;
    } catch (error) {
      await this.closeConnectionUnsafe();
      this.lastError = errorMessage(error);
      this.onRuntimeUnavailable?.();
      throw error;
    }

    if (affinityChanged && this.client) {
      await this.closeConnectionUnsafe();
    }
    // Health recovery resets retry backoff but cannot revive an old MCP client.
    // Close it in the serialized execution path before attempting a handshake.
    if (this.connection.needsMcpRevalidation() && this.client) {
      await this.closeConnectionUnsafe();
    }

    if (
      this.client &&
      this.connectedSignature === probe.signature &&
      this.catalog.size > 0
    ) {
      this.catalogValidatedAt = Date.now();
      this.connection.markHealthy();
      return;
    }

    await this.connectFreshUnsafe(probe.signature);
    // A successful first MCP handshake also establishes a fresh catalog.
    // closeConnectionUnsafe() retired the old health cache before connect.
    this.lastVerifiedHealthSignature = probe.signature;
    this.lastVerifiedHealthAt = Date.now();
  }

  private buildStatus(probe: HealthProbe): GatewayRuntimeStatus {
    if (!probe.online) {
      this.connection.markOffline();
      this.onRuntimeUnavailable?.();
      return {
        gateway: "ready",
        affinity: {
          project_uuid: this.projectUuid,
          authoring_phase: this.authoringPhase,
        },
        runtime: {
          online: false,
          endpoint: this.runtimeUrl,
          mcp_client_ready: false,
          protocol_era: null,
          catalog_stale: this.catalog.size > 0,
          runtime_signature: null,
          connected_signature: this.connectedSignature,
          catalog_count: this.catalog.size,
          health: null,
        },
        connection: this.connection.snapshot(),
        operations: this.operationStatus(),
        last_error: probe.error,
      };
    }

    const projectHealth = readRuntimeProjectHealth(probe.health);
    const boundProjectUnverified = this.projectUuid !== null &&
      (!projectHealth ||
       projectHealth.requested_project_uuid !== this.projectUuid ||
       projectHealth.requested_project_available !== true);
    const ready =
      Boolean(this.client) &&
      this.catalog.size > 0 &&
      this.connectedSignature === probe.signature &&
      !this.connection.needsMcpRevalidation() &&
      !boundProjectUnverified;
    const catalogStale =
      this.catalog.size > 0 &&
      (!this.hasFreshCatalog() || this.connectedSignature !== probe.signature ||
       boundProjectUnverified);
    // Passive health is not proof that the old Runtime's Control facts still
    // apply after instance replacement, transport failure or tab loss.
    const runtimeAuthorityChanged = boundProjectUnverified ||
      (this.connectedSignature !== null &&
       this.connectedSignature !== probe.signature);
    if (runtimeAuthorityChanged) {
      // An observed new Runtime generation or missing bound project retires
      // the old MCP authority, even if a catalog lease has time remaining.
      // Degraded state closes the cached discovery fast path immediately.
      this.connection.markDegraded();
    }
    if (runtimeAuthorityChanged || this.connection.needsMcpRevalidation()) {
      this.onRuntimeUnavailable?.();
    }
    // A health-only status read can precede the first intentional lazy MCP
    // connection. Reflect this first healthy probe as "probing" rather than
    // reporting an offline client, but never erase failed reconnect evidence.
    const session = this.connection.snapshot();
    if (
      !ready &&
      this.connectedSignature === null &&
      session.state === "offline" &&
      session.last_ready_at === null &&
      session.reconnect.failures === 0 &&
      !this.connection.needsMcpRevalidation()
    ) {
      this.connection.beginProbe();
    }
    if (ready) {
      // /health verifies Runtime identity, not tools/list or the catalog.
      // Only a real catalog validation may renew catalogValidatedAt.
      this.connection.markHealthy();
    }
    return {
      gateway: "ready",
      affinity: {
        project_uuid: this.projectUuid,
        authoring_phase:
          this.authoringPhase ?? readRuntimeAuthoringPhase(probe.health),
      },
      runtime: {
        online: true,
        endpoint: this.runtimeUrl,
        mcp_client_ready: ready,
        protocol_era: ready ? this.connectedProtocolEra : null,
        catalog_stale: catalogStale,
        runtime_signature: probe.signature,
        connected_signature: this.connectedSignature,
        catalog_count: this.catalog.size,
        health: probe.health,
      },
      connection: this.connection.snapshot(),
      operations: this.operationStatus(),
      last_error: this.lastError,
    };
  }

  async getStatus(): Promise<GatewayRuntimeStatus> {
    // Status reads stay outside the native operation queue. If a read spans a
    // reconnect/affinity operation or a newer status probe, discard its result
    // before it can mark the MCP connection ready/offline or alter health proof.
    // One bounded retry is safe for status; never retry native mutations.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const revision = this.backendRevision;
      const sequence = ++this.passiveStatusSequence;
      const operationWasActive = this.operationStatus().active > 0;
      const probe = await this.probeHealth(undefined, true);
      if (operationWasActive ||
          this.operationStatus().active > 0 ||
          revision !== this.backendRevision ||
          sequence !== this.passiveStatusSequence) continue;
      if (probe.online) {
        this.lastVerifiedHealthSignature = probe.signature;
        this.lastVerifiedHealthAt = Date.now();
        this.connection.markAvailable();
      } else {
        this.lastVerifiedHealthSignature = null;
        this.lastVerifiedHealthAt = 0;
      }
      return this.buildStatus(probe);
    }
    throw new GatewayBackendError(
      "BACKEND_UNAVAILABLE",
      "Gateway Runtime status changed during observation; retry read-only status.",
      true,
      { reason: "SUPERSEDED_STATUS_PROBE", executed: false }
    );
  }

  async adoptActiveProject(): Promise<GatewayRuntimeStatus> {
    return this.runExclusive(async () => {
      const initial = await this.probeHealth();
      if (!initial.online) {
        this.lastError = initial.error;
        return this.buildStatus(initial);
      }

      const projectHealth = readRuntimeProjectHealth(initial.health);
      if (!projectHealth) {
        throw new GatewayBackendError(
          "PROJECT_CONTEXT_LOST",
          "The connected LazyDesigner Runtime does not expose project-affinity health. Deploy/reload the matching LazyDesigner build before rebinding.",
          false
        );
      }
      if (!projectHealth.active_project_uuid) {
        throw new GatewayBackendError(
          "PROJECT_CONTEXT_LOST",
          "No Blockbench project tab is active, so this Gateway cannot rebind project affinity.",
          false
        );
      }

      // An explicit rebind may select any visible tab, but the Runtime must
      // prove the exact UUID is unique. The first passive probe cannot detect
      // duplicate UUIDs when no requested-project header is supplied.
      const selectedUuid = projectHealth.active_project_uuid;
      const confirmed = await this.probeHealth(selectedUuid);
      if (!confirmed.online) {
        this.lastError = confirmed.error;
        throw new GatewayBackendError(
          "BACKEND_UNAVAILABLE",
          `Could not verify the selected Blockbench project: ${confirmed.error}`,
          false
        );
      }
      const verifiedProject = readRuntimeProjectHealth(confirmed.health);
      if (
        confirmed.signature !== initial.signature ||
        !verifiedProject ||
        verifiedProject.active_project_uuid !== selectedUuid ||
        verifiedProject.requested_project_uuid !== selectedUuid ||
        verifiedProject.requested_project_available !== true
      ) {
        throw new GatewayBackendError(
          "PROJECT_CONTEXT_LOST",
          "Selected Blockbench tab changed, is ambiguous, or Runtime restarted during rebind. Choose one unique tab and explicitly rebind again.",
          false,
          { project_uuid: selectedUuid }
        );
      }

      // Commit neither affinity until both project and Stage are validated.
      let affinityChanged = this.syncAuthoringPhaseFromHealth(confirmed.health);
      if (this.projectUuid !== selectedUuid) {
        this.projectUuid = selectedUuid;
        affinityChanged = true;
      }
      if (affinityChanged) {
        await this.closeConnectionUnsafe();
      }
      this.lastError = null;
      return this.buildStatus(await this.probeHealth());
    });
  }

  async searchCapabilities(
    query: string,
    limit: number = 4,
    context: CapabilitySearchContext = {}
  ): Promise<CapabilitySummary[]> {
    if (this.hasUncontendedFreshCatalog()) {
      return searchCapabilityCatalog([...this.catalog.values()], query, limit, {
        ...context,
        authoringPhase: this.authoringPhase,
      });
    }

    return this.runExclusive(async () => {
      if (!this.hasFreshCatalog()) {
        await this.ensureCatalogUnsafe();
      }
      return searchCapabilityCatalog([...this.catalog.values()], query, limit, {
        ...context,
        authoringPhase: this.authoringPhase,
      });
    });
  }

  async describeCapability(capability: string): Promise<BackendTool> {
    const readTool = (): BackendTool => {
      const tool = this.catalog.get(capability);
      if (!tool) {
        throw new GatewayBackendError(
          "CAPABILITY_NOT_FOUND",
          `Runtime capability "${capability}" is not exposed by the current LazyDesigner surface.`,
          true,
          { capability }
        );
      }
      return tool;
    };
    if (this.hasUncontendedFreshCatalog()) return readTool();

    // Read the definition under the same queue ownership used to revalidate
    // the catalog. Never release the lock between refreshing and reading.
    return this.runExclusive(async () => {
      if (!this.hasFreshCatalog()) await this.ensureCatalogUnsafe();
      return readTool();
    });
  }

  async invokeCapability(
    capability: string,
    args: JsonRecord = {},
    requestMeta?: JsonRecord
  ): Promise<GatewayRuntimeCallResult> {
    return (
      await this.invokeCapabilityWithMetadata(capability, args, requestMeta)
    ).result;
  }

  async invokeCapabilityWithMetadata(
    capability: string,
    args: JsonRecord = {},
    requestMeta?: JsonRecord,
    signal?: AbortSignal
  ): Promise<GatewayRuntimeInvocation> {
    return this.runExclusive(async () => {
      const capabilityMetadata = getCapabilityMetadata(capability);
      const projectTransition =
        capabilityMetadata.effects.projectAffinity === "adopt_created_project";
      await this.ensureCatalogUnsafe(!projectTransition, projectTransition);
      const tool = this.catalog.get(capability);
      if (!tool) {
        throw new GatewayBackendError(
          "CAPABILITY_NOT_FOUND",
          `Runtime capability "${capability}" is not exposed by the current LazyDesigner surface.`,
          true,
          { capability }
        );
      }

      try {
        const result: unknown = await this.client!.callTool(
          {
            name: capability,
            arguments: args,
            ...(requestMeta && Object.keys(requestMeta).length > 0
              ? { _meta: requestMeta }
              : {}),
          },
          { timeout: this.callTimeoutMs }
        );
        const normalized = normalizeRuntimeCallResult(result);
        let managed = normalized;
        const application = resolveGatewayCapabilityEffects(
          capability,
          normalized.structuredContent,
          this.authoringPhase
        );
        const receiptIssue = validateGatewayCapabilityEffectReceipt(
          application,
          normalized.isError !== true
        );
        if (receiptIssue) {
          await this.closeConnectionUnsafe();
          this.connection.markDegraded();
          this.onRuntimeUnavailable?.();
          throw new GatewayBackendError(
            "BACKEND_UNAVAILABLE",
            receiptIssue.message,
            false,
            {
              capability,
              receipt_issue: receiptIssue.code,
            }
          );
        }

        let affinityChanged = false;

        if (normalized.isError !== true) {
          if (application.projectUuid) {
            this.projectUuid = application.projectUuid;
            affinityChanged = true;
          }

          const phaseAffinityUpdated =
            application.effects.phaseAffinity === "update_from_result";
          if (phaseAffinityUpdated) {
            if (!application.authoringPhase) {
              await this.closeConnectionUnsafe();
              this.connection.markDegraded();
              this.onRuntimeUnavailable?.();
              throw new GatewayBackendError(
                "BACKEND_UNAVAILABLE",
                "LazyDesigner Runtime returned an invalid authoring phase handoff receipt.",
                false,
                {
                  capability,
                  receipt_issue: "MISSING_AUTHORING_PHASE",
                }
              );
            }

            this.authoringPhase = application.authoringPhase;
            affinityChanged = true;
            managed = {
              ...normalized,
              structuredContent: {
                ...(isRecord(normalized.structuredContent)
                  ? normalized.structuredContent
                  : {}),
                phase: application.authoringPhase,
                surface_changed: application.surfaceChanged === true,
              },
            };
          }

          if (application.effects.invalidateCatalog || affinityChanged) {
            await this.closeConnectionUnsafe();
          }

          return {
            result: normalizeGatewayManagedResult(phaseAffinityUpdated, managed),
            readOnly: tool.annotations?.readOnlyHint === true,
            effectApplication: application,
          };
        }

        return {
          result: managed,
          readOnly: tool.annotations?.readOnlyHint === true,
          effectApplication: application,
        };
      } catch (error) {
        const message = errorMessage(error);
        if (isRuntimeProjectContextError(error)) {
          await this.closeConnectionUnsafe();
          this.lastError = message;
          this.onRuntimeUnavailable?.();
          throw new GatewayBackendError(
            "PROJECT_CONTEXT_LOST",
            `LazyDesigner refused "${capability}" because this Gateway's bound project tab is no longer safely available. Select the intended open tab and explicitly rebind before continuing.`,
            false,
            {
              capability,
              project_uuid: this.projectUuid,
              cause: message,
              action: "select intended Blockbench tab, then call status with adopt_active_project=true",
            }
          );
        }
        if (error instanceof GatewayBackendError) {
          this.lastError = message;
          throw error;
        }

        const classification = classifyInterruptedCall(tool);
        const timedOut = isRequestTimeoutError(error);
        await this.closeConnectionUnsafe();
        const retryAfterMs = this.connection.markDegraded();
        this.lastError = message;
        this.onRuntimeUnavailable?.();
        throw new GatewayBackendError(
          classification.code,
          classification.code === "OUTCOME_UNKNOWN"
            ? `LazyDesigner Runtime connection was interrupted while invoking "${capability}". The mutation may already have executed; inspect current model state before retrying.`
            : `LazyDesigner Runtime connection was interrupted while invoking read-only capability "${capability}".`,
          classification.safe_to_retry,
          {
            capability,
            cause: message,
            retry_after_ms: retryAfterMs,
            ...(timedOut ? { timeout_ms: this.callTimeoutMs } : {}),
          }
        );
      }
    }, signal);
  }

  async close(): Promise<void> {
    await this.runExclusive(() => this.closeConnectionUnsafe());
  }
}