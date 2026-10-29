# Texture & UV Knowledge — K2 Coverage, Gaps, Adoption Decisions

**Status:** K2 SOURCE AUDIT AND RESEARCH ADOPTION MAP; no Runtime implementation, no native/visual PASS, no executed Bun verification. 2026-10-29.  
**Pinned source:** `OpenITStudios/M-LazyDesigner` / `Local` at `23bfc62af41292a11658d401e6113944aad7e835`.  
**Inputs:** [K1 112-record source inventory](research-sources.md), [K0–K9 procedure](knowledge-development-plan.md), [Texture/UV standard](standard.md), [Geometry UV reference](../../../.agents/skills/lazydesigner-modelling/references/uv-layout.md), [Texturing Skill](../../../.agents/skills/lazydesigner-texturing/SKILL.md).  
**Owner boundary:** Modelling retains UV Layout/UV PASS on frozen Geometry; Texturing owns atlas pixels, styling, alpha/render and PBR. Do not resume Geometry R0–R5. `manage_uv_layout` remains **UNREGISTERED**.

## Decision result, not feature-count target

Source audit distinguishes four different assertions: (a) algorithm/guard implemented; (b) reference-grounded decision that selects it; (c) actual Runtime consumer/execution exposure; (d) native, exported and human reference verification. **A function and a test definition only establish source presence, not a successful executable run or accepted asset.** A P0 guard below is a *risk if violated*, not evidence of an active P0 bug. Do not create a second UV engine, knowledge index, texture registry or model/scorer.

Status legend:

- `SUPPORTED_SOURCE`: canonical implementation and source test owner found, but tests have not been run for this K2 SHA.
- `SOURCE_POLICY`: normative boundary and helper exist; exact target/native use not demonstrated.
- `ADVISORY_ONLY`: candidate evaluation/preflight exists, but not authority to mutate/claim visual quality.
- `DECISION_GAP`: existing functions require user/agent-selected material/reference intent; a selected source/compatibility-grounded case is not demonstrated.
- `SOURCE_ONLY_PARTIAL`: technical evidence exists for a bounded subset, not a complete native/visual verdict.
- `UNREGISTERED_NATIVE`: implementation/adapter defined, public activation intentionally blocked.
- `NATIVE_UNVERIFIED`: native/file/export quality evidence absent for the selected version.

## K2-U — UV coverage (Modelling-owned)

| ID | Decision family | Observed code state | Canonical implementation | Existing test owner | K1 evidence | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| U01 | Box UV versus Per-Face UV | `SUPPORTED_SOURCE` | [lib/uv/boxUvPolicy.ts](../../../mcp/lib/uv/boxUvPolicy.ts) | [tests/uv-box-policy.test.ts](../../../mcp/tests/uv-box-policy.test.ts) | B02, B13, BB06 | P1 |
| U02 | Signed face UV, quarter turns, mirrored corners | `SUPPORTED_SOURCE` | [lib/uv/facePixelMapping.ts](../../../mcp/lib/uv/facePixelMapping.ts) | [tests/face-pixel-mapping.test.ts](../../../mcp/tests/face-pixel-mapping.test.ts) | B02, B22, BB04, BB10 | P0-guard |
| U03 | Logical UV versus integer physical texel density | `SUPPORTED_SOURCE` | [lib/uv/physicalEvidence.ts](../../../mcp/lib/uv/physicalEvidence.ts) | [tests/uv-physical-evidence.test.ts](../../../mcp/tests/uv-physical-evidence.test.ts) | BB05, BB01, D01 | P0-guard |
| U04 | Packing, semantic zones, padding and stability | `SUPPORTED_SOURCE` | [lib/uv/packing/planner.ts](../../../mcp/lib/uv/packing/planner.ts) | [tests/uv-stable-packing.test.ts](../../../mcp/tests/uv-stable-packing.test.ts) | D04, A03, A05, E01 | P1-proof |
| U05 | Intentional stacking versus accidental overlap | `DECISION_GAP` | [lib/uv/stacking.ts](../../../mcp/lib/uv/stacking.ts) | [tests/uv-stacking-proposals.test.ts](../../../mcp/tests/uv-stacking-proposals.test.ts) | E01, B17, A01 | P1 |
| U06 | Mirrored asymmetry and directional markings | `DECISION_GAP` | [lib/uv/stacking.ts](../../../mcp/lib/uv/stacking.ts) | [tests/uv-stacking-proposals.test.ts](../../../mcp/tests/uv-stacking-proposals.test.ts) | B22, B17, BB04 | P1 |
| U07 | UV lock, painted atlas and exact pixel migration | `UNREGISTERED_NATIVE` | [lib/uv/pixelMigrationTransaction.ts](../../../mcp/lib/uv/pixelMigrationTransaction.ts) | [tests/uv-pixel-migration-transaction.test.ts](../../../mcp/tests/uv-pixel-migration-transaction.test.ts) | BB06, E11, D05 | P0-block |
| U08 | Planar cutout / alpha-owned 2D silhouette | `SOURCE_POLICY` | [lib/texture/alphaSemantics.ts](../../../mcp/lib/texture/alphaSemantics.ts) | [tests/texture-treatment-intelligence.test.ts](../../../mcp/tests/texture-treatment-intelligence.test.ts) | BB01, B05 | P1-proof |
| U09 | UV plan project/atlas identity, staleness | `SUPPORTED_SOURCE` | [lib/uv/service.ts](../../../mcp/lib/uv/service.ts) | [tests/uv-plan-service.test.ts](../../../mcp/tests/uv-plan-service.test.ts) | BB05, BB08, E11 | P0-guard |
| U10 | Native UV registration and availability | `UNREGISTERED_NATIVE` | [server/runtime/uv/layoutService.ts](../../../mcp/server/runtime/uv/layoutService.ts) | [tests/uv-registration-readiness.test.ts](../../../mcp/tests/uv-registration-readiness.test.ts) | BB06, BB10 | P0-block |
| U11 | Bedrock/export UV parity and saved project | `NATIVE_UNVERIFIED` | [server/runtime/uv/layoutRuntime.ts](../../../mcp/server/runtime/uv/layoutRuntime.ts) | [tests/uv-native-transaction.test.ts](../../../mcp/tests/uv-native-transaction.test.ts) | B01, B02, BB10 | P1-proof |

### UV: fact versus unresolved decision

| ID | Verified code fact or source boundary | Gap / APPLY–REJECT decision |
| --- | --- | --- |
| U01 | Native Box/per-face distinction and explicit-conversion refusal exist. | Do not add a new UV mode. K3 only if a reference-specific choice is not resolved. |
| U02 | Physical pixel mapper supports 0/90/180/270, authored flips, and bounds. | Preserve code; K3 negative mirrored text/identity, not a second mapping algorithm. |
| U03 | Physical face aspect/density analysis exists, read-only; fractional logical UV can be valid. | Require exact physical scaling in K3; avoid changing geometry for integer UV. |
| U04 | MaxRects, explicit shared cohorts, locks and semantic packing are implemented. | Visual/editability comparison missing; reject occupancy-only optimization. |
| U05 | Explicit stacks checked; identical shape yields REVIEW proposals, not automatic sharing. | Missing source-bound decision linking actual mark/exposure/texture intent to each proposed stack. |
| U06 | Unique detail and mirror-forbidden constraints exist if explicitly declared. | No authoritative image-based classification of logo/eye/wear orientation is established; source evidence required. |
| U07 | Strict candidate/atomic adapter, digest, rollback and outcome-unknown source contracts exist. | Native apply unregistered; no unlocking painted repack until generated build and live Undo/save/reopen proof. |
| U08 | Alpha/render semantic analysis and explicit PLANAR_CUTOUT_CARRIER exception exist. | Needs validated carrier geometry and material binding; not permission to invent depth. |
| U09 | Project/UV fingerprints and automatic atlas source decoded pixel revision checks exist. | Keep fail-closed on changed bitmap UUID or content; no new cache or revision registry. |
| U10 | Future manage_uv_layout ToolSpec exists, intentionally not registered. | Do not promote to a working user tool, edit generator artifacts manually or claim UV PASS. |
| U11 | Native adapter/transaction source exists; serialized file/render parity is unproven at this SHA. | Need exact version Blockbench import/export, saved bbmodel and Bedrock mapped-model evidence. |


## K2-T — Texture coverage (Texturing-owned)

| ID | Decision family | Observed code state | Canonical implementation | Existing test owner | K1 evidence | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | Single base atlas and exact texture identity | `SUPPORTED_SOURCE` | [server/tools/texture/atlas.ts](../../../mcp/server/tools/texture/atlas.ts) | [tests/authoring/texture-production-discipline.test.ts](../../../mcp/tests/authoring/texture-production-discipline.test.ts) | B03, B07, BB08 | P0-guard |
| T02 | Face/region coverage and ownership | `SUPPORTED_SOURCE` | [lib/texture/treatmentPlan.ts](../../../mcp/lib/texture/treatmentPlan.ts) | [tests/texture-treatment-intelligence.test.ts](../../../mcp/tests/texture-treatment-intelligence.test.ts) | B03, BB01, R18 | P1-proof |
| T03 | Reference-specific palette and value/hue ramps | `DECISION_GAP` | [lib/texture/palette.ts](../../../mcp/lib/texture/palette.ts) | [tests/texture-palette.test.ts](../../../mcp/tests/texture-palette.test.ts) | BB01, P01, P02, P07 | P1 |
| T04 | Surface material family, pixel treatment and direction | `DECISION_GAP` | [lib/texture/surfacePattern.ts](../../../mcp/lib/texture/surfacePattern.ts) | [tests/texture-treatment-intelligence.test.ts](../../../mcp/tests/texture-treatment-intelligence.test.ts) | BB01, D09, P07, R18 | P1 |
| T05 | Pixel clusters, scale, nearest and anti-noise | `SUPPORTED_SOURCE` | [lib/texture/pixelCraft.ts](../../../mcp/lib/texture/pixelCraft.ts) | [tests/texture-pixel-craft.test.ts](../../../mcp/tests/texture-pixel-craft.test.ts) | BB01, E07, E10, P06 | P1-proof |
| T06 | Shared UV surfaces and incompatible painted treatment | `ADVISORY_ONLY` | [lib/texture/geometrySignalCompiler.ts](../../../mcp/lib/texture/geometrySignalCompiler.ts) | [tests/texture-geometry-signal-compiler.test.ts](../../../mcp/tests/texture-geometry-signal-compiler.test.ts) | B17, E01, R03 | P1 |
| T07 | Directional identity marks and mirror-aware placement | `DECISION_GAP` | [lib/texture/treatmentPlan.ts](../../../mcp/lib/texture/treatmentPlan.ts) | [tests/texture-treatment-intelligence.test.ts](../../../mcp/tests/texture-treatment-intelligence.test.ts) | B22, BB04, P07 | P1 |
| T08 | Exact pixel writes, bounded ROI and rollback | `SUPPORTED_SOURCE` | [lib/texture/paintTransaction.ts](../../../mcp/lib/texture/paintTransaction.ts) | [tests/texture-transaction-dirty-region.test.ts](../../../mcp/tests/texture-transaction-dirty-region.test.ts) | BB07, E11, D11 | P0-guard |
| T09 | Seams, adjoining Cube edges and omission accounting | `SOURCE_ONLY_PARTIAL` | [lib/texture/seamContinuity.ts](../../../mcp/lib/texture/seamContinuity.ts) | [tests/texture-seam-continuity.test.ts](../../../mcp/tests/texture-seam-continuity.test.ts) | D08, D09, B03 | P0-proof |
| T10 | Alpha cutout/blend/emissive and render material | `SUPPORTED_SOURCE` | [lib/texture/alphaSemantics.ts](../../../mcp/lib/texture/alphaSemantics.ts) | [tests/texture-treatment-intelligence.test.ts](../../../mcp/tests/texture-treatment-intelligence.test.ts) | B04, B05, B16, E03 | P0-guard |
| T11 | PBR normal/height/MER(S) optional content | `SUPPORTED_SOURCE` | [lib/texture/pbrContent.ts](../../../mcp/lib/texture/pbrContent.ts) | [tests/texture-pbr-content.test.ts](../../../mcp/tests/texture-pbr-content.test.ts) | B06, B10, BB09, E06 | P1-proof |
| T12 | Variant alignment and base-mapping reuse | `SUPPORTED_SOURCE` | [lib/texture/productionAlignment.ts](../../../mcp/lib/texture/productionAlignment.ts) | [tests/texture-production-alignment.test.ts](../../../mcp/tests/texture-production-alignment.test.ts) | B13, B17, B19, B21 | P1-proof |
| T13 | Reference-view/region provenance for style decision | `DECISION_GAP` | [lib/texture/treatmentPlan.ts](../../../mcp/lib/texture/treatmentPlan.ts) | [tests/texture-treatment-intelligence.test.ts](../../../mcp/tests/texture-treatment-intelligence.test.ts) | R01, R02, R03, R12 | P1 |
| T14 | Selective source-pinned Texture/UV case retrieval | `DECISION_GAP` | [server/resources/texture-authoring-knowledge.ts](../../../mcp/server/resources/texture-authoring-knowledge.ts) | [tests/authoring/texture-knowledge-resource.test.ts](../../../mcp/tests/authoring/texture-knowledge-resource.test.ts) | BB04, B13, P07, R01 | P1 |


### Texture: fact versus unresolved decision

| ID | Verified code fact or source boundary | Gap / APPLY–REJECT decision |
| --- | --- | --- |
| T01 | Atlas identity and single-base-color creation preflight are present. | No per-part base atlas engine; identity and authoritative texture_id must remain pinned. |
| T02 | Required face inventory, SHARED source and unresolved slots are represented. | Region-only readiness is not whole-asset coverage or painted PASS. |
| T03 | HSL ramp from an explicit base and append/replace/preview operations exist. | Absent source-bound reason to choose base, shadow, accent and hue shift for a given face/reference; generic defaults alone inadequate. |
| T04 | 17 qualitative surface recipes exist and do not infer render profile. | Planner currently resolves supplied pattern; no demonstrated selective source-case decision for actual wood vs painted metal etc. |
| T05 | Bounded isolated-pixel, transition and cluster diagnostics; verdict explicitly not_evaluated. | Cannot use low-noise score or palette count as quality PASS; compare reference at physical scale. |
| T06 | Geometry-driven contact/exposure shared-texel conflict is guarded in source. | Need early reference/material selection before artist commits independent wear onto shared cells; avoid duplicating mask guard. |
| T07 | Region identity_colors and face targets exist; existing mapper preserves face orientation. | Reference-specific label/stripe/logo orientation and view evidence not authenticated for automatic strategy choice. |
| T08 | Deterministic pixel transaction, readback and dirty-region tests authored. | Do not add another Painter or replay uncertain state; live Undo/saved bitmap still needs proof. |
| T09 | Intra-Cube counters and cross-Cube pure analysis exist; caller-declared observations are not native attestation. | Need exact observed matched edges and native revision binding; 2D padding/partial sample cannot certify all seams. |
| T10 | Render-aware alpha logic distinguishes custom, cutout, blend, mask and emissive. | Do not infer glow from bright eyes or MERS/texture name; target Minecraft evidence outstanding. |
| T11 | Channel-oriented PBR diagnostics and optional material contract exist. | Do not mandate PBR or mix MERS subsurface with PNG opacity; engine-specific appearance unverified. |
| T12 | One base plus variant/PBR dimensions and channel conflict checks exist. | Keep sample license distinct; no variant-by-variant UV generator or external dataset. |
| T13 | Regions accept observed/inferred/unknown; seam observations have exact edge claims but are caller-unverified. | No complete source-image revision/face/view authentication for general palette/pattern choice; unknown view stays REVIEW_REQUIRED. |
| T14 | On-demand resource has four generic topics; central semantic index supports SHA and compatibility. | No Texture/UV K3 casebook integration demonstrated; existing Recipe case selection is Geometry-specific and must not be broadened blindly. |


## First-wrong-owner diagnosis: only changes that could improve accepted assets

### G1 — A reference-grounded UV-sharing choice (P1, first K3 UV pilot)

- **Observed:** `uv/stacking.ts` proposes implicit identical-shape stacks as `REVIEW`; explicit stack constraints can be `READY`. `texture/geometrySignalCompiler.ts` detects incompatible physical-texel exposure/contact/cavity when the claim is already known. Neither proves whether an *approved reference* demands distinct marks.
- **First missing decision:** before an intended overlap, which face/semantic region is allowed to share **the same artwork**? An explicit current reference view/mark, its face identity, UV source and material compatibility must be checked. The first wrong owner would be **selection of UV share intent**, not the MaxRects implementation.
- **Existing consumer:** Modelling-owned semantic UV planning/stack review; Texture treatment and geometry-aware mask creation must recheck shared pixel owners. **Do not wire another automatic stacking tool** or reinterpret a structural `READY` as user artwork approval.
- **K3 falsifier:** identical geometry with one asymmetric eye/logo/paint chip must choose `UNIQUE` or `REVIEW_REQUIRED`, while a genuinely symmetric/plain pair with explicit matching source evidence can remain stack-eligible. A matching footprint alone never authorizes overlap.
- **Required native proof:** selected real Cube/face UUID, bitmap mapping, reference front/side views, mirrored marked text orientation, and nonregressing 3D/model export. An example using Enderman's `mirror:true` establishes a format fact, not that any new model should mirror its texture.

### G2 — Reference-backed palette/material/pixel-language selection (P1, first K3 Texture pilot)

- **Observed:** `texture/palette.ts` generates an HSL shadow/highlight ladder from a specified base; `texture/surfacePattern.ts` contains 17 surface style descriptions; `texture/treatmentPlan.ts` resolves a **caller-supplied** surface_pattern and tracks `identity_colors`. PixelCraft diagnostics remain advisory.
- **First missing decision:** choose the right pattern, palette roles, directional cues and *where* to paint for a **specific approved reference and physical texel density**. An object name like 'robot' or material tag like 'metal' must not fabricate scratches or override unique colors.
- **Existing consumer:** Texturing specialist's material cohort treatment plan, then existing `paint_texture_transaction`/Painter. Keep `render_profile` and `pbr_texture_set` separate, and preserve the initial standard Box UV/one-atlas path.
- **K3 falsifier:** observed painted-wood panel with distinct color and vertical grain -> supported selected region; otherwise a reference with clean painted metal or an unreadable material/view must **not** receive automatic wood grain or generic uniform noise.
- **Required evidence:** actual approved image/view region, exact Cube faces/UV scale, base/accent values or review status, source revision and mapped-model before/after. Comparing number of colors or pixel fragmentation alone is invalid.

### G3 — Verified cross-Cube continuity, no false clean (P0-proof, K3 seam pilot)

- **Observed:** `texture/seamContinuity.ts` has intra-Cube sample evidence and cross-Cube pure analysis, with omissions/ambiguity. `texture/treatmentPlan.ts` permits explicit observed edge-pair claims; its native handoff labels `CALLER_DECLARATION_UNVERIFIED` and `visual_verdict=not_evaluated`. Normal `list_textures` scan does not certify cross-Cube seams.
- **Missing proof**, not a reason to rewrite the seam algorithm: exact physically adjoining native faces, texture UUID/material, current PNG revision, compatible sample counts and a genuine observed continuity expectation. Adobe's 2D-neighbor dilation is not equivalent to physically adjacent surfaces; different materials can deliberately form boundaries.
- **K3 falsifier:** two supposedly adjacent edges with unequal samples / noncoincident geometry / missing observed reference MUST stay unresolved, not `CLEAN`. A true observed seam may be a review candidate even when padding looks clean in the 2D atlas.
- **Native acceptance:** current mapped model at affected front/side/corner with current atlas and export; no complete-scene PASS from bounded scan.

### G4 — Rights and target compatibility before knowledge promotion (P0-governance)

- **Observed:** existing `mcp/lib/semantic/knowledge.ts` can source-hash Markdown and strictly screen external snapshots by exact compatible version. Geometry G1 uses selective content-bound sections in `mcp/lib/authoringRecipe/knowledgeSelection.ts`. Current texture resource serves generic recipes, not pinned case-specific cards.
- **Gap:** a Texture/UV K3 card needs an actual **consumer** and source entitlement to avoid promoting 112 miscellaneous documents as untrusted hot-path instructions. External rolling URL ≠ immutable source. Mojang samples are copyright/EULA restricted; Blockbench code GPL-3.0; research papers, code, weights and datasets are separate rights.
- **Adoption:** prioritize **bounded authored decision facts** and links (no copied assets/code), with source section SHA256, upstream SHA/version, exact applicable target, explicit apply/abstain and one affected existing function. Reuse the semantic index and on-demand resource architecture only after a discriminatory K3 pilot; do not extend Geometry-only Recipe case selection blindly.
- **Negative case:** incompatible/missing exact version, changed content hash, unlicensed marketplace asset, unsupported render mode or ambiguous matched case -> no promoted suggestion, no silent fallback to generic source.

## Source adoption record: APPLY / REJECT / DEFER

| Candidate technique | Decision | Required new evidence / alternative | Benefit criterion (not proxy) | Source IDs |
| --- | --- | --- | --- | --- |
| Native Bedrock Box and explicit Per-Face mapping | **RETAIN** | Existing validated format/face UV and locked geometry | No UV/export regression; unchanged correct simple path | B01–B02, BB04–BB10 |
| Mirroring, signed rotations and exact texel grid | **RETAIN** | Current face orientation and pixel grid; no new algorithm | Asymmetric marks do not reverse or smear | B22, BB04, BB10 |
| MaxRects and semantic cohort ordering | **RETAIN / VALIDATE** | Same-source mapped-model review and editability before claiming better | Equal/better reference fidelity, stable locked atlas | D04, A03–A05 |
| Asset-source-grounded UV stacking | **APPLY to K3 pilot** | Approved visual mark/exposure intent, exact face UUID/UV source and current model | Shared pixels remain semantically compatible | B17, B22, E01 |
| Source-specific texture material/palette | **APPLY to K3 pilot** | Current actual reference region, palette roles and physical texel density | Better material/identity fidelity with no extra noise | BB01, P01–P07 |
| Cross-Cube seam matching | **APPLY to K3 pilot (read-only)** | Physically paired native edges, source observation and bitmap revision | No false clean, fewer visible boundary artifacts | D08–D09 |
| PBR default on every asset | **REJECT** | Retain base color alone unless specific render target justifies PBR | Avoid meaningless channels and wrong alpha/material claims | B06, B08–B10, BB09 |
| Lightmap-style unique, non-overlap-only UV | **REJECT** | Unreal lightmap-specific requirement does not govern Bedrock color UV | Valid deliberate texture reuse preserved | E01–E02 |
| General mesh unwrap/UDIM/photoreal baking | **DEFER** | Actual Bedrock mesh case and reference need; prefer Cube/native template | No extra engine or format compatibility loss | D02, D06–D07, A01 |
| AI multi-view diffusion/latent texture generation | **DEFER** | Rights, proven visual win over Minecraft pixel baseline, compatible runtime/cost | Source-paired consistent identity, not realistic-looking hallucination | R01–R20 |
| Research paper / purchased model as training corpus | **REJECT by default** | Specific source/asset training and distribution permission must be separately established | Rights-safe, provenance-aware knowledge only | C01–C11, R19 |
| Painted atlas automatic UV repack | **DEFER activation; KEEP BLOCKED** | Matching generated catalog, full native atomic bitmap+UV Undo, saved model and visual proof | Byte-for-byte preserved source, rollback and mapped appearance | BB06–BB10, E11 |

## K3 pilot selection — only four discriminating choices

**Chosen for promotion review, not yet indexed as production knowledge:**

| Candidate | Source facts verified | Positive input | Negative/ambiguous input | Expected outcome | Scope |
| --- | --- | --- | --- | --- | --- |
| `UV-P01` Explicit texture reuse versus asymmetric markings | Enderman/Copper Golem Box/mirror and Unreal texture UV overlap | Two source-observed, semantically identical flat regions + known aligned mapping | Same geometry with unique wear/logo, or unknown face reference | `APPLY_REUSE` only when explicit shared pixel intent; else `UNIQUE/REVIEW_REQUIRED` | Modelling UV selection only |
| `TEX-P01` Material pixel language and identity | Blockbench Minecraft Style Guide; existing wood/metal/cloth recipes | Referenced wood/metal/cloth region with orientation, primary/secondary values, physical texels | Material inferred solely from part name, wrong palette or tiny grid | `APPLY_PATTERN` conditionally; else `REVIEW_REQUIRED` | Texturing treatment plan |
| `TEX-P02` True seam continuity | Substance 2D/3D neighbor docs and source cross-Cube analysis | Exact world-edge pair, reference continuity and native comparable sample set | 2D-only padding, missing/unequal samples, accidental triple edge | Advisory seam result if comparable; else `NOT_EVALUATED` | Texture Verify / validation |
| `TEX-P03` Emissive looking eyes and PBR/render distinction | Pinned Creaking/Dragon eye texture-set JSON + official material docs | Confirmed client material binding and source identity, declared target renderer | Assume glow just because filename includes 'eyes' or MERS emissive | Explicit render+PBR choice only on real binding, else `REVIEW_REQUIRED` | Texturing render/PBR |

**Control-only, already guarded rather than new K3 decisions:** `UV-C01` physical half-logical-grid mapping and `UV-C02` painted atlas source revisions/Undo. Preserve current tests; do not inflate the curated casebook with repeated invariants.

### K3 case acceptance criteria (not yet met)

Each promoted case must include: (1) one concrete decision and current source fact; (2) URL with commit/revision, precise section/path, copyright + allowed knowledge use; (3) the **actual source/section SHA-256**, not Git blob SHA mislabelled; (4) exact Bedrock/Blockbench applicability or `UNKNOWN`; (5) approved reference view/part identity or `REVIEW_REQUIRED`; (6) APPLY and negative/ambiguous abstention; (7) one caller and one test owner; (8) valid/stale/ambiguous selection fixture; (9) explicit source-only versus native/visual proof labels. A rolling docs page cannot be promoted as an exact-version-verified external snapshot until the needed version/source bytes are pinned.

**Selection should abstain** for a generic word like 'metal' if material appearance, surface orientation and reference view are not established. Matching multiple case titles or only a parent heading is not case authority. No automatic painting/UV mutation from a knowledge suggestion.

## Verification, reporting and handoff

1. **Current result:** source-file inspection, review of named regression definitions and source-specific adoption rationale; **no tests executed**, no new Runtime feature/asset. Tests linked in the two matrices are existing potential regression owners, not current successful runs.
2. **K3 next:** author a small canonical casebook under this texture domain, containing only the four pilots above with source hash/version and negative selection fixture. Reuse `mcp/lib/semantic/knowledge.ts` when source implementation is warranted and preserve no-knowledge fast path. Do not add a second registry or make a new public Gateway tool.
3. **K4 decision review:** only implement a case whose actual caller cannot already make the correct decision with current evidence; prove a negative selection case and stale-source failure before wiring into authoring. Surface patterns and alpha/PBR remain separate.
4. **K7–K9:** with actual executable environment, run targeted source proofs on exact SHA. Matching native Blockbench must later verify atlas pixels, mapped model in relevant views, signed face UV, material behavior, Undo/save/reopen and Bedrock output, then accept fidelity before measuring time/tool count.
5. **Stop condition:** K2 coverage and K3 pilot selection recorded. No Geometry resumption, UV tool registration, license-unsafe corpus import, CI workflow changes, release, or unsupported quality PASS.
