# LazyDesigner Authoring Quality Benchmark

This is an evaluation contract for comparing authoring quality and efficiency across representative asset classes. It is **not** a new Runtime tool, authoring workflow, score engine, or acceptance authority.

Canonical machine-readable cases live in `mcp/tests/fixtures/quality-benchmark-cases.json`.

The checked-in cases are **synthetic contract fixtures**, not measured quality baselines. They may prove coverage and evaluation semantics, but they must not be presented as empirical authoring-performance results. A measured baseline requires an actual approved asset/reference, environment/version provenance, captured evidence, acceptance state, and observed cost-to-accepted-result.

## Purpose

Use the same evidence vocabulary across Geometry, Texturing, and Animation so improvements can be judged against accepted output rather than proxy metrics.

```text
approved reference + explicit dimensions/constraints
→ authored result
→ comparable visual/runtime evidence
→ PASS | FAIL | UNVERIFIED per applicable dimension
→ causal correction
→ accepted result
→ measure authoring cost separately
```

There is no aggregate quality score. A critical visual/structural failure cannot be averaged away by good results elsewhere, and fewer tool calls cannot compensate for lower quality.

## Representative Profiles

The benchmark set intentionally spans six materially different construction problems:

1. `PROP_FURNITURE` — rigid structure, attachment/contact, negative space, material identity.
2. `VEHICLE` — multi-part rigid structure, depth, repeated/mechanical forms, optional articulation.
3. `CHARACTER_MOB` — articulated hierarchy, joint closure, deformation readability, pose/motion fidelity.
4. `ORGANIC_CURVED` — non-boxy silhouette, segmentation quality, depth continuity, curve interpretation.
5. `MECHANICAL` — articulated hard-surface structure, pivots, clearance/contact, surface integrity, physical UV evidence.
6. `GENERIC` layered/cutout — layered carriers, coplanar-risk, physical UV fidelity, and alpha-cutout boundary evidence.

These are evaluation profiles, not geometry presets. They must not force a modelling method or cube count.

## Evidence Authority

For reference-driven work:

```text
explicit user facts / dimensions
→ approved reference image(s)
→ current authored state
→ fresh comparable capture / texture / playback evidence
```

Paths, memory, tool success, coordinates, bounds, hierarchy, cube count, keyframe count, or a generated similarity number are not visual proof by themselves.

**Coarse envelope numerical representability gate:** the existing
`analyzeProjectedEnvelopeFidelity` projection is advisory, not a
silhouette-quality scorer. If finite input bounds nevertheless produce
overflowing/underflowing widths, areas, volumes, unions, ratios or center
deltas, the projection now returns `unavailable` instead of a fabricated
IoU or `NaN`/Infinity. Malformed reference vectors also remain unavailable.
This check has no shape-specific dimension limit, does not clamp authored
Cubes, and does not change visual approval or native Blockbench state.

A dimension is:

- `PASS` only when current evidence supports it and no material defect remains;
- `FAIL` when current evidence shows a material defect;
- `UNVERIFIED` when the required evidence is absent, stale, obstructed, or technically unavailable.

`UNVERIFIED` is not failure and is not permission to invent a result.

## Geometry Dimensions

Every profile checks at least:

- silhouette;
- cross-view proportion;
- required part completeness;
- attachment/contact;
- depth/layering;
- intentional negative space.

Profile-specific dimensions extend this list. Examples include motion-ready structure and curve segmentation quality.

Critical geometry defects include missing/floating required parts, wrong required part count, broken attachment, and reference-unsupported invented structure. These remain `FAIL` regardless of technical validator success.

## Texture Dimensions

When Texturing applies, evaluate:

- palette/material-region correspondence;
- identity-critical markings;
- mapped-surface continuity;
- seam control.

Texture cannot hide a required Geometry defect. Dark pixels, shading, or alpha are not substitutes for missing required surfaces unless the approved representation explicitly calls for a planar/cutout carrier.

## Animation Dimensions

When Animation applies, evaluate only relevant motion requirements. The Character/Mob case explicitly checks:

- pivot/rig suitability;
- reference-pose fidelity;
- joint-gap control;
- clearance/contact;
- weight transfer;
- timing/motion readability;
- loop or handoff continuity.

Excessive joint gaps, invalid pivots, unintended foot slide, floor penetration, or broken required contact are critical defects. Animation uses categorical evidence verdicts, not a numeric quality score.

## Difference-First Review

Review the largest identity-bearing difference first:

```text
reference requirement
→ matching reference view/time
→ current model view/time
→ observed difference
→ owning phase/cause
→ smallest coherent correction
→ recapture only affected evidence
```

Do not correct downstream styling when the first wrong owner is Geometry or rig structure. Do not add filler cubes or extra keyframes merely to improve a proxy count.

## Efficiency Measurement

Measure efficiency only after or alongside quality evidence. Record:

- status calls;
- capability-search calls;
- capability-describe calls;
- redundant readbacks;
- visual capture batches;
- correction rounds;
- repeated same-cause failures;
- total tool calls to accepted result.

The target is **Cost to Accepted Result**, not minimum tool calls in isolation.

Cross-session report metrics must reconcile before comparing savings:
accepted `tool_calls_to_accepted_result` must equal the sum of the six
actual call-kind counters, with bounded decision-required and redundant
readback counts. Otherwise no apparent candidate savings are admitted
from contradictory supplied JSON. This is an offline report-integrity
gate, not proof that two sessions were independent, the model was
sourced from a real Codex run or a native result passed visual review.


**Golden save/capture ordering:** the native project save must be the final
recorded `mutate` event supporting an `ACCEPTED` Golden report, not merely
the last successful geometry/texture/animation edit. Any later mutation
(including failed or outcome-uncertain calls, or non-authoring Stage/control
operations) makes an earlier .bbmodel readback stale for acceptance. Save
again with a matching content digest, then capture the final reference-bound
views after that last native mutation. An intervening read-only inspection
does not by itself invalidate the saved artifact. These are sequence and
declared receipt checks, not proof of native byte/visual equality without
independent evidence.

### Actual image usage with the existing quality-first Golden task

Record `capture_model_views.image_transport` values: delivered image
count, generated PNG bytes, delivered PNG bytes, exact-reused PNG bytes and
capture processing milliseconds. Separately account for approved Reference
Package images, texture region and animation pose images. Record GPT-6.1
Sol usage tokens or billing only when reliable native/provider telemetry
is actually supplied; otherwise say `NOT_MEASURED`. PNG bytes are not
token usage, and fewer pictures do not independently prove lower costs.

Compare matching baseline/candidate input asset, approved reference image
bytes, runtime environment, criteria and artifact revision. Any missed
critical defect, skipped required gate or newly UNVERIFIED quality claim
disqualifies an efficiency improvement. Once both results achieve accepted
and comparable quality, assess the already-owned cost-to-accepted-result,
tool calls, image delivery bytes, correction rounds and elapsed time.
Do not create another benchmark engine or claim a synthetic percentage.

## Future Local Benchmark Run

When a matching live environment is available, run **one full-asset Golden Task** (`golden-full-asset-authoring`) using its isolated fixture; retain these quality dimensions as a review rubric rather than running six unrelated Golden assets:

```text
input reference revision
model artifact revision
phase verdicts
critical defects
correction history
accepted/not accepted
usage/tool-call observations
runtime/environment notes
```

Compare implementation changes only against equivalent inputs and acceptance criteria. Accepted live benchmark runs must retain end-to-end provenance for the approved Reference Package fingerprint, Control task-context id, Runtime build identity, and resulting artifact revision. Baseline/candidate comparisons require the same Reference Package fingerprint; otherwise they are different authoring inputs and are not comparable efficiency experiments. A prepared fixture or passing static test is not live visual/runtime proof.


## QA-01 — Blinded paired art-quality review (optional Golden evaluation)

This **extends the existing single full-asset Golden Task** rather than creating another task/runner/scorer. Source rationale: [Riot process/portfolio guidance](https://www.riotgames.com/en/portfolio-and-reel-suggestions) emphasizes design decisions and readability; [DreamSim (NeurIPS 2023)](https://proceedings.nips.cc/paper_files/paper/2023/hash/9f09f316a3eaf59d9ced5ffaefe97e0f-Abstract-Conference.html) demonstrates limits of low-level pixel metrics. Neither source proves automated aesthetic quality or a LazyDesigner result.

**Preparation:** independently run baseline and candidate from byte-identical immutable seed and approved Reference Package; record distinct source/Runtime SHAs, exact asset revisions, views, shading/exposure, camera/crop, intended display scale and pose/time samples. Reject incompatible evidence before preference review. A one-view hero render cannot replace multi-view structure/texture evidence or animated playback.

**Blinding:** show visually comparable current-revision baseline/candidate captures labelled only A/B, with order balanced between reviewers when possible. Ask about *specific* identity-bearing silhouette, focal clarity, material coherence, readable pixel language and motion staging (where applicable); record the view and a concrete reason for the preference, tie or `UNVERIFIED`. Hide version labels, prompts, tool counts and speed during the visual judgement. If only one judge exists, report that limitation; repeated opinions from one judge are not independent votes.

**One-task review worksheet:** use the Golden's actual approved source and current-revision source-matched captures: **front neutral** for recognizable silhouette/focal identity; **left neutral** for depth and negative-space/contact; **back neutral** for the vent/back-facing materials; **right-arm signal pose** for pose readability, clearance and feet contact. Review mapped material clusters/identity in the actual applicable shaded views, not an unwrapped atlas or an isolated hero render. When an approved reference has no directly comparable image for one requested viewpoint or time, record `UNVERIFIED` for that visual inference and separately retain any current technical evidence. For each comparison, note A/B or tie/unknown, the actual matched view/pose, current output artifact revision, lighting/crop/display conditions, and a concrete identity-bearing reason. Keep the referee's free-form notes and evidence links with the existing `human_acceptance`/`reference_fidelity` evidence references; **no additional Golden JSON fields, separate scoring service, or fabricated reviewer votes**. Do not claim independent consensus from one judge. Both accepted `PASS` is a minimum quality floor for cost deltas, not proof that the candidate is artistically superior.

**Evidence identity for the one Golden:** Record the exact benchmark trace
`golden-capture:v1:<sha256>` handle as the existing visual `evidence_ref`
for each of the four static visual criteria. The handle comes only from the
PNG bytes the Gateway actually returned, with the approved reference fingerprint,
live project identity, `-z` front direction and shaded front/left/back.
The evaluator rejects an earlier/other-project/other-reference capture even
when a manually typed PASS label looks valid. Human review still examines
the actual reference and matching native images at comparable pose, crop,
camera and brightness. A hash is a content identifier, **not** a style score,
a proof of image similarity, an attestation of saved-file pixel parity or
an independent reviewer vote. A still image does not prove the idle/signal
timing and foot contact through time; those need separate native playback
and user review evidence. No second Golden task, new report schema or
always-on image hashing is introduced.

**Saved artifact vs. rendered capture:** for the single Golden, require a
recorded `export_model` native project save receipt with verified file
readback, and compare its SHA-256 against the runner's saved `.bbmodel`
hash. This protects against claiming a successful authored result from an
older saved file or arbitrary `artifact_revision`. The source-side gate
does not certify actual Blockbench reopen parity, source-vs-model image
quality, exported Bedrock geometry/animation files or human approval:
retain those as explicit `save_reopen_export_integrity` and
`human_acceptance` evidence, never extrapolate from `READBACK_MATCHED`.

**Acceptance:** preserve per-criterion `PASS / FAIL / UNVERIFIED` and the existing independently documented human acceptance. Never collapse mixed critical failures into an aggregate beauty score, assume aesthetic superiority from a perceptual embedding, or trade away Bedrock/UV/save/export correctness for visual preference. Only once quality is accepted/equal-or-better compare cost, time and corrections through the existing runner/finalizer; no fabricated preferences, new JSON fields or extra Gateways. This protocol is **PREPARED, NOT RUN**.

## G3 Geometry Knowledge A/B — next native acceptance experiment

This is a **future measured run plan**, not source proof or a new evaluation
engine. G2 retrieval regressions only establish that selected advisory text
matches a semantic feature and source revision; they do not establish a
better model. The **single** current product-level Golden scenario is
`golden-full-asset-authoring`: create the new Beacon Courier Bot from its
dedicated blank seed and approved reference through Geometry, UV, Texture,
Animation and final native acceptance. If measuring one Geometry knowledge
decision, use the same canonical task, new fixture and identical source/build
for both experiment arms. Other domains retain their affected regressions;
do not reintroduce named/micro Golden tasks. Old projects are not baselines.

- **Pair inputs:** identical approved reference package SHA-256, user
  dimensions, required views and acceptance criteria, identical immutable
  starting `.bbmodel` bytes, matching task ID, Blockbench/Runtimes, and
  exact recorded source SHAs. The candidate changes only the documented
  G1 knowledge-availability/selection condition.
- **Provenance:** record `feature_id`, exact G-P01..G-P08 case section ID,
  full knowledge-source and section SHA-256, `recipe_knowledge` freshness,
  matched reference-view evidence and source/installed build identity.
  A failed or ambiguous case retrieval cannot be treated as successful
  knowledge application.
- **Quality first:** require reference-comparable silhouette, proportions,
  required parts, contact/depth/negative space and motion-ready pivots when
  applicable; an unsupported new part or critical defect remains FAIL.
  Preserve the source/visual/user verdict distinctions.
- **Then measure:** only for equally accepted results, compare correction
  rounds, repeated causal failures, verification calls, total calls,
  accepted-result time and actual token usage when observable. Do not
  replace quality with a scalar score or Cube-count minimization.
- **Fail closed:** absent LIVE_BLOCKBENCH, missing user acceptance, changed
  reference or starting model, unqualified source/toolchain, or missing
  readback leaves the run `UNVERIFIED`. A source-only G1/G2 test is
  not a Golden Task or a measured A/B result.

Use `mcp/scripts/reporting/run-golden-benchmark-session.ts` and the existing
Golden acceptance/compare validators; do not create another registry, run
schema, task database or alternative approval pipeline.


## R5 source-aligned Geometry Knowledge pairing (benchmark-only)

The existing `compareAcceptedGoldenSessions` owns Golden quality/cost
comparison. `scripts/reporting/compare-geometry-knowledge.ts` now adds a
**strict, optional R5 eligibility filter**, **not** another quality scorer,
Runtime tool or acceptance authority. It compares existing
`golden-session-final` reports under two conditions using a separately
captured, content-addressed structured-response sidecar:

1. **CONTROL_NO_CURATED_GUIDANCE:** the actual live response capture shows
   no selected Geometry case exposed to the modelling decision;
   `curated_case` is `null`.
2. **CANDIDATE_CURATED_GUIDANCE:** the actual response capture references
   one exact G-P01..G-P08 case selected for the **same** semantic feature,
   with its section ID, section/source SHA-256, heading and source path.

Both arms must already satisfy the original Golden accepted-result
requirements: approved current Reference, saved changed `.bbmodel`,
real LIVE_BLOCKBENCH trace, required PASS evidence, human approval and
recorded cost. This R5 filter **additionally** requires the same task,
initial model SHA-256, Reference Package, Control task-context ID,
**identical source SHA/runtime build**, known matching agent model and
telemetry source, identical protocol SHA-256 and reference-claim handles,
and matching Blockbench/Bedrock/OS environment. Each arm must use a
**distinct benchmark session ID** with the same independently revalidated
immutable seed and distinct response capture ref/content hash.
The authored Blockbench Project UUID **may legitimately be equal**
when both sessions load the same original .bbmodel; it is not a session ID.
A working copy that retained the preceding run's edits is not a control.
The candidate G1 case must match the exact checked-in canonical casebook
text and revision, not a plausible title or an external unpinned source.

Use the existing finalizer, then compare via:

```text
bun run compare:geometry-knowledge -- baseline-final.json candidate-final.json geometry-exposure-pair.json
```

The exposure-pair document has only
`baseline_exposure` and `candidate_exposure`. Each holds `mode`,
`task_id`, `source_sha`, `input_project_uuid`, `benchmark_session_id`, `feature_id`,
`reference_claim_ids` (1–8), `structured_response_ref` and its
`structured_response_sha256`, shared `protocol_sha256`, and
`environment` (`operating_system`, `blockbench_version`,
`target_bedrock_version`). The candidate's `curated_case` holds
`feature_id`, `section_id`, `section_sha256`, `source_sha256`,
`heading`, `source_path`, and
`guidance_state: CONTENT_HASH_MATCHED_NOT_VISUAL_PROOF`. The control
must have `curated_case: null`. These are **recorded assertions**: the
pure comparator checks their coherence with current source/reports but
does **not independently authenticate capture bytes, absence of earlier
knowledge exposure, human review, or agent use**.

Result is deliberately
`MATCHED_ACCEPTED_REPORTS_FOR_HUMAN_REVIEW` with
`attribution: NOT_CAUSALLY_ATTESTED` and descriptive per-metric deltas.
Even identical accepted quality with fewer calls is **not** a proven
knowledge-caused improvement without independent live review of the
captured responses and any remaining experimental confounders. Failed,
incomplete, simulated or source-only runs must never be presented as a
measured Geometry gain. This R5 code is source preparation only;
**no R5 live pairs were executed or accepted**.

## Harness² candidate probe (opt-in development evaluation)

The evaluation script eval:harness-candidate reads one JSON proposal with a
canonical baseline and candidate golden-session-final report. This is an
offline, read-only quality gate; it does not run a second agent, modify
Skills, or promote candidates.

- Declare distinct SHA-256 values for baseline/candidate harness context.
  These identities are caller-supplied, NOT verified against context bytes.
- The baseline must meet the existing accepted Golden report contract.
  Both reports must describe the same task, initial asset, approved Reference,
  source commit, installed Runtime build and observed model identity.
- A matched LIVE_BLOCKBENCH quality FAIL rejects the candidate regardless
  of cheaper or incomplete execution metrics. UNVERIFIED, mismatched or
  source-only evidence is INCONCLUSIVE.
- Two matched accepted PASS reports are REVIEW_REQUIRED, using the existing
  Golden per-metric comparator. No aggregate score, causal improvement
  claim, automatic update of Skills or bypass of human/native review.
- A Golden finalizer report is itself contract evidence. Independent
  native/visual/session correlation remains necessary for acceptance.

The script implements only the evidence gate of a Propose-Probe-Compose
experiment, not an installed upstream Harness² optimizer.

### Controlled ChatGPT-to-Codex Harness probe

This opt-in experiment is **not** part of daily Codex asset authoring.
Use only with disposable Golden inputs and a real testable Codex Runtime.

1. ChatGPT identifies an observed authoring/routing defect and authors one
   narrowly scoped candidate instruction/context. Do not override approved
   Reference authority or modify canonical production Skills for a speculative
   experiment.
2. In Codex, compare a baseline context and a temporary candidate context
   under **one fixed source SHA**. Hold model, usage telemetry source,
   Runtime build, task, approved Reference fingerprint and initial `.bbmodel`
   bytes constant. Keep the canonical Control task context identity constant
   as well; distinct disposable project UUIDs may occur, but each run must
   identify its actual project and independently establish the reset. Reset an
   independent disposable Golden seed before each run; never reuse a live
   user Workspace as a benchmark fixture.
3. Declare actual context byte digests in `baseline_harness_sha256` and
   `candidate_harness_sha256`. Supply `session_pair` with two distinct
   opaque session IDs, recorded from independently initiated Golden runs.
   Missing, malformed or repeated IDs make a candidate INCONCLUSIVE; distinct
   caller-declared IDs alone cannot authenticate independent execution.
   The optional CLI file arguments can independently check **selected file
   bytes** against those declarations.
   A matching selected file still does not prove that the agent loaded or
   followed the instructions. Independently correlate Golden report sessions,
   native evidence and human visual acceptance.
4. Once Codex has two canonical final reports, evaluate their contract:

```bash
cd mcp
bun test tests/benchmark/golden-session-comparison.test.ts
bun run eval:harness-candidate -- <probe.json> [<baseline-context-file> <candidate-context-file>]
```

The Bun test above validates **only the comparator code**, not actual model
quality. `REJECTED_QUALITY` vetoes the candidate; `INCONCLUSIVE` proves no
winner; `REVIEW_REQUIRED` is still not approval, causality or auto-promotion.
ChatGPT may edit a production Skill only after separate decision and tests.

**Byte-check status:** when explicit context files are provided, the CLI
reports `SELECTED_BYTES_MATCH_DECLARATIONS_NOT_AGENT_CONSUMPTION`.
When omitted, it reports `NOT_CHECKED`; neither status is evidence that
Codex received the chosen context, nor is it visual/quality acceptance.
Context inputs are read-only, explicit and capped at 256 KiB each.

**Recorder session correlation:** Current opt-in Gateway benchmark
traces now include one random recorder nonce per Gateway instance. The
Golden runner/draft/finalizer retain `gateway_session_id` from the
trace; an A/B Harness `session_pair` must match the two recorded 32-hex
IDs and the two IDs must differ. Two invented caller labels, a mixed
legacy/new trace, a reused run, or two swapped labels can no longer
reach `REVIEW_REQUIRED`. This guards against accidental evidence
reuse; a determined author can still forge internally consistent
metadata, so independent checkout/runtime/capture evidence and blinded
visual review remain necessary.

**Session isolation:** The optional probe envelope now requires
`session_pair.baseline_session_id` and
`session_pair.candidate_session_id` to be distinct, bounded handles for a
reviewable result. These are assertions, not verified capture identities.
A repeated or missing pair returns `INCONCLUSIVE` rather than an apparent
quality regression or measured efficiency comparison.

**Source isolation:** This evaluator intentionally requires identical
`baseline.source_sha` and `candidate.source_sha`. Comparing two commits
returns `SOURCE_SHA_MISMATCH` / `INCONCLUSIVE`. First test temporary context
variants under one fixed revision; promote an accepted instruction through
ChatGPT as a new canonical source change and revalidate that new revision.
Cross-commit comparison would require independent Git-diff isolation proof,
not a self-reported file allowlist.

