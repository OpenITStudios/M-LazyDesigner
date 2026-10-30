# Development Scripts

This directory owns bounded source-development planning and derived development context.

```text
analyze-semantic-impact.ts       changed paths → affected capability graph
build-development-symbol-map.ts  intent → bounded TypeScript symbol map
build-knowledge-index.ts         repository knowledge → deterministic index and optional revision delta
audit-data-inventory.ts          tracked documents, fixture consumers and aliases → read-only audit
plan-development-context.ts      intent/change set → bounded Codex read targets
plan-affected-execution.ts       changed paths → minimum safe verification plan
run-affected-execution.ts        execute the bounded affected plan
plan-semantic-invalidation.ts    semantic diff → invalidation/check plan
snapshot-semantic-registry.ts    canonical semantic registry snapshot
```

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
```

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
