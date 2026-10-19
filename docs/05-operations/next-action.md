# LazyDesigner Next Action

This file owns **continuation only**, not history. Flow: `docs/01-product/flow.md`; source ownership: `docs/04-system/implementation-map.md`; proof: `current-validation.md`; native procedure: `local-acceptance-runbook.md`. Older detailed continuation is preserved in Git history (`3bbb057a` and `79d7afd`).

**Branch:** `Local`; work mode `REMOTE_GITHUB`. Do not use the user's PC as a prerequisite. `main`, prior recovery build `3.0`, installed models, signing and release publication are outside scope.

## Next REMOTE_GITHUB work

**2026-10-19 Current exact-SHA gate:** At `1e37433`, MCP full+provenance, required conformance and source-only release readiness PASS. Windows CI proved Svelte 0 errors, Rust 78/78 PASS, NSIS build and silent install PASS, but intentionally FAILS on npm security; verified Windows artifact upload is suppressed. Four MCP high advisories and two Desktop high packages remain. The source-only PowerShell timeout fix passed in real Windows CI. No current release/native Blockbench authorization or proof.

1. **Preserve accepted MCP source evidence.** Matching SHA `1e37433` has successful full Bun verification, exact build provenance and uploaded MCP bundle; repeat only after the source/dependency inputs change.

2. **Security blockers.** Bun audit: high `@modelcontextprotocol/client@2.0.0`, `source-map-js@1.2.1` and two `undici@7.29.0` findings. Windows npm audit: high `devalue` and `source-map-js`. Use a capable Bun/npm checkout to regenerate and test real lockfiles; never hand-edit lockfiles, suppress audit or upgrade MCP major APIs without regression proof.
3. **Protocol conformance.** Latest required MCP suite PASS; optional/extension coverage remains separate from native proof.
4. **Windows Desktop.** Latest Windows Rust/NSIS/silent installer smoke PASS, but source/package acceptance still FAILS while Desktop npm audit is unsafe; after lockfile remediation rerun exact-SHA full Windows gate and confirm installer artifact upload.
5. **Test modernization.** `bun run audit:tests` reads the 559 test/spec inventory; stale status is not implied. Reuse canonical `mcp/gateway/development/affectedExecution.ts` with conservative full fallback. Do not delete, weaken or auto-quarantine tests.

## Temporary Full CI

**Latest evidence:** `1e37433`: full MCP and verified bundle PASS; conformance PASS; Windows smoke and Rust PASS but final Desktop FAIL (audit); Bun security FAIL. Native Blockbench NOT_EXECUTED.

User authorized automatic non-publishing verification on `Local` pushes. Workflows: MCP full, Dependency Security, MCP Conformance, Windows Desktop Verify and Release Readiness source-only. Manual focused MCP and separate manual release/draft/package workflows remain. No changes to `main` or user installation. An automatic push is not a PASS: inspect exact SHA, required steps and artifacts.

## System boundaries

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness, Runtime/Plugin owns native Blockbench state. Geometry↔Texturing share AUTHORING; AUTHORING↔Animation requires explicit handoff. Public Gateway: `status`, `search_capabilities`, `describe_capability`, `invoke_capability`.

**Generated files:** Only the canonical generators may update these artifacts. Use `bun run generate:owned-artifacts` in a capable checkout and `bun run docs:check`. Never hand-edit API/HTML/schema/prompt output.

## Local/native residue and STOP

LIVE_BLOCKBENCH acceptance is separate from source/static and Windows installer CI.

Matching installed Blockbench Undo/Redo, pivot/seam visuals, Texture atlas alpha, animation restoration, Save As/reopen, Windows update/rollback, particle playback, reference acceptance and cost-to-quality telemetry remain **NOT_EXECUTED / UNVERIFIED** on latest SHA. See native runbook. Native
and visual checks remain NOT_EXECUTED until actually observed. Work source → owner → regression → exact-SHA CI. No second engine, router, shadow registry, or automatic release.
