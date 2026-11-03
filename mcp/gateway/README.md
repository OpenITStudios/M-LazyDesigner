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

## Scoped Texture Image Delivery

Within an explicit `invoke_capability` task cohort, a successful
`paint_texture_transaction` with `cohort_boundary=CONTINUE` may omit
its **verified inline PNG** from the AI-facing response. The native
transaction and full revision guards still run; the Control verification
scope marks the preview as `follow_up_read` until a matching image is
actually delivered. The default and final `COMPLETE` requests keep
their image. A final merged cohort must re-read the affected region if
the last PNG does not cover all earlier edits. This uses the existing
four-tool Gateway and Control Delta, without new tools or a cross-call
image cache. Omitting a PNG reduces AI-visible image blocks but does
not remove native encoding work or prove token/allowance savings.

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
`error_code` remain supported. These metrics measure Gateway request timing
only; they are not provider token usage or accepted visual Blockbench results.
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