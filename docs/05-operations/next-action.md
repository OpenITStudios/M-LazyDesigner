# LazyDesigner Next Action

This file owns **continuation only**, not history. Flow: `docs/01-product/flow.md`; source ownership: `docs/04-system/implementation-map.md`; proof: `current-validation.md`; native procedure: `local-acceptance-runbook.md`. Older detailed continuation is preserved in Git history (`3bbb057a` and `79d7afd`).

**Branch:** `Local`; work mode `REMOTE_GITHUB`. Do not use the user's PC as a prerequisite. `main`, prior recovery build `3.0`, installed models, signing and release publication are outside scope.

## Next REMOTE_GITHUB work

**2026-10-19 verified baseline:** All five automatic Full CI workflows passed on `Local` commit [`4c0accd2617117c8c149d6061e468894469c365b`](https://github.com/OpenITStudios/M-LazyDesigner/commit/4c0accd2617117c8c149d6061e468894469c365b), including MCP full/provenance, Bun high-severity audit, required conformance, Windows Desktop npm audit/source/Rust tests/NSIS/silent-install and verified installer upload, plus source-only release readiness. See `current-validation.md` for exact run IDs and proof limits. Earlier Bun/npm security failures are superseded; do not redo their fixed lockfile work.

**Selected next unit: dependency/Rust security hardening (Cargo artifact candidate route authorized; generated artifact and acceptance pending).** Current `Cargo.lock` retains `zip 2.4.2`, `serde_yaml 0.9.34+deprecated`, `ureq 2.12.1` and transitive `unsafe-libyaml 0.2.11`. `Cargo.toml` declares the first three directly, but all 15 Rust source modules and `build.rs` show no direct usage. These are removal candidates, subject to Cargo feature/dependency-closure confirmation. The existing `dependency-security.yml` checks Bun but has no RustSec advisory gate. No Rust lockfile, manifest or CI security policy has been changed during this read-only Rust triage.

**Minimum remaining executable step:** The existing Dependency Security workflow now has an explicit `[rust-lock-refresh]` push-commit gate that runs pinned Rust 1.98.1 Cargo removal and emits a read-only, exact-SHA, checksummed candidate artifact. Confirm the candidate job completed, download the artifact, review provenance/diff/unchanged package versions, then commit its Cargo-generated `Cargo.toml` and `Cargo.lock` together on the current `Local` HEAD. Do not hand-edit the lockfile or create another workflow. After the removal is accepted, extend the same security workflow with a pinned RustSec/Cargo audit that distinguishes vulnerabilities from unmaintained/yanked warnings, and verify locked Rust checks/tests plus Windows packaging. A candidate artifact is not an accepted source change or advisory scan.

After Rust is resolved, separately assess narrowly scoped compatible patch candidates (`@types/bun` relative to Bun 1.4.3, Zod, Svelte, svelte-check and Vite), regenerate only with their actual Bun/npm package managers, and avoid unnecessary MCP-server, host Blockbench, or framework migrations. Do not publish a manifest/lock mismatch. Finish each justified unit on `Local` with accepted locked/frozen install, audit, typecheck/tests/build, the canonical `bun run verify:full` source gate, and the five non-publishing Full CI workflows passing on one exact new SHA. Recheck Windows smoke and verified installer artifact when Rust/Desktop inputs change.

**Execution ceiling:** This session has authenticated GitHub read/write, exact-SHA CI, artifact download, and no local Cargo installation. The user explicitly approved the narrow GitHub Actions Cargo candidate exception: the runner can generate the pair without committing it, and ChatGPT can review the returned files before a separately authorized `Local` commit. Actual locked build, RustSec findings, Windows smoke and native Blockbench claims remain separate. No Codex/Work task, release or additional paid runner was initiated.

## Temporary Full CI

Temporary `Local` push authorization remains active for the existing five non-publishing workflows: MCP Verify, Dependency Security, MCP Conformance, Desktop Verify, Release Readiness / Source Only. Manual release/draft/package gates are unchanged. A push or queued check is not PASS; evaluate required completed steps on matching SHAs. No `main`, installed user files, release, secrets, or billing changes.

## System boundaries

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness, Runtime/Plugin owns native Blockbench state. Geometry↔Texturing share AUTHORING; AUTHORING↔Animation requires explicit handoff. Public Gateway: `status`, `search_capabilities`, `describe_capability`, `invoke_capability`.

**Generated files:** Only the canonical generators may update these artifacts. Use `bun run generate:owned-artifacts` in a capable checkout and `bun run docs:check`. Never hand-edit API/HTML/schema/prompt output.

## Local/native residue and STOP

LIVE_BLOCKBENCH acceptance is separate from source/static and Windows installer CI.

Matching installed Blockbench Undo/Redo, pivot/seam visuals, Texture atlas alpha, animation restoration, Save As/reopen, Windows update/rollback, particle playback, reference acceptance and cost-to-quality telemetry remain **NOT_EXECUTED / UNVERIFIED** on latest SHA. See native runbook. Native
and visual checks remain NOT_EXECUTED until actually observed. Work source → owner → regression → exact-SHA CI. No second engine, router, shadow registry, or automatic release.
