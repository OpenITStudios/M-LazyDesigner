# LazyDesigner Next Action

This file owns **continuation only**, not history. Flow: `docs/01-product/flow.md`; source ownership: `docs/04-system/implementation-map.md`; proof: `current-validation.md`; native procedure: `local-acceptance-runbook.md`. Older detailed continuation is preserved in Git history (`3bbb057a` and `79d7afd`).

**Branch:** `Local`; work mode `REMOTE_GITHUB`. Do not use the user's PC as a prerequisite. `main`, prior recovery build `3.0`, installed models, signing and release publication are outside scope.

## Next REMOTE_GITHUB work

**2026-10-19 verified baseline:** All five automatic Full CI workflows passed on `Local` commit [`4c0accd2617117c8c149d6061e468894469c365b`](https://github.com/OpenITStudios/M-LazyDesigner/commit/4c0accd2617117c8c149d6061e468894469c365b), including MCP full/provenance, Bun high-severity audit, required conformance, Windows Desktop npm audit/source/Rust tests/NSIS/silent-install and verified installer upload, plus source-only release readiness. See `current-validation.md` for exact run IDs and proof limits. Earlier Bun/npm security failures are superseded; do not redo their fixed lockfile work.

**Selected next unit: dependency/Rust security hardening (BLOCKED at canonical lockfile generation, not source diagnosis).** Current `Cargo.lock` retains `zip 2.4.2`, `serde_yaml 0.9.34+deprecated`, `ureq 2.12.1` and transitive `unsafe-libyaml 0.2.11`. `Cargo.toml` declares the first three directly, but all 15 Rust source modules and `build.rs` show no direct usage. These are removal candidates, subject to Cargo feature/dependency-closure confirmation. The existing `dependency-security.yml` checks Bun but has no RustSec advisory gate. No Rust lockfile, manifest or CI security policy has been changed during this read-only Rust triage.

**Minimum remaining executable step:** In a genuinely capable cloud `LOCAL_CODE` checkout at fresh `Local` HEAD, with pinned Rust 1.98.1, Bun 1.4.3 and Desktop Node 24, remove only confirmed-unused Rust direct dependencies using Cargo's own dependency-edit/update operations, inspect the regenerated `Cargo.lock` closure, and run locked check/test. Do not hand-edit the lockfile, introduce a replacement archive/YAML/HTTP library, or ask the user's PC to do this. Then extend the *existing* Dependency Security workflow with a version-pinned RustSec/Cargo audit using a documented fail-closed vulnerability policy; triage unmaintained/yanked and platform-specific advisories by evidence, with no blanket suppressions. Audit the **resulting** lockfile before accepting a gate; publishing a known-red gate while canonical remediation is unavailable does not complete this unit.

After Rust is resolved, separately assess narrowly scoped compatible patch candidates (`@types/bun` relative to Bun 1.4.3, Zod, Svelte, svelte-check and Vite), regenerate only with their actual Bun/npm package managers, and avoid unnecessary MCP-server, host Blockbench, or framework migrations. Do not publish a manifest/lock mismatch. Finish each justified unit on `Local` with accepted locked/frozen install, audit, typecheck/tests/build, the canonical `bun run verify:full` source gate, and the five non-publishing Full CI workflows passing on one exact new SHA. Recheck Windows smoke and verified installer artifact when Rust/Desktop inputs change.

**Execution ceiling:** This ChatGPT session has authenticated GitHub source/write and CI inspection, but no executable Bun/Cargo toolchain or registry-connected checkout. It cannot author canonical new lockfiles. GitHub Actions is verification/artifact infrastructure, not a source-edit/lockfile-generator writeback channel. Finish independent GitHub-verifiable work and preserve only this `LOCAL_CODE` residue for a capable future cloud environment. No Codex/Work task or paid runner has been initiated.

## Temporary Full CI

Temporary `Local` push authorization remains active for the existing five non-publishing workflows: MCP Verify, Dependency Security, MCP Conformance, Desktop Verify, Release Readiness / Source Only. Manual release/draft/package gates are unchanged. A push or queued check is not PASS; evaluate required completed steps on matching SHAs. No `main`, installed user files, release, secrets, or billing changes.

## System boundaries

The persistent Gateway owns client stability and Runtime recovery; Control owns context/readiness, Runtime/Plugin owns native Blockbench state. Geometry↔Texturing share AUTHORING; AUTHORING↔Animation requires explicit handoff. Public Gateway: `status`, `search_capabilities`, `describe_capability`, `invoke_capability`.

**Generated files:** Only the canonical generators may update these artifacts. Use `bun run generate:owned-artifacts` in a capable checkout and `bun run docs:check`. Never hand-edit API/HTML/schema/prompt output.

## Local/native residue and STOP

LIVE_BLOCKBENCH acceptance is separate from source/static and Windows installer CI.

Matching installed Blockbench Undo/Redo, pivot/seam visuals, Texture atlas alpha, animation restoration, Save As/reopen, Windows update/rollback, particle playback, reference acceptance and cost-to-quality telemetry remain **NOT_EXECUTED / UNVERIFIED** on latest SHA. See native runbook. Native
and visual checks remain NOT_EXECUTED until actually observed. Work source → owner → regression → exact-SHA CI. No second engine, router, shadow registry, or automatic release.
