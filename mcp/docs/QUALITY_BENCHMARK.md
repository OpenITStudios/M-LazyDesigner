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

When local testing is authorized, run all six profiles with fixed reference/constraint inputs and retain:

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


## G3 Geometry Knowledge A/B — next native acceptance experiment

This is a **future measured run plan**, not source proof or a new evaluation
engine. G2 retrieval regressions only establish that selected advisory text
matches a semantic feature and source revision; they do not establish a
better model. Use the existing Golden Task machinery and six quality
dimensions above. Initially select `golden-existing-model-correction` for a
controlled correction, then `golden-humanoid-fisherman`,
`golden-mechanical-lift`, or `golden-organic-flower` only when a
specific Geometry case is decision-relevant.

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
