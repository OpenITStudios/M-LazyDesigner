# Geometry Intelligence — Implementation Design

Status: **R0 CURATED; R1–R3 SOURCE IMPLEMENTED (NOT EXECUTED)** (2026-10-29).
Recipe planning now returns conditional strategies, exact declared assembly
relationships and optional sampled-curve alternatives before candidate
compilation. No automatic Cube/Bone generation, new compiler pattern,
trained weights, native proof, measured performance or accepted asset.
Owner: existing Geometry/Recipe domain. This document is the conditional
engineering design for [curated external sources](research-sources.md),
not a second production workflow. Actual modelling policy remains in
[standard.md](standard.md), cases in [decision-cases.md](decision-cases.md),
and evidence/acceptance in `mcp/docs/QUALITY_BENCHMARK.md`.

## 1. The first wrong boundary

Current `authoringRecipe/service.ts:planPair` calls
`collectRecipeKnowledge` **before** `planIncrementalRecipeRebuild`.
R1 creates conditional knowledge proposals. R2 projects authored
`ANCHOR`/symmetry dependencies and part identities, but neither stage
automatically revises a Recipe, independently attests reference images,
or derives finished native Bone hierarchy/curves. Do not portray this
source-only preflight as an autonomous Geometry modeller.

**Objective:** when an actual feature decision is unresolved, select the
minimum useful grounded modelling principle, propose a **bounded**
representation/structure option **before** the caller constructs a
candidate Recipe, and only then use existing compiler, Runtime and
Validation. A proposal must not auto-mutate, persist approval, convert
Texture to Geometry, or trust invented coordinates.

**Product result:** fewer *supported visual/structural errors and correction
rounds* on the same approved reference, while preserving readability,
Bedrock compatibility, stable edits and the current developer workflow.
Source count, candidate count and raw Cube reduction are not success proxies.

## 2. One end-to-end decision path (no second engine)

```text
current task + approved Reference Package + selected profile
  → source-grounded semantic feature / unknowns
  → existing featureDecision.ts (GEOMETRY | TEXTURE | OMIT | REVIEW_REQUIRED)
  → on-demand known-source knowledge selection + applicability checks
  → 0–3 EXPLAINED candidate construction strategies
  → caller chooses a supported candidate; unresolved remains unresolved
  → existing Recipe prototypes, patterns, ANCHOR, symmetry/ownership
  → existing compile / incremental plan / native transaction
  → existing affected-only structural, UV and visual checks
  → source/asset revision-matched outcome + learning note if justified
```

A candidate is **not** an executable Recipe unless its dimensions,
ownership, constraints and current user/reference evidence are known.
Preserve the normal direct `manage_cubes` fast path when there is no
decision-changing knowledge. No obligatory Recipe ceremony per Cube.
No additional Gateway tools or persistent queues.

## 3. Scoped source/consumer ownership

| Concern | Exact existing owner | Minimal implementation direction |
| --- | --- | --- |
| Reference fact + cross-view uncertainty | `mcp/lib/reference/crossViewEvidence.ts`; `mcp/gateway/control/contextProjection.ts` | Consume explicit claims and view IDs, never derive unknown depth from pixels |
| Source index, version and excerpt | `mcp/lib/semantic/knowledge.ts`; `authoringRecipe/knowledge.ts`, `knowledgeSelection.ts` and `knowledgeExcerpt.ts` | Add explicit applicability and counterexample checks **inside Recipe**, retain existing index; avoid external network and always-on corpus |
| Feature representation and ownership | `mcp/lib/authoringRecipe/featureDecision.ts` | Keep current 8 Geometry reasons and evidence states; no new policy router |
| Precompile candidate guidance | `mcp/lib/authoringRecipe/knowledgePlanning.ts` | Add **one small pure feature-level proposal helper** under this domain *only when a real caller is wired in the same change*; do not expand `planning.ts` or `service.ts` with another general planner |
| Cube/replication/relations | `mcp/lib/authoringRecipe/patterns.ts`, `constraints.ts`, `symmetry.ts`, `components.ts` | Translate supported candidate to existing `LINEAR/GRID/RADIAL` and `ANCHOR` / symmetry when expressible; do not add Sweep/Boolean DSL immediately |
| Native authoring and rollback | `mcp/server/runtime/recipes/authoring/service.ts` + existing transaction/Undo owners | Remain the sole mutation path; explicit target/project epoch required |
| Structural/contact/UV assessment | `mcp/lib/geometry/modelQuality.ts`, `surfaceEvidence.ts`, existing UV owners | Reuse current validators and risk-specific views; no second numerical quality scorer |
| Outcome and comparison | `mcp/docs/QUALITY_BENCHMARK.md`, existing Golden Task reporting | Same input/source/artifact provenance; quality before measured efficiency |

**No godfile rule:** `planning.ts`, `service.ts` and `surfaceEvidence.ts`
are already large; only modify their necessary call seams. Keep any new
feature-specific pure helper focused and test it through **one owning
scenario matrix**, not one test file per research paper.

## 4. Proposed read-only decision contract (illustrative, NOT shipped)

```ts
type GeometryProposal = {
  feature_id: string;               // exact semantic feature owner
  feature_route: "GEOMETRY" | "TEXTURE" | "OMIT" | "REVIEW_REQUIRED";
  reference_claim_ids: string[];   // caller-supplied; never invented
  knowledge: Array<{
    section_id: string;
    section_sha256: string;
    source_sha256: string;
    usage: "ADVISORY_ONLY";
  }>;
  options: Array<{                // 0–3, deterministic and explainable
    strategy: string;              // descriptive, NOT a new compiler enum
    contribution: string[];        // existing Geometry reasons
    apply_when: string[];
    reject_when: string[];
    missing_evidence: string[];
    existing_recipe_operations: string[];
    visual_or_native_proof_needed: string[];
  }>;
  verdict: "PROPOSAL_ONLY" | "MORE_REFERENCE_EVIDENCE_REQUIRED";
  mutation_authorized: false;
  visual_verdict: "NOT_EVALUATED";
};
```

This object is **transient**; do not add it to persisted schema-1 Recipe,
Workspace, Control, public MCP schema or a parallel registry. Never emit
numeric coordinates, confidence probabilities, bone names or Cube counts
unless the appropriate source/current authored state establishes them.
A supported geometry route does not prove the selected strategy is correct.

For a missing source, incompatible version, stale binding or an ambiguous
candidate: return a bounded explanation of what evidence is missing,
without downgrading unrelated supported features. This is not permission
to turn every missing semantic label into a permanent failure.

## 5. Implementation slices and acceptance

### R0 — Source adoption and discriminating cases (this plan)

- Record selected source, exact source identity when available, license
  and what we can **transfer**; reject code copying or training rights
  by implication. Reuse G1 eight positive/negative decision probes.
- Produce one source-grounded `APPLY / REJECT / REQUIRED_EVIDENCE`
  card **only when** it adds a decision not already in the canonical
  Geometry Standard.
- Acceptance: no duplicated policy, clear license boundary, owner
  and counterexample. No runtime performance claim.

### R1 — Knowledge-informed *precompile* proposals (P0)

**Source state:** `mcp/lib/authoringRecipe/geometryProposal.ts` provides
bounded, provenance-bound conditional strategies. `knowledgePlanning.ts`
and the existing `service.ts:planPair` consume them before compiling a
candidate Recipe. This remains advice, not an approved/applicable shape
or automatic native operation. Executable Bun/typecheck/build/native
and visual proof: NOT EXECUTED.

- Keep `featureDecision.ts` as the only representation route owner.
  Build a small pure proposal selector using the current Recipe knowledge
  index, current semantic feature facts and source/revision compatibility.
- Rank only candidates whose **applicability conditions are observed**.
  An overlapping word like "wing" or "curve" does not prove anatomy,
  representation or pivot. Keep max 3 viable explanations; if there
  is no clear distinction, abstain and identify the missing view/claim.
- Connect its output to the existing authoring decision caller **before**
  a Recipe draft is compiled. Keep legacy `plan/planStored` behavior
  unchanged unless the caller explicitly opts into the preflight.
- Acceptance: same supported G-P01..08 cases plus negative/ambiguous/
  stale/unsupported-version probes; no stale context or unreferenced
  claim can become a source-derived geometry placement.
  Golden source tests must actually run before claiming executable PASS.

### R2 — Structure-first construction alternatives (P0)

**Current source:** `mcp/lib/authoringRecipe/geometryAssembly.ts`
reuses the existing pattern expander and declarative Recipe `ANCHOR` /
`SYMMETRY` relationships to map exact instance IDs to semantic feature
owners and surface bounded, source-only attachment/symmetry review before
compilation. `geometryProposal.ts` attaches this as
`geometry_proposals[].assembly` without another workflow or persistent
graph. The report never equates positional `ANCHOR` to native Bone
parenting, treats Group labels as unverified, flags identity exceptions,
and preserves distinct UV/texture/rig mirror policies.
**R2 source wired; Bun/typecheck/build/native/visual NOT EXECUTED.**
New topology/constraints are **not** inferred or auto-created.

- Apply ShapeAssembly/StructureNet **ideas**, not their implementations:
  semantic part graph, parent/contact relation, explicit symmetry,
  variation boundaries and smallest necessary joint topology.
- Generate proposed attachments/transform ownership first. Only translate
  an accepted, expressible relation to existing Recipe ANCHOR/symmetry/
  pattern operations. Unsupported cross-view geometry stays an explained
  alternative, not fabricated Cubes.
- Test rigid prop, articulated mechanical joint, humanoid limb and
  deliberately asymmetric fixture. Preserve known native UUID ownership,
  UV/rig constraints, and non-Recipe direct operations. No auto-delete.

### R3 — Curved/organic construction alternatives (P1)

**Source state:** `mcp/lib/authoringRecipe/geometryCurves.ts` accepts
explicit transient, reference-handle-linked control samples (centerline
and positive rectangular cross-section). It derives directional change,
cross-section differences, span lengths, explicit joint boundaries and
conditional single-rotated vs segmented-Cuboid alternatives. The existing
Recipe `plan/planStored` caller accepts optional `curve_observations`
and returns the result under `geometry_proposals[].curve_review`; no
default caller, public schema or regular modelling operation changes.
Positions are supplied by the caller and **not** independently inferred
or verified from images; no native Cuboids or hierarchy are produced.
Four or more intervals require complexity review, not a style quota.
R3 regression source authored; Bun/build/native/visual NOT EXECUTED.

- Borrow Sweep's **centerline + varying cross section** concept:
  identify confirmed orientation changes and significant volume changes,
  propose minimum necessary semantic segments and attachment relations.
- Prototype only **source-only** bounded Cuboid alternatives via existing
  Recipe patterns/primitive operations. A free-form Sweep mesh is **not**
  representable in current Recipe v1; no claim of automatic curved mesh
  output or silent new compiler pattern kinds.
- Compare rotated-single-Cube, supported segmented cohort and
  alpha/Texture option when valid. Use front/side/3/4 evidence and neutral/
  extreme pose where relevant. Reject micro-segmentation without distinct
  silhouette/volume/motion benefit.

### R4 — Quality-preserving correction and optimization (P1)

- Reuse existing bounds, oriented contact, surface integrity and
  difference-first correction. Propose merge/remove only with
  explicit reference+material+UV+motion+visibility invariants.
- Track a **vector** of defects (silhouette, proportion, negative space,
  contact, hierarchy/pivot, surface integrity, export); do **not**
  compute a misleading single quality score or maximize saved Cubes.
- A previous attempted correction that failed twice for the same cause
  without new evidence should block that direction; do not invent new
  unrelated operations to pass a validator.

### R5 — Matched live benchmark before promotion (P1)

- Reuse existing Golden Task fixtures/runner/comparison, initially
  `golden-existing-model-correction` followed by one articulated/
  one organic case only when matching approved references exist.
- Both arms use same reference and immutable starting `.bbmodel`,
  equivalent available tools, art requirements and acceptance criteria,
  with distinct actual build/source identity recorded. Candidate differs
  only in curated guidance availability; no leaked warm-start state.
- Acceptance requires no critical visual/structural regression.
  Measure correction rounds, repeated-cause failures, capture/tool
  calls, time and actual usage **only after** matching accepted quality.
  Without `LIVE_BLOCKBENCH` and human/reference review, mark
  `UNVERIFIED`; do not claim the change improves modelling.

## 6. Anti-regression and security matrix

| Case | Required behavior |
| --- | --- |
| No feature_intents / old Recipe | Existing compiled placement and flow unchanged |
| Texture-only label, with no 3D reason | Never auto-create a Cube |
| Geometry feature lacking actual view/claim | Provisional options only; no numeric authoritative placement |
| Conflicting front/side or missing depth | Only independent safe work proceeds; no guessed depth |
| Stale source, license or incompatible Bedrock version | Withhold affected external candidate, mark why |
| Multiple plausible strategies or weak word match | Abstain or show differences, no automatic first-match |
| Symmetric appearance but asymmetric equipment | Preserve intentional asymmetry |
| Small Box UV vs valid plane-like Cube | Distinguish material technical cases, no blanket 3D-size rule |
| Native source/project/Recipe changes during plan | Existing snapshot/identity and transaction protection remains |
| User reference contradicts external paper or Vanilla style | User-approved reference wins; retain exception |
| High-cost AI/mesh generator or arbitrary external code | Not loaded; no arbitrary eval, fs import or network on authoring hot path |
| Rejected/failed alternative | Preserve reason as bounded case evidence only after review; do not auto-train |

Tests should assert observable behavior, conservation of explicit
source identities and **negative applicability**, not exact wording
or model count. Tests authored but not executed are NOT proof.

## 7. Maintenance and context-cost controls

- Preserve exactly **one** Recipe owner, one Markdown knowledge index,
  existing four Gateway tools, existing Control stages, existing
  Validation/approval owner, and existing store/Undo.
- Source papers/catalogs are **documentation-only**: never bundle the
  full research list into the Runtime Markdown or hot-path prompts.
  Only promoted, source-bound, small decision cards may enter the
  selected on-demand knowledge corpus.
- Feature-level planning, not a per-Cube form or audit. Reuse
  `knownContextIds`/current state when valid. Add a new helper only
  with its actual in-use caller and matching regressions; no speculative
  routers, ML abstraction layers, caches or embeddings databases.
- Each live study begins with a specific user-artifact problem and ends
  after the narrow owner, affected tests and acceptance are addressed.
  New observations become evidence references; prior failures/positives
  do not override a new user's reference.
- The extension from **Geometry → Texture → Animation** remains
  staged. No Texture/PBR or animation keyframe engine should be
  created as a consequence of this research.

**Current proof ceiling:** this file specifies future work only.
No R1–R5 behavior or test/native/visual proof is claimed. Continue
through ChatGPT and authenticated GitHub source work; never require
the user's own PC, local checkout, Blockbench installation or Codex
as a prerequisite for independently valid source changes.
