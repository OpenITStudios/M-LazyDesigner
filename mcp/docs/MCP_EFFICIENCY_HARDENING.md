# MCP Efficiency Hardening

Branch: `Local`

## Objective

Reduce Cost to Accepted Result without capability loss, weaker verification, hidden retries, or a larger public Gateway surface.

This work treats efficiency as four measurable dimensions:

1. tool calls to accepted result;
2. AI-visible payload bytes;
3. mutation/inspection/verification call mix;
4. preserved quality and recovery semantics.

## Current High-End Baseline

Already implemented and retained:

- coherent Geometry creation/update through `manage_cubes`;
- coherent Animation keyframe work through the existing batch timeline route;
- exact Texture region work through `paint_texture_transaction`;
- receipt-only continuation when a mutation returns complete authoritative state;
- verified particle writes continue from their transactional write receipt;
- verified render-profile writes continue from compact mutation identity + write receipts;
- element removal continues from consistent deleted-root/count/animation-impact receipts;
- bone rigging continues from complete final bone/controller/deletion receipts;
- bounded search + focused inspection when identity is unknown;
- change-scoped freshness/invalidation;
- no automatic retry after uncertain mutation outcome.

No fifth Gateway tool is introduced.

## Measurement Gate

Canonical command:

```bash
bun run measure:mcp-efficiency
```

The report records, per representative workflow:

```text
baseline_calls
optimized_calls
saved_calls
call_reduction_percent
baseline_payload_bytes
optimized_payload_bytes
saved_payload_bytes
payload_reduction_percent
baseline_mutation_calls
optimized_mutation_calls
baseline_inspection_calls
optimized_inspection_calls
baseline_verification_calls
optimized_verification_calls
quality_preserved
```

The command is part of `verify:mcp`.

These values are deterministic architecture proxies. They are not live Codex token counts, wall-clock latency, or native Blockbench proof.

Per-workflow call and payload deltas are signed. A complete receipt may intentionally trade a few payload bytes for removal of an entire confirmation call; do not require every workflow to improve every metric independently. Reject a change when it worsens both call count and payload without a quality/recovery benefit, and keep aggregate cost moving down.

The scorecard also records the current Runtime tool count and JSON-schema/description bytes for reused hot-path primitives. Existing-path optimization should normally require zero new public capabilities; proposed schema growth must be weighed against recurring dynamic savings before implementation.

For a proposed helper, use the static-vs-dynamic break-even rule: added schema bytes / recurring dynamic bytes saved per use = minimum uses needed to pay back the static cost. If expected use within a session does not reach that break-even point, do not add the helper.

## Implementation Phases

### Phase A — Measurement contract — IMPLEMENTED

- shared `efficiencyScorecard` owner;
- representative Geometry, Animation, Texture, receipt, and discovery workflows;
- quality-preservation checks;
- regression floor in Runtime tests;
- opportunity register separating implemented optimization from unproven ideas.

### Phase B — Existing primitive saturation

Before creating a helper, confirm the current semantic capability cannot already express the work coherently.

Priority order:

1. Geometry coherent cohorts;
2. Animation coherent cohorts;
3. focused inspection / receipt continuation;
4. Texture region transactions;
5. rig/locator/IK repeated cohorts.

A new helper is rejected if existing batch/transaction semantics can express the same intent with equivalent safety.

### Phase C — Rig / Locator cohort evidence

Current state: `evidence_required`.

Do not widen `manage_locator`, `manage_null_object`, or `bone_rigging` yet.

Promote a cohort transaction only when real workflow evidence shows repeated same-owner mutations materially dominate cost and all of these hold:

- intermediate results do not change the next decision;
- one Undo/rollback unit is semantically correct;
- identities can be preflighted before mutation;
- result can return bounded authoritative continuation state;
- schema growth is smaller than the recurring context/call cost it removes.

### Phase D — Inspection / verification precision

Continue replacing broad reassurance reads with:

```text
complete receipt
or
focused target read
or
bounded visual evidence
```

Never remove visual verification when it changes acceptance judgement.

### Phase E — Native Blockbench acceleration

Use stable native APIs where available. Private/internal Blockbench modules are not copied into LazyDesigner merely for lower call counts.

`RenderTargetSnapshot` remains blocked until a stable plugin-facing boundary exists.


## Texture Efficiency Closure — REMOTE_GITHUB

Implemented without adding a public tool:

- `list_textures` defaults to inventory-only; bounded diagnostics are opt-in and scoped with `diagnostic_scope=uv|coverage|seam|pbr|full`.
- coverage, seam, and PBR diagnostics share a request-local containment-aware pixel-read context; cache state never survives the MCP invocation.
- `diagnostic_io` exposes actual request-local read calls, cache hits, pixels read, bytes read, and cached-region count for measurable full-diagnostic cost.
- deterministic texture targeting uses `resolvePaintTexture` and does not change editor selection; native Painter activation occurs only when native semantics are required.
- exact-pixel `paint_with_brush` bypasses Brush/slider/ColorPanel setup and selection mutation.
- `paint_texture_transaction` keeps full before/after revision proof but writes only the bounded dirty region to the canvas.
- transaction evidence reuses the verified dirty-region buffer; no third full-atlas read is performed for the affected-region PNG.
- `texture_layer_management` resolves an explicit `layer_id` inside the target texture instead of relying on global `TextureLayer.selected`.
- layer Undo is action-scoped: metadata mutations snapshot layer metadata only, ordering changes avoid bitmap snapshots, and pixel-destructive layer operations retain texture-level bitmap Undo.
- layer rename preserves Texture visual freshness and avoids a full texture recomposite/PNG serialization.
- layer flattening is native-only and fails closed when `texture.flatten()` is unavailable; the removed manual fallback could not preserve all native blend/alpha-mask semantics.

Deliberately deferred until evidence justifies the added complexity:

- persistent full-atlas revision ledgers/caches across calls — requires LIVE_BLOCKBENCH invalidation proof for manual edits, Undo/Redo, layers, reloads, and external changes.
- weakening full transaction postcondition reads — current full after-revision remains the correctness boundary.
- layer-cohort batching — technically feasible after explicit layer identity, but must first pass static-schema-vs-recurring-call break-even measurement.
- global cross-subsystem diagnostic budgets beyond request-local read reuse — add only if measured full diagnostics still exceed the accepted cost envelope.
- selection morphology replacement — conditional path only; optimize if real use justifies replacing the current radius-based scan.

## Texture Layer Metadata Batching

`texture_layer_management(action=batch_metadata)` batches coherent rename/opacity/blend/order updates by explicit `layer_id`:

- all targets and final names are preflighted before Undo;
- duplicate layer targets and all-no-op cohorts are rejected;
- metadata-only rename batches preserve visual freshness;
- opacity/blend/order batches perform at most one recomposition;
- one Undo and one interface refresh cover the cohort;
- bitmap-structural actions (create/delete/duplicate/merge/flatten) remain separate because their rollback and image semantics differ.

This branch reuses the existing capability; no public tool was added.

## Texture Diagnostic I/O Hardening

Full texture diagnostics now share one request-local read context across coverage, seam, and PBR analysis.

- cached parent regions serve contained seam/coverage reads without another native `getImageData`;
- large PBR downsample reads are cached and included in the same diagnostic I/O metrics;
- one invocation-wide native-pixel ceiling bounds aggregate diagnostic work across subsystems;
- budget exhaustion is reported as budget evidence, not misclassified as UV/pixel-mapping failure;
- no diagnostic cache survives the invocation, so external edits cannot reuse stale pixels.

## Texture Layer Transaction Hardening

`texture_layer_management(action=batch_metadata)` batches coherent layer rename/opacity/blend/order updates while keeping bitmap-structural actions separate.

- all layer identities and final names are preflighted before Undo;
- all-no-op cohorts fail before mutation;
- rename-only batches preserve visual freshness;
- opacity/blend/order batches perform at most one recomposition;
- one Undo and one interface refresh cover the metadata cohort;
- the branch reuses the existing capability and stays within the normal MCP surface budget.

## Surface-Budget Preservation

Texture efficiency changes must remain net-positive at the MCP boundary. The layer metadata batch reuses `texture_layer_management`; self-evident field prose stays out of the static schema so repeated tools/list context does not absorb the saved calls. Runtime validation and action-specific errors remain authoritative, and the normal surface budget remains the release gate.

## Texture Compute Engine

Texture automation now separates color/surface computation from pixel mutation. `paint_texture_transaction` remains the single deterministic mutation owner and can run a compact compute pipeline before its existing revision, Undo, dirty-region, postcondition, evidence, and PNG-output stages.

Current compute primitives include:

- perceptual Oklab/OKLCh shade ramps and palette mapping;
- auto-levels and lightness posterization;
- nearest/blended/ordered gradient maps;
- linear, reflected, radial, diamond, and conical spatial gradients;
- deterministic Bayer dithering and Floyd–Steinberg palette diffusion;
- height extraction, Sobel slope estimation, and directional shading;
- palette extraction and palettization.

The public MCP surface exposes only compact operation names plus bounded args; detailed validation stays Runtime-owned. Compute runs inside `paint_texture_transaction`, so revision protection, one Undo, dirty-region write, postcondition proof, evidence, and optional PNG output remain owned by the existing transaction instead of a second mutation path.

## Capability Discovery CPU Reuse — SOURCE OPTIMIZATION

The Gateway capability ranking retains its previous semantic, BM25, Stage
and eligibility scoring contracts. One request now expands its query tokens
once for both rankers and all candidate tools. Static branch-manifest semantics
are indexed and their token sets compiled once rather than rebuilt for each
search. This is in-process derived metadata, not another registry, background
worker, authored-state cache, or new Gateway capability.

The existing `gateway/capabilities/intelligence.test.ts` checks equivalent
ranking/branch results with and without a pre-expanded query. No measured
runtime acceleration or accepted-result token reduction is claimed until an
exact-SHA executable benchmark supplies evidence.

## Control Context Headroom CPU Reuse — SOURCE OPTIMIZATION

Optional non-blocking facts previously caused repeated full context JSON/UTF-8
serialization, once per attempted item. The existing Control headroom projector
now retains an exact UTF-8 JSON byte accumulator, including field/array/comma
overhead, and measures only each new string. The actual final projection and
its diagnostics still undergo the canonical complete serialization and hash.

A focused regression compares the incremental decisions against full JSON
serialization across quote/escape/non-ASCII strings, rejected oversized items
and different budgets. This changes no decision evidence, byte limits, tools,
network calls or policy; executable performance measurements remain pending.

## Runtime Structured Result Mirror Compaction — SOURCE OPTIMIZATION

The existing `lib/factories.ts` result normalizer no longer serializes every
`structuredContent` payload merely to compare it with an ordinary one-line
summary. It first checks whether the companion text is a complete JSON object
or array. Only plausible JSON mirrors are parsed and compared semantically,
so whitespace/key-order variations do not return duplicate JSON copies.

Distinct human text, non-equivalent JSON, mixed image/tool content and
warnings not already present in the structured payload remain unchanged.
The existing structured-result test owner covers pretty/ordered mirrors,
nested safety/locator values, large ordinary summaries and mixed media.
This is output normalization only: no new public capability or weaker
quality/acceptance evidence. Source-only change; no measured token or CPU
improvement is claimed without executable validation.

## Gateway AI-Context Progressive Disclosure

The four-tool Gateway is the model-facing boundary. Token/context efficiency is therefore measured at the routed Gateway path, not inferred only from the internal Runtime catalog.

- `search_capabilities` defaults to four results and caps one search at eight; results expose capability identity, domain/tier, safety flags, and a bounded hint rather than repeating full tool descriptions.
- `describe_capability` defaults to input-schema-only because schema uncertainty is its normal routing purpose; `detail=full` is explicit when lifecycle, annotations, output schema, or ownership metadata is actually decision-changing.
- Gateway status/tool prose stays concise; Control structured projections remain authoritative.
- Repo-owned common-prefix and specialist bytes remain separate from dynamic search/describe/invoke payloads. Byte measurements are regression proxies, never claims about provider token billing.
- Instruction slimming must preserve canonical safety/ownership invariants; repeated prose may be removed only when another loaded owner remains authoritative.

This follows progressive disclosure: known capability → invoke directly; unknown capability → bounded search; real schema uncertainty → focused describe.

## Acceptance Rules

An efficiency change is acceptable only when:

- quality-preserved checks remain true;
- required verification call count does not decrease merely to improve the score;
- unknown mutation outcomes remain fail-closed;
- public Gateway remains four tools;
- no capability is removed;
- generated docs/typecheck/unused-symbol/runtime/authoring/Zero-Waste gates pass;
- LIVE_BLOCKBENCH claims are deferred until actually tested.

## Stop Rules

Stop optimizing when the remaining call is decision-changing.

Do not:

- build `smart_build`, `smart_texture`, or `do_everything` mega-tools;
- create duplicate planners for behavior already owned by a native semantic capability;
- add persistent state solely to save a cheap deterministic read;
- widen schemas based only on hypothetical savings;
- replace native Blockbench behavior with DOM/click emulation;
- report proxy bytes as model tokens or proxy calls as native latency.

## Next Evidence Target

After remote/source gates remain green, collect real accepted-result telemetry during future local/live sessions and compare it with the deterministic scorecard. The first candidate for new implementation is rig/locator cohort mutation only if that telemetry confirms repeated same-domain call waste.
