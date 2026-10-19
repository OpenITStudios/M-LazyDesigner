import { ReconnectPolicy } from "./reconnectPolicy";
import { RuntimeSessionState } from "./runtimeSession";

export class GatewayConnectionManager {
  readonly reconnect = new ReconnectPolicy({
    minBackoffMs: Number(process.env.LAZYDESIGNER_GATEWAY_RECONNECT_MIN_MS ?? 250),
    maxBackoffMs: Number(process.env.LAZYDESIGNER_GATEWAY_RECONNECT_MAX_MS ?? 2_000),
  });
  readonly session = new RuntimeSessionState();
  // A recovered /health endpoint is not proof that the MCP client recovered.
  // Retain this evidence across reconnect cooldown resets until a real handshake.
  private unverifiedConnectionFailure = false;

  needsMcpRevalidation(): boolean {
    return this.unverifiedConnectionFailure;
  }

  canAttempt(now: number = Date.now()): boolean {
    return this.reconnect.canAttempt(now);
  }

  retryAfterMs(now: number = Date.now()): number {
    return this.reconnect.retryAfterMs(now);
  }

  beginProbe(): void {
    if (this.session.snapshot().state !== "ready") {
      this.session.transition("probing");
    }
  }

  markAvailable(): void {
    const state = this.session.snapshot().state;
    // /health recovery can clear a prior *health outage* cooldown. It must
    // not clear backoff for a failed MCP handshake: that requires a completed
    // handshake (markReady). Status-only health polling is not recovery proof.
    if (state !== "degraded") this.reconnect.markSuccess();
    if (state === "offline" || state === "degraded") {
      this.session.transition(
        this.unverifiedConnectionFailure ? "degraded" : "probing"
      );
    }
  }

  beginConnect(): void {
    this.session.transition("connecting");
  }

  markReady(options: { catalogRefreshed?: boolean } = {}): void {
    const wasReadyBefore = this.session.hasBeenReady();
    if (options.catalogRefreshed) this.session.markCatalogRefresh();
    if (wasReadyBefore) this.session.markReconnect();
    this.reconnect.markSuccess();
    this.unverifiedConnectionFailure = false;
    this.session.transition("ready");
  }

  markHealthy(): void {
    this.reconnect.markSuccess();
    this.session.transition("ready");
  }

  markOffline(): number {
    this.unverifiedConnectionFailure = true;
    const alreadyOffline = this.session.snapshot().state === "offline";
    this.session.transition("offline");
    // The session starts in "offline": the first failed health probe still
    // counts as one failure. Repeated offline polls must not inflate backoff.
    return alreadyOffline && this.reconnect.snapshot().failures > 0
      ? this.reconnect.retryAfterMs()
      : this.reconnect.markFailure();
  }

  markDegraded(): number {
    this.unverifiedConnectionFailure = true;
    const alreadyDegraded = this.session.snapshot().state === "degraded";
    this.session.transition("degraded");
    return alreadyDegraded
      ? this.reconnect.retryAfterMs()
      : this.reconnect.markFailure();
  }

  snapshot() {
    return {
      ...this.session.snapshot(),
      reconnect: this.reconnect.snapshot(),
    };
  }
}
