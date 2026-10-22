# Prompt Cache & Long-Context Contract

Updated: 2026-09-20

This contract defines LazyDesigner-owned behavior that supports prompt-cache reuse and safe long-running conversation compaction. It does **not** claim that LazyDesigner owns the Codex/OpenAI conversation API or can force a cache hit.

## Objective

The primary production target is **Codex allowance consumed per accepted asset/task**, not OpenAI API invoice cost.

Codex allowance does not expose a repository-owned exact pricing function. Treat it as an external budget whose consumption is influenced by model choice, task complexity, context volume, reasoning effort, tool work, and session length. LazyDesigner therefore optimizes controllable workload drivers while protecting accepted-result quality:

```text
minimum sufficient context
+ minimum necessary reasoning
+ minimum decision-changing visual evidence
+ minimum non-redundant tool work
+ bounded correction loops
→ accepted result
```

API-style input/output/cached-token telemetry remains useful **only when the actual Codex/client surface supplies it**. It is optional measurement evidence, not the production accounting model and never a requirement for the zero-waste workflow.

Keep reusable context stable and move volatile task state into a bounded dynamic tail.

```text
CROSS-STAGE COMMON PREFIX CANDIDATE
→ repository instructions that truly apply
→ stable Gateway instructions
→ four stable Gateway tool definitions

STAGE-STABLE EXTENSION
→ exactly one active specialist for the current semantic stage
→ appended after the common prefix so a stage change need not invalidate the earlier reusable prefix candidate

DYNAMIC TAIL
→ user/task delta
→ Control stage projection
→ reference images/evidence selected for the decision
→ current tool results / recovery state
→ current visual evidence
```

Static-prefix bytes are a regression proxy, not model tokens. Actual reuse is proven only by provider/client telemetry such as cached-input accounting or cache diagnostics when available.

## Stable Prefix Rules

1. Keep Gateway tool names, ordering, descriptions and schemas stable when semantics did not change.
2. Keep stable instructions byte-identical when no behavior changed; do not inject UUIDs, revisions, timestamps, task IDs or current status into stable instruction text.
3. Content-addressed specialist/profile handles preserve identity; unchanged handles are reused rather than resent.
4. Do not move volatile state into AGENTS, Skills, Gateway descriptions, or static tool schemas.
5. A stable but unnecessarily large prefix is still waste. Instruction footprint is measured by `measure:model-context`; quality-sensitive slimming requires regression proof.

Canonical static-footprint utility:

```bash
bun run measure:model-context
```

It reports one cross-stage common-prefix fingerprint plus the current stage-specialist extension and assembled task-class fingerprint. This lets development distinguish churn in truly reusable context from an expected Geometry/Texturing/Animation specialist change. Fingerprints detect source churn only; they do not prove upstream prompt assembly or cache hits.

## Dynamic Tail Rules

Dynamic context contains only state that can change the current decision.

- Headroom applies at the whole Gateway Control-envelope boundary, not just one field.
- REQUIRED stage evidence is preserved even if it exceeds the byte proxy budget.
- Stage-approved `reference_image_ids`, blocking unknowns, user delta, requirements, readiness and workspace gates are REQUIRED.
- Non-blocking unknowns, stage document pointer and workspace next step are bounded useful context.
- A continuation reserve is held back for later tool/result state.
- Byte limits are regression proxies and never advertised as model context-window/token limits.

## Tool Observation Economy

- Successful state-preserving reads use canonical read-only annotations and do not receive redundant `NO_CHANGE control_delta`.
- Authoritative mutation receipts replace reassurance rereads.
- Superseded specialist/profile handle families are explicitly invalidated.
- UNKNOWN_OUTCOME, conflicting evidence and decision-changing visual verification state are never evicted for compactness.
- Structured results remain authoritative; duplicate prose is compacted only where structured receipt is sufficient.

## Conversation Compaction Boundary

LazyDesigner does not own arbitrary Codex/chat history and must not implement blind last-N/history deletion.

Instead it provides a deterministic compaction-safe checkpoint:

```text
mcp/gateway/control/continuationCheckpoint.ts
```

The checkpoint retains task/project identity and binding, active domain/next intent, current user delta and REQUIRED stage evidence, readiness/blockers, current required/invalidated context IDs, freshness uncertainty, and verification scope when still decision-changing. It intentionally omits complete fresh-scope complements, source-owner prose and historical observations no longer required for continuation.

Measurement:

```bash
bun run measure:continuation
```

An upstream client that actually owns conversation state may use its native compaction mechanism at meaningful milestones. LazyDesigner Gateway/Runtime does not call a provider conversation API.

## Codex Allowance Accounting

Compaction is not free, but normal Codex usage optimization must not pretend that repository byte counts or API pricing equal the user's Codex allowance.

For normal Codex operation, compare controllable workload drivers:

```text
task success / accepted result
user correction count
reasoning class transitions
context-pressure trajectory
compaction count
tool calls
visual capture count + selected view count
dynamic payload bytes
continuation-checkpoint bytes
repeated/stale observation count
```

A change is an optimization only when accepted-result quality does not regress. Prefer direct before/after Codex usage observations from the user's actual Codex usage surface when available; otherwise report proxy improvements without converting them into invented tokens, credits, dollars, or percentages.

### Optional token telemetry benchmark

When the active Codex/client surface actually exposes source-provided token telemetry, end-to-end measurement may additionally include every model event.

```text
model_events:
- kind: response | compaction
- total_tokens
- input_tokens
- cached_input_tokens
- output_tokens
- reasoning_tokens
- cache_missed_tokens (when exposed)
- comparison_reusable_tokens (when exposed)
```

If any required event lacks source-provided `total_tokens`, token comparison remains unavailable rather than being reconstructed from components.

Use:

```bash
bun run eval:astra-usage -- <normalized-usage.json>
```

This command is an **optional telemetry evaluator**, not the primary Codex allowance meter. Quality PASS and successful completion are required before any token comparison can be claimed. If Codex does not expose complete source telemetry, leave the token comparison unavailable and evaluate the workload proxies above instead.

## Development Context

SYSTEM_DEVELOPMENT begins with exact source owners. Do not load a repo map on every task.

When routing is ambiguous/cross-owner and broad reads would otherwise be required:

```bash
bun run map:development -- "<intent>"
```

The map is bounded and contains only source paths, imports and top-level signatures. It never includes implementation bodies and is not used by asset-authoring Runtime.

## Client-Owned Session Policy

LazyDesigner does not own the Codex/OpenAI conversation API and Managed Distribution must preserve unrelated Codex model/settings semantics. Session-lifecycle decisions are therefore exposed as a deterministic integration policy, not as hidden config rewriting.

Canonical evaluator:

```bash
bun run eval:session-policy -- <session-policy-input.json>
```

Input comes from the actual client/controller owner and uses only provider-independent facts:

```text
task class
context pressure state
meaningful milestone
continuation checkpoint freshness
recovery uncertainty
pending visual-verification evidence
routing ambiguity
common-prefix stability
stage-extension stability
whether another tool action is pending
whether source-provided usage telemetry exists
decision class when the client can classify the current decision deterministically:
  DETERMINISTIC_EXECUTION | BOUNDED_INTERPRETATION | VISUAL_JUDGMENT
```

Decision class is intentionally narrower than task class. A long reference-driven or
Animation task may contain many exact mutations, saves, inspections, and receipt
handling steps that do not require expensive visual reasoning. Clients should classify
the **current decision**, not permanently escalate the whole task. If `decision_class`
is omitted, the evaluator preserves the legacy task-class fallback.

The evaluator returns:

```text
KEEP_CONTEXT | REQUIRE_FRESH_CHECKPOINT | COMPACT_NOW
REUSE_FULL_PREFIX | REUSE_COMMON_PREFIX | RESET_PREFIX_IDENTITY
ECONOMY_WHEN_SUPPORTED | BALANCED | QUALITY_FIRST
MINIMAL_INTERMEDIATE | NORMAL_USER_FACING
```

Safety rules:

- compaction never proceeds without a fresh LazyDesigner continuation checkpoint;
- non-critical recovery uncertainty remains expanded;
- pending decision-changing visual evidence delays non-critical compaction;
- a stage change may reuse the cross-stage common prefix without claiming the stage extension is unchanged;
- lower reasoning is only an optional hint for deterministic direct work with no ambiguity, recovery uncertainty, or pending visual judgment;
- intermediate prose may be minimized only while another tool action is pending;
- no usage claim is available without source-provided telemetry;
- the evaluator does not call a provider API, own chat history, or modify Codex configuration.

A future client/controller that actually owns model invocation may map these decisions to provider-native cache, compaction, reasoning, and output controls. Until then, the evaluator is the tested handoff contract and must not be represented as active upstream execution.

### Model-neutral client adaptation

LazyDesigner does not invoke, identify, select, or configure the AI model. A model supporting native tool search, programmatic tools, provider caching, or adjustable reasoning does **not** mean the connected host exposes these controls. The host/client that owns model invocation must activate them; the MCP Gateway cannot infer them from a model name.

Preferred client behavior when actually supported:

```text
known capability and loaded schema → direct invoke
unknown capability               → bounded search; describe only required schema branch
host-native tool search          → client-owned, no second Gateway discovery engine
deterministic work               → economical reasoning when available
ambiguous/visual decisions       → sufficient reasoning and current visual evidence
complete authoritative receipt   → continue without reassurance reread
uncertain native mutation        → recover state, never blindly retry
```

Production retains `stable_four`. The opt-in `hybrid_4_experimental` exposes selected direct tools through the same executor but adds static schemas. Do not promote a profile or alter client model/reasoning settings merely because a newer model exists. Compare **accepted-result cost**, not only static schema bytes or modeled saved calls: include selection accuracy, runtime calls, correction loops, visual quality, latency and recovery. Shadow replay and string lengths are proxies, not measured model tokens or native acceptance.

Keep the stable common prefix and one active specialist; place dynamic reference facts, project revisions, Runtime receipts and visual evidence in the task tail. After compaction, a handle does not prove its Skill/profile content remains loaded. Reuse only retained content; reload missing active content rather than all domains.

Use existing client-owned session-policy outputs as optional per-decision hints if the host supports them. Do not introduce a second AI planner, provider-specific token accounting, automatic model switching, or token-budget controls inside MCP. Preserve native validation, project/phase authority, Undo and visual-approval boundaries.

## Measurement Layers

Keep these measures separate:

```text
STATIC PREFIX PROXY
→ AGENTS / specialist / Gateway instructions / four tool schemas

DYNAMIC WORKFLOW PROXY
→ Gateway/Control/tool-result bytes + call trajectory

CONTINUATION PROXY
→ full internal state vs compact continuation checkpoint

ACTUAL USAGE
→ source-provided response + compaction token telemetry

QUALITY
→ task success + reference/technical/visual acceptance + user corrections
```

Never sum static-prefix bytes and dynamic bytes and label the result “tokens”; prompt caching and history reuse make that invalid.

Canonical combined proxy report:

```bash
bun run benchmark:zero-waste-total
```

## Stop Rule

Do not add AI summarizers, AI planners, vector stores, persistent observation databases, lossy compression of authoritative state, or predictive prefetch merely to reduce context.

After these contracts pass source gates, further context trimming is allowed only when real usage telemetry identifies a material decision-safe bottleneck and quality/correction count does not regress.
