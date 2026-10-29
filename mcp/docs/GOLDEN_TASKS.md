# LazyDesigner Golden Task Benchmark

This file defines the future live benchmark contract for **Cost to Accepted Result**. It does not add a Runtime tool, planner, quality scorer, or automated acceptance authority.

Canonical machine-readable tasks live in `tests/fixtures/golden-task-cases.json`. Real regression incidents live separately in `tests/fixtures/regression-cases.json`.

**Benchmark identity boundary:** `benchmark-zero-waste-golden.ts` and `benchmark-zero-waste-workflow.ts` are synthetic payload/step projections, **not** completed live Golden Tasks. Their `quality_preserved=true` describes checks on fixture fields and modeled verification steps only. Every returned fixture row carries `quality_evidence=SYNTHETIC_SEMANTIC_CHECKS_ONLY`, including when its tests pass. It does not establish visual correctness, human acceptance, actual Codex/model tokens, cost, native Undo, or latency. The accepted-result benchmark below remains the separate live measurement authority.

## Rule

Every checked-in Golden Task remains `UNMEASURED` until the task is executed against a matching LazyDesigner source/build with:

- approved reference evidence and explicit requirements;
- Blockbench/runtime environment provenance;
- captured Geometry/Texturing/Animation evidence as applicable;
- correction history;
- tool-call observations;
- human acceptance state.

Static tests may validate the benchmark **shape**, but they cannot convert an unmeasured task into PASS.

## Accepted-result proof guard

The existing evaluator accepts quality as measured only with
`LIVE_BLOCKBENCH` scope, a contiguous task/SHA-specific Gateway trace,
at least one **recorded successful** mutation and verification, unique PASS
evidence for every required task criterion, and a separate documented
`human_acceptance` review reference. Failed attempts may stay in the trace.
Approval must come from a real human review; an LLM, tool receipt or passing
static validator cannot attest it.

The existing Gateway recorder already emits operation success flags. The
session draft preserves those flags and adds an **UNVERIFIED** human-review
criterion. No extra authoring tools, screenshots or routine Codex context are
introduced.

### Accepted artifact and final-revision integrity — all eight tasks

An `accepted_result: true` run for **any** of the eight canonical Golden
Tasks requires the captured immutable starting `input_asset_sha256`, a
live `input_project_uuid`, and a valid persisted `output_asset_sha256`
**different from the starting asset bytes**. Previously, the evaluator
required the persisted output only for `golden-existing-model-correction`;
the other seven tasks could be marked accepted despite missing final
artifact evidence. A changed output hash proves persisted bytes changed,
**not** visual/reference, UV, motion or export acceptance.

The final successful verification event must occur **after the last mutation
event** (including a failed/uncertain mutation), and the final verification
event must itself have succeeded. A successful earlier capture cannot
certify later edits; an unsuccessful later verification cannot be hidden
behind an earlier success. Any additional `FAIL` acceptance evidence
precludes an overall accepted result, even if the failed criterion is
outside the minimum corpus criteria. These are consistency requirements
on existing trace and review records, not new inspections.

Comparison of two purportedly accepted session reports also requires
each to carry `LIVE_BLOCKBENCH` proof scope, a canonical task ID and schema,
valid reference/Control provenance, valid nonnegative metrics, a live input
project UUID, valid changed persisted output bytes, and identical starting
model/reference fingerprints across baseline and candidate. Arbitrary
source-only PASS reports, placeholder task IDs, invalid metrics, and
missing output artifacts cannot produce claimed efficiency gains.
When optional usage telemetry is merged into an **accepted** final session,
it must come from the exact same source SHA and `LIVE_BLOCKBENCH` proof
scope. SHA-unknown/source-only usage may be retained for incomplete
diagnostics, never merged into accepted cost metrics. These fields are
self-reported provenance until a live owner confirms them, so neither
this validator nor the comparison itself authenticates human acceptance.

The corpus remains **UNMEASURED**. A source-regression test of these gates
does not create a live model, independently authenticate a human's review,
or establish eight accepted Golden Tasks.

## First baseline — Existing Model Correction

For `golden-existing-model-correction`, use the **same unchanged starting
`.bbmodel` bytes** for baseline and candidate, in addition to the same
approved Reference Package. The existing session runner accepts the absolute
starting model path as its third positional argument, hashes it **once before
Gateway starts**, and validates that Blockbench currently has a **saved, separate working copy**
with identical initial bytes. It reuses the existing read-only live preflight
and `get_project_info` capability before Gateway starts, recording
`input_asset_sha256`, `input_project_uuid` and matching Runtime build identity
in the usual `golden-run-draft.json`. It does not copy, mutate or save a model.
After the benchmark Gateway child exits, the runner checks that the immutable
seed still matches the original digest and reads the separate saved `.bbmodel`
working copy. Only valid JSON containing Blockbench document metadata receives
an `output_asset_sha256` in the draft. Missing, empty, corrupt or unreadable
output retains a null output digest and a diagnostic; the trace remains available.
Absolute local paths do not enter the portable run report.

An accepted correction requires the captured live project identity and a valid
saved `output_asset_sha256` distinct from `input_asset_sha256`. A later
comparison rejects missing or different starting model SHA-256 and rejects
a correction whose output digest is missing, invalid or input-identical.
Baseline and candidate outputs need not hash identically. This is a
benchmark-only preflight (including one read-only `get_project_info` call)
with **zero extra MCP calls or model-context loading during normal authoring**.
Preserve the immutable seed and open a distinct saved working copy in Blockbench
before the benchmark; editing the seed or starting from an already-modified
working copy is rejected. The preflight proves only the starting moment, not
ongoing project identity, visual improvement, or unaffected-state preservation;
those still require fresh evidence and human review. A changed saved-file
digest does not establish native reopen success, UV quality, visual/reference
fidelity, preservation of unaffected parts, or human acceptance.

## Required Run Record

A future live run should record at minimum:

    task_id
    source_sha
    runtime_build_identity
    blockbench_version
    operating_system
    reference_revision
    artifact_revision
    phase verdicts
    critical defects
    status_calls
    search_calls
    describe_calls
    identity inspections
    visual capture batches
    mutation calls
    correction rounds
    redundant readbacks
    runtime/tool errors
    total calls to accepted result
    accepted | not accepted

Do not compute a single aggregate quality score. Critical failures remain explicit categorical defects and cannot be averaged away.

## Comparison Rule

Compare implementation revisions only when task inputs and acceptance criteria are materially equivalent.

For the R5 **within-build** Geometry Knowledge experiment, use
[Quality Benchmark R5](QUALITY_BENCHMARK.md#r5-source-aligned-geometry-knowledge-pairing-benchmark-only)
and the benchmark-only `compare:geometry-knowledge` command. This
specialized filter reuses the Golden comparator but additionally requires
two separately captured live benchmark sessions with the same seed,
exact source/build, Control context, known model/telemetry/environment,
protocol and reference claims;
the candidate must have one canonical source-hash-checked G1 retrieval
receipt and the control must have none. Without authenticated exposure
receipts and human review its output is descriptive **not causal proof**.

An improvement means equal-or-better accepted quality with lower or equal **Cost to Accepted Result**, or a clearly documented quality gain that justifies additional cost.

## Corpus Intent

The initial eight tasks cover rigid prop/furniture, mechanical geometry + animation, humanoid rig/attachment/motion, organic curved construction, layered/alpha-cutout representation, PBR material authoring, particle + locator + animation integration, and targeted correction of an existing model.

Do not expand the corpus merely to increase case count. Add a task only when it represents a materially different authoring failure mode or production workload.
