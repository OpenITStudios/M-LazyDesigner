# Authoring Knowledge — Cross-Domain Maturity and Ownership

**Scope:** Canonical *knowledge-curation method* for Geometry, Texture and Animation. Source inspection on `Local` at `beea59e7` (2026-10-31); **no asset quality, native behavior or case promotion is proved by this document**. Current work priority/HOLD is owned by [Next Action](../05-operations/next-action.md), not by this permanent contract.

## One source, one authoring system

Keep one canonical semantic owner per rule, one Reference Package for the current asset, one Codex → Gateway/Control → Runtime → Blockbench authoring workflow, and one authoritative editable `.bbmodel` output. Knowledge curation happens **outside** that workflow: no production/research router choice, per-operation admission gate, extra MCP tool, knowledge server, second registry, generic Recipe engine, or compulsory lookup before Cube/paint/keyframe operations. Never expand Engine features just because a research source exists.

## Ownership inventory

| Concern | Canonical semantic owner | Consumption/evidence, not a second policy owner |
| --- | --- | --- |
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

## Next bounded work, without feature expansion

1. Compare the actual Geometry, Texture and Animation case cohorts against these fields; note only missing, contradictory or duplicated ownership.
2. Normalize **one existing case per domain** in its original owner first, preserving IDs and actual provenance. Inspect its real consumer and negative/ambiguous behavior before generalizing.
3. Reuse focused existing tests; label unexecuted Bun/native/visual claims accurately. The [single full-asset Golden Task](../../mcp/docs/GOLDEN_TASKS.md) is `golden-full-asset-authoring`, not 16 or eight new micro-Goldens.
4. Promote no case and modify no Engine until source-level consistency and the relevant quality evidence exist. Stop corpus expansion when a new case does not materially change a decision or prevent a demonstrated failure.

**Quality before efficiency:** compare time, calls and context cost only for equal-or-better *accepted* outcomes.
