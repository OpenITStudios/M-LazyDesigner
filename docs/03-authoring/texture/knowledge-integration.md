# Texture & UV Knowledge — K4 Bounded Read-Only Integration

**Status:** K4 read-only source design and implementation candidate; Bun/typecheck/build and installed/native/visual acceptance NOT EXECUTED.  
**Pinned source before K4:** OpenITStudios/M-LazyDesigner / Local at `e78d494e83acc8365853d9d9ea941f2710c9c2c3` (2026-10-30).  
**Canonical authority:** [Texture & UV Standard](standard.md); [K0–K9 plan](knowledge-development-plan.md); [K2 gap map](knowledge-coverage.md); [K3 four decision cases](decision-cases.md) and [K1 source inventory](research-sources.md). K4 is an integration description, NOT another policy owner, model registry or AI dataset.

## Objective, proof ceiling and non-goals

K4 makes four K3 source-grounded candidate decisions *selectively readable* through the **existing** Texture knowledge resource. It preserves the normal Box-UV/one-base-atlas fast path and strictly refuses stale or ambiguous source selection. It does **not** infer current user reference pixels, approve materials, map faces, paint textures, change UV, register `manage_uv_layout`, add Gateway tools, or demonstrate a visual quality improvement.

Distinguish four separate proof levels: source code authored; successful exact-SHA runnable verifier; matching installed Blockbench/Undo/export; human acceptance of an actual same-reference model. Only source authorship and repository-content inspection apply to K4 so far. Published tests are authored but **NOT EXECUTED**.

## Source and consumer map

| Responsibility | Canonical owner | K4 action |
| --- | --- | --- |
| Current K3 examples, rights, hypothetical cases | `docs/03-authoring/texture/decision-cases.md` | Original source text embedded into Runtime build; no models/texture assets bundled |
| Actual SHA-256 and section selection | `mcp/lib/semantic/knowledge.ts` | **Reuse unchanged** for exact section IDs, source digests, unique leaf-title selection |
| Strict K3 source reader | `mcp/lib/texture/knowledgeCases.ts` | New narrow read-only helper; four expected sections, optional source/section pin checks |
| Current Texture Knowledge Resource | `mcp/server/resources/texture-authoring-knowledge.ts` | Extend existing four topics with four opt-in case topics, only one case text per read |
| K3 case file rebuild tracking | `mcp/build/watch-policy.ts` | Rebuild when original decision-cases Markdown changes; never regenerate prompts |
| Canonical test owner | `mcp/tests/authoring/texture-knowledge-resource.test.ts` | Extend existing resource tests with source/pin/ambiguity/old fast path cases |
| UV and Texture mutation/execution | Existing `mcp/lib/uv/` and `mcp/lib/texture/` owners | No changes and no new invocation |
| Four-tool public Gateway | `mcp/gateway/` | No new tool, no implied forwarding of Runtime resources |

Normal authoring stays:

    Approved reference + current Control context
      -> Existing UV/Texturing capabilities and verification
      -> No knowledge case lookup by default

Explicit source guidance request:

    K3 canonical Markdown (Bun text import)
      -> Existing semantic index / source and section hashes
      -> Small read-only Texture UV case reader
      -> Existing Runtime texture-authoring-knowledge Resource
      -> One selected SOURCE_CANDIDATE, always REVIEW_REQUIRED for asset

**Accessibility limitation:** Normal AI clients use the stable Gateway with exactly four tools (`status`, `search_capabilities`, `describe_capability`, `invoke_capability`). K4 extends a **Runtime Resource** available through the Runtime resource mechanism, not an additional Gateway capability. Consequently, K4 **does not establish** that normal Gateway clients automatically receive the case or that case selection influences real model creation. A genuinely connected normal authoring caller belongs to K5/K6, only after its evidence ownership is proven.

## Read-only source-bound decision contract

The four opt-in Resource topic IDs are `case-uv-p01`, `case-tex-p01`, `case-tex-p02` and `case-tex-p03` under the existing `texture-authoring://{topic}` URI. The original `surface-patterns`, `vanilla-principles`, `render-profiles` and `treatment-plan` remain unchanged.

The small pure reader takes the trusted bundled Markdown, uses `indexMarkdownKnowledge` and `describeKnowledgeSource` from the existing semantic module, and provides two **source-retrieval** operations: exact-case lookup or unique leaf-title query. Optional `expected_source_sha256` and `expected_section_sha256` reject a stale caller. The actual case section must exist, have all required fields and remain within bounded size. The reader never reads external files at runtime, fetches the network, or accepts the current asset as part of its case text.

Successful **source retrieval** returns:

    state: SOURCE_CANDIDATE
    case_id: UV-P01 | TEX-P01 | TEX-P02 | TEX-P03
    source: docs/03-authoring/texture/decision-cases.md
    source_sha256: canonical SHA-256 of bundled source
    section_id, section_sha256: canonical semantic index identity/digest
    title, guidance_text: only the selected K3 case
    required_evidence: current case-required facts
    reference_scope: CURRENT_USER_REFERENCE_NOT_ATTESTED
    target_compatibility: UNKNOWN_CURRENT_BEDROCK_AND_BLOCKBENCH
    decision_readiness: REVIEW_REQUIRED
    mutation_authorized: false
    visual_verdict: not_evaluated

For missing, malformed, overbudget or corrupted source, fail closed. For an unknown ID, generic word, tied title, malformed digest, changed source or changed case body, return REVIEW_REQUIRED with a machine-readable reason. A matched title **never upgrades to APPLY**, even if it is a uniquely relevant case. It only provides advisory source evidence for further judgement.

**Hash interpretation:** the case reader hashes original checked-in Markdown and case sections, not its user's reference image, PNG pixels or remote Mojang assets. The K3 casebook separately has pinned Git SHAs and eleven source-file SHA-256 values; the Resource does not verify those external bytes or training rights at runtime. A pinned source-file revision and a Bedrock `format_version` are not proof of compatibility with the currently installed editor/renderer.

## Required current-asset proof per decision family

| Case | Evidence a *future* authoring consumer must actually validate | Canonical owner; forbidden shortcut |
| --- | --- | --- |
| UV-P01: asymmetric/symmetric reuse | Both exact Cube+face identities, signed UV/rotation, texture UUID/revision, physically shared pixel ownership and approved opposite-side mark evidence | Modelling `uv/stacking.ts` / `uv/semanticPlanner.ts`. Never stack because same footprint or Box mirror alone |
| TEX-P01: palette/material clusters | Approved reference image/view claim, region/face targets, material and palette/identity values, physical texel scale, current atlas revision | Texturing `treatmentPlan.ts` / `surfacePattern.ts` / `palette.ts`. Never choose grain/metal/cloth from part label alone |
| TEX-P02: cross-Cube seam | Reference edge observation, distinct exact Cube/face+edge identities, geometry adjacency, matched sampling, texture/material/alpha revision | `seamContinuity.ts` and existing Validation. Never claim seamless from 2D padding, skipped samples or ambiguous T junction |
| TEX-P03: emissive eyes | Actual target render/alpha material binding, known texture format, PBR channel intent and current renderer compatibility | `renderProfile.ts` / `alphaSemantics.ts` / `pbrContent.ts`. Never infer emissive from bright RGB, file name or MERS alone |

K4's Resource **cannot** authenticate those user-specific facts, because it receives no current Reference Package/image evidence or native Blockbench project+texture snapshot. It deliberately does not add caller Boolean flags pretending to attest them. Future K5/K6 must obtain facts through existing Control and Runtime contract owners; lack of evidence remains REVIEW_REQUIRED, not an implicit action, automatic repeat or visual PASS.

## Safety, compatibility, rights and maintenance

- Geometry stays frozen. A K4 case cannot change shapes, bones, Cube positions, UV lock, atlas size, material channels or pixels.
- Current native Box UV, explicit per-face rotation/flip, whole-physical-texel mapping, UV sharing constraints and painted atlas migration protection stay unchanged. `manage_uv_layout` remains **UNREGISTERED**.
- Empty alpha is **not** proof that underlying nonzero RGB may be discarded. Never repack a painted atlas using read-only knowledge.
- Multiple texture render domains remain distinct: `surface_pattern`, `render_profile`, `pbr_texture_set` and `geometry_material_instance`.
- Mojang sample source is EULA/all-rights-reserved. Blockbench implementation is GPL-3.0. No external image/model/code/dataset/weights have been copied. Source examples are research facts, not licensed training inputs.
- No general purpose case manager, second source registry, Gemini-like AI image inference, profile loader or new public tool. A modified K3 casebook triggers a Runtime rebuild, not a prompt generator edit.

## Required regression and quality checkpoints

| Gate | Falsifiable expectation | Current K4 proof |
| --- | --- | --- |
| Original resource topics | Their existing JSON semantics stay unchanged; no case is loaded by default | Source/test authored, NOT EXECUTED |
| Four explicit case URIs | Each returns only its named case and original-content hashes, never paint readiness | Source/test authored, NOT EXECUTED |
| Invalid casebook | Missing/duplicated/incomplete/oversized casebook fails closed | Source/test authored, NOT EXECUTED |
| Case retrieval | Exact title queries select one; generic `material` ties abstain; unrelated `animation pivot` gets no case | Source/test authored, NOT EXECUTED |
| Stale source | Changed Markdown rejects previous source hash; changed case body rejects its prior section hash | Source/test authored, NOT EXECUTED |
| K3 source edits | Watch rebuilds Runtime on exact casebook path, not regenerate prompt | Source/test authored, NOT EXECUTED |
| Gateway/capability inventory | Exactly four public Gateway tools; existing unregistered UV tool unchanged | Static intent, executable verification NOT EXECUTED |
| Native quality | Same approved reference and bbmodel; pixel, orientation, seams, alpha/PBR and Bedrock export review | NOT EXECUTED |
| Efficiency | Only compare accepted baseline/candidate after no fidelity regression | NOT EXECUTED |

**K4 STOP:** selected read-only cases are source-grounded and accessible via their existing Runtime resource; no direct ordinary-Gateway authoring integration or application. Next, choose a single justified K5/K6 source slice with real authenticated current-task evidence, focused positive/negative tests, and no lost default capabilities. Geometry paused; Animation deferred; CI disabled, no release, no user-PC work.


// ---- K5–K6 source continuation: 2026-10-30 ----

## One real normal-Gateway diagnostic consumer

The existing `list_textures(diagnostics=true, diagnostic_scope=uv|coverage|full)`
returns current UV/face-coverage evidence through the four-tool Gateway. K5/K6
now consumes **only this already-requested structured diagnostic result**, at
`mcp/server/runtime/extensions/texture/authoring.ts::wireTextureReads`. It
does not add an input argument, a Gateway tool, another texture reader or an
automatic painting decision:

- **UV-P01** is offered only when `uv_audit.exact_reuse.region_count > 0`
  or `uv_audit.partial_overlap.pair_count > 0` on the actual requested UV
  scope. A matching rectangle means review of art/face ownership, not
  permission to stack, mirror or repack.
- **TEX-P01** is offered only when sampled
  `optimization_opportunities.coverage.review.solid_color_faces.count > 0`
  and `coverage.scanned_faces > 0`, on explicit coverage/full diagnostics.
  Flat pixels may be intentional. No wood/metal/color decision is inferred.
- Both hints include the K3 case's source and section SHA-256 plus required
  evidence, are `REVIEW_REQUIRED`, and explicitly deny mutation. This is an
  actual Gateway-reachable technical diagnostic consumer of K4's indexed case
  source; it is **not** an authenticated visual-reference consumer.
- No hints are generated for ordinary inventory/default diagnostic=false or
  evidence-free scopes. There is no casebook parsing when the selected
  diagnostics contain no relevant signal.
- **TEX-P02** is not attached to the generic intra-Cube seam scan because
  it requires explicit observed *cross-Cube* adjacency/continuity.
  **TEX-P03** is not attached to a bright-looking atlas, PBR map or filename
  without an actual resolved Bedrock render/material binding. This abstention
  is required, not an unfinished automatic inference feature.
- Failure of the optional casebook reader reports
  `TEXTURE_UV_KNOWLEDGE_SOURCE_UNAVAILABLE` while retaining the
  independently valid native UV/coverage evidence. No alternate case or
  silent source substitute is fabricated.

## K6 additional source-owner safety for explicit SHARED texture treatment

`mcp/lib/texture/treatmentPlan.ts` now marks a cross-region `SHARED`
face as `review_required` if its declared pattern, Minecraft material
code, optional PBR intent or explicitly specified identity colors conflict
with its named source face. A shared claim against a face intentionally
transparent while requesting a distinct colored mark is likewise a conflict.
K7 source review strengthens this owner: **one-sided or blank region identity
colors remain `SHARED_UV_IDENTITY_UNVERIFIED`**; two explicitly specified
different palettes remain `SHARED_UV_IDENTITY_CONFLICT`. Case/whitespace
normalization alone does not reject compatible role-aligned colors. Both sides
entirely unspecified remain structurally valid only; `ready` is never a
reference-approved decision. The same revalidation applies at seam handoff.
This guard requires **no new caller fields** and never manipulates real UV
or PNG pixels. It does not verify that two face declarations actually map
to identical texels; that remains the native UV owner.

`requireTextureTreatmentSeamPlanReady` must revalidate the copied
`identity_colors` as well, so a post-plan mutation cannot inherit the
previous `ready` state. Unchanged, compatible SHARED plans retain the
previous structural readiness path; styling/PBR/render visual approval
remains external to this pure planning result.

## Verification and remaining higher-context residue

- **K5/K6 source slice authored, not executed:** existing knowledge case
  owner, live diagnostic wrapper, Texture treatment-plan owner and two
  existing owning regression suites. No new auto-test files.
- **Execution proof missing:** exact-SHA Bun targeted tests/typecheck/build.
  CI is disabled; no workflow has been created or enabled. No tests are
  claimed PASS merely because source assertions were written.
- **Native proof missing:** same installed Blockbench build, actual
  project/atlas revision, deterministic face/UV evidence, real Undo and
  rendered model compared to an approved reference. Case hints do not
  authorize automatic painting/repack and never claim visual PASS.
- **Next K7:** focused executable source integration verification on this
  exact commit when a capable environment exists, plus static review of
  bounded output and existing Gateway result compaction. K8/K9 remain native,
  mapped-model and comparison acceptance.
 

## K7 — Exact-source verification audit (2026-10-30)

The K7 review inspected the actual K4–K6 producers, the `list_textures`
Runtime extension order, `textureOptimizationRuntime` coverage fields, the
canonical `planTextureTreatment` owner, the Gateway output compaction
contract and their existing test owners. The standard Gateway has four
tools; `list_textures` remains an existing authoring capability.

**Source defect repaired:** explicit `SHARED` treatment regions previously
tested palette equality only when **both** palettes were nonempty; source-only
or destination-only identity marks could therefore pass this semantic
check. A missing counterpart is now `review_required`; actual bitmap/UV
equality and user reference approval remain independently unverified.

**Source-only preservation checks:** default
`list_textures(diagnostics=false)` exits without K3 retrieval;
`diagnostic_scope=uv` consumes only UV audit counts; coverage/full
may provide a flat-face material review; `seam` and `pbr` alone cannot
trigger those two cases; K3 cases TEX-P02/TEX-P03 still abstain without
actual cross-Cube/renderer source evidence. Gateway structuredContent has
no special K3 stripping, and the overlay issues no native edits.

**Runnable proof remains missing:** this session can inspect source through
the authenticated GitHub connector but has no checked-out repository,
Bun/installed dependencies or enabled CI. Git clone via container network
was unavailable (no GitHub DNS); generic local TypeScript availability is
not a substitute for repository `bun`/native proof. Static review and
authored tests are **NOT** executable PASS.

**Targeted K7 verifier once an actual supported code environment exists:**

From `mcp/` on the **exact final K7 SHA**, use the maintained
repository dependency environment; do not reinstall or change lockfiles
just to run this report:

```bash
bun test tests/texture-treatment-intelligence.test.ts tests/authoring/texture-knowledge-resource.test.ts tests/authoring/texture-decision-cases.test.ts tests/texture-atlas-integrity.test.ts
bun run typecheck
bun run typecheck:gateway
bun run plan:affected -- lib/texture/treatmentPlan.ts lib/texture/knowledgeCases.ts server/runtime/extensions/texture/authoring.ts
bun run verify:affected -- lib/texture/treatmentPlan.ts lib/texture/knowledgeCases.ts server/runtime/extensions/texture/authoring.ts
```

Use `docs/05-operations/local-acceptance-runbook.md` for K8 when an
actual matching installed Blockbench build and approved model reference
exist. Neither static regression definitions nor advisory diagnostics are
visual PASS. No GitHub workflow re-enabled and no user-PC step demanded.


## K8 native verification harness — prepared, not executed

The existing disposable `verify:texturing-live` entrypoint is the canonical
native validation owner. K8 extends its **same existing fixture** rather than
adding a new tool, model, database, or live test script. It checks:

- `list_textures` **inventory-only** emits no unsolicited `knowledge_guidance`;
- a current UV-only diagnostic offers `UV-P01` **if and only if** actual
  exact-reuse or partial-overlap evidence is positive, not `TEX-P01`;
- a current coverage-only diagnostic offers `TEX-P01` **if and only if**
  scanned native faces include solid-color candidates, not `UV-P01`;
- every surfaced hint is source- and section-hash-pinned, REVIEW_REQUIRED,
  mutation_authorized=false, and visual verdict `not_evaluated`;
- before/after native Cube UV, production atlas image bytes and unrelated
  decoy image bytes remain unchanged across diagnostic-only calls.

The verifier already requires `--confirm-disposable`, a matching managed build,
the previously created disposable Geometry project, and a valid live Runtime
connection. This K8 extension changes neither the normal authoring tools nor
the native painting and Undo paths. A case without a positive diagnostic signal
is **not covered by a positive live example**, never silently counted as PASS.

**Current proof:** source/fixture authored in GitHub only. The live verifier
has not executed in this session; Bun, installed Blockbench, active Gateway
and approved model/reference evidence are unavailable. Do not write K8 PASS,
visual acceptance, or quality/efficiency claims based on this script.


## K8 source-review follow-up: selected knowledge must reach the Gateway

K8 source inspection caught a K5 usefulness gap: the actual normal Gateway
diagnostic response contained case ID and `required_evidence` but **not** the
case's APPLY/REJECT/AMBIGUOUS criteria. Clients connected only through the
four-tool Gateway could not automatically read the K3 Runtime Resource.
The canonical `mcp/lib/texture/knowledgeCases.ts` now extracts the existing
four K3 fields once, with a per-field 800-character bound, and includes
`decision_examples.decision / positive_hypothesis / reject_hypothesis /
ambiguous_hypothesis` in each opt-in diagnostic hint. It does not duplicate
the content into a second registry; all fields derive from the pinned
Markdown and retain the source and case-section SHA-256 identifiers.

A selected hint remains **SOURCE_CANDIDATE / REVIEW_REQUIRED**, with
`mutation_authorized=false` and current user reference and Bedrock render
compatibility **unverified**. These textual cases describe hypothetical
conditions, not observations of the active model. Casebook tampering,
missing/duplicated field lines and oversized examples fail closed; callers
cannot mutate the stored case summary through a returned object.

The existing disposable Texturing native verifier and current authoring
source test owner now check that the conditional Gateway hints include
those bounded distinctions. No extra normal authoring call or new public
tool is required. This remains SOURCE ONLY until targeted Bun and
LIVE_BLOCKBENCH execution really occur.
