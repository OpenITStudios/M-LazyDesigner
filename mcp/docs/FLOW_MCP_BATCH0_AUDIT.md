# Flow MCP — Batch 0: Quality / Token-Efficiency Audit

Status: INITIAL SOURCE AUDIT; NOT LIVE VALIDATED
Date: 2026-10-20
Branch: Local
Baseline commit: 9c95bd842e310139a71db6b2d2ef25c81e14eb87
Scope: Geometry, UV/Texturing, Animation, cross-domain correction and cost-to-accepted-result.

## Decision
Improve the existing three-domain workflow; do not create a second quality engine, registry, routing layer, score or Gateway API. Source contracts and synthetic fixture PASS do not prove native Blockbench quality. Do not run Actions, publish releases, or modify main.

## Source-verified ownership map
- Canonical sequence: docs/03-authoring/workflow.md; Geometry -> Geometry Verify -> authorized approval/verification -> UV -> Texturing -> Texture Verify -> Animation readiness -> Animation -> Finalization. Geometry owns UV mapping; Texture owns mapped pixels; Animation owns motion, not structural rig mutation.
- Gateway capability discovery and branch semantics: mcp/gateway/capabilities/catalog.ts and manifest.ts. Tool exposure must be proven against the generated Runtime catalog, not inferred from library existence.
- Capability source owners: mcp/gateway/development/sourceOwners/geometry.ts and animation.ts. Geometry manage_cubes uses mcp/server/tools/geometry/cubes.ts; bone_rigging uses mcp/server/tools/animation/rigging.ts; animation manage_keyframes/inspection/controllers use tools/animation. Source-owner mapping is a guide, not a live registration proof.
- Important known gap: manage_uv_layout is explicitly FUTURE/UNREGISTERED in geometry source owners; mcp/lib/orchestration/evidencePlan.ts currently requests this name for UV evidence. Reconcile planner outputs with available native tool set before shipping UV-flow claims. Existing create_texture(type=template) native generator is not equivalent to UV PASS.
- mcp/lib/authoring/ owns authored state; authoringRecipe/ owns recipes/compilation; orchestration/ owns sequencing/evidence plans. Keep dependencies one-way.
- mcp/lib/orchestration/verificationPlan.ts scopes changed Geometry, UV, Rig, Animation, Texture; evidencePlan.ts already maps scope + risk to focused evidence. Expand/repair those contracts rather than adding a competing planner.
- mcp/gateway/control/contextProjection.ts already projects domain-specific context; mcp/lib/authoringRecipe/efficiency.ts measures bytes/static operation proxies, explicitly NOT AI-token use or wall-clock.
- mcp/docs/QUALITY_BENCHMARK.md and mcp/tests/fixtures/quality-benchmark-cases.json define six synthetic profiles, categorical PASS/FAIL/UNVERIFIED, no aggregate score, and quality-first cost-to-accepted-result.

## Gap register (source audit, pending runtime verification)
| ID | Priority | Domain | Observed evidence | Next bounded verification |
|---|---|---|---|---|
| F0-01 | P0 | UV capability | manage_uv_layout source owner explicitly says unregistered; evidencePlan requests it | Compare generated runtime catalog and verification executor; ensure fallback uses registered native operations and never invents UV PASS |
| F0-02 | P0 | All | Quality benchmark fixtures are synthetic only | Execute six fixed-source approved-asset benchmarks with actual matched references; retain captured view/atlas/playback and verdicts |
| F0-03 | P0 | Token efficiency | Existing recipe metrics are serialized bytes/static calls only | Add opt-in client/provider usage collection outside core quality verdict; record actual input/output/cache tokens and model/version, otherwise UNKNOWN |
| F0-04 | P1 | Geometry | Geometry quality and contact modules exist; native aesthetic performance unverified | Test silhouette, proportions, attachments, negative spaces, curves in cross-view comparison |
| F0-05 | P1 | Texture | Texture treatment, seams, UV, compute modules exist; fidelity unverified | Test surface mapping, palette/material regions, identity markings and actual atlas seams |
| F0-06 | P1 | Animation | Motion/contact/controller modules exist; playback acceptance unverified | Test pose fidelity, joint gaps, weight shift, foot sliding, continuity in native playback |
| F0-07 | P1 | Correction | Delta verification, correctionLoop, evidence freshness exist | Verify minimal invalidation and restore/rollback on one geometry->texture and geometry->animation correction |
| F0-08 | P1 | Live acceptance | next-action.md records LD-Q01..Q04 unresolved | Run separately scoped disposable native Blockbench acceptance only with matching installed build and authority |

## Token / tool-cost execution policy (not new runtime gate)
1. Treat reference facts and approved constraints as immutable inputs by revision fingerprint; hold only one active semantic stage/context projection in AI context.
2. Use an explicit intent + compact parameter recipe. Keep repeated geometry as instances; compile and mutate coherent batches. No per-Cube/pixel/keyframe dialog or confirmation.
3. Resolve known capabilities by stable id; search/describe only if unknown, ambiguous, stale, or schema changed. Reuse receipt and revision hashes instead of re-reading full project.
4. Verify only evidence invalidated by change; one coherent multi-view capture for material Geometry changes, focused atlas region for Texture, relevant poses/times for Animation. Do not crop away defects or call static diagnostics visual PASS.
5. Correct first material owning cause; do not use Texture to hide Geometry flaws or Animation to compensate for broken pivots. After two same-cause unsuccessful attempts without new evidence, BLOCK instead of token-burning retries.
6. Keep typed bounded result summaries: status, changed scopes, root cause, evidence links/hashes, critical defects, next legal stage. Full verbose payload only on explicit diagnostic request.
7. Compare accepted-result quality before optimizing usage. No lower-quality 'saving' passes; no fabricated empirical token savings.

## Measurable baseline schema (local/native runs only)
For each of the six canonical profiles record:
- approved_reference_fingerprint, artifact_revision, installed_build, platform, Blockbench version, model/provider version;
- input_tokens, output_tokens, cached_input_tokens when supplied by provider; otherwise UNMEASURED, never estimate from bytes;
- capability_search_calls, describe_calls, total_invocations, redundant_reads, capture_batches, correction_rounds, native_wall_clock_ms when measured;
- Geometry/UV/Texture/Animation applicable verdicts PASS/FAIL/UNVERIFIED and per-view/atlas/playback evidence; critical_defects; accepted_by and acceptance_time;
- compare baseline/candidate only if reference and acceptance rubric are identical; report quality and actual token cost separately, never aggregate into one score.

## Implementation batches (ordered by real dependency, with bounded parallel audit)
B0-A: Reconcile catalog -> Gateway dispatch -> Runtime tool -> Blockbench adapter -> receipt for representative geometry, UV, texture, animation capabilities. Output a capability trace table with REGISTERED / SOURCE_ONLY / FUTURE / UNVERIFIED.
B0-B: Consolidate one benchmark runbook for six existing profiles; do NOT fork new fixtures or add micro-tests.
B1: Geometry cross-view/silhouette, semantic mass, rig/negative-space corrections; reuse quality.ts/modelQuality.ts and recipes.
B2: UV native capability reconciliation first; then semantic atlas and material fidelity on verified geometry.
B3: Native animation poses/contact/continuity once rig/UV prerequisites pass.
B4: Scoped cross-domain correction and restore, using existing orchestration.
B5: Source+native comparative quality and cost evidence; optimize only measured hotspots.

## Definition of done for Batch 0
- Every representative native capability traced to actual registry/adapter (not merely source-owner declaration).
- Explicit status for UV evidence route; no request to an unavailable tool at runtime.
- Six-profile benchmark instructions and evidence schema fixed, with UNVERIFIED used for unavailable live evidence.
- No new authorization gate, duplicate engine, duplicate progress ledger, broad test explosion or synthetic 'token saving' claim.
- Any production changes evaluated with existing consolidated domain/contract tests and optional native acceptance.

## Audit boundaries
This initial audit inspected repository source and documented policy via GitHub only. No local/installed Blockbench execution, provider token telemetry or live capture was performed. Exact findings above are not proof of live capability registration or authoring quality. Follow existing docs/05-operations/next-action.md for prior dependency closeout and live acceptance limits.
