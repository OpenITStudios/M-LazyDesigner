# LazyDesigner Current Validation

This file owns **current proof interpretation only**. Flow: `docs/01-product/flow.md`; canonical source: `docs/04-system/implementation-map.md`; continuation: `next-action.md`; native acceptance: `local-acceptance-runbook.md`. Historical detail remains in Git and linked reports.

## Current authority

**2026-10-19 accepted dependency-security baseline:** `Local` source commit [`4c0accd2617117c8c149d6061e468894469c365b`](https://github.com/OpenITStudios/M-LazyDesigner/commit/4c0accd2617117c8c149d6061e468894469c365b) completed all five existing automatic non-publishing Full CI workflows successfully on the **same SHA**. The mandatory steps, rather than only the parent workflow conclusions, were checked. This is source/CI evidence, not `LIVE_BLOCKBENCH` or visual/native acceptance.

| Workflow | Exact-SHA run | Completed mandatory evidence |
| --- | --- | --- |
| MCP Verify | [39229922814](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39229922814) | Bun 1.4.3 frozen install, `bun run verify:full`, provenance and compatibility artifact upload PASS |
| Dependency Security | [39229922728](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39229922728) | Frozen Bun install and `bun run security:audit` PASS |
| MCP Conformance | [39229922694](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39229922694) | Pinned official required conformance PASS; optional/extensions do not imply native acceptance |
| Desktop Verify (Windows) | [39229922742](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39229922742) | Node 24/npm install and audit, Svelte/source verification, locked Cargo checks/tests, NSIS bundle, silent install/bootstrap, checksum/provenance and installer artifact upload PASS |
| Release Readiness / Source Only | [39229922734](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39229922734) | Inspector test and source-only policy preflight PASS; no release publication |

Intentional conditional skips were MCP's manual `texture` branch and the Desktop audit-failure enforcement branch (because the npm audit succeeded). They were not required failures or bypassed security checks.

The source-lock baseline retains MCP client/core `2.2.0`, server/nested core `2.0.0`, TypeScript `5.9.3`, Zod `4.6.5`, and `@types/bun` `1.3.8`; Desktop retains Svelte `5.57.0`, svelte-check `4.7.6`, Vite `7.3.6`, Tailwind `4.3.3`, devalue `5.9.4`, and source-map-js `1.2.2`. The previously blocking Bun/npm high advisories were remediated by package-manager-generated accepted lockfiles in the baseline commit. The lower-severity `blockbench-types`/Vue advisory is not a reason to upgrade host types without compatibility review.

**2026-10-19 Rust and Windows source CI:** Cargo 1.98.1 generated the removal of three unused Rust direct dependencies and 15 transitive package versions, without introducing any new versions. Generated Cargo.toml/Cargo.lock were byte-verified against read-only artifact 12183255612 and committed at [37a8f448](https://github.com/OpenITStudios/M-LazyDesigner/commit/37a8f4489c062b75ba15d721e6762fd0692f1750).

At exact [fc53359](https://github.com/OpenITStudios/M-LazyDesigner/commit/fc533594991948288d25670485a49a22ecc1b6f0), [MCP Verify](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39246298469), [MCP Conformance](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39246298466), [Windows Desktop Verify](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39246298517), and [source-only Release Readiness](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39246298463) **PASS**, including Desktop locked Rust tests, NSIS build, silent-install/bootstrap smoke and installer upload. [Dependency Security](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39246298484) **FAIL** only in the new strict RustSec job while Bun frozen-install/security audit PASS. The RustSec scan retrieved 1,338 security advisories and reported 10 denied informational warnings (9 unmaintained, 1 glib unsound); no classified vulnerability was reported in that run.

Risk remains open: proc-macro-error (GTK/Tauri), five unic-* packages (urlpattern/tauri-utils), zbus_names/zvariant/zvariant_derive (ashpd/rfd), and glib 0.18.5 (GTK/Tauri, RUSTSEC-2024-0429). Cargo.lock captures cross-platform transitive dependencies, not only the Windows target. The existing RustSec workflow now adds a locked Windows-target Cargo graph diagnostic before its unchanged strict audit, without asserting safety from graph membership. No blanket advisory ignores, migration, release or native Blockbench proof have been accepted.

**Temporary Full CI** remains limited to the five existing non-publishing `Local` workflows; optional/manual release and live Blockbench gates remain separate.

## Current proof matrix

| Surface | Accepted proof or current gap |
| --- | --- |
| Repository/MCP contracts, TypeScript and bundle | Exact SHA `4c0accd` MCP Verify PASS |
| Bun/npm high-severity dependency gate | Exact SHA `4c0accd` security and Desktop npm audits PASS; lower-severity findings are not a global security guarantee |
| Rust/Cargo advisories | **EXECUTED / FAIL** at fc53359: 9 unmaintained and 1 unsound warnings, no classified vulnerability reported; no exemptions or advisory waiver |
| MCP conformance | Exact SHA `4c0accd` required conformance PASS; optional tests and installed Runtime remain separate |
| Windows installation | Exact SHA `4c0accd` Desktop NSIS/silent-install/bootstrap and verified artifact PASS |
| LIVE_BLOCKBENCH/visual/rollback | **NOT EXECUTED** on current source; follow the native acceptance runbook |

## Current source contracts

- **Control** is under `mcp/gateway/control/`; development planning is under `mcp/gateway/development/`. The retired Navigator source remains removed. No parallel routing registry.
- The persistent Gateway keeps four tools: `status`, `search_capabilities`, `describe_capability`, `invoke_capability`. Unknown mutations are never blindly retried.
- Geometry/Texturing share AUTHORING, Animation handoff is explicit. Correct structural receipts do not establish rendered visual similarity.
- Generated API/HTML/schema/prompt outputs remain generator-owned. Do not hand-edit them to pass tests.
- No user models, installed runtime, release or `main` changes are implied by current CI.

## Last reusable proven source baseline

The latest accepted source baseline is `4c0accd` with all five matched workflow passes above. Older installed/native evidence below is **historical**, not native acceptance for `4c0accd` or this documentation-only commit.

[Native report, 2026-10-14](native-acceptance.md#consolidated-windows-local-test-report--2026-10-14) scopes successful earlier Windows and source checks to installed `e9b3bca5` (Bun 1.3.14), prior `fcf66179` and `4cd2fd06`, and separate `561ee8e4` exact-SHA source proof. Historical debug tests, recovery snapshot `3.0` and reference work are not current-head acceptance. Native Blockbench visual quality, Golden F and reliable token savings remain unverified.

## Proof boundary

Do not strengthen source/static claims into local/live/visual claims without matching evidence from the exact current source SHA. Record SHA, run, job, scope, required successful steps and separately native evidence before claiming PASS. For a docs-only head, `Head Proof` may establish that executable source did not change; this is source-equivalence evidence, not test execution. Source-impacting heads continue to require matching-SHA source gates and native proof where applicable.
