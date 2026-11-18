/**
 * Trusted-only, per-execution Code Mode observations.
 * Not an authorization boundary, native speed benchmark, or persistent store.
 * Keep the original overlapping receipt fields and exclude all model data.
 */
import { performance } from 'node:perf_hooks';

const roundMs = value => Math.max(0, Math.round(value));
const KINDS = new Set(['NO_DISK_RUST', 'INJECTED_RUNNER', 'CLI_EXECFILE']);

export function createExecutionMetrics(rustAdapterKind, now = () => performance.now()) {
  if (!KINDS.has(rustAdapterKind) || typeof now !== 'function') {
    throw new TypeError('CODE_MODE_METRICS_CONFIG_INVALID');
  }
  const startedAt = now();
  let guestFirstFrameMs = null;
  let hostRpcMs = 0;
  let rustAdapterMs = 0;
  let rustAdapterCalls = 0;
  let rustAdapterFailures = 0;
  let approvalWaitMs = 0;
  let rpcFailures = 0;

  return Object.freeze({
    mark: () => now(),
    recordFirstGuestFrame() {
      // First guest output includes startup AND guest work, not pure cold start.
      if (guestFirstFrameMs === null) guestFirstFrameMs = roundMs(now() - startedAt);
    },
    recordNativeCall(sample) {
      // Called only from the originating RPC's AsyncLocalStorage execution.
      rustAdapterCalls++;
      rustAdapterMs += sample.duration_ms;
      if (!sample.success) rustAdapterFailures++;
    },
    recordApprovalSince(started) {
      approvalWaitMs += Math.max(0, now() - started);
    },
    recordRpcFailure() { rpcFailures++; },
    recordRpcSince(started) {
      hostRpcMs += Math.max(0, now() - started);
    },
    snapshot() {
      // Durations can overlap. Never sum these values or interpret as tokens.
      return Object.freeze({
        wall_ms: roundMs(now() - startedAt),
        guest_first_frame_ms: guestFirstFrameMs,
        host_rpc_ms: roundMs(hostRpcMs),
        rust_adapter_ms: roundMs(rustAdapterMs),
        rust_adapter_calls: rustAdapterCalls,
        rust_adapter_failures: rustAdapterFailures,
        approval_wait_ms: roundMs(approvalWaitMs),
        rpc_failures: rpcFailures,
        rust_adapter_kind: rustAdapterKind,
      });
    },
  });
}
