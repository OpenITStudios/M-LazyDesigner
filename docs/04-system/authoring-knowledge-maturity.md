# Authoring Knowledge — Cross-Domain Maturity and Ownership

**Scope:** Long-lived, cross-domain Knowledge curation and ownership for Geometry, Texture and Animation. This contract is not a runtime source, a training-data pipeline, a proof of native/visual quality or a task-status ledger. Current exact-SHA proof, active priorities and engine HOLD are owned by [Next Action](../05-operations/next-action.md).

## One source, one authoring system

Keep one canonical semantic owner per rule, one Reference Package for the current asset, one Codex → Gateway/Control → Runtime → Blockbench authoring workflow, and one authoritative editable `.bbmodel` output. Knowledge curation happens **outside** that workflow: no production/research router choice, per-operation admission gate, extra MCP tool, knowledge server, second registry, generic Recipe engine, or compulsory lookup before Cube/paint/keyframe operations. Never expand Engine features just because a research source exists.

## Ownership inventory

| Concern | Canonical semantic owner | Consumption/evidence, not a second policy owner |
| --- | --- | --- |
| Cross-domain 3D voxel visual-family grammar, not asset approval | [Reference Art Direction](../02-reference/art-direction.md) | Current approved, decision-changing style facts only; projected into existing Geometry/Texture/Animation reference handoffs, not another Runtime source |
| Standalone Pixel Art Style Lock and pixel-art-specific grammar | [Pixel Art Style Lock](../02-reference/pixel-art/style-lock.md) | Selected approved appearance facts may inform Texture without becoming Geometry or Animation instructions |
| Universal Geometry; Geometry-vs-Texture form; hierarchy/pivot; UV Layout and UV PASS | [`modelling/standard.md`](../03-authoring/modelling/standard.md) | One Control-selected [`modelling/profiles/`](../03-authoring/modelling/profiles/) when applicable; Modelling Skill; `mcp/lib/geometry/`, `uv/`, `authoringRecipe/` |
| Profile-specific modelling decisions | Exactly one matching [`modelling/profiles/`](../03-authoring/modelling/profiles/) file | Reference and confirmed dimensions outrank profile advice |
| Atlas pixels, colour/material language, alpha/PBR/render and Texture Verify | [`texture/standard.md`](../03-authoring/texture/standard.md), with topic ownership in its `material.md`, `render-profile.md`, `surface-pattern.md` | Texturing Skill, `mcp/lib/texture/` |
| Motion/clip, controller preview, timing, contact and playback | [`animation/standard.md`](../03-authoring/animation/standard.md) | Animation Skill, `mcp/lib/animation/` and native execution owners |
| Stage dependencies, approval, evidence freshness and handoff | [`authoring-stage-context.md`](authoring-stage-context.md) and [`workflow.md`](../03-authoring/workflow.md) within their existing scopes | Gateway Control projects current stage; no second planner |
| Curated examples and research sources | Each domain's `decision-cases.md` where present, `research-sources.md`, curation/coverage notes | Case cards are conditional advice and references, not model presets or automatically binding policy |
| Source/section identities and bounded Markdown selection | `mcp/lib/semantic/knowledge.ts` | Recipe/Texture readers reuse the index. A source hash proves identity, not maturity |
| Current asset truth | Current user intent, approved Reference Package, bound native Blockbench/Workspace state | Never infer source-image evidence or approval from filenames, test IDs or source hashes |

Docs own semantic meaning; Skills and `mcp/prompts/bedrock_entity_workflow.md` may summarize **how** to operate but must not silently supersede Docs. `mcp/lib/texture/vanillaKnowledge.ts`, `surfacePattern.ts`, Recipe contracts and other code carry executable data/guards, not competing artistic authority. A disagreement requires a focused correction at the canonical semantic owner **and** the affected consumer, not a copied rule.

## Audited current cohort — not promoted

| Domain | Bounded candidate inventory | Already connected | Actual acceptance still missing |
| --- | --- | --- | --- |
| Geometry | 8 source-grounded `G-P01`–`G-P08` in [`modelling/decision-cases.md`](../03-authoring/modelling/decision-cases.md) | Optional Recipe knowledge suggestions and read-only proposals | Executed owning regression, installed native checks, reference-paired visual quality |
| Texture / UV | `UV-P01`, `TEX-P01`–`TEX-P03` in [`texture/decision-cases.md`](../03-authoring/texture/decision-cases.md) | Read-only resource and selected diagnostics hints | Executed source tests, native face/UV/atlas checks and mapped visual quality |
| Animation | 30 F-families, 4 paired K2 examples, 16 A-scenarios, 145 research pointers in [`animation/knowledge-coverage.md`](../03-authoring/animation/knowledge-coverage.md) and `research-sources.md` | Selected specialist doc guidance and native motion capabilities; **no analogous case reader established** | Executed tests, native playback/round-trip, reference-paired pose/contact/loop quality |

These numbers describe **coverage**, not validated modelling intelligence. Domain standards/Skills remain the existing operational baseline; their existence alone does not establish superior craft quality.

## Maturity and evidence (development bookkeeping, not runtime routing)

- **RESEARCH:** source discovery or untested transfer hypothesis; not new normative production advice.
- **CANDIDATE:** one decision with explicit applicability, rejection/ambiguity, source provenance, bounded existing consumer, and falsifiable evidence requirements. `SOURCE-GROUNDED` or a matching SHA is still only candidate evidence.
- **PROVEN_FOR_SCOPE:** a claim may be adopted only for the exact behavior and source revision supported by rights/version compatibility, distinct positive/negative/ambiguous cases, successful relevant executable checks, native behavior where material, and actual reference-matched visual/human review for aesthetic fidelity. Record missing dimensions as `UNVERIFIED`; technical validity never automatically becomes visual PASS or user approval.

Do not make these labels a new authoring stage, `status` field, alternate runtime mode or mandatory runtime gate. Promotion means *reviewing and updating the existing canonical authoring rule and its real consumers*, with the relevant tests; it is not achieved by changing a word in a markdown label. Unready knowledge may be researched but must not silently become an authoritative build instruction.

## Canonical case-card contract

Every reusable card must identify: **stable ID**, domain and exact question; **apply** and **reject/defer** conditions; reference evidence required; existing rule owner; exact affected technical consumer; positive/negative/ambiguous example with hypothetical/observed labels; risks and consequences; source URL + pinned version/hash + rights and compatibility; verification owner, actual executed proof and explicit unverified claims; maturity/claim scope. Use one Markdown section in the existing domain case owner, indexed through `mcp/lib/semantic/knowledge.ts`; no second hand-edited JSON copy. Geometry adds views/parts/pivots, Texture adds face/UV/material/atlas, and Animation adds bone/clip/time/contact/playback detail.

An unknown or incompatible requirement blocks **only the dependent decision**. Current approved user reference and native state outrank research examples. Candidate descriptions never authorize automated mutations.

## Active research-first method — 2026-11-01 user decision

**Research remains open: no incremental generator testing.** This supersedes the earlier pattern of collecting a handful of examples and immediately requesting tests. **Golden Assets/Golden Tasks are rejected for this Knowledge initiative**: never use, propose or schedule them as a test, a readiness gate, or the default step after research. Do not request source-by-source or small-batch Bun/native/visual tests. Keep the existing production safety guards intact for unrelated, separately authorized engineering work.

**Work in substantial research cohorts, not one citation → one test:**

1. **Broad discovery.** Search artist portfolios, professional voxel creators, curated galleries, model catalogs and suitable 3D/animation demonstrations across humanoids, creatures, machines, furniture/props, vehicles and other relevant families. Select individual visually excellent works, not entire marketplaces. Record low-quality counterexamples where informative. Neither popularity, price, ornament quantity nor render glow establishes craftsmanship.
2. **Deep primary artwork analysis.** Inspect original multi-view images where available; identify silhouette, mass hierarchy, characteristic geometry, negative space, intentional surface clusters, value/color ramps, material contrast, scale, visual rest and where details belong. Inspect UV/source pixels and genuine motion only if legitimately accessible; otherwise record UNKNOWN, not fabricated precision.
3. **Cross-work synthesis.** Compare multiple creators, styles, object classes and contrasting examples. Separate broadly reusable artist decisions from style-specific exceptions. Never impose gritty fantasy complexity onto clean furniture or simplify creatures merely to match Vanilla.
4. **Knowledge distribution.** Write sourced observations, counterexamples, uncertainties, license/use boundaries and hypotheses into the current three `research-sources.md` owners for Geometry, Texture and Animation. Research notes are not automatically normative standards, Skill changes, new casebook sections, a dataset or Runtime behavior.
5. **Research consolidation.** Only when a meaningful corpus covers the relevant style/object families and important visual questions with independent examples, contrasts, reasons to reject poor work, and clearly stated remaining gaps, prepare a joint synthesis. There is no arbitrary item quota or claim of exhaustive coverage of the internet. Additional discovery should diminish in decision-changing value before the phase is considered mature.

**Evidence/efficiency:** during research verify source authenticity, actual inspection depth, rights, duplicates and what was visibly observed. These are editorial checks, **not execution tests**. Save coherent research batches instead of repeatedly asking for generation or validation. Bun, native model generation, animation playback and visual improvement claims stay UNVERIFIED where not actually executed.

**Transition is separate:** after the user has reviewed the consolidated research, any move to production Knowledge integration and any later evaluation method requires a new explicit decision. Never silently reintroduce Golden Assets as that evaluation method.

## Research-derived Craft Knowledge — source index v0.5 (2026-11-01)

The user authorized continuing wide research **while preserving actual learned artistic distinctions**. Successive research syntheses are preserved in the **three existing domain source owners**, not in a fourth database, new active standard, Skill, Recipe, Runtime registry or generated asset:

| Domain notebook | Research knowledge identifiers | What is preserved |
| --- | --- | --- |
| [Geometry research sources](../03-authoring/modelling/research-sources.md) — “Working Art-Craft Knowledge v0.1–v0.5” | GK-01–GK-12 | Primary silhouette identity; negative space; shape dialect; asset-family variation; source-image versus topology limits; articulation-aware grouping; formation-informed volume; intentional reference interpretation; pose-exposed form; bounded late detail geometry; volumetric/plane/anchor source distinctions; title versus observed morphology, and original Generic rig segmentation |
| [Texture/UV research sources](../03-authoring/texture/research-sources.md) — “Working Art-Craft Knowledge v0.1–v0.5” | TK-01–TK-15 | Intentional pixel clusters and ramps; material-specific grammar; visual-family differences; pack continuity; render/paint distinction; face-aware shading, material origins, meaningful UV/texel allocation, shade-count exceptions; exposed hidden faces, pixel-edge anti-aliasing, tileability versus atlas identity; source-grounded appearance carrier choice and independent UV/rig ownership; actual embedded 32x32 bitmap, original 594 face mappings / 48 distinct UV arrays, and artwork-versus-format rights caveats |
| [Animation research sources](../03-authoring/animation/research-sources.md) — “Working Art-Craft Knowledge v0.1–v0.5” | AK-01–AK-17 | Causal poses, timing/weight, locomotion and attachments, observability; major-pose blocking, stance versus swing, secondary phase lag, and rig/interpolation format boundaries; temporal readability, equipment-dependent performance, loop-seam continuity; source-inspected mode-specific poses and signature-part action; sustained cycle versus transition clips and explicit directional gaits |


### First source-paired cross-domain dossiers — research-only

These dossiers are **links to the existing domain research notebooks**, not a separate registry, new work stage or additional Runtime source. Source inspection is not installed Blockbench/video acceptance.

| Research dossier | What was directly inspected | Cross-domain learned relationship | Unknown / exclusions |
| --- | --- | --- | --- |
| CX-01 [Mojang artist Peter Sheff — Goblin Chef](https://learn.microsoft.com/en-us/minecraft/creator/documents/makerseriesmakingthegoblinchef?view=minecraft-bedrock-stable) | FIRST-PARTY written modelling/texturing/animation *process*, three sections; embedded videos and original assets **not played/read** | Large shapes → small 3D detail may continue in texture pass → paint/eraser/shadow treatments → bone pivots, personality-specific rotational movement and overlap. GK-10, TK-14, earlier AK-01/07 | Exact source Cubes/UV/frames/looks and completeness of video unreproduced; NOT a production recipe |
| CX-02 Mojang [Allay geometry](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/allay.geo.json), [animation](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/animations/allay.animation.json), [client entity](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/entity/allay.entity.json) | PINNED original source JSON: 3D cubes, two thin separate wing bones sharing one UV coordinate, nonrendered rightItem attachment, idle/fly and distinct held-item stances | Shape carrier, atlas-pixel reuse and specific action/attachment poses are separate semantic owners that compose into one creature. GK-11, TK-15, AK-14 | Raw PNG/renderer, motion playback and licensed copying NOT established; small Vanilla mob is not the premium fantasy style target |
| CX-03 Mojang [Warden design interview](https://www.minecraft.net/en-us/article/meet-warden), [geometry](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/models/entity/warden.geo.json), [animation](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/resource_pack/animations/warden.animation.json) | FIRST-PARTY concept/history + PINNED native JSON of ribs/tendrils, UV planes and shiver/roar/attack/sonic/raise actions | Identity-bearing special geometry can receive purpose-specific transforms and motion cues, rather than universal wiggling of all attachments. GK-11, TK-15, AK-15 | Source JSON confirms authored keys but not human-perceived motion, bitmap contents or approved appearance; gameplay behavior stays outside LazyDesigner scope |

**Rights:** The pinned Mojang bedrock-samples [LICENSE.md](https://github.com/Mojang/bedrock-samples/blob/15701fa9c13923f12662984c32c124327e40e3d3/LICENSE.md) invokes Minecraft EULA. Original asset files are for cited factual study only: no copying into LazyDesigner, no bulk training set, no external image/model redistribution. The user's approved premium stylized voxel art remains the actual visual authority, while official Minecraft data grounds only format/representation examples.


### Further source-linked cross-domain dossiers — research-only v0.5

This continues the existing CX-01–CX-03 editorial table; it is not a new runtime registry or compulsory source-loading route. Every source remains subject to actual content, format, version and rights constraints.

| Dossier | Material inspected | What the three domain owners learn together | Limitation |
| --- | --- | --- | --- |
| CX-04 [Hoodgail / Desert Dog original bbmodel](https://github.com/Hoodgail/three-blockbench/blob/9f7bfa2152c5496ee879b53fa65badefb14e9a61/examples/models/desert_dog.bbmodel) | **SOURCE-INSPECTED** actual Blockbench 5.0 Generic JSON, 99 cubes, 27 anatomy groups, 32x32 embedded atlas PNG opened for source study; 594 face records, 48 distinct serialized UV arrays, 23 clips / 16 loops / 7 once, 5,859 keyframe records | Geometry segmentation and semantic hierarchy are separate from how one atlas distributes paint; cycles, directional moves and transitional actions share the same project anatomy. GK-05/GK-06, TK-09/TK-15, AK-16/AK-17 | Source art's ownership/license provenance, actual 3D appearance, animated playback and Bedrock export remain UNKNOWN. Software MIT ≠ blanket clearance of creative sample for copying/training; no asset data imported |
| CX-05 [Eann Rodriguez — Phoenix Guardian](https://blockbenchworkshop.com/model/eanncrod/phoenix-guardian), [Visage Of Malice](https://blockbenchworkshop.com/model/eanncrod/visage-of-malice) | Original creator pages, metadata, actual static thumbnails; one describes a "phoenix" as a robotic golem, another shows antlers but dark-on-black visibility | Work names cannot substitute for shape evidence; surface presentation affects confidence; clips and atlas sizes cannot demonstrate quality. GK-12, TK-06/TK-09, AK-05 | Public download returned HTTP 401; model, UV, source texture and motion were NOT inspected. CC BY is uploader-stated, not independently rights-audited. Not declared premium mastery |
| CX-06 [Swuei — hand-painted functional props](https://swuei.github.io/Portfolio/index.html), [Quest Board original image](https://swuei.github.io/Portfolio/pictures/quest_board_sr.png) | Creator's first-person hand-paint/workflow statement and original still image: red roof planes, pale pinned pages, foliage and visible wooden frame; portfolio mentions 16x projects and a 32x market stall | A readable prop family can achieve identity through few major forms plus localized high-contrast painting without copying boss-scale intricacy; supports visual-family-specific surface judgment. GK-03, TK-03/TK-09 | Specific downloadable model/UV/animation files not inspected. Artist's broad free-use statement is not independently verified for each individual pack or AI training context |

**Cross-dossier selection:** Desert Dog = high technical inspectability, artistic quality UNVERIFIED. Phoenix/Visage = artist preview and metadata, raw file unavailable, premium status not established. Quest Board = stronger visible prop readability, original UV/motion unavailable. Do not rank source accessibility, marketplace clip count or title synonym as a proxy for visual fidelity. The current user's approved premium fantasy reference remains the artistic authority, not these samples.

**Maturity:** RESEARCH SYNTHESIS / conditional artist hypotheses. PRIMARY_GUIDE or PRIMARY_TEACHING means a published source was genuinely read; visually inferred transfers are never native/source-model verified. Third-party art rights remain source-specific and do not authorize copying or AI training. No generated model, original atlas, live clip, human acceptance, runtime behavior or improvement has been established. Preserve IDs for research continuity, but these are **not** the machine-indexed G-P/TEX-P/A-case IDs and must not be added to casebook selection until a separate user decision. During the current research phase, there is no Golden Asset, generator regression/test request, new engine, mandatory retrieval or production-rule promotion.

**Editorial continuation:** Continue finding independent original artist references; refine these domain notebooks with better counterexamples and actual evidence as access permits. Consolidate across meaningful research cohorts, not one source per test. At the later research review, retain only materially distinct knowledge and explicitly mark any unresolved uncertainty rather than silently inventing data.

## Routine Knowledge updates — single source, explicit adoption

**Goal:** allow frequent additions and corrections without a second database, autonomous web harvesting, new MCP tool, mandatory per-operation Knowledge lookup or a parallel authoring path. A source URL, curated case and validated production rule are **different proof claims**.

| Change | Canonical edit owner | What changes for consumers |
| --- | --- | --- |
| New research or changed external publication | Domain `research-sources.md` | Discovery only. Inspect publication date/version, precise upstream revision, Minecraft/Blockbench compatibility and item-specific text/code/image/model rights before extracting an observed claim. Nothing auto-promotes. |
| Cross-domain 3D voxel style | [Art Direction](../02-reference/art-direction.md) | Update only established family grammar supported by user or approved references. Reload affected stage context; style does not override asset-specific evidence. |
| Universal modelling, texturing or motion principle | The matching domain `standard.md` or topic owner | Correct that one rule; update its Skill or technical consumer only when the actual operational behavior changes. |
| Profile-dependent structure | Exactly one matching `modelling/profiles/*.md` | Load the selected profile; do not copy all profiles or manufacture presets. |
| Case, exception, or natural-language problem signal | Existing domain `decision-cases.md` (Animation uses its current case owner) | Preserve stable IDs, heading and parsed field labels. New words select *candidates*, not source-image claims or permission to mutate. |
| Successful visual/native revision | Owned asset/reference evidence, plus the canonical case/standard only if generalizable | Retain actual before/after, comparable view/clip, current SHA/asset revision and reviewer conclusion; only matching proof permits promotion. |

**Later adoption/update procedure (inactive for source-only research, and only after separate authorization; never a required user-PC task):**

1. **Pin and classify:** read the current `Local` HEAD, then the nearest owner. Identify exactly one changed fact, rule or case. Separate `OBSERVED / INFERRED / HYPOTHETICAL / UNKNOWN`. A changing public webpage is not necessarily an applicable new rule.
2. **Deduplicate and verify:** check whether the current decision already has an owner; prefer correcting it over adding another case. Record the upstream URL, publisher, actually inspected version/hash if available, target compatibility and permissions. Never copy proprietary 3D/texture data simply because it is online.
3. **Edit only the owner:** preserve published case IDs/heading paths and required parser labels. Keep a bounded `APPLY / REJECT / UNKNOWN` boundary and positive/negative/ambiguous examples. Add `Problem signals` only for a demonstrated phrasing miss, not as a global synonym list. A policy change and its affected consumer belong in one logical commit.
4. **Review source delta:** the existing `mcp/scripts/development/build-knowledge-index.ts` generates a **read-only** SHA-256 source/section inventory. Its default inputs include current core casebooks and shared Art Direction; for other documents supply exact paths. The `--previous <file>` option compares against an earlier diagnostic index generated from the **same paths**. A generated index is neither canonical policy nor a runtime registry.
5. **Verify only separately authorized behavior changes:** where an actual casebook consumer or code update is approved, use relevant existing checks. Pure research-source additions do NOT trigger `verify:affected`, Bun/native evaluation, model generation or any Golden task. Preserve `UNVERIFIED` when executable or visual proof is unavailable.
6. **Refresh the consumer correctly:** edits to docs/profiles/Art Direction require reloading the relevant AI context when needed; a remembered source ID/hash is not loaded content. **Geometry and Texture casebooks are bundled into Runtime at build time**: after changing either, its development watcher requests a rebuild, but a deployed installation still needs build/deploy/reload and client-context refresh. A GitHub commit is **not** an automatic live update.
7. **Accept only grounded outcomes:** static source integrity does not demonstrate a usable native model. Before upgrading a rule to `PROVEN_FOR_SCOPE`, check exact target version, installed Blockbench behavior, the real matched approved reference, and human art acceptance where material. Missing proof leaves the candidate unchanged.

**Case expansion boundary:** the present bounded readers accept exactly `G-P01`–`G-P08` and `UV-P01` + `TEX-P01`–`TEX-P03`. An edit to one accepted section needs no new registry or tool. **Adding G-P09 or a fifth Texture/UV case is not merely a Markdown append**; the same logical change must deliberately update the existing reader's expected inventory, selection, focused tests and consumer when the new case distinguishes a source-grounded decision gap. Unknown extra Geometry headings are rejected rather than silently ignored. Animation case coverage is advisory and has no equivalent case reader yet.

**Maintainer commands when Bun is actually available (from `mcp/`):** `bun run generate:knowledge-index` for a read-only snapshot; `bun run generate:knowledge-index --previous <prior-index.json>` for a comparable source revision delta; `bun run verify:affected -- <changed-path> [...]` for the affected verification plan. Do not hand-edit a generated manifest or require the user to install tooling for ChatGPT-owned source work.

**Rollback and stale context:** Git commits retain change history. Old explicit knowledge links are intentionally invalidated when source/section bytes change; re-ground the affected decision rather than silently reverting to obsolete advice or retrying uncertain native mutations. There is no automatic external-source ingestion or model-weight learning.

## Current next — deepen and consolidate research (no implementation)

1. Expand discovery to multiple skilled creators and individual quality-selected works beyond the first Bepoo/marketplace examples.
2. Examine original available views, material/pixel techniques and genuine motion evidence deeply, including negative/ambiguous comparisons and style-specific exceptions.
3. Synthesize findings across existing Geometry, Texture and Animation research owners, deduplicate observations and document open questions.
4. Present one substantial cross-domain research assessment before any Knowledge adoption. **No Golden Assets, no per-reference tests, no engine development and no premature rule promotion.** Future evaluation is not automatically scheduled and requires a separately agreed non-Golden method.

**Research efficiency:** prioritize depth, useful comparison and fewer fragmented handoffs over a quick transition to tests.
