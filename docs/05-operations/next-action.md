# LazyDesigner Next Action

This file owns **continuation only**, not history. Flow: `docs/01-product/flow.md`; source ownership: `docs/04-system/implementation-map.md`; proof: `current-validation.md`; native procedure: `local-acceptance-runbook.md`. Older detailed continuation is preserved in Git history (`3bbb057a` and `79d7afd`).

**Branch:** `Local`; work mode `REMOTE_GITHUB`. Do not use the user's PC as a prerequisite. `main`, prior recovery build `3.0`, installed models, signing and release publication are outside scope.

**Product boundary: CHATGPT_FIRST / NO_STANDALONE_APP_REQUIRED (2026-10-19).** The user works in ChatGPT only; no separate LazyDesigner app, Codex, installer or local system is required. Desktop/MCP/Rust code is retained optional engineering, not a default user setup or app-building goal. Never infer native proof from CI.

## Next REMOTE_GITHUB work

**2026-10-19 verified baseline:** All five automatic Full CI workflows passed on `Local` commit [`4c0accd2617117c8c149d6061e468894469c365b`](https://github.com/OpenITStudios/M-LazyDesigner/commit/4c0accd2617117c8c149d6061e468894469c365b), including MCP full/provenance, Bun high-severity audit, required conformance, Windows Desktop npm audit/source/Rust tests/NSIS/silent-install and verified installer upload, plus source-only release readiness. See `current-validation.md` for exact run IDs and proof limits. Earlier Bun/npm security failures are superseded; do not redo their fixed lockfile work.

**Selected next unit: RustSec advisory disposition — ACTIVE, NOT ACCEPTED.** Cargo 1.98.1-generated removal of zip, serde_yaml and ureq (plus 15 transitives) is committed as [37a8f44](https://github.com/OpenITStudios/M-LazyDesigner/commit/37a8f4489c062b75ba15d721e6762fd0692f1750), matched byte-for-byte to candidate artifact 12183255612; no replacement packages or version upgrades. Existing Dependency Security workflow now includes mandatory pinned cargo-audit 0.22.2 at [fc53359](https://github.com/OpenITStudios/M-LazyDesigner/commit/fc533594991948288d25670485a49a22ecc1b6f0). Four other exact-SHA workflows PASS including Windows CI Rust tests, NSIS/silent install and installer artifact; [Dependency Security 39246298484](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39246298484) FAILS on 9 unmaintained and 1 glib unsound RustSec warnings. Bun audit remains PASS. No confirmed Rust vulnerability classification was reported.

**Next bounded action — review-only Tauri upstream candidate:** Windows target metadata confirms five `unic-*` crates still resolved from `urlpattern 0.3.0 → tauri-utils 2.9.3`. Upstream Tauri 2.12.3 requires `tauri-utils ~2.10.2` (confirmed by Cargo resolver); the corrected candidate allows Cargo to choose this compatible dependency family with `urlpattern 0.6`; a bounded, opt-in `[rust-upstream-review]` Cargo generator now replaces the completed removal-only job in existing Dependency Security. Review the candidate Cargo.lock diff and exact-SHA artifact/checksums. Do not accept the dependency update until compatible Windows locked tests, NSIS smoke and RustSec disposition are demonstrably satisfied. Keep strict advisory checks and avoid wholesale ignore. Local PC/native Blockbench testing remains DEFERRED.

After Rust is resolved, separately assess narrowly scoped compatible patch candidates (`@types/bun` relative to Bun 1.4.3, Zod, Svelte, svelte-check and Vite), regenerate only with their actual Bun/npm package managers, and avoid unnecessary MCP-server, host Blockbench, or framework migrations. Do not publish a manifest/lock mismatch. Finish each justified unit on `Local` with accepted locked/frozen install, audit, typecheck/tests/build, the canonical `bun run verify:full` source gate, and the five non-publishing Full CI workflows passing on one exact new SHA. Recheck Windows smoke and verified installer artifact when Rust/Desktop inputs change.

**Execution ceiling:** GitHub-hosted pinned Rust/Cargo, Bun/npm audits, source tests and Windows installer smoke have executed; no PC installation or native Blockbench acceptance occurred. Native and visual claims remain NOT_EXECUTED. No Codex/Work, paid runner, release or main changes.

## Temporary Full CI

Temporary `Local` push authorization remains active for the existing five non-publishing workflows: MCP Verify, Dependency Security, MCP Conformance, Desktop Verify, Release Readiness / Source Only. Manual release/draft/package gates are unchanged. A push or queued check is not PASS; evaluate required completed steps on matching SHAs. No `main`, installed user files, release, secrets, or billing changes.

## System boundaries

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness, Runtime/Plugin owns native Blockbench state. Geometry↔Texturing share AUTHORING; AUTHORING↔Animation requires explicit handoff. Public Gateway: `status`, `search_capabilities`, `describe_capability`, `invoke_capability`.

**Generated files:** Only the canonical generators may update these artifacts. Use `bun run generate:owned-artifacts` in a capable checkout and `bun run docs:check`. Never hand-edit API/HTML/schema/prompt output.

## Local/native residue and STOP

LIVE_BLOCKBENCH acceptance is separate from source/static and Windows installer CI.

Matching installed Blockbench Undo/Redo, pivot/seam visuals, Texture atlas alpha, animation restoration, Save As/reopen, Windows update/rollback, particle playback, reference acceptance and cost-to-quality telemetry remain **NOT_EXECUTED / UNVERIFIED** on latest SHA. See native runbook. Native
and visual checks remain NOT_EXECUTED until actually observed. Work source → owner → regression → exact-SHA CI. No second engine, router, shadow registry, or automatic release.
