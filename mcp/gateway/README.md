# LazyDesigner MCP Gateway

LazyDesigner Gateway is the stable four-tool MCP client boundary in front of the volatile Blockbench Runtime. LazyDesigner Control provides intake/context/readiness/routing through this boundary; Gateway itself does not become a second workflow engine.

```text
AI client / Codex
   ↓ stable stdio session
LazyDesigner Gateway
   ↓ reconnectable loopback Streamable HTTP session
LazyDesigner Runtime inside Blockbench
```

The Gateway is the persistence boundary: Runtime/plugin reload, rebuild, phase change, temporary Runtime loss, or Blockbench restart must not require restarting the AI client. Runtime transport objects and capability catalogs are disposable and may be rebuilt behind the same Gateway process. See `ARCHITECTURE.md` for the persistent connection design.

## Stable Client Surface

```text
status
search_capabilities
describe_capability
invoke_capability
```

Blockbench/plugin reload and Runtime stage changes do not change the client-facing Gateway tool surface.

## Control Bootstrap

When orientation is unknown or materially stale:

```text
status
→ control.task_context_id
→ control.readiness
→ control.stage_context
→ control.context
→ control.blockers
```

Asset authoring may provide:

```text
reference_package_path
workspace_path
current_user_delta
known_context_ids
```

Control consumes compact `REFERENCE.json` + Active Workspace state and projects only the active authoring context:

```text
GEOMETRY_CONTEXT
TEXTURE_CONTEXT
ANIMATION_CONTEXT
```

Geometry receives the Modelling Skill plus exactly one selected profile when available. Texturing and Animation do not reload the full modelling profile by default.

For LazyDesigner source/product development:

```text
status(task_mode=SYSTEM_DEVELOPMENT, task_intent=<concrete problem>)
```

returns bounded source/specialist/test ownership without loading asset reference/workspace context.

## Capability Discovery

Known capability → invoke directly. Search is fallback for unknown/stale names; describe is fallback for real schema uncertainty.

```text
PRIMARY      normal authoring hot path
SUPPORT      valid conditional capability
EXPERIMENTAL explicit matching intent only
MAINTENANCE  legacy/debug fallback
```

`search_capabilities` defaults to at most four results. Search results carry Control domain/source-owner metadata but not duplicate full schemas.

Canonical named capability metadata is owned by:

```text
mcp/lib/capabilities/manifest.ts
```

`authoringPhase.ts` retains registration-family fallback logic only. AI-facing branch/search/dependency metadata is owned by `gateway/capabilities/`. Control does not maintain a second Geometry/Texturing/Animation capability table.

## Internal Ownership

```text
gateway/capabilities/  AI discovery, branch schemas, preconditions/effects
gateway/context/       neutral authoring-domain + specialist-path contract
gateway/execution/     capability execution orchestration above Runtime
gateway/runtime/       Runtime connection, affinity, recovery, queue mechanics
gateway/providers/     optional Gateway-local capabilities
gateway/control/       product Control packets, context, readiness, projection
gateway/development/   repository-development diagnosis/source ownership
contracts/protocol.ts             canonical Gateway protocol/base types
contracts/outputSchemas.ts           canonical public output validation contracts
presentation/resultCompaction.ts     canonical AI-facing result/receipt compaction
presentation/statusProjection.ts     canonical normalized public status projection
runtime/backend.ts                   canonical Runtime adapter/orchestration boundary
index.ts               stable four-tool stdio composition root
contract.ts            compatibility facade only
```

Same-named files retained at the `gateway/` root for migrated modules are compatibility re-exports only. They are navigation aliases, never implementation owners. New production imports must target the canonical subdirectory owner directly. See `COMPATIBILITY.md` for the wrapper ledger and removal criteria.

## Project / Tab Affinity

One Gateway process retains only:

```text
project UUID affinity
+ authoring phase affinity
```

It does not cache model objects, selections, textures, animations, Undo state, or other authored project data.

Project binding remains conservative:

```text
0 open projects → no binding
1 open project  → first project-sensitive invocation binds that UUID
2+ projects     → select intended tab and call status(adopt_active_project=true) once
```

Bound-project loss fails closed with `PROJECT_CONTEXT_LOST`.

## Authoring / Animation Handoff

Geometry↔Texturing stays on the shared AUTHORING Runtime surface. Semantic ownership changes without client/runtime phase bounce.

`switch_authoring_phase` is reserved for AUTHORING↔Animation:

```text
invoke through Gateway
→ phase affinity changes
→ backend Runtime catalog invalidates
→ next request reconnects/refetches requested Runtime surface
→ same AI task/chat continues
```

No manual AI-client reconnect is required.

## Persistent Runtime Recovery

The Gateway process remains alive when Runtime disappears or is replaced. Recovery is demand-driven rather than heartbeat-driven:

```text
explicit Gateway request
→ health probe
→ compare Runtime signature
→ reuse current backend when unchanged
→ otherwise drop only backend transport/catalog
→ reconnect to current Runtime
→ refresh catalog once
→ continue the same Codex task
```

Repeated Runtime failures use bounded exponential backoff. There is no background reconnect loop, idle heartbeat chatter, or automatic mutation replay.

Expected behavior:

```text
plugin reload       → backend reconnect only
Runtime rebuild     → backend reconnect only
phase handoff       → catalog refresh on next request
Blockbench closed   → Gateway stays alive/offline
Blockbench reopened → next explicit request reconnects automatically
Codex               → remains connected throughout
```

## Control Delta

Every normal invocation receives a compact post-operation `control_delta`.

```text
ordinary mutation
→ affected knowledge marked stale
→ no automatic full status reread

phase/project authority change
→ requires_status_refresh=true
```

Dependency direction currently distinguishes:

```text
Geometry → Geometry + potentially dependent Texture/Animation
Texture  → Texture + potentially dependent Animation
Animation→ Animation
```

This is affected-knowledge metadata, not a forced full downstream reset.

## Smart Evidence Selection

The Gateway/Control continuation can provide executable `get_texture`
crop arguments for a current, validated Texture region without adding a
new MCP capability or calling a tool automatically. Geometry's automatic
silhouette evidence suppresses only redundant masks from orthogonal
risk-expansion views, not shaded views. Animation's numeric-keyframe
candidate times can be narrowed to a focused bone/time range without
extra native renders. All remain advisory until actual visual inspection;
stale evidence and partial view coverage are never upgraded to PASS.

## Scoped Texture Image Delivery

Within an explicit `invoke_capability` task cohort, a successful
`paint_texture_transaction` with `cohort_boundary=CONTINUE` may omit
its **verified inline PNG** from the AI-facing response. The native
transaction and full revision guards still run. PNG deferral additionally
requires a verified project UUID from the serialized native invocation:
unbound or uncertain project identity retains the inline PNG and cannot
defer Control's visual obligation. The Control verification
scope marks the preview as `follow_up_read` until a matching image is
actually delivered. The default and final `COMPLETE` requests keep
their image. A final merged cohort must re-read the affected region if
the last PNG does not cover all earlier edits. This uses the existing
four-tool Gateway and Control Delta, without new tools or a cross-call
image cache. Omitting a PNG reduces AI-visible image blocks but does
not remove native encoding work or prove token/allowance savings.

## Correlated Diagnostic Trace (opt-in)

The existing Gateway benchmark trace remains the only durable per-call event
recorder. New additive v1 fields include request start time, one span ID per
recorded Gateway tool request and validated W3C version-00 `traceparent`
correlation when supplied by a client. Without a valid parent, a process-local
trace ID groups the Gateway's recorded session. Raw Control
`task_context_id` is never persisted; only its SHA-256 digest and the fixed
`cohort_boundary` enum may be retained. A matched trace ID does not prove
AI model usage or a complete client-to-Blockbench trace.

The existing Gateway operation queue keeps its always-on, bounded 64-sample
aggregate wait and duration statistics. **Only with detailed trace capture
enabled**, a native invocation additionally records queue admission wait
and queued-operation duration. The operation duration includes possible
connection, catalog and preflight costs; it is not pure native execution.
A missing measurement remains `null` rather than an invented zero.
Trace observers cannot alter mutation results, recovery, or Undo.

Use the already-supported environment contract to capture a scoped local trace:

```text
LAZYDESIGNER_BENCHMARK_TRACE_PATH=<ignored local .cache path>
LAZYDESIGNER_BENCHMARK_TASK_ID=<one bounded logical task>
LAZYDESIGNER_BENCHMARK_SOURCE_SHA=<exact 40-character Git SHA>
```

Then use `bun run report:gateway-trace -- <trace.ndjson>` to inspect
correlation coverage, observed timing and bounded event metadata.
Historical v1 trace files remain readable. No additional MCP tool,
background monitoring server, database, prompts, images, raw project paths or
credentials are recorded by this extension. Gateway byte/image counts are
not Codex/Astra provider tokens, verified model ingestion, or visual approval.

## Bounded Offline Bottleneck Review

The existing `report:gateway-trace` command now includes a diagnostic
section in its JSON output. It ranks up to five capabilities by **summed
observed Gateway call latency**, which is not task wall time and may overlap
with parallel work. Missing response bytes remain `null`, never zero.

Up to four `INVESTIGATE_ONLY` findings identify repeated matching
capability/error codes or queue waits that repeatedly exceed the corresponding
queued-operation duration. A matching error code does not prove identical root
cause or waste; these signals propose investigation, not retry, source edits,
quality claims, or automatic optimization. Each candidate points to a bounded
list of event sequence numbers; no inputs or response contents are retained.

No new instrumentation or background collection was added to normal authoring
for this report. The report consumes only the existing opt-in trace; provider
token usage is `null` and accepted-result quality is `UNVERIFIED` until
separately sourced. Evidence coverage and legacy trace compatibility remain
explicit.

## Offline Codex Usage + Golden Comparison (explicit inputs only)

`bun run compare:observability -- <baseline-final.json>
<candidate-final.json> <baseline-trace.ndjson> <candidate-trace.ndjson>
<normalized-usage.json>` performs a **read-only, offline** comparison.

Inputs are two accepted LIVE_BLOCKBENCH Golden final reports, the corresponding
opt-in Gateway NDJSON traces, and the existing normalized `lazydesigner-astra-usage-v1`
document containing exactly one `baseline` and one `zero_waste` run.
For each usage run, set `gateway_trace_sha256` to the exact lowercase SHA-256
of its captured NDJSON *file bytes*. The comparator validates the binding,
Golden task/source identities, identical starting asset and reference, accepted
results, matched provider model where available, and correction counts. The
document-level `source_sha` must be `null` when comparing two different
source revisions. Trace files may not be reused across both runs.

A token-reduction claim additionally requires a named source and model from
the client, a submitted source-provided `model_events` list with distinct stable
`event_id`, `source`, and `total_tokens` for every response/compaction
event, explicit accepted-result PASS on both normalized runs, and no increase
in user corrections. No component-based token estimation, unverified aggregate
usage, cross-model claim, API pricing, allowance inference or automatic
improvement is allowed. If an identity or digest **contradicts** the evidence,
the comparison fails closed; if telemetry is missing, it reports
`INSUFFICIENT_LINKED_USAGE_EVIDENCE`. A SHA bind selects an exact file and
does **not** independently authenticate the upstream Codex OTel export.

Codex supports opt-in OpenTelemetry exports. The current Codex release and its
exported field semantics must be verified at capture time; notably some
historical `response.completed` OTel logs called provider total tokens
`tool_token_count`. Do not silently treat this field as tool-only usage or
derive missing totals by summing input/output fields. Normalize only genuinely
source-provided totals, preserving response/compaction coverage and model
identity, and record the exporter/version in the source description.

This comparator does **not** read private Codex session files, enable host
telemetry, change `config.toml`, start an OTLP collector, retain raw prompts,
or ingest tool arguments/output. Raw Codex OTel logs may include sensitive tool
content even with prompt logging disabled; selective sanitization belongs to
the explicitly authorized client-side export workflow. Normal authoring and
Gateway four-tool responses remain unchanged.

## Offline Visual Report (P5)

The existing `compare:observability` command accepts an optional final
`--html` flag after its five required input paths. Without the flag its
previous JSON output remains unchanged except for an **additive**
`gateway.inspection` section containing two bounded trace previews and the
already-generated investigative findings/hotspots.

```text
bun run compare:observability -- <baseline-final.json> <candidate-final.json> <baseline-trace.ndjson> <candidate-trace.ndjson> <normalized-usage.json> --html
```

HTML is written **only to stdout**, never automatically to user files or
Workspace; an operator may intentionally redirect the output to an ignored
local HTML report and open it offline. The report is static, includes a restrictive
CSP, escapes all displayed input-derived strings, has no client scripts or
external resources, and changes no live Gateway/Desktop state.

The timeline displays up to 60 event rows per run (first 30 and last 30 when
longer), explicitly reports omitted rows, and draws duration bars only when
recorded `started_at` timestamps yield a complete measured window. Historical
v1 traces without starts show `Start not measured` rather than fabricated
timings. Reported Gateway latency sums are not task wall time or time-to-accepted
result; missing queue/image measurements remain `null`. Signal links reference
bounded event sequence numbers; events outside the preview are marked not shown.
Results still require the P4 trace SHA, provider/Golden quality and correction
gates. The JSON/HTML review also includes a bounded `feedback` disposition:
`REJECT_CANDIDATE` for increased recorded user corrections,
`REVIEW_CANDIDATE` for a source-event token reduction with supplied accepted
Golden evidence, or `HOLD_OR_NO_EFFICIENCY_GAIN` otherwise. The report lists
coverage gaps and bounded machine-readable recommended checks, never automatic
source edits, retries, release promotions, or an AI-generated quality verdict.

This is an **offline diagnostics viewer**, not a live Desktop dashboard,
OTLP exporter, new server, or autonomous optimization engine.

## Always-On L0 Project Observation (source-authored)

The existing four-tool Gateway now has an internal, lightweight **L0
aggregate observer**. It executes as a best-effort callback after the
regular tool has returned, using its existing status/Control Delta evidence:
no extra MCP calls, AI prompts, native inspections, PNG capture, or
AI-facing response fields. The detailed Golden recorder above remains
separately opt-in; the L0 path does not duplicate its per-call NDJSON trace.

L0 records bounded, non-payload counters: tool/capability call counts,
failures by safe machine code, observed Gateway duration, domain-coded calls,
verification obligations (never quality PASS), observed acceptance-gate
invalidations and downstream recheck counts, the presence (not contents)
of a user delta on status, a capped count of task context IDs **without
storing their contents**, and phase observations from a verified status
or validated phase-transition receipt only. None of these observations
is itself a confirmed correction cause or user approval. Calls without
a verifiable native project binding are assigned to `unbound`, not
guessed into the last known project. The project key is a SHA-256 digest
of the verified native project UUID, not a secret, long-lived account ID or
guarantee of cross-reopen project identity. Different native UUIDs are
never silently merged.

L0 defaults on, and can be disabled via
`LAZYDESIGNER_PROJECT_OBSERVABILITY=0`. On supported Windows installs,
sessions use `%LOCALAPPDATA%/LazyDesigner/analytics/`; non-Windows
development uses `$XDG_STATE_HOME/LazyDesigner/analytics/` or
`~/.local/state/LazyDesigner/analytics/`. The observer stores **one
atomic, coalesced summary snapshot per Gateway process session**, at most
once per 64 calls or after an additional call beyond 60 seconds, and on
normal shutdown. The cached snapshots are limited to sixteen owned
session JSON files, 128 KiB maximum each. Cardinality is capped (12
projects/session, 24 capability keys plus OTHER, 64 distinct task contexts
per bound project, 24 recent phase observations). A slow disk never creates
an unbounded write queue; only the latest pending snapshot is retained.
A failed write must not interrupt authoring. An unexpected crash may lose
up to the last unflushed interval; `state: OPEN` must not be called a
complete session. The small writer/retention concern lives in
`gateway/execution/projectObservationStore.ts`; metric accounting is owned by
`gateway/execution/projectObservation.ts` and consumed by the offline reporter. This L0 window is **not** a complete audit/history service.

Use the explicit, offline command:

```text
bun run report:project-analytics -- <local-analytics-directory>
```

The reporter reads at most sixteen regular snapshot files of bounded
size and groups only matching hashed native UUID identities across sessions.
Use the optional `--html` flag to output an entirely local static HTML
report to stdout; JSON remains the default. HTML escapes all displayed
metadata, uses a no-network Content Security Policy, and bounds its visible
project cards to twenty. Nothing is uploaded or inserted into AI context.
It distinguishes `OPEN`/closed sessions, unbound calls, source and
coverage uncertainty, phase **observations** versus approvals, and calls
summed across sessions versus elapsed/accepted-result time. It never
infers visual quality, session-wide model usage, native project completion
or full project wall time. It adds no status polling, persistent registry,
new UI view or public Gateway tool. The existing opt-in P1-P5 detail
reporters remain the drill-down route when evidence is needed.

## Research Archive & Index (explicit offline operations)

For longer-lived research, the rolling L0 session window can be copied on
explicit request into a dedicated research location. No background archiving,
Gateway calls, AI tracking, Desktop polling, or database are added.

```text
bun run research:archive -- capture <l0-cache-dir> <research-root> "Geometry Trial 01"
bun run research:archive -- verify <research-root>/research-<id>
bun run research:index -- <research-root> --format=json
bun run research:index -- <research-root> --format=csv --project-key=<64hex>
bun run research:index -- <research-root> --label=Geometry --since=2026-11-01
```

The archive contains only bounded L0 JSON snapshots, checksums, and a
derived summary; it is *not* another native project owner or a replacement
for the explicit Golden acceptance/usage comparator. Indexing reads
manifests only, warns when archived captures reuse the same session, and
never sums duplicated session data across experiments. JSON/CSV are
emitted to stdout for optional user-controlled storage. A separate explicit
verify operation rereads source snapshots and checks file hashes and
summary consistency. The index deliberately marks underlying snapshot
integrity `NOT_RECHECKED` until such verification is performed.

L0 cannot prove exact code source SHA, native Runtime build, Workspace
binding, approved visual quality or model token usage. All remain
`null`/`UNVERIFIED` in this archival flow. The research index is a
safe source locator and trend input, not a causal or quality verdict.

## AI-First Research Data Reading (explicit and offline)

The existing research archive supports **AI-first, full *retained-data*
review** without an extra MCP tool, Runtime poll, AI tracking call, database,
or normal Gateway response payload. An explicitly authorized AI client with
local research-directory access can call:

```text
bun run research:read -- <research-root> --view=catalog --limit=8
bun run research:read -- <research-root> --view=project --project-key=<sha256> --limit=8
bun run research:read -- <research-root> --view=archive --archive-id=<research-id>
bun run research:read -- <research-root> --view=sessions --archive-id=<research-id> --limit=8
bun run research:read -- <research-root> --view=session --archive-id=<research-id> --session-id=<16hex>
bun run research:read -- <research-root> --view=project --project-key=<sha256> --runtime-build-key=<sha256>
```

For every paged response, follow the exact returned `next_cursor` via
`--cursor=<opaque>` until it is `null`. The cursor is bound to its
query and collection revision. To review **all available archives**, enumerate
catalog pages, session-list pages for each archive and then each requested
session; a selected session returns every recognized L0 field with a
verified local snapshot byte checksum. Unknown JSON keys are removed before
AI presentation. The catalog/project/summary views are metadata-only and
do **not** recheck all archived file bytes; use explicit
`research:archive verify` for full archive integrity.

Returned data has a stable machine schema, explicit trust/evidence/coverage
labels, archive/session IDs, and source checksums. All labels and archive
content are **untrusted data**, never operational instructions. A matching
checksum detects changed bytes, but is not source authentication. A verified
Runtime `build_identity` is stored only as its observed hashed fingerprint,
not treated as a Git source SHA. A MATCHED finalization saved-file digest
is evidence of checkpoint content, not stable cross-UUID asset identity or
human-approved visual quality. Historical snapshots without new optional
build/checkpoint fields remain readable and keep their prior summary hash.
Do not silently compare builds, merge cloned assets, or claim saved AI tokens.

A client without explicit local filesystem/command access does not gain
these capabilities automatically. This architecture deliberately keeps the
AI reader outside the four-tool authoring surface so normal asset creation
incurs no context or inference overhead from research history.

Research consulted:
- MCP resources and safe file-backed access: https://ts.sdk.modelcontextprotocol.io/v2/servers/resources
- OpenTelemetry logs/traces correlation: https://opentelemetry.io/docs/specs/otel/logs/
- JSON Schema 2020-12: https://json-schema.org/draft/2020-12/
- OWASP prompt injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- OpenAI stable-prefix/dynamic-context caching: https://developers.openai.com/api/docs/guides/prompt-caching
- RFC 8785 JSON canonicalization: https://www.rfc-editor.org/rfc/rfc8785.html

Existing SHA-256 of `JSON.stringify(summary)` is a local JavaScript
serialization contract, **not** RFC 8785 canonical JSON or a digital
signature. For cross-language or signed provenance, define and verify a
separate canonical signed receipt rather than retroactively redefining the
archive format.

## Context / Result Economy

Context handles use SHA-256 identities of current canonical repository files. `known_context_ids` suppresses unchanged Skill/profile content and invalidates changed members of the same family.

The former asset-router Skill is not mandatory authoring context.

The Runtime remains complete native/debug evidence owner. Gateway may compact normal continuation receipts when omitted data is redundant, while preserving failure/uncertainty evidence needed for recovery.

No heartbeat chatter, background catalog polling, automatic confirmation reads, or automatic mutation retries are introduced.

## Bounded HTTPS Connection Reuse

Finite MCP responses can reuse the same authenticated loopback HTTPS connection when the client supports HTTP keep-alive. The native listener enforces a five-second idle keep-alive window and a separate 30-second socket inactivity limit, honors explicit `Connection: close`, and closes tracked sockets on Runtime teardown. Subscription streaming and conservative mutation recovery remain separate concerns.

Focused Runtime tests compare reused versus fresh connections and verify HTTPS certificate/token protection. Recorded p95/sample latencies are observations, **not** guaranteed improvements or native Blockbench acceptance. Health probing before an authoring invocation is retained because Runtime generation and active-project affinity may change outside Gateway control. Do not remove that probe merely to increase a synthetic cache-hit rate.

## Pre-execution Queue Cancellation

Gateway's serialized operation queue now distinguishes **waiting** from **started** work. Waiting work expires after 30 seconds by default (`LAZYDESIGNER_GATEWAY_MAX_QUEUE_WAIT_MS`; independently configurable from the 120-second native call timeout). The MCP v2 request abort signal can release a waiting slot immediately. Neither action invokes Blockbench; the result is `GATEWAY_QUEUE_EXPIRED` or `GATEWAY_QUEUE_CANCELLED` with `executed=false`, `safe_to_retry=true`, and separate `expired_before_start` / `cancelled_before_start` counters.

Once a queued operation starts, Gateway **does not** abort or replay the native mutation. Cancellation or timeout after execution starts can still produce `OUTCOME_UNKNOWN` and requires state inspection before any replay. Queued work expiry/cancellation is not treated as proof that an already-running native operation was undone. This is a bounded admission policy, not guaranteed cancellation of Blockbench's native API.

## Opt-in Gateway Observability

The existing benchmark trace remains disabled by default. When explicitly
enabled with an exact source SHA and task identity, it records Gateway
call timings, result byte counts, and bounded machine error codes without
writing response contents, failure messages, or private file paths.

The existing trace reporter now includes nearest-rank p50/p95 latency and
failure counts grouped by machine error code. Older v1 traces without
`error_code` remain supported. When opt-in, it also counts actual
`content.image` items and decoded media/PNG byte lengths in the final
Gateway responses, without storing image bytes, base64 or source paths.
Historical/incomplete image telemetry remains null, never zero. These
metrics are NOT model-ingestion proof, provider token usage or accepted
visual Blockbench results.
No database, monitoring service, or fifth Gateway tool is added.

## Bounded Queue Telemetry

The Gateway operation queue uses an actual FIFO list of waiting operations.
Cancellation and queue expiry remove the waiting entry immediately, rather
than leaving discarded callbacks attached to a Promise chain. Native work
already started is never cancelled or automatically replayed.

Queue wait and native-operation duration each retain only the most recent
64 **started** samples in process memory. Their nearest-rank p50/p95 metrics,
sample counts, and separate `outcome_unknown` / `read_interrupted` counters
are available from backend diagnostic status. Cancelled/expired jobs are
counted independently and excluded from started-work distributions. The
AI-facing four-tool `status` projection remains compact; no database,
background timer, or persistent sample history is introduced.

## Reliability Invariants

- Gateway startup does not require Blockbench to be open.
- Blockbench/plugin reload does not terminate the Gateway process.
- Changed Runtime build/profile/stage invalidates cached backend catalog.
- Backend reconnect is automatic on the next explicit request; the AI client stays connected.
- Repeated unavailable backends are rate-limited by bounded reconnect backoff.
- Each Gateway owns one project UUID affinity and one authoring-phase affinity.
- Cross-Gateway Runtime calls remain serialized around Blockbench process-wide project globals.
- Bound project loss fails closed.
- Runtime calls and queue depth are bounded.
- `tools/call` is never automatically retried after transport interruption/timeout.
- Interrupted mutation may return `OUTCOME_UNKNOWN`; inspect state before retrying.
- Gateway owns no authored model state or persistent Control database.
- Gateway connects only to loopback Runtime URLs.

## Run Locally

From `mcp/`:

```bash
bun run gateway
```

Runtime endpoint default:

```text
https://127.0.0.1:3000/bb-mcp
```

Internal package/server identifiers may still contain legacy `lazydesigner-*` names during migration. Do not treat them as a second product.

Run `bun run setup:tls` before native testing; see [Runtime TLS setup](../README.md#normal-client-boundary). The Bun Gateway uses the machine-local certificate for both health probes and SDK requests, with certificate validation enabled. `LAZYDESIGNER_RUNTIME_URL` overrides the endpoint **only with a loopback HTTPS URL** during normal Gateway startup; a configured HTTP endpoint fails closed. Explicit HTTP URLs remain available only to isolated protocol tests that construct a backend directly. `LAZYDESIGNER_TLS_DIR` selects the shared certificate directory. Replacing an old HTTP Gateway process with this HTTPS-aware version requires one client reconnect; subsequent Runtime reloads recover beneath that process as before.

## Current Source Surface

```text
Gateway client tools      4
Runtime callable union   54
AUTHORING surface        47
Animation surface        18
```

These are source-era counts, not installed Runtime proof.

Current proof interpretation:

```text
../../docs/05-operations/current-validation.md
```

## Proof Boundary

Source/static contracts can establish Gateway/Control structure, context selection, bounded routing, affinity/retry semantics and invalidation intent. They do not prove installed Runtime freshness, native Blockbench behavior, visual fidelity, persistence/playback, or measured end-to-end usage reduction.