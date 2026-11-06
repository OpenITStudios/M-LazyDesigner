# Development Scripts

This directory owns bounded source-development planning and derived development context.

```text
analyze-semantic-impact.ts       changed paths → affected capability graph
build-development-symbol-map.ts  intent → bounded TypeScript symbol map
build-knowledge-index.ts         repository knowledge → deterministic index and optional revision delta
audit-data-inventory.ts          tracked documents, fixture consumers and aliases → read-only audit
audit-source-reachability.ts     TypeScript import graph → runtime / tooling / test-only / unreferenced review
plan-development-context.ts      intent/change set → bounded Codex read targets
plan-affected-execution.ts       changed paths → minimum safe verification plan
run-affected-execution.ts        execute the bounded affected plan
plan-semantic-invalidation.ts    semantic diff → invalidation/check plan
snapshot-semantic-registry.ts    canonical semantic registry snapshot
```

## Read-only branch readiness impact

`plan:affected` reuses the canonical capability manifest to show qualified
prerequisites that may be obscured by an unselected operation, including
`manage_animation_timeline` with its shared fallback graph. The diagnostic
is emitted for graph/manifest changes and Control search-projection changes.
Its `catalog_authority: MANIFEST_ONLY_NOT_RUNTIME_EXPOSURE` field means
that planned or unregistered capabilities are **not** asserted executable.
The plan does not change capability facts, regenerate API contracts or run
tests. Semantic source revisions still require their canonical generator and
matching proof; this read-only result cannot override that gate.

These scripts may consume canonical Gateway/lib owners, but product/runtime source must never depend on this directory.

Prefer the package commands rather than invoking files directly:

```bash
bun run plan:development-context -- "<intent>" --changed <path>
bun run plan:affected -- <path>
bun run verify:affected -- <path>
bun run plan:affected -- --auto
bun run verify:affected -- --auto --expect-sha <exact-Local-HEAD>
bun run analyze:semantic-impact -- <path>
bun run audit:data # optional --strict fails on authored broken links/alias chains
bun run audit:reachability # optional --sample-limit=0..100 --review-offset=N, never auto-delete
```

## Source reachability and orphan review

`audit:reachability` is an **on-demand read-only** TypeScript graph inspection.
It starts from the actual Plugin `index.ts`, Gateway `gateway/index.ts`,
package.json-owned script entrypoints, and test imports. It tracks two
projections of the same TypeScript AST: syntactic **value imports** for
potential Runtime/CLI reachability and **all source imports**, including
erased `import type`/`export type` and import-type queries, for source
ownership. The `TYPE_ONLY_REFERENCED` class preserves compile-time
dependencies rather than falsely claiming they are bundled or orphaned.
Test-only modules, external compatibility candidates and unreferenced
source **review candidates** remain separate. Standalone JavaScript CLI
files under `scripts/` (including `.mjs`) and compatibility sources are
included even when they are outside TypeScript config globs; an unreferenced
manual CLI is a review item, not automatic dead-code evidence. The existing
script-entrypoint ownership test explicitly retains the manual AI image
ingestion QA probe and checks its diagnostic-only scope.
Unreferenced review candidates appear **before** compatible facades, with
`review_candidate_count`, `review_offset`, and `review_next_offset` for
deterministic bounded pagination. `--sample-limit=0` gives counts only;
use `--review-offset=<number>` to page until `review_next_offset=null`.
Unresolved local imports, missing declared roots and nonliteral dynamic
imports are reported rather than silently ignored. A syntactic value import
still does not prove emitted JavaScript, installed Runtime registration or
actual execution.
This audit also cannot prove external consumers, model quality or safe deletion. Pair its findings with
existing `audit:unused`, exact owner tests, manifest/Runtime inventory
and focused production caller review. No new Runtime module, cleanup
automation, CI workflow or persistent graph is created.

## Cross-repository efficiency adoption

`--auto` borrows the Git change-discovery pattern from M-Lazy-Developer and
M-Minecraft-Emulator. It checks tracked and untracked nonignored paths; on a
clean checkout, it checks the latest commit against its first parent (initial
commit: all tracked paths). Renames retain both old and new ownership paths.
Unknown or empty change sets retain the conservative full verification gate.

`--expect-sha` refuses mismatched HEAD **and** staged, unstaged or nonignored
untracked files before tests. Omit it when deliberately verifying a dirty
working tree: that result cannot count as exact-commit evidence. Both flags reuse
the existing plan/verify commands, not a new runner or registry. Planning is
read-only; no CI, installs, cache deletion or native acceptance is implied.
