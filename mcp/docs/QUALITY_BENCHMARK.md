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
