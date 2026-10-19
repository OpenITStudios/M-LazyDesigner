# LazyDesigner Next Action

This file owns **continuation only**, not history. Flow: `docs/01-product/flow.md`; source ownership: `docs/04-system/implementation-map.md`; proof: `current-validation.md`; native procedure: `local-acceptance-runbook.md`. Older detailed continuation is preserved in Git history (`3bbb057a` and `79d7afd`).

**Branch:** `Local`; work mode `REMOTE_GITHUB`. Do not use the user's PC as a prerequisite. `main`, prior recovery build `3.0`, installed models, signing and release publication are outside scope.

## Next REMOTE_GITHUB work

**2026-10-19 Final authoring + Windows proof routing (source pending CI):** Full MCP at `50cc6d7` passed repository/runtime and left one authoring source contract: bounded Geometry edits must verify affected views. Updated the modelling owner without weakening the test. Desktop's npm audit remains mandatory but now permits independent Windows source, build, and installer smoke diagnostics before an explicit failing security enforcement step; verified installer artifact upload requires a successful audit, so insecure packages never produce accepted install artifacts. New repository regression checks cover both fail-closed paths. A new exact-SHA CI run is required to prove execution; security advisories and artifact quota remain unresolved, and native Blockbench is not verified.

**2026-10-19 Authoring final owner trim (source pending CI):** Full MCP on `a104950` passed repository/runtime but had three authoring source checks: obsolete README legacy-identifier explanation, conditional `front_left_3q` fidelity rule, and oversized static source schema block. This batch clarifies the legacy migration warning and source-matched view choice and compacts existing Gateway input schema declarations/descriptions. Validator/default chains were statically compared before/after; no API additions or weakened input guards. Pending current-SHA Bun/CI. Security audit, Desktop npm audit and artifact quota are independent blockers.

**2026-10-19 Latest MCP verifier (`5db0c6d`):** repository 278 PASS, runtime 2,138 PASS plus one skipped, managed install 26 PASS; full verification next failed at seven authoring source-contract assertions. This batch fixes stale canonical ownership/bundle expectations, clarifies material cohorts and conditional rear evidence, and compresses Gateway guidance without omitting mandatory safety rules. The next exact-SHA Full CI is authoritative; no build/native PASS claimed. Security/Windows npm audits remain blocked by vulnerable dependencies requiring package-manager-managed lockfile regeneration.

1. **Recover the full source gate with `bun run verify:full`.** MCP Verify on `79d7afd` stopped at 268 repository tests passing / 10 failing. Inspect each source owner before repairing a test. This batch aligns Desktop managed-action SHA parameter, .bbmodel validation and focus text; corrects the Bun JSONC lockfile expectation and Animator identifier false positive; registers `audit:tests`. Review remaining failures after automatic exact-SHA CI, then obtain TypeScript, runtime and `Bun.build` proof.
2. **Security blockers.** Bun audit: high `@modelcontextprotocol/client@2.0.0`, `source-map-js@1.2.1` and two `undici@7.29.0` findings. Windows npm audit: high `devalue` and `source-map-js`. Use a capable Bun/npm checkout to regenerate and test real lockfiles; never hand-edit lockfiles, suppress audit or upgrade MCP major APIs without regression proof.
3. **Protocol conformance.** The pinned official 2026-07-28 suite reported 144 passing / 38 failing. Separate mandatory stateless/schema/HTTP behavior from optional Tasks extensions before source changes. Preserve a truthful conformance report; do not silently skip required tests.
4. **Windows desktop.** After audit passes, complete Rust/Svelte verification, NSIS build and install/recovery smoke on Windows CI. This is independent of native Blockbench visual acceptance.
5. **Test modernization.** `bun run audit:tests` reads the 559 test/spec inventory; stale status is not implied. Reuse canonical `mcp/gateway/development/affectedExecution.ts` with conservative full fallback. Do not delete, weaken or auto-quarantine tests.

## Temporary Full CI

**Latest evidence:** repository tests 278/278 PASS, but `MCP Verify` is still blocked by typecheck at `3a9037f`. Official MCP required conformance now PASS with optional/pending differences still visible. Both security audits remain FAIL. The present commit fixes only the unused parameter; inspect a newly completed exact-SHA run before claiming TypeScript, runtime or build acceptance.

User authorized automatic non-publishing verification on `Local` pushes. Workflows: MCP full, Dependency Security, MCP Conformance, Windows Desktop Verify and Release Readiness source-only. Manual focused MCP and separate manual release/draft/package workflows remain. No changes to `main` or user installation. An automatic push is not a PASS: inspect exact SHA, required steps and artifacts.

## System boundaries

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness, Runtime/Plugin owns native Blockbench state. Geometry↔Texturing share AUTHORING; AUTHORING↔Animation requires explicit handoff. Public Gateway: `status`, `search_capabilities`, `describe_capability`, `invoke_capability`.

**Generated files:** Only the canonical generators may update these artifacts. Use `bun run generate:owned-artifacts` in a capable checkout and `bun run docs:check`. Never hand-edit API/HTML/schema/prompt output.

## Local/native residue and STOP

LIVE_BLOCKBENCH acceptance is separate from source/static and Windows installer CI.

Matching installed Blockbench Undo/Redo, pivot/seam visuals, Texture atlas alpha, animation restoration, Save As/reopen, Windows update/rollback, particle playback, reference acceptance and cost-to-quality telemetry remain **NOT_EXECUTED / UNVERIFIED** on latest SHA. See native runbook. Native
and visual checks remain NOT_EXECUTED until actually observed. Work source → owner → regression → exact-SHA CI. No second engine, router, shadow registry, or automatic release.
