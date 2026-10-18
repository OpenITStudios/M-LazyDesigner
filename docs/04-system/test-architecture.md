# Test Architecture Modernization — Bun / LazyDesigner

**Status:** staged source implementation; no test retirement authorized yet
**Date:** 2026-10-18
**Branch:** `Local` (source authority); keep `main` unchanged without explicit approval.

## Decision

Modernize the **existing** `bun:test`, affected-work planner, temporarily automatic Local Full CI and
native-acceptance boundaries. Do not build a second test framework, autonomous
test router, result database, scheduler, or parallel source of truth. Use the
single execution selector `mcp/gateway/development/affectedExecution.ts`;
`mcp/scripts/development/plan-affected-execution.ts` and
`run-affected-execution.ts` already expose that plan.

The GitHub `Local` tree contained **559 `.test.ts` / `.spec.ts` files**
on 2026-10-18 at `703c2b58` (all under `mcp/`). This is an inventory
count, **not** evidence that 559 tests are stale or that their assertions
still pass. Test count, static match count and shorter CI duration are
not accepted-quality scores.

### Optimization objectives, in priority order

1. **Correctness and safety**: no untested public capability, mutation safety
   regression, protocol failure, lifecycle failure, or material native defect.
2. **Trustworthy proof**: separate source-string checks, pure unit behavior,
   end-to-end transport, Windows installation and actual Blockbench visuals.
3. **Change-aware selection**: on a bounded change, run the smallest
   **sufficient** owner + dependent contracts, not the smallest number of tests.
4. **Low maintenance**: one canonical implementation owner per behavior;
   consolidate duplicated assertions only with equivalent or stronger coverage.
5. **Performance**: measure elapsed time, CPU/memory, repeated cold/warm
   executions and false-negative selection on equivalent workload/commit.
   Do not weaken tests to reach a numerical speed target.

## Existing machinery to preserve

| Existing owner | Responsibility |
| --- | --- |
| `mcp/gateway/development/sourceOwners.ts` | Canonical source owner/anchor |
| `mcp/gateway/development/impact.ts` | Semantic change impact |
| `mcp/gateway/development/affectedExecution.ts` | Single affected-test/source-gate planner |
| `mcp/scripts/development/plan-affected-execution.ts` | On-demand inspection of planned work |
| `mcp/scripts/development/run-affected-execution.ts` | Sequential execution with fail-on-error |
| `mcp/tests/**/*.test.ts` and co-located tests | Bun test evidence |
| `.github/workflows/mcp-verify.yml` | Full exact-SHA on Local push, focused/full manual source verification |
| `.github/workflows/desktop-verify.yml` and `managed-distribution.yml` | Separate Windows packaging and desktop proof |
| `docs/05-operations/current-validation.md` | Actual executed proof, not aspirations |

Do not infer new routes from shared names alone. Unknown changes,
dependency/lockfile/Bun/toolchain changes, truncated semantic analysis,
public identity/schema changes, or uncertain test mapping retain
conservative **full verification**. A targeted PASS is never a `verify:full`
PASS. Changed source or test inputs invalidate evidence reuse.

## Test evidence tiers and retirement rules

| Tier | What it proves | Representative evidence | Not proven |
| --- | --- | --- | --- |
| T0: static/ownership | Direct links, policy and schema declarations | Repository source assertions | Executed behavior |
| T1: deterministic unit | Real pure function behavior, including invalid cases | `bun:test` functional assertions | Transport/native visuals |
| T2: integration/transport | Contract routing, lifecycle, exact outputs, retries, resources | MCP/Gateway fixtures; fault injection | Installed Blockbench |
| T3: platform/package | Executable, installation, rollback, Windows behavior | Non-publishing Windows GitHub Actions | Actual editor model fidelity |
| T4: native/visual | Installed exact-bundle behavior, Undo, save/reopen, image/reference parity | Matching-build Blockbench acceptance | Unobserved user scenarios |

Treat a source-reading `toContain` test as a **possible T0 review candidate**,
not automatically stale. Even a textual assertion may guard a critical
boundary. Do not replace a verified T1/T2 failure-path assertion with a
T0 string check. Conversely, do not claim a `bun:test` test is a behavior
test merely because Bun executed it.

A test may be marked `RETIRE_CANDIDATE` only with all of:
- its original **claim**, owning source and behavior are identified;
- the old claim is demonstrably obsolete, duplicated or superseded;
- replacement tests cover the equivalent positive, negative and edge cases
  (including failure/rollback, whenever applicable);
- focused and owning cross-domain tests execute successfully on the same SHA;
- no security, public API, dependency, user data or native evidence is lost.

Prefer `KEEP`, `REPAIR`, `CONSOLIDATE_CANDIDATE`, `RETIRE_CANDIDATE`.
**No automatic deletion, quarantine by filename/age, mass snapshot update,
skip-if-fails, weakening expected errors or hiding failures.** Quarantine
requires a reproducible platform defect, its owner, scope, expiry and
independent release gate.

## Phased execution plan

### Phase 0 — Inventory and preserve proof (source implemented; acceptance pending)

- Count actual `.test.ts`/`.spec.ts` files across MCP rather than
  trusting historical count.
- Use the **on-demand**, read-only
  `mcp/scripts/development/audit-test-inventory.ts` to group tests by
  owner and identify *possible* source-text assertion review candidates.
  This is a heuristic; it does not test staleness or select runtime tests.
- Run the pure inventory tests in
  `mcp/tests/development/test-inventory-audit.test.ts`.
- Map recent Texturing modules directly to their owner tests **inside**
  the existing `affectedExecution.ts`; preserve existing semantic owner
  mapping and full fallback.
- Preserve `Bun 1.4.3` pin and `tsc` as source baseline candidates,
  subject to actual executable/Windows validation.

**Commands on a capable cloud checkout, with exact Local SHA:**

```bash
cd mcp
bun install --frozen-lockfile
bun run ./scripts/development/audit-test-inventory.ts
bun test tests/development/test-inventory-audit.test.ts tests/development/affected-execution.test.ts
bun run typecheck
```

**Exit criteria:** auditable inventory summary, truthful review candidates,
selected changed-owner regressions and conservative fallback, passing
source/type tests. Current chat's GitHub source review is not this proof.

### Phase 1 — Identify staleness with an explicit evidence ledger

- Review affected tests **by source-owner cluster**, not all 559
  sequentially. Begin with Texturing seam/masks/UV, capability manifests,
  Gateway lifecycle and distribution—the areas changed recently.
- For each test under review, record temporarily in issue/PR notes or the
  owning change's commit message: test path, original claim, current source
  owner, observed execution, retained/replacement checks and decision.
  **Do not maintain a second permanent test database.**
- Detect code-only assertions, generated-file checks, duplicated assertions,
  deleted owners, and tests that exercise no real logic. Prove before
  labeling `RETIRE_CANDIDATE`.
- Account for co-located tests and fixture-dependent tests; missing import
  mapping is not proof a test is unnecessary.

**Exit criteria:** first bounded owner cluster audited, no unsupported stale
label, and every proposed retirement has proof obligations.

### Phase 2 — Replace weak tests with behavior and failure-path contracts

- Upgrade value-poor source-string tests to behavior only when an import-safe
  owner and deterministic fixture are available.
- Prioritize mutation no-op prevention, alpha/material integrity, public
  schema, project affinity, interrupted-operation handling, persistence and
  lifecycle rollback.
- Use table-driven positive/negative/edge cases and equivalent golden data.
  Keep T0 policy checks for static safety and source ownership.
- Consolidate duplicate fixtures only after comparing coverage and same-SHA
  test results, with a recoverable Git history.

**Exit criteria:** representative changed-domain behaviors are exercised
without reducing acceptance breadth or native fidelity standards.

### Phase 3 — Prove affected selection accuracy and CI economy

- Exercise `plan:affected` / `verify:affected` with actual changed files;
  source-owner anchors, fixture dependencies and cross-domain consumers
  must be included. Fail closed to full on unknown or truncated changes.
- Add a targeted selection replay corpus to the **existing planner tests**,
  covering positive match, negative unrelated change, changed test,
  toolchain change, public schema/identity and mixed-owner change.
- During temporary user-authorized Full CI, push to `Local` automatically
  runs the existing non-publishing full MCP, dependency security, MCP
  conformance, Windows Desktop and source-only readiness workflows.
  Focused runs and release checks remain manual; no automatic publishing,
  `main`, PR, tag, schedule, workflow chaining or write permission.
- Evidence artifacts record exact SHA, selected scope and required steps;
  skipped required steps cannot produce PASS.

**Exit criteria:** no observed critical false-negative selections; focused
run does not claim full acceptance; full fallback remains reliable.

### Phase 4 — Bun runtime and cost-to-result validation

- Compare pinned Bun source build/test behavior against the last accepted
  baseline using identical source, inputs and Windows target.
- Measure warm/cold test wall-clock, isolated process startup, Gateway
  idle CPU/memory, bundled module behavior and Windows binary
  install/rollback. Measure multiple trials, not one speed figure.
- Treat `bun check` as experimental until it matches canonical `tsc`
  diagnostics and project-reference behavior; keep `tsc` authoritative.
- Optimize process/test-suite overhead only if parity and safety pass.

**Exit criteria:** actual exact-SHA executable benchmark and regressions;
no performance claim imported from upstream Bun used as LazyDesigner proof.

### Phase 5 — Native Blockbench first-localtest readiness

- Require source, relevant Windows package and compatibility-gate evidence
  before native acceptance of the exact installed plugin bundle.
- Verify Undo/Redo, geometry, UV, alpha/material rendering, animation,
  save/reopen/export, project switching and Gateway reconnect/recovery.
- The actual approved visual reference and current model screenshots are
  mandatory for material visual PASS. CI-only PASS cannot replace these.
- Release remains separately authorized; no automatic publishing.

**Exit criteria:** matching-build native/visual acceptance or explicit
bounded unverified residue. Never substitute CI, tests or a benchmark.

## Maintenance and continuation

After each phase: reconcile current `Local` HEAD; update the relevant
canonical code/tests and **current** `docs/05-operations/next-action.md`;
record actual evidence in `current-validation.md`, linking exact SHA and
run/job where executed. Git retains the retired test and its rationale.
The plan is modular: change a phase, test owner or verifier without replacing
the entire framework. Do not create another test-router Skill or test DB.

**Stop:** no mass removal, no automatic release, no claim that the suite is
faster or more accurate until controlled measurements and equivalent
behavioral coverage exist.
