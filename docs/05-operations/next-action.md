# LazyDesigner Next Action

This file owns **continuation only**, not history. Flow: `docs/01-product/flow.md`; source ownership: `docs/04-system/implementation-map.md`; proof: `current-validation.md`; native procedure: `local-acceptance-runbook.md`. Older detailed continuation is preserved in Git history (`3bbb057a` and `79d7afd`).

**Branch:** `Local`; work mode `REMOTE_GITHUB`. Do not use the user's PC as a prerequisite. `main`, prior recovery build `3.0`, installed models, signing and release publication are outside scope.

## Next REMOTE_GITHUB work

**2026-10-19 Windows Rust source correction (CI pending):** Diagnostic Desktop Verify at `a5c2e3c` reached real Rust compilation after npm audit but revealed E0061 in `system_status.rs`: automatic repair omitted the third `expected_source_sha` parameter. Call now supplies `None`, matching existing rule that source SHA selection is update-only. The existing Desktop ownership contract asserts this call. Do not equate this code fix with Windows installer PASS; recheck the new exact-SHA CI. npm dependency audit remains FAIL and final security gate blocks verified installer upload.

**2026-10-19 Final authoring + Windows proof routing (source pending CI):** Full MCP at `50cc6d7` passed repository/runtime and left one authoring source contract: bounded Geometry edits must verify affected views. Updated the modelling owner without weakening the test. Desktop's npm audit remains mandatory but now permits independent Windows source, build, and installer smoke diagnostics before an explicit failing security enforcement step; verified installer artifact upload requires a successful audit, so insecure packages never produce accepted install artifacts. New repository regression checks cover both fail-closed paths. A new exact-SHA CI run is required to prove execution; security advisories and artifact quota remain unresolved, and native Blockbench is not verified.

1. **Recover full `verify:full` on the next exact SHA.** At `a9dbb6b`, repository verification reached 278 PASS but failed its current-continuation footprint ceiling; the old narratives are preserved in Git. Reach TypeScript, runtime and Bun build next.
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
