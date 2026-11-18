/**
 * Source-authored regression contract. Execution remains on hold.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionMetrics } from './execution-metrics.mjs';

test('per-run metrics preserve existing exact receipt keys and overlapping timing', () => {
  let clock = 100;
  const meter = createExecutionMetrics('CLI_EXECFILE', () => clock);
  assert.deepEqual(meter.snapshot(), {
    wall_ms: 0, guest_first_frame_ms: null, host_rpc_ms: 0,
    rust_adapter_ms: 0, rust_adapter_calls: 0, rust_adapter_failures: 0,
    approval_wait_ms: 0, rpc_failures: 0, rust_adapter_kind: 'CLI_EXECFILE',
  });
  clock = 115;
  meter.recordFirstGuestFrame();
  clock = 130;
  meter.recordFirstGuestFrame();
  const rpcStart = meter.mark();
  clock = 136;
  meter.recordRpcSince(rpcStart);
  meter.recordRpcFailure();
  const approvalStart = meter.mark();
  clock = 146;
  meter.recordApprovalSince(approvalStart);
  meter.recordNativeCall({ duration_ms: 22, success: false });
  meter.recordNativeCall({ duration_ms: 8, success: true });
  clock = 170;
  const receipt = meter.snapshot();
  assert.deepEqual(receipt, {
    wall_ms: 70, guest_first_frame_ms: 15, host_rpc_ms: 6,
    rust_adapter_ms: 30, rust_adapter_calls: 2, rust_adapter_failures: 1,
    approval_wait_ms: 10, rpc_failures: 1, rust_adapter_kind: 'CLI_EXECFILE',
  });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(JSON.stringify(receipt).includes('source'), false);
});

test('separate execution metric recorders cannot inherit each other\'s calls', () => {
  let time = 1000;
  const now = () => time;
  const first = createExecutionMetrics('INJECTED_RUNNER', now);
  time = 1010;
  first.recordNativeCall({ duration_ms: 9, success: false });
  const second = createExecutionMetrics('NO_DISK_RUST', now);
  second.recordRpcFailure();
  time = 1020;
  assert.equal(first.snapshot().rust_adapter_calls, 1);
  assert.equal(first.snapshot().rpc_failures, 0);
  assert.equal(second.snapshot().rust_adapter_calls, 0);
  assert.equal(second.snapshot().rpc_failures, 1);
  assert.equal(second.snapshot().rust_adapter_kind, 'NO_DISK_RUST');
  assert.throws(() => createExecutionMetrics('UNTRUSTED', now),
    /CODE_MODE_METRICS_CONFIG_INVALID/);
});
