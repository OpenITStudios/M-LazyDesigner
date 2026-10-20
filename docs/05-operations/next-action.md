# LazyDesigner Next Action

## MCP Node 24 typings alignment — 2026-10-20

MCP now explicitly pins `@types/node 24.19.2` as a **development-only** dependency, matching the supported Desktop Node 24 type line. The prior implicit root Node 20 types and nested Electron Node 24.13.3 are deduplicated into a single Node 24.19.2 entry compatible with Electron 40's `^24.9.0` declaration and Bun's `*` range. `undici-types 7.24.6` is paired with the Node typings' `>=7.24.0 <7.24.7` constraint. All SHA512 fingerprints were reused from existing published npm metadata already in Desktop's lockfile. One obsolete Electron-specific Undici 7.18.2 entry is also removed.

**Verification:** Root manifest/Bun lock match and statically resolved dependency closure checked; no additional dependency is missing. **NOT EXECUTED:** a Bun-generated lock, frozen install, actual TS7 typecheck, Gateway/runtime tests, or Windows-native checks. CI remains OFF.


## Svelte-check patch upgrade — 2026-10-20

Desktop `svelte-check` is updated **4.7.6 → 4.7.7**, released 2026-10-16. The upstream direct dependencies and TypeScript 6 peer contract are unchanged; the exact published tarball checksum matches two independently generated npm locks. Desktop `package.json` and `package-lock.json` are updated together. **Source static PASS only:** current environment still cannot download registry tarballs or execute `npm ci`; actual `svelte-check --tsgo`, TypeScript 6 compatibility check and frontend build are **NOT EXECUTED**. CI remains OFF.


## Transitive dependency compatibility correction — 2026-10-20

The existing `blockbench-types@5.2.0` package requires Electron `^40.8.0`. An audited lockfile had wrongly resolved this transitive **dev-only typings dependency** to Electron `41.10.7`, which is out of range. `mcp/bun.lock` now locks **electron 40.10.6**, the latest compatible 40.x patch. Its exact manifest/integrity match an independent Bun-generated lock record and Electron's upstream `v40.10.6` tag; all unrelated lock records remain byte-equivalent. This does **not** switch the LazyDesigner Desktop Tauri runtime to Electron.

Electron 40 has reached upstream end-of-life; upgrading it to a supported major requires an upstream `blockbench-types` release that changes its dependency constraint. This scoped alignment is a static source fix only. Bun frozen installation, compiler/runtime/build and Blockbench acceptance still remain **NOT EXECUTED**; CI remains disabled.


## Zod runtime patch 4.6.7 — 2026-10-20

`mcp/package.json` and `mcp/bun.lock` now pin Zod **4.6.7** instead of locked 4.6.5. The upstream package has no additional runtime dependencies; the published SHA512 integrity was cross-checked against independently published Nix/npm metadata. MCP Client/Server/Core 2.3.1 depend on compatible Zod `^4.2.0`, so the source graph remains satisfiable. This is **source/lockfile metadata validation**, not an executed Bun frozen install or MCP conformance proof. CI stays disabled.


## TypeScript 7 / MCP Node typings compatibility — 2026-10-20

The official MCP Server SDK v2 notes that TypeScript 6 and newer no longer implicitly includes `@types/node` when an explicit `compilerOptions.types` list is set. The MCP shared tsconfig and three overrides (`gateway/tsconfig.json`, `tsconfig.gateway-shared.json`, `tsconfig.semantic-core.json`) now explicitly add `node` while retaining their existing `bun` and Blockbench type entries. `@types/node 20.19.4` is already present in the existing MCP Bun lock, so this is a configuration compatibility correction and **does not require a dependency resolution change**.

**Verification:** four tsconfig documents parsed, inherited/overridden types checked, matching Bun lock Node types found. Actual TS7 `typecheck` / gateway source checks remain **NOT EXECUTED** until the new source can be installed and executed. No CI workflow enabled or started.


## Desktop TypeScript 7 native integration — 2026-10-20

Desktop now declares **TypeScript 7.0.2** as the native compiler alias `@typescript/native` and uses it for the primary `svelte-check --tsgo` typecheck. **TypeScript 6.0.3** remains under the canonical `typescript` name for `svelte-check`'s classic JavaScript compiler API and is verified independently via `typecheck:compat`. The existing `verify:source` chain executes both TypeScript 6 and 7 checks before Vite/Rust verification.

Both `apps/desktop/package.json` and `package-lock.json` were updated together. The reconstructed npm lock includes 20 original upstream integrity-verified TypeScript native platform binaries. No runtime/build acceptance is asserted: `npm ci`, both Svelte checks, frontend build, Cargo, and Windows packaging remain **NOT EXECUTED** because the registry and development runtime are inaccessible here. Canonical npm lockfile regeneration and actual source checks are still required. CI is still OFF.


## TypeScript 7 MCP compiler migration — 2026-10-20

The MCP declared TypeScript compiler is now **7.0.2** with TypeScript's native platform-specific binaries. The shared `mcp/tsconfig.json` changes `moduleResolution: node` to `bundler` because TypeScript 7 rejects the former. The already-declared `module: ESNext` is compatible. `blockbench-types` still requests TypeScript ^5.8.3, so a nested TypeScript 5.9.3 lock entry is retained for that package rather than silently violating its dependency constraint.

The Bun lock resolution uses original, immutable package SHA-512 integrity records from a published npm-generated TypeScript 7.0.2 lock for all 20 optional native binaries. **Source static verification only**: Bun 1.4.3 frozen install, TypeScript 7 typecheck, generated project references, MCP runtime tests, and Windows executable build are **NOT EXECUTED**, because registry/executable access is unavailable. The lock still requires canonical Bun regeneration/verification before acceptance or release. CI stays disabled.


## Vite 8 + Svelte plugin 7 source migration — 2026-10-20

**Versions in source:** `vite 8.3.4`, `@sveltejs/vite-plugin-svelte 7.3.1`. The dependency graph was reconciled against published npm lock metadata, verified Vite/plugin source manifests and SHA512 fingerprints. The old Rollup/esbuild path and orphaned inspector were pruned. Rolldown 1.2.12 with native platform bindings is present. Because `@tailwindcss/node 4.3.3` pins Lightning CSS 1.32.0 while Vite 8 requires 1.33.0, both compatible versions are explicitly resolved at their distinct dependency paths. Svelte plugin 7 uses nested `magic-string 1.4.3`, preserving the root `0.30.x` needed by Svelte and Tailwind. All reachable hard/optional dependencies and their version ranges were checked structurally.

**Proof ceiling:** This is a **reconstructed source lock**, not a package-manager-generated or installed/frozen lock proof. Registry/network restrictions prevented npm install, typecheck and `build:frontend`; these remain **NOT EXECUTED**. CI remains OFF. Do not label the new Vite pipeline production-accepted until npm independently regenerates the lockfile and the Desktop build/tests pass.


## Pending package upgrade execution evidence — 2026-10-20

**Source target selected:** MCP client/core/server 2.3.1, `@types/bun` and `bun-types` 1.4.3, Blockbench typings 5.2.0. The manifest and Bun lock graph have been assembled from upstream package manifests and independently published package-manager lock checksums. Redundant nested MCP Core 2.0.0 was removed when both SDK entrypoints converged on 2.3.1. No unrelated packages changed.

**Proof ceiling:** No Bun executable or registry tarball access is available in this session. This is a **source-level, externally validated lockfile reconstruction**, not a Bun-generated frozen install, installed TypeScript check, MCP conformance, or native Blockbench proof. These are **NOT EXECUTED**; run the canonical Bun 1.4.3 frozen install and focused checks before calling this upgrade accepted. CI remains OFF as requested. `liveValidatedBuilds` stays empty.


## Version upgrade compatibility checkpoint — 2026-10-20

**Goal:** Dependency and development-kit version increases only, on `Local`; **CI DISABLED** remains in effect. This checkpoint is version research and readiness evidence, **not** an installed upgrade or a current-head build PASS.

- **MCP SDK:** locked client/core `2.2.0`, server/nested core `2.0.0`; target coordinated `@modelcontextprotocol/client`, `@modelcontextprotocol/server`, and resolved `@modelcontextprotocol/core` `2.3.1`. Upstream `v2.3.1` requires Node >=20 and retains the root server API and `./stdio` export currently used by `mcp/gateway/index.ts`; runtime/session behavior still needs actual tests.
- **Bun typings:** `@types/bun` / `bun-types` locked `1.3.8`; target `1.4.3` matching pinned Bun `1.4.3`. Upstream `bun-types` introduces direct `undici-types: "*"` alongside `@types/node: "*"`; regenerate the full `mcp/bun.lock` using pinned Bun rather than copying just two entries.
- **Blockbench typings:** `blockbench-types` locked `5.1.0`; target `5.2.0`. Upstream direct dependency names/ranges are unchanged. This is a **source-typing** update only: do not promote `mcp/compatibility/blockbench.json` host versions to native-validated or silently change `sourceTypeBaseline` until relevant typings/source review and tests justify it.
- **Vite migration:** locked Vite `7.3.7` and `@sveltejs/vite-plugin-svelte` `6.2.4`; target coordinated Vite `8.3.4` + plugin `7.3.1`. Plugin 7.3.1 peers with Vite 8 and Svelte >=5.46.4; locked Svelte `5.57.2` meets the stated Svelte peer range. Vite 8 swaps Rollup-based build internals for Rolldown. Desktop's `vite.config.ts` uses `svelte()` and `tailwindcss()` without the plugin options removed in v7; **source shape only**, not build proof.

**Exact blocker:** Current execution environment has npm/Node but no Bun executable and cannot resolve npm registry DNS. An isolated `npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund --save-dev vite@8.3.4 @sveltejs/vite-plugin-svelte@7.3.1` failed `ENOTCACHED` on the Svelte plugin package metadata. No new lockfile was produced, no CI was started, and no manifest was committed without a generator-valid matching lockfile.

**Next implementation:** In an actually connected executable checkout, regenerate `mcp/bun.lock` with the pinned Bun for the three scoped MCP/typings upgrades, validate `bun install --frozen-lockfile`, `bun run typecheck`, `bun run typecheck:gateway` and affected tests; separately resolve Vite 8/plugin 7 with npm, `npm ci`, `npm run typecheck` and `npm run build:frontend`. Commit each coherent manifest + generated lockfile only after verification. Keep release jobs manual and all verification CI disabled. No user-PC action is assumed.


## CI DISABLED — dependency/kit upgrades only (2026-10-20)

**Accepted source change:** `Local` [`d14aa2d`](https://github.com/OpenITStudios/M-LazyDesigner/commit/d14aa2d6ed9a32f20a6d853d4ea90dc24625345d) atomically upgraded Tauri Rust and npm to 2.12.3 from generated artifact `12196594517`, with exact Git blob hashes and intact lockfiles. CI remains fully disabled; nine verification workflows are archived, while two release/distribution workflows are manual-only. No source check on the new SHA has been executed; **NOT EXECUTED** must not be reported as PASS.

**2026-10-20 Rust/Tauri version declaration update:** `Cargo.toml` requires Rust **1.90** (Tauri 2.12 minimum) and declares `tauri = 2.12.3`, `tauri-build = 2.7.3`. Both match the existing locked resolved versions; no Cargo.lock regeneration or new dependency resolution is required. Static manifest/lock alignment verified; `cargo check --locked`, installer and native Blockbench execution are **NOT EXECUTED** after disabling CI. Remaining new Bun/npm versions still require package-manager-generated lockfiles.

**2026-10-20 Rust compiler pin upgrade:** The Desktop toolchain and dormant-by-default manual Desktop Draft Release toolchain selection are aligned from **Rust 1.98.1 → 1.99.1** (stable 2026-10-15). Existing Cargo.lock and Rust dependencies remain unchanged. No GitHub CI is reenabled or dispatched, and no actual Rust compile/build on 1.99.1 is claimed; **NOT EXECUTED**.

**2026-10-20 Node.js runtime kit upgrade:** Desktop now pins the released Node.js **24.22.0 LTS** in `apps/desktop/.node-version`, and the manually dispatched desktop-release workflow reads this same canonical version file. Existing `package.json` Node 24.x engine accepts it; npm dependency versions and `package-lock.json` are unchanged. No CI was restarted. Fresh Node 24.22.0 install/typecheck/NSIS proof: **NOT EXECUTED**.

**2026-10-20 Desktop dependency floor alignment:** Seven direct frontend/type package constraints were raised to the **already resolved locked versions**: @tailwindcss/vite 4.3.3, @types/node 24.13.4, Svelte 5.57.0, svelte-check 4.7.6, Tailwind CSS 4.3.3, TypeScript 5.9.3 and Vite 7.3.6. **This does not upgrade installed dependencies to new releases.** Offline `npm install --package-lock-only --offline --ignore-scripts --no-audit` on an equivalent lockfile graph succeeded and generated only these seven root-declaration changes; source `package.json` and `package-lock.json` updated together. An online registry is still required for later latest-version updates (MCP 2.3.1, Bun types 1.4.3, Svelte 5.57.2, Vite 8 + plugin 7, Blockbench types 5.2.0). CI remains disabled; current-source runtime and build proof **NOT EXECUTED**.

**2026-10-20 Svelte patch upgrade:** Desktop `svelte` updated from locked **5.57.0** to **5.57.2**, with coherent `apps/desktop/package.json` and `apps/desktop/package-lock.json`. Published package metadata was reconciled with Svelte's upstream `svelte@5.57.2` source and the integrity fingerprint in an independent Bun lock. An offline npm `install --package-lock-only` on the extracted Desktop lock graph completed using a locally seeded, provenance-checked package metadata record. Only the Svelte root constraint and Svelte lock entry were applied to GitHub, preserving the unchanged dependency lock graph. Offline package-resolution proof is **NOT** an installed typecheck/build/Windows/Blockbench PASS; those checks remain **NOT EXECUTED**. CI remains disabled.

**2026-10-20 Node 24 type definitions upgrade:** `@types/node` locked **24.13.4 → 24.19.2** together with its required `undici-types` **7.18.2 → 7.24.6**. Desktop `package.json` and npm lock root+two resolved entries are synchronized. Offline npm `install --package-lock-only` completed successfully on the Desktop graph with provenance-checked metadata/integrity from public published lock records. Other dependency versions remain unchanged. Runtime typecheck, `npm ci`, and packaging on the new SHA are **NOT EXECUTED**; CI remains disabled.

**2026-10-20 Vite 7 maintenance upgrade:** Desktop Vite patched **7.3.6 → 7.3.7**, with `apps/desktop/package.json` and `apps/desktop/package-lock.json` synchronized. Registry integrity for 7.3.7 was cross-checked against multiple public npm-generated locks; its source manifest at upstream tag `v7.3.7` has unchanged direct dependencies and Node engine floor. Offline `npm install --package-lock-only --offline --ignore-scripts --no-audit` completed on the equivalent Desktop graph; exactly the root Vite constraint and Vite package entry changed among 149 package entries. **This is not the separate Vite 8 + Svelte plugin 7 migration.** npm package installation, source build and Windows runtime proof are **NOT EXECUTED**. CI remains disabled.

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
