# Reporting Scripts

This directory owns benchmark-session reporting, comparison, and finalization.

```text
evaluate-golden-authoring-runs.ts
summarize-gateway-benchmark-trace.ts
project-research-archive.ts (explicit, integrity-checked L0 research snapshots)
project-research-index.ts (manifest-only search, JSON/CSV export)
read-project-research.ts (AI-first catalog/archive/project/sessions/session reader)
summarize-project-observation.ts (bounded L0 source reader and report)
render-project-observation.ts (static local view)
run-golden-benchmark-session.ts
finalize-golden-session.ts
compare-golden-sessions.ts
compare-geometry-knowledge.ts (opt-in R5 source-aligned pairing only)
```

The AI-first reader returns a bounded page or one allowlisted complete L0
snapshot with on-demand byte-checksum verification. Archive-level summaries
are also field-allowlisted and validated before use; build-key filters
select projects, not calls attributable to one build. No tool-payload text,
unrecognized JSON fields or prompt instructions enter this output. Read
the catalog first and follow `next_cursor` to access all retained data;
opaque cursors refuse stale collections. Source SHA and workspace identity
remain unknown until established independently.

The existing `summarize-project-observation.ts` or an explicit archived
`verify` operation may correlate an accepted
canonical Golden final report with same-session L0 artifact/build/task
evidence via optional `--golden-final=<path>`. It does not synthesize a
quality PASS or time-to-acceptance from L0 counters. Per-build metrics
include only calls with verified preflight evidence and state measured
session coverage and unknown-build counts.

The read-only Gateway trace report validates event kinds, timestamps and
result byte counts before computing diagnostics. Missing byte counts and
unsafe aggregate integer totals stay unknown, not zero or an efficiency
improvement. Invalid input fails closed rather than producing distorted
per-capability or total response-byte measurements. This is trace-source
integrity only; it does not verify the Runtime, accepted artistic quality,
or whether an AI processed the reported media.

## Golden trace evidence integrity

The existing offline `summarize-gateway-benchmark-trace.ts` parser now checks
optional `capture_evidence` and `artifact_evidence` entries before passing
recorded events into diagnostic/Golden workflows. It reuses canonical
`benchmarkCaptureEvidenceRef` and `benchmarkArtifactEvidenceRef` to
recalculate content-bound handles, and rejects malformed or unexpected
fields, duplicate/unknown model views, mismatched image-delivery counts,
wrong capability/kind/success, and inconsistent saved-project digests.

**Proof boundary:** a matching digest binds values within a supplied trace;
it does **not** authenticate the original Gateway writer, recover PNG pixels,
confirm a native Blockbench save, establish a same-project capture/save pair,
or approve reference fidelity. A fully forged but internally consistent
report still requires independent exact-SHA/native/session correlation and
actual visual review. Historical trace events that do not contain these
optional Golden evidence fields remain readable; only contradictory
claims of capture/save proof fail closed. No new Runtime/agent hooks or
additional instrumentation run during ordinary MCP authoring.

## Accepted Golden metric reconciliation

The canonical `compare-golden-sessions.ts` gate now rejects externally
supplied `ACCEPTED` final reports whose integer tool-call totals disagree
with the six recorded call kinds (search, describe, inspect, mutate,
verify, recovery). `decision_required_calls` must not exceed total
calls; `redundant_readbacks` must not exceed inspected calls; accepted
runs require at least one mutation and verification. When both durations
are available, time-to-acceptance cannot exceed observed wall time.

This reuses metrics already produced by
`evaluate-golden-authoring-runs.ts` and applies to direct pair comparisons
as well as the existing Harness² and Geometry Knowledge evaluation paths.
Missing/non-integer breakdowns are rejected for `ACCEPTED` comparisons;
legitimately unmeasured token/time metrics remain `null`. This does
**not** authenticate final-report origin, prove separate benchmark sessions,
or establish a quality/efficiency improvement from synthetic input. Exact
source SHA, actual native project and independent run evidence still matter.

## Recorder session identity in Gateway traces

The opt-in Gateway trace reporter now exposes a single
`gateway_session_id` from the recorder's own 128-bit random nonce,
regardless of client-supplied trace IDs. A trace containing mixed
recorder IDs, or a mixture of current and legacy event identities, is
rejected as a cross-run splice. Historical traces entirely lacking
the optional field retain `gateway_session_id: null` with scope
`LEGACY_SESSION_ID_MISSING`. A matching supplied JSON nonce is an
identity consistency check, not authentication of the trace producer,
live Blockbench session, or a successful native model operation.

## Golden final-save ordering

`evaluate-golden-authoring-runs.ts` now requires the final readback-matched
`export_model` event to be the **last recorded mutation** for an accepted
Golden result. A newer mutation after the saved file, even if reported
failed or unrelated to a specific authoring phase, prevents declaring the
previous file the final artifact. The accepted final capture must still
occur after that last mutation. A fresh save restores the order if its
receipt and output digest match; read-only inspection does not invalidate
the save. This is a stricter acceptance-only gate, not a new save operation,
auto-retry, native state replay, or independent visual verdict.

## Code-only failure classification

The existing offline Gateway trace reporter adds a bounded
`diagnostics.failure_evidence` view. It classifies recorded failure codes
only: uncertain native outcome, interrupted read transport, lost project
affinity, blocked prerequisites, missing capability, pre-execution queue
control, Reference constraint, ambiguous backend unavailability, or
unclassified/unknown error. Each failed event contributes to one category,
including errors without a named code; `failures.by_code` remains unchanged.

**Critical limitation:** Gateway trace events carry an error code but do not
record `receipt_issue`, the original native receipt, mutation commit status,
or the recovery policy's full detail. `BACKEND_UNAVAILABLE` therefore
remains `BACKEND_UNAVAILABLE_AMBIGUOUS`: it may be a connectivity failure
or an invalid project/Stage receipt after a native mutation. No default
retry action, state-inspection substitute, root-cause claim, or quality
verdict is generated from these bins. Unknown codes fail into
`OTHER_UNCLASSIFIED`. A successful event cannot claim a non-null error
code in the reader; contradictory trace input fails closed.

Repeated error diagnostics are partitioned using *existing* correlation
metadata, not just matching capability and error code. An observed Control
task-context digest takes precedence over the trace ID. If that context
is unavailable, the trace ID is used; historical events with no correlation
are grouped separately for exploratory backward compatibility. Scoped and
unscoped failures never combine into a fabricated repeat. The optional
`grouping_basis` field on correlated findings identifies `TASK_CONTEXT_HASH`
or `TRACE_ID`, without revealing new task identities. These groups are
`INVESTIGATE_ONLY`: a matching hash/trace is not proof of one native
incident, causal defect, or retry permission.

## L0 counter reconciliation

The existing L0 project-observation reader validates a snapshot's per-tool,
capability, named-error and classified-domain totals before they contribute
to a diagnostic report. Every observed `invoke_capability` is labeled once
(including `OTHER` and `UNKNOWN_CAPABILITY`), named error-code counts cannot
exceed observed failures, and partial domain breakdowns may be smaller than
project totals but never larger. Missing error codes remain unclassified;
a domain is not invented for calls without verified domain identity.
Corrupted/inconsistent snapshots are rejected instead of creating misleading
failure hotspots, accepted-result metrics, or fabricated project provenance.

This is offline source-data integrity only: the recorder, Runtime, Gateway,
asset bytes, user Workspace and approval authority are unchanged. No actual
Codex/native test proof is implied by the authored regressions.

Reporting consumes benchmark/evaluation evidence; it does not own Runtime behavior or acceptance truth.
The explicit Research archive is a selected copy of L0 cache evidence, not
a competing project history or authoring state owner. It never runs on the
Gateway hot path, reads private Codex transcripts, modifies the canonical
Workspace, or proves quality/source revision/AI usage. Source snapshots are
fingerprinted with SHA-256, but local checksums are not signatures. The
manifest-based index deliberately does not combine archived session totals
across experiments, because the same session may be archived more than once.