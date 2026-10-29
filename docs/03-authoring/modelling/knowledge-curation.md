# Geometry Knowledge Curation Contract

Status: G0 documented; **G1 eight SOURCE-GROUNDED_CANDIDATE pairs prepared** (2026-10-29). Source facts are pinned where available; negative cases remain hypothetical and deterministic regressions/native/visual acceptance are NOT EXECUTED.
Owner: `docs/03-authoring/modelling/`; continuation: `docs/05-operations/next-action.md`.

## Purpose and non-goals

Supporting documents: [curated research and licensing](research-sources.md)
and [modular implementation design](geometry-intelligence-plan.md).
They are conditional research/development guidance, not normal modelling
context or an independent knowledge/approval engine.

Enrich the **existing** Recipe's geometry decisions with reusable, evidence-bound
examples. Quality is **better reference-grounded choices with fewer accepted-result
corrections**, not more Markdown, models, Cubes, bones, tools, or test files.
Do not build a second knowledge engine, model database, approval mechanism,
style scorer, separate Recipe registry, or a giant document of repeated policy.

The existing `standard.md` owns universal modelling rules; `profiles/*.md`
own profile-specific advice; `docs/02-reference/package/geometry.md` owns
reference handoff. This document owns **curation/coverage criteria only**.
If a fact is already covered, link its canonical owner rather than copying
its prose into a new case. Keep ordinary authoring context unchanged: one
active Modelling specialist plus the selected profile, and conditional
knowledge retrieved only for an actual decision.

Authority remains: explicit user requirement and approved visual reference;
confirmed dimensions/current authored state; applicable official Bedrock
spec/native runtime; bounded, compatible curated examples. A source-valid
example is never automatic approval of a new model.

## Coverage matrix: where new evidence actually helps

| Priority | Decision family | Existing owner | Missing enrichment to curate |
| --- | --- | --- | --- |
| P0 | View / depth / scale interpretation | Reference Package + `standard.md` | Paired cross-view successes and ambiguity/refusal cases |
| P0 | Silhouette and primary mass | `standard.md` + selected profile | Different-proportion examples and bad blockout corrections |
| P0 | Geometry / Texture / Omit choice | `standard.md` + Recipe `featureDecision.ts` | Supported 3D feature vs surface-only counterexamples |
| P0 | Bone, pivot, attachment | `standard.md` + Humanoid/Creature/Mechanical profiles | Correct vs arbitrary joint/hinge pivot; clearance and inheritance |
| P1 | Slopes and segmented organic shapes | `standard.md` + Creature/Plant profiles | Rotated/segmented alternatives and oversegmentation failures |
| P1 | Symmetry, repeated assemblies | Recipe `patterns.ts` / `symmetry.ts` | Reusable vs intentional-asymmetry decisions; cross-profile cases |
| P1 | Negative space, contact, layers | `standard.md` + `geometry/surfaceEvidence.ts` | Opening-vs-painted-shadow; overlap, contact and occlusion cases |
| P1 | Optimization, corrections, UV/export limits | `standard.md`, existing Geometry & Bedrock owners | Counterfactual before/after + failure and format-specific exceptions |

A decision family is not a new code module. Prefer one well-grounded
positive/negative pair over ten similar model examples. Prioritize a *gap*
only when its evidence can change a Recipe choice or prevent a known failure.

## One canonical knowledge-card shape

The bounded G1 pilot's eight **case-only** cards live together in
[decision-cases.md](decision-cases.md), with unique headings that the existing
`mcp/lib/semantic/knowledge.ts` can index. This separates evidence examples
from the already large universal `standard.md` and seven profiles, without
adding a second modelling policy or an always-loaded corpus. Later sustained
profile-specific rules must extend their existing owner, not duplicate cards.
Native asset/image evidence remains with its `workspace/active/<asset>/`
owner. Each case card should contain only the following fields when applicable:

| Field | Minimum content |
| --- | --- |
| Decision / question | One concrete choice to make; stable semantic feature identity |
| Applicable when | Required context, geometry purpose, target format/version, art direction |
| Do not apply when | Known exceptions, conflicting reference, unsupported format/rig |
| Existing rule owner | Link to `standard.md`, selected profile or canonical technical owner |
| Observed example | Exact asset/source path, part ID, view/pose, source revision; no invented evidence |
| Counterexample | Similar-looking input requiring a *different* decision |
| Preferred action | Representation / transform / correction suggestion within existing Recipe operations |
| Proof requirement | Structural check plus reference views/poses and native/export checks if relevant |
| Provenance/status | Origin, author, upstream version/ref, license/use scope, hashes; `CANDIDATE / SOURCE_VERIFIED / NATIVE_VERIFIED / VISUAL_ACCEPTED` with clear proof scope |

The status is **not** a single cumulative approval level. A valid source
revision and passing technical validator cannot attest visual similarity,
animation suitability or user approval. Never infer a reference-view
`evidence_refs` handle from words/names/coordinates alone.

### Example card: hinge pivot (illustration, NOT verified case)

**Decision:** rotate a hinged panel through its supported attachment
relationship rather than an arbitrary mass-center pivot.
**Apply:** the current reference identifies hinge side/axis and the panel
actually articulates. **Reject/defer:** hinge is unseen or panel is static;
a name like `door_y` does not establish axis/side.
**Rule owner:** `standard.md#pivot--origin`; `profiles/mechanical.md`.
**Proof needed:** current exact part/parent identities, hinge evidence,
rest/extreme pose contact/clearance and native export when applicable.
**Case/provenance:** none yet; `CANDIDATE`, not a verified design example.

## First eight discriminating decision probes (G1)

Each row is **one positive/negative decision pair**, not an asset preset.
The [G1 casebook](decision-cases.md) now documents each decision with a
source-grounded positive **structural fact** and a clearly hypothetical
negative counterexample. This is not accepted artistic/visual test evidence:
real approved references, matching native proof and executed retrieval
regressions remain required before claiming the pairs verified.

| ID | Positive case to support | Negative / exception to preserve | Coverage |
| --- | --- | --- | --- |
| G-P01 | Exact dimensions + comparable front/side shape | Image pixels alone cannot establish unknown depth | Humanoid / Generic |
| G-P02 | Primary mass expresses target silhouette | Micro-Cube detail cannot repair a wrong global silhouette | Creature / Humanoid |
| G-P03 | Actual protruding armor/horn is 3D | Painted seam/marking belongs to Texture | Humanoid / Creature |
| G-P04 | One rotated member expresses a material slope | Cube staircase for the same contour without new purpose | Vehicle / Prop |
| G-P05 | Verified hinge/joint uses required parent and pivot | Pivot chosen from element name or bounding-box center | Mechanical / Prop |
| G-P06 | Opening/cavity owns real negative-space boundary | Dark paint is mistaken for a required opening | Prop / Vehicle |
| G-P07 | Symmetric repeated structure shares declared relation | Intentional asymmetry is forcibly mirrored | Creature / Vehicle |
| G-P08 | Required thin carrier / UV-compatible choice | Small Box UV span silently collapses mapped face | Plant / Generic |

Do not assign fixed part counts or Cube budgets. Keep the six existing
quality-benchmark profiles as representative coverage; these eight probe
pairs are a small source-level decision **pilot**, not new scores or a measured
baseline. One accepted case should test a real boundary, not just a keyword.

## Evidence intake and acceptance procedure

1. **Select one uncertainty:** a concrete Recipe decision not already solved
   by current source or validation.
2. **Inspect minimum sources:** [Mojang Bedrock Samples](https://github.com/Mojang/bedrock-samples),
   [Minecraft Creator geometry schemas](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/schemasreference/),
   [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/),
   or an existing user-authorized project. Use exact version and file/part
   identity; prefer stable/release samples over preview unless preview is the target.
3. **Check rights and relevance:** Mojang sample files are subject to
   [Minecraft EULA terms](https://github.com/Mojang/bedrock-samples/blob/main/LICENSE.md).
   A free/paid marketplace download is not a reusable training license.
   Extract transferable techniques, not protected model/texture copies.
4. **Capture positive + negative:** record what changed the decision,
   applicability/exclusions, source hashes and unresolved observations.
5. **Use the canonical owners:** no duplication of rules/validators; read
   a card only if the current Recipe feature and reference satisfy its trigger.
6. **Check source-level selection:** one exact relevant section chosen; a
   conflicting/stale/unlicensed source does not silently become guidance.
7. **Test the result:** same approved reference for baseline and candidate,
   affected technical checks, necessary reference-matched views and native
   evidence, then user approval when required. Compare cost to *accepted*
   result only after quality has been established.
8. **Retain causal feedback:** the accepted case may support a general
   principle; rejected corrections/false positives become counterexamples.
   Do not imply automatic model-weight learning.

## Critical integration gap and proof gates

G2 source now wires exactly eight pilot sections through the existing
Runtime Recipe knowledge adapter using Bun's original-text Markdown import
from `decision-cases.md` alongside the unmodified canonical workflow
manifest. The source is bundled at build-time, not read by Runtime from the
filesystem or external network. Recipe retrieval supplies **only selected
source-hash-verified excerpts**, and a stale explicit binding blocks guidance.
Neither this source change nor authored regressions demonstrate an installed
Blockbench build: executable, native and visual acceptance remain NOT EXECUTED.
Do not hand-edit `mcp/prompts/manifest.json`, duplicate the index, add a
Gateway tool, or load all profiles into every prompt.

**G0 / planning acceptance:** coverage matrix, unique owners, first eight
decision-pair targets and exact evidence requirements recorded (this file).
**G1 / source candidate:** eight cards have source facts, applicability and
negative decision boundaries. The owning Recipe knowledge regression is
AUTHORED but NOT EXECUTED; G1 executable acceptance remains pending, and
the cards are not model-quality PASS.
**G2 / connected Recipe:** the relevant cards are now connected at source to
existing Recipe planning/opt-in inspection with bounded excerpts and
source-revision checks. Bun/typecheck/build and installed Runtime evidence
are NOT EXECUTED; no end-to-end operational PASS.
**G3 / native quality:** matching installed build and same approved reference;
verified structure, visual fidelity, correction rounds and measured
cost-to-accepted-result against a comparable baseline.

**Stop criterion:** do not expand the corpus merely to raise item counts.
Expand only when a new case distinguishes a decision or fixes a recurring
failure; advance to Texture only after the agreed Geometry acceptance scope.
