# LazyDesigner Next Action

This file owns **continuation only**, not history. Flow: `docs/01-product/flow.md`; source ownership: `docs/04-system/implementation-map.md`; proof: `current-validation.md`; native procedure: `local-acceptance-runbook.md`. Older detailed continuation is preserved in Git history (`3bbb057a` and `79d7afd`).

**Branch:** `Local`; work mode `REMOTE_GITHUB`. Do not use the user's PC as a prerequisite. `main`, prior recovery build `3.0`, installed models, signing and release publication are outside scope.

## Next REMOTE_GITHUB work

**2026-10-19 Full MCP source acceptance / repository transfer:** On exact `f373b17`, `MCP Verify` completed its `bun run verify:full` step **PASS**, covering frozen Bun 1.4.3 install, TypeScript, repository/runtime/authoring/conformance contracts, benchmarks and `Bun.build`. The overall job FAILED only in `verified-build-artifact.ts write-ci`: `Unexpected CI repository: OpenITStudios/M-LazyDesigner`. GitHub repository ID 1373998154 was unchanged; the owner namespace moved from MIVUBI-STD to OpenITStudios. Repair the current strict `VERIFIED_REPOSITORY` constant and tests; preserve exact Local ref/SHA and reject historical-owner provenance. Observe a new matching-SHA provenance step and bundle upload before claiming overall MCP PASS. Separate Desktop and security audits remain pending/FAIL.

**2026-10-19 Gateway reconnect/UV owner repair (source pending CI):** Exact-SHA MCP full on `a5c2e3c` passed repository, runtime and authoring, then failed two Gateway contract tests. A cold failed health probe began in `offline` without incrementing reconnect failures; connection owner now counts first outage once and avoids repeated backoff inflation with new focused regression. UV Layout owner assertion aligned to canonical Modelling specialization. Separately Windows CI reached Rust compilation and exposed a repair call missing update-only `None`, corrected in the preceding commit. Recheck the new SHA; security audits remain FAIL pending package-manager lockfile remediation.


1. **Accept the full MCP build provenance at exact Local SHA.** Verify updated canonical GitHub owner, SHA, ref, bundle digest and build identity; then confirm `MCP Verify` ends PASS rather than assuming successful `verify:full` means uploaded artifact.

2. **Security blockers.** Bun audit: high `@modelcontextprotocol/client@2.0.0`, `source-map-js@1.2.1` and two `undici@7.29.0` findings. Windows npm audit: high `devalue` and `source-map-js`. Use a capable Bun/npm checkout to regenerate and test real lockfiles; never hand-edit lockfiles, suppress audit or upgrade MCP major APIs without regression proof.
3. **Protocol conformance.** Latest required MCP suite PASS; optional/extension coverage remains separate from native proof.
4. **Windows Desktop.** Rust/Svelte and NSIS smoke may run diagnostically while npm audit FAILS; final job remains FAIL and installer upload is blocked until security PASS.
5. **Test modernization.** `bun run audit:tests` reads the 559 test/spec inventory; stale status is not implied. Reuse canonical `mcp/gateway/development/affectedExecution.ts` with conservative full fallback. Do not delete, weaken or auto-quarantine tests.

## Temporary Full CI

**Latest evidence:** At `a9dbb6b`, repository 278 PASS and one doc-size test FAIL; earlier complete runtime suite had 2,138 PASS plus 26 managed-install PASS. Required MCP conformance PASS; security audits FAIL. No latest-SHA build/native PASS yet.

User authorized automatic non-publishing verification on `Local` pushes. Workflows: MCP full, Dependency Security, MCP Conformance, Windows Desktop Verify and Release Readiness source-only. Manual focused MCP and separate manual release/draft/package workflows remain. No changes to `main` or user installation. An automatic push is not a PASS: inspect exact SHA, required steps and artifacts.

## System boundaries

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness, Runtime/Plugin owns native Blockbench state. Geometry↔Texturing share AUTHORING; AUTHORING↔Animation requires explicit handoff. Public Gateway: `status`, `search_capabilities`, `describe_capability`, `invoke_capability`.

**Generated files:** Only the canonical generators may update these artifacts. Use `bun run generate:owned-artifacts` in a capable checkout and `bun run docs:check`. Never hand-edit API/HTML/schema/prompt output.

## Local/native residue and STOP

LIVE_BLOCKBENCH acceptance is separate from source/static and Windows installer CI.

Matching installed Blockbench Undo/Redo, pivot/seam visuals, Texture atlas alpha, animation restoration, Save As/reopen, Windows update/rollback, particle playback, reference acceptance and cost-to-quality telemetry remain **NOT_EXECUTED / UNVERIFIED** on latest SHA. See native runbook. Native
and visual checks remain NOT_EXECUTED until actually observed. Work source → owner → regression → exact-SHA CI. No second engine, router, shadow registry, or automatic release.
