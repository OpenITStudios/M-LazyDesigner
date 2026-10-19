# LazyDesigner Next Action

This file owns **continuation only**, not history. Flow: `docs/01-product/flow.md`; source ownership: `docs/04-system/implementation-map.md`; proof: `current-validation.md`; native procedure: `local-acceptance-runbook.md`. Older detailed continuation is preserved in Git history (`3bbb057a` and `79d7afd`).

**Branch:** `Local`; work mode `REMOTE_GITHUB`. Do not use the user's PC as a prerequisite. `main`, prior recovery build `3.0`, installed models, signing and release publication are outside scope.

## Next REMOTE_GITHUB work

**2026-10-19 verified baseline:** All five automatic Full CI workflows passed on `Local` commit [`4c0accd2617117c8c149d6061e468894469c365b`](https://github.com/OpenITStudios/M-LazyDesigner/commit/4c0accd2617117c8c149d6061e468894469c365b), including MCP full/provenance, Bun high-severity audit, required conformance, Windows Desktop npm audit/source/Rust tests/NSIS/silent-install and verified installer upload, plus source-only release readiness. See `current-validation.md` for exact run IDs and proof limits. Earlier Bun/npm security failures are superseded; do not redo their fixed lockfile work.

**Selected next unit: RustSec advisory disposition — ACTIVE, NOT ACCEPTED.** Cargo 1.98.1-generated removal of zip, serde_yaml and ureq (plus 15 transitives) is committed as [37a8f44](https://github.com/OpenITStudios/M-LazyDesigner/commit/37a8f4489c062b75ba15d721e6762fd0692f1750), matched byte-for-byte to candidate artifact 12183255612; no replacement packages or version upgrades. Existing Dependency Security workflow now includes mandatory pinned cargo-audit 0.22.2 at [fc53359](https://github.com/OpenITStudios/M-LazyDesigner/commit/fc533594991948288d25670485a49a22ecc1b6f0). Four other exact-SHA workflows PASS including Windows CI Rust tests, NSIS/silent install and installer artifact; [Dependency Security 39246298484](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39246298484) FAILS on 9 unmaintained and 1 glib unsound RustSec warnings. Bun audit remains PASS. No confirmed Rust vulnerability classification was reported.

**Next bounded action — classify the five residual RustSec advisories by target and dependency path:** The aligned Tauri Rust/npm 2.12.3 candidate [run 39276095004](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39276095004), artifact `12196594517`, has 0 classified RustSec vulnerabilities and exactly 5 informational findings: `RUSTSEC-2024-0370` (proc-macro-error), `RUSTSEC-2024-0429` (glib unsound), `RUSTSEC-2026-0370`, `0371`, `0372` (zvariant, zbus_names, zvariant_derive). Generator and Windows candidate tests, NSIS shell and runner silent-install PASS. No generated dependency file is committed; production all-platform RustSec remains FAIL. A bounded same-workflow candidate diagnostic now records filtered Windows/Linux Cargo graphs, shortest resolved dependency paths, and refuses unexpected warning counts or any Windows-active warnings. **Graph absence is not proof of API non-reachability.** Next review the emitted evidence and upstream-compatible Linux remediations; do not blanket-ignore, force Tauri major upgrade or accept source without explicit advisory disposition and matching-SHA final CI. Native/PC localtest remains DEFERRED.

After Rust is resolved, separately assess narrowly scoped compatible patch candidates (`@types/bun` relative to Bun 1.4.3, Zod, Svelte, svelte-check and Vite), regenerate only with their actual Bun/npm package managers, and avoid unnecessary MCP-server, host Blockbench, or framework migrations. Do not publish a manifest/lock mismatch. Finish each justified unit on `Local` with accepted locked/frozen install, audit, typecheck/tests/build, the canonical `bun run verify:full` source gate, and the five non-publishing Full CI workflows passing on one exact new SHA. Recheck Windows smoke and verified installer artifact when Rust/Desktop inputs change.

**Execution ceiling:** GitHub-hosted pinned Rust/Cargo, Bun/npm audits, source tests and Windows installer smoke have executed; no PC installation or native Blockbench acceptance occurred. Native and visual claims remain NOT_EXECUTED. No Codex/Work, paid runner, release or main changes.

## Full CI — explicit milestone only

Routine `Local` push CI runs focused path-filtered checks for MCP repository/types, Desktop source/locked Rust without NSIS, protocol conformance and dependency security. Release Readiness is manual-only. Full `bun run verify:full`, integrated Windows NSIS and milestone acceptance require explicit manual same-SHA checks. Skipped checks are **NOT EXECUTED**, not PASS. No `main`, release, user-PC installation or live Blockbench.

## System boundaries

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness, Runtime/Plugin owns native Blockbench state. Geometry↔Texturing share AUTHORING; AUTHORING↔Animation requires explicit handoff. Public Gateway: `status`, `search_capabilities`, `describe_capability`, `invoke_capability`.

**Generated files:** Only the canonical generators may update these artifacts. Use `bun run generate:owned-artifacts` in a capable checkout and `bun run docs:check`. Never hand-edit API/HTML/schema/prompt output.

## Local/native residue and STOP

LIVE_BLOCKBENCH acceptance is separate from source/static and Windows installer CI.

Matching installed Blockbench Undo/Redo, pivot/seam visuals, Texture atlas alpha, animation restoration, Save As/reopen, Windows update/rollback, particle playback, reference acceptance and cost-to-quality telemetry remain **NOT_EXECUTED / UNVERIFIED** on latest SHA. See native runbook. Native
and visual checks remain NOT_EXECUTED until actually observed. Work source → owner → regression → exact-SHA CI. No second engine, router, shadow registry, or automatic release.
