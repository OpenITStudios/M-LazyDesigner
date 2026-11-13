# Tool Boundaries, Reliability and Failure Recovery

## Capability ≠ authorization ≠ evidence

Evaluate three different questions before every effect:
1. **Available:** is the intended tool, runtime, environment or host genuinely connected and capable?
2. **Allowed:** does the current user request and project profile permit **this specific action** on this target/ref/data class?
3. **Proven:** what observation/receipt would demonstrate the action actually succeeded?

A text prompt, SKILL.md or advertised plugin name does not create a tool connection, scope or permission. A successful API transport acknowledgment is not necessarily a persisted state transition or an accepted product result.

## Tool design contract (for project-owned engines)

A useful tool should have stable:
- explicit `operation`, typed inputs, target identity and source/expected revision;
- declared read-only vs mutating effects, risk and idempotency semantics;
- concise, structured success/error reasons with affected scope and receipt;
- discoverable capabilities that load on demand, without dumping all tool schemas;
- bounded retry, cancellation, rollback or manual reconciliation guidance.

This is a **design standard** for tools owned by individual projects, not a new gateway or generic tool server. Project systems keep their actual MCP/REST/desktop implementations and source authority.

## Action and transport boundaries

| Situation | Required response |
| --- | --- |
| GitHub read/search | Pin explicit working ref; distinguish partial search from exact source |
| GitHub write | Check permissions, current blob/HEAD and concurrency; no unapproved fallback |
| Local code execution | Require real checkout and toolchain; match proof to revision |
| Native desktop/game/device | Require connected target observation; do not infer live acceptance from source |
| External send/payment/deploy | Separate explicit user authority, target, effect and receipt |
| ChatGPT conversation integration | Use documented authorized host capabilities; do not infer session control from a browser tab or GitHub link |

Do not infer an ability to run, read, write or automate ChatGPT conversations from a coding agent's ability to open a web page. Codex/OpenCode can act as hosts or workers only within the documented interfaces and permissions actually configured.

## ChatGPT-GitHub operational preflight and commit reconciliation

For a material GitHub task, reuse root `GITHUB_RULES.md`, the selected repository profile and `commit-continuity-and-recovery.md`; do **not** add a new gateway or obligatory workflow for simple read-only questions.

1. **Capability:** distinguish the available GitHub connector's actual read/write actions and scoped permission from generic product descriptions. A GitHub link or writable tool name alone does not prove authorization.
2. **Target and evidence:** pin the explicitly selected repository/branch/HEAD and current owners/affected consumers. Search, truncated trees, commit lists and partial diffs are **discovery only**; check pagination and exact paths before claiming absence or full coverage.
3. **Write admission:** establish current user intent, project holds, affected paths, current blob and HEAD. Refresh HEAD immediately before mutation, use the available expected-SHA/fast-forward guard, and stop to reconcile if it moved. Do not force-push, switch branch or bypass a denied write.
4. **Coherent effect:** prefer one logical source change/commit containing the necessary related files. If the host only permits non-atomic per-file writes, track each accepted change and report `PARTIAL_SOURCE_CHANGE` if interrupted; do not call partial integration complete.
5. **Real receipt:** after an acknowledged material commit, re-read the selected branch HEAD and exact GitHub commit object, parent and changed paths. Review source semantics against acceptance separately. A successful transport or commit message alone is not proof of implementation or local runtime behavior.
6. **Ambiguous outcome:** if a write response is lost or errors after possible persistence, first inspect the actual remote branch/commit/file state. Retry only when evidence proves it is safe; otherwise report `UNKNOWN_OUTCOME`. Stop repeated attempts that add no information.

Once source acceptance has been met, do not continue into unrelated cleanups, new validators, speculative refactors or historical workstreams. The canonical terminal rule is `execution-sop.md` **Goal lock, scope guard and terminal STOP**.

## Cost-aware GitHub reads, writes and receipt reuse

These are **choices among existing connected tools**, not a new gateway or rigid API-call quota.

1. **Select source by decision.** Pin selected branch/HEAD; read current mandatory root rules/profile, primary owner and affected consumers. Use tree/path discovery and branch-scoped metadata only when needed. Reuse exact file content only when its blob SHA is verified unchanged and content remains in effective context. On a HEAD move, inspect relevant differences before re-reading everything.
2. **Choose a one-file route when safe.** For an independent UTF-8 file edit, GitHub Contents create/update may save calls if the selected branch and current file blob SHA are supplied. **A checked file blob SHA is not a branch-HEAD lease.** Contents may not protect against an unrelated concurrent branch move; refresh HEAD before mutation, check parent/HEAD afterward, and choose Git Data when strict ancestry is material.
3. **Write multi-file changes coherently.** Prepare all related source, docs and regression fixtures, create a Git tree from pinned `base_tree`, create a commit with the pinned parent, then update the selected ref with `force=false` and a supported expected-SHA guard. An unreferenced tree/commit object is not a completed branch update. If HEAD moves, reconcile instead of force-pushing or silently overwriting.
4. **Batch reads prudently.** Independent reads may be grouped within provider limits; writes to one ref remain serialized. A wrapper's single invocation can still send multiple API requests. Never install a new tool solely to hide call count.
5. **Reuse complete receipts.** **One complete GitHub commit receipt can establish commit SHA, parent and changed paths without redundant identical commit reads.** Re-read selected HEAD and review affected semantic owners separately. Expand for pagination, renames, missing patches or actual conflict/coverage gaps; Compare is not required when complete data already agree. Source identity is not runtime PASS.
6. **STOP after acceptance.** Preserve holds and `UNKNOWN_OUTCOME` reconciliation; avoid unneeded audits and commits.

**Evidence of efficiency:** compare actual time-to-accepted-source, API operations, repeated reads, correction rounds and proof integrity when observed. A lower commit/tool count alone is not proof of improvement. Do not invent telemetry.

## Deterministic first, generative only where useful

Use the cheapest grounded query, schema check, hash, diff, parser or exact-state assertion before invoking broad agent reasoning if those checks fully settle the task. Conversely, do not replace qualitative judgment or visual acceptance with a purely numeric proxy. A deterministic gate is not a reason to ignore missing meaningful evidence.

## Failure classes and retry ceilings

Classify `SOURCE_DEFECT`, `CONTRACT_MISMATCH`, `STALE_EVIDENCE`, `TOOL_UNAVAILABLE`, `PERMISSION_DENIED`, `CONCURRENT_UPDATE`, `UNKNOWN_OUTCOME` or `NATIVE_NOT_VERIFIED`. Only retry after obtaining evidence that distinguishes the suspected cause. A denied operation is not a transient error to route around.

For non-idempotent actions with missing acknowledgement, **inspect persisted state before retrying**. If the receiving tool cannot expose it, keep status uncertain. Stop after repeated retries without new evidence, avoid hidden automatic side effects and report a concrete blocker.
