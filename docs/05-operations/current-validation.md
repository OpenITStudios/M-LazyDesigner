# LazyDesigner Current Validation

This file owns **current proof interpretation only**. Flow: `docs/01-product/flow.md`; canonical source: `docs/04-system/implementation-map.md`; continuation: `next-action.md`; native acceptance: `local-acceptance-runbook.md`. Historical detail remains in Git and linked reports.

## Current authority

**Temporary Full CI** is authorized on `Local` and source-only; publishing and actual native/visual acceptance are separate.

Branch `Local` is source authority. The persistent Gateway owns client continuity and Runtime recovery. Runtime/Plugin executes in Blockbench. **Source/static CI never proves installed/native/visual behavior.**

### Observed automatic Full CI on `79d7afded1793aef3f9e59a851466d25c7ffcd77`

| Workflow | Evidence | Verdict |
| --- | --- | --- |
| Release Readiness Source Only | [39149013636](https://github.com/MIVUBI-STD/M-LazyDesigner/actions/runs/39149013636) | **PASS**, static source policy only |
| MCP Verify / full | [39149013411](https://github.com/MIVUBI-STD/M-LazyDesigner/actions/runs/39149013411) | **FAIL**, 268 repository tests passed / 10 failed; TypeScript/runtime/build not reached |
| Dependency Security | [39149013591](https://github.com/MIVUBI-STD/M-LazyDesigner/actions/runs/39149013591) | **FAIL**, 4 high advisories |
| MCP Conformance | [39149013430](https://github.com/MIVUBI-STD/M-LazyDesigner/actions/runs/39149013430) | **FAIL**, 144 passed / 38 failed |
| Desktop Verify / Windows | [39149013598](https://github.com/MIVUBI-STD/M-LazyDesigner/actions/runs/39149013598) | **FAIL**, npm audit devalue and source-map-js; installer not reached |

The pinned **Bun 1.4.3** was installed, and `bun install --frozen-lockfile` completed successfully on MCP jobs. This establishes dependency reproducibility for this SHA, not TypeScript/build quality. Later source edits require their own exact-SHA runs. Missing, failed, skipped and cancelled results remain unverified.

## Current proof matrix

| Surface | Owner / minimum evidence | Limit |
| --- | --- | --- |
| Repository policy | `verify:repository` | Static tests, currently failing |
| MCP source, TypeScript, regression, build | `verify:full` | All required steps on same SHA |
| Dependencies | `bun audit --audit-level=high` and `npm audit --audit-level=high` | High advisories block security acceptance |
| MCP transport/protocol | Official pinned 2026-07-28 conformance | Separate required behaviors from optional Tasks extensions without hiding mandatory failures |
| Windows packaging | `Desktop Verify` and managed package proof | Built installer, provenance and smoke |
| LIVE_BLOCKBENCH | Native runbook on matching installed bundle | Undo, save/reopen, animation, recovery, visual |
| Artistic quality | User review against approved reference | Not inferred from CI |

## Current source contracts

- **Control** is under `mcp/gateway/control/`; development planning is under `mcp/gateway/development/`. The retired Navigator source remains removed. No parallel routing registry.
- The persistent Gateway keeps four tools: `status`, `search_capabilities`, `describe_capability`, `invoke_capability`. Unknown mutations are never blindly retried.
- Geometry/Texturing share AUTHORING, Animation handoff is explicit. Correct structural receipts do not establish rendered visual similarity.
- Generated API/HTML/schema/prompt outputs remain generator-owned. Do not hand-edit them to pass tests.
- No user models, installed runtime, release or `main` changes are implied by current CI.

## Last reusable proven source baseline

[Native report, 2026-10-14](native-acceptance.md#consolidated-windows-local-test-report--2026-10-14) scopes successful earlier Windows and source checks to installed `e9b3bca5` (Bun 1.3.14), prior `fcf66179` and `4cd2fd06`, and separate `561ee8e4` exact-SHA source proof. Historical debug tests, recovery snapshot `3.0` and reference work are not current-head acceptance. Native Blockbench visual quality, Golden F and reliable token savings remain unverified.

## Proof boundary

Do not strengthen source/static claims into local/live/visual claims without matching evidence from the exact current source SHA. Record SHA, run, job, scope, required successful steps and separately native evidence before claiming PASS. For a docs-only head, `Head Proof` may establish that executable source did not change; this is source equivalence, not test execution. Source-impacting heads continue to require matching-SHA source gates and native proof where applicable.
