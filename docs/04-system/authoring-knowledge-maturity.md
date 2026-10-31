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

**Normal update procedure (for ChatGPT/Codex maintainers, never a required user-PC task):**

1. **Pin and classify:** read the current `Local` HEAD, then the nearest owner. Identify exactly one changed fact, rule or case. Separate `OBSERVED / INFERRED / HYPOTHETICAL / UNKNOWN`. A changing public webpage is not necessarily an applicable new rule.
2. **Deduplicate and verify:** check whether the current decision already has an owner; prefer correcting it over adding another case. Record the upstream URL, publisher, actually inspected version/hash if available, target compatibility and permissions. Never copy proprietary 3D/texture data simply because it is online.
3. **Edit only the owner:** preserve published case IDs/heading paths and required parser labels. Keep a bounded `APPLY / REJECT / UNKNOWN` boundary and positive/negative/ambiguous examples. Add `Problem signals` only for a demonstrated phrasing miss, not as a global synonym list. A policy change and its affected consumer belong in one logical commit.
4. **Review source delta:** the existing `mcp/scripts/development/build-knowledge-index.ts` generates a **read-only** SHA-256 source/section inventory. Its default inputs include current core casebooks and shared Art Direction; for other documents supply exact paths. The `--previous <file>` option compares against an earlier diagnostic index generated from the **same paths**. A generated index is neither canonical policy nor a runtime registry.
5. **Verify the affected behavior:** use the existing source/reader tests (G1 casebook, Texture/UV case reader, source-hash staleness, positive/negative/ambiguous retrieval). Use `verify:affected` in an actually capable Bun workspace, not the whole suite by ritual. Preserve `UNVERIFIED` when executable or visual proof is unavailable.
6. **Refresh the consumer correctly:** edits to docs/profiles/Art Direction require reloading the relevant AI context when needed; a remembered source ID/hash is not loaded content. **Geometry and Texture casebooks are bundled into Runtime at build time**: after changing either, its development watcher requests a rebuild, but a deployed installation still needs build/deploy/reload and client-context refresh. A GitHub commit is **not** an automatic live update.
7. **Accept only grounded outcomes:** static source integrity does not demonstrate a usable native model. Before upgrading a rule to `PROVEN_FOR_SCOPE`, check exact target version, installed Blockbench behavior, the real matched approved reference, and human art acceptance where material. Missing proof leaves the candidate unchanged.

**Case expansion boundary:** the present bounded readers accept exactly `G-P01`–`G-P08` and `UV-P01` + `TEX-P01`–`TEX-P03`. An edit to one accepted section needs no new registry or tool. **Adding G-P09 or a fifth Texture/UV case is not merely a Markdown append**; the same logical change must deliberately update the existing reader's expected inventory, selection, focused tests and consumer when the new case distinguishes a source-grounded decision gap. Unknown extra Geometry headings are rejected rather than silently ignored. Animation case coverage is advisory and has no equivalent case reader yet.

**Maintainer commands when Bun is actually available (from `mcp/`):** `bun run generate:knowledge-index` for a read-only snapshot; `bun run generate:knowledge-index --previous <prior-index.json>` for a comparable source revision delta; `bun run verify:affected -- <changed-path> [...]` for the affected verification plan. Do not hand-edit a generated manifest or require the user to install tooling for ChatGPT-owned source work.

**Rollback and stale context:** Git commits retain change history. Old explicit knowledge links are intentionally invalidated when source/section bytes change; re-ground the affected decision rather than silently reverting to obsolete advice or retrying uncertain native mutations. There is no automatic external-source ingestion or model-weight learning.

## Next bounded work, without feature expansion

1. Compare the actual Geometry, Texture and Animation case cohorts against these fields; note only missing, contradictory or duplicated ownership.
2. Normalize **one existing case per domain** in its original owner first, preserving IDs and actual provenance. Inspect its real consumer and negative/ambiguous behavior before generalizing.
3. Reuse focused existing tests; label unexecuted Bun/native/visual claims accurately. The [single full-asset Golden Task](../../mcp/docs/GOLDEN_TASKS.md) is `golden-full-asset-authoring`, not 16 or eight new micro-Goldens.
4. Promote no case and modify no Engine until source-level consistency and the relevant quality evidence exist. Stop corpus expansion when a new case does not materially change a decision or prevent a demonstrated failure.

**Quality before efficiency:** compare time, calls and context cost only for equal-or-better *accepted* outcomes.
