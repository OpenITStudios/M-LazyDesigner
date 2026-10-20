# LazyDesigner Next Action

## CI DISABLED — dependency/kit upgrades only (2026-10-20)

**Accepted source change:** `Local` [`d14aa2d`](https://github.com/OpenITStudios/M-LazyDesigner/commit/d14aa2d6ed9a32f20a6d853d4ea90dc24625345d) atomically upgraded Tauri Rust and npm to 2.12.3 from generated artifact `12196594517`, with exact Git blob hashes and intact lockfiles. CI remains fully disabled; nine verification workflows are archived, while two release/distribution workflows are manual-only. No source check on the new SHA has been executed; **NOT EXECUTED** must not be reported as PASS.

**2026-10-20 Rust/Tauri version declaration update:** `Cargo.toml` requires Rust **1.90** (Tauri 2.12 minimum) and declares `tauri = 2.12.3`, `tauri-build = 2.7.3`. Both match the existing locked resolved versions; no Cargo.lock regeneration or new dependency resolution is required. Static manifest/lock alignment verified; `cargo check --locked`, installer and native Blockbench execution are **NOT EXECUTED** after disabling CI. Remaining new Bun/npm versions still require package-manager-generated lockfiles.

**2026-10-20 Rust compiler pin upgrade:** The Desktop toolchain and dormant-by-default manual Desktop Draft Release toolchain selection are aligned from **Rust 1.98.1 → 1.99.1** (stable 2026-10-15). Existing Cargo.lock and Rust dependencies remain unchanged. No GitHub CI is reenabled or dispatched, and no actual Rust compile/build on 1.99.1 is claimed; **NOT EXECUTED**.

**2026-10-20 Node.js runtime kit upgrade:** Desktop now pins the released Node.js **24.22.0 LTS** in `apps/desktop/.node-version`, and the manually dispatched desktop-release workflow reads this same canonical version file. Existing `package.json` Node 24.x engine accepts it; npm dependency versions and `package-lock.json` are unchanged. No CI was restarted. Fresh Node 24.22.0 install/typecheck/NSIS proof: **NOT EXECUTED**.

**2026-10-20 Desktop dependency floor alignment:** Seven direct frontend/type package constraints were raised to the **already resolved locked versions**: @tailwindcss/vite 4.3.3, @types/node 24.13.4, Svelte 5.57.0, svelte-check 4.7.6, Tailwind CSS 4.3.3, TypeScript 5.9.3 and Vite 7.3.6. **This does not upgrade installed dependencies to new releases.** Offline `npm install --package-lock-only --offline --ignore-scripts --no-audit` on an equivalent lockfile graph succeeded and generated only these seven root-declaration changes; source `package.json` and `package-lock.json` updated together. An online registry is still required for later latest-version updates (MCP 2.3.1, Bun types 1.4.3, Svelte 5.57.2, Vite 8 + plugin 7, Blockbench types 5.2.0). CI remains disabled; current-source runtime and build proof **NOT EXECUTED**.

**Remaining bounded upgrades — do not modify unrelated source or add new frameworks:**

1. MCP runtime: compare locked client/core 2.2.0 and server/nested core 2.0.0 with upstream stable 2.3.1. Generate `mcp/bun.lock` with Bun 1.4.3 and verify client/server/transport APIs before accepting updates.
2. Bun type declarations: compare locked `@types/bun` 1.3.8 to upstream 1.4.3, while preserving the Bun runtime 1.4.3 pin and verifying TypeScript compatibility.
3. Desktop patches: update Svelte from locked 5.57.0 to a compatible patch (upstream 5.57.2 observed). Review svelte-check, TypeScript, Tailwind and Zod from real registry metadata; regenerate only package-manager-owned lockfiles.
4. Desktop build toolkit: Vite 7.3.6 -> Vite 8 requires **coordinated** `@sveltejs/vite-plugin-svelte` 6.2.4 -> compatible 7.x (7.3.1 current observed). This is a major bundler migration; do not merge manifest-only or without source/build verification.
5. Blockbench typings: `blockbench-types` 5.1.0 -> 5.2.0 may change plugin-facing contracts. Preserve `mcp/compatibility/blockbench.json` minimum/review policy and do not claim live Blockbench 5.2.2 acceptance without actual host verification.

**Required integrity before each acceptance:** use actual Bun/npm/Cargo generated lockfiles, frozen/locked install, targeted typecheck, affected tests and build where an executable toolchain exists; record any missing checks as **NOT EXECUTED**. Do not re-enable CI, generate fake integrity strings, edit unrelated application behavior, run releases, or move `main`.

Older CI instructions below are historical and superseded by this section.


This file owns **continuation only**, not history. Flow: `docs/01-product/flow.md`; source ownership: `docs/04-system/implementation-map.md`; proof: `current-validation.md`; native procedure: `local-acceptance-runbook.md`. Older detailed continuation is preserved in Git history (`3bbb057a` and `79d7afd`).

**Branch:** `Local`; work mode `REMOTE_GITHUB`. Do not use the user's PC as a prerequisite. `main`, prior recovery build `3.0`, installed models, signing and release publication are outside scope.

## Next REMOTE_GITHUB work

**2026-10-19 verified baseline:** All five automatic Full CI workflows passed on `Local` commit [`4c0accd2617117c8c149d6061e468894469c365b`](https://github.com/OpenITStudios/M-LazyDesigner/commit/4c0accd2617117c8c149d6061e468894469c365b), including MCP full/provenance, Bun high-severity audit, required conformance, Windows Desktop npm audit/source/Rust tests/NSIS/silent-install and verified installer upload, plus source-only release readiness. See `current-validation.md` for exact run IDs and proof limits. Earlier Bun/npm security failures are superseded; do not redo their fixed lockfile work.

**Selected next unit: RustSec advisory disposition — ACTIVE, NOT ACCEPTED.** Cargo 1.98.1-generated removal of zip, serde_yaml and ureq (plus 15 transitives) is committed as [37a8f44](https://github.com/OpenITStudios/M-LazyDesigner/commit/37a8f4489c062b75ba15d721e6762fd0692f1750), matched byte-for-byte to candidate artifact 12183255612; no replacement packages or version upgrades. Existing Dependency Security workflow now includes mandatory pinned cargo-audit 0.22.2 at [fc53359](https://github.com/OpenITStudios/M-LazyDesigner/commit/fc533594991948288d25670485a49a22ecc1b6f0). Four other exact-SHA workflows PASS including Windows CI Rust tests, NSIS/silent install and installer artifact; [Dependency Security 39246298484](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39246298484) FAILS on 9 unmaintained and 1 glib unsound RustSec warnings. Bun audit remains PASS. No confirmed Rust vulnerability classification was reported.

**Next bounded action — Windows-only RustSec and aligned Tauri migration:** Only `x86_64-pc-windows-msvc` is supported. The Dependency Security workflow still audits the complete locked RustSec database but blocks only Windows-resolved vulnerabilities/unmaintained/unsound/yanked findings, disclosing other-platform findings without any ignores. Operational/database/graph uncertainty fails closed. The current Tauri 2.11.x lock should still FAIL due Windows `unic-*`. The generated aligned Rust/npm Tauri 2.12.3 candidate [39276095004](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39276095004) removes those five Windows warnings and has 0 classified vulnerabilities; candidate Windows source/NSIS shell smoke PASS. The canonical 3-file generated dependency pair remains **uncommitted**. Next verify Windows-scoped RustSec and MCP focused CI, accept the coherent candidate only after checksum/source review, then run affected Windows security/source checks and manual integrated installer milestone. No user-PC/local Blockbench test.

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
