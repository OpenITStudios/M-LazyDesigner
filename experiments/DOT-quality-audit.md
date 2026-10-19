# DOT — Quality Evaluation

## Role and authority

DOT is an evaluation aid and independent second opinion. Its purpose is to compare implemented results with the user's intended outcomes, current repository rules, and actual verification evidence, then identify specific gaps and proportionate improvements.

This document is bounded experimental review material, not a production router, approval authority, release gate, roadmap, or parallel work-state ledger. Current source and verified results take precedence. Canonical continuation remains in `docs/05-operations/next-action.md`; proof interpretation remains in `current-validation.md`. A DOT recommendation is not an implementation, accepted upgrade, or native-runtime result.

User-requested naming: DOT-authored evaluation files begin with `DOT`. This report uses one stable file instead of accumulating dated duplicate reports. Future revisions must revalidate findings against their stated SHA; Git retains history.

## Review contract

- Repository: OpenITStudios/M-LazyDesigner
- Working branch: Local
- Evaluated source: `9d6f8a3c4bcfd90c6ee0b91c741381a2bbc55858`
- Review date: 2026-10-19 UTC
- Context: REMOTE_GITHUB
- Goal: evaluate whether scoped CI and staged dependency work satisfy their intended outcomes.
- Success criteria: relevant changes trigger their owning checks; tests protect behavior rather than incidental prose; dependency claims remain bounded by actual evidence.
- Scope: recent workflow routing, affected repository contracts, advisory classification, and existing CI evidence.
- Non-goals: product redesign, dependency acceptance, Linux-support policy changes, releases, native testing, or code repairs.
- Method: exact-ref source/diff inspection and existing GitHub Actions logs/artifacts. No local test execution or new CI dispatch.
- This delivery changes only this requested report. STOP after the documentation commit is confirmed.

## Verdict

**Partially correct; not complete.** Focused path-filtered CI is an intentional efficiency improvement. It need not run the old full suite on every push. However, the latest scoped check fails, two directly relevant inputs are absent from trigger filters, and the earlier candidate-advisory identity weakness remains.

No product source or dependency version changed in the two commits since `54de9d7`. Absence of a new security run on this test-only commit does not resolve the previously observed strict RustSec failure.

## Current exact-SHA evidence

[MCP Verify run 39288880712](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39288880712), scoped job `118183999476`:

- Checkout, SHA validation and frozen Bun install: PASS.
- Repository contracts: **286 PASS, 1 FAIL**, 287 tests across 62 files.
- Failure: `development-operating-contract.test.ts:46` expects the literal `workflow_dispatch` inside GITHUB_RULES.md.
- Both subsequent TypeScript checks: **NOT EXECUTED**, because the command chains repository verification and typechecks with `&&`.
- Manual full verification job: intentionally SKIPPED, not PASS.

The failure does not demonstrate a product-runtime bug or removal of manual dispatch: the policy describes manual dispatch, and workflow YAML retains the actual event. It demonstrates an overly literal assertion/document mismatch.

## Findings and smallest complete corrections

### DOT-01 — Required scoped check fails on wording (P2, confirmed)

Owner: [repository contract test](https://github.com/OpenITStudios/M-LazyDesigner/blob/9d6f8a3c4bcfd90c6ee0b91c741381a2bbc55858/mcp/tests/repository/development-operating-contract.test.ts#L39-L50).

Expected outcome: policy and executable routing agree, and scoped checks run successfully.

Observed: prose says manual dispatch but lacks the exact underscored token demanded by the test. The failure prevents downstream typechecks.

Correction: make the assertion verify the intended policy and actual workflow event/job conditions. Align documentation terminology where useful, but do not keep adding incidental phrases merely to satisfy brittle string tests. Preserve meaningful security and proof-boundary assertions.

Acceptance: repository contracts and both typechecks complete successfully on the corrected SHA; changing the real manual/full routing incorrectly must still fail a relevant test.

### DOT-02 — Trigger filters miss direct verifier inputs (P2, confirmed)

1. [MCP push filters](https://github.com/OpenITStudios/M-LazyDesigner/blob/9d6f8a3c4bcfd90c6ee0b91c741381a2bbc55858/.github/workflows/mcp-verify.yml#L7-L16) omit `CONTRIBUTING.md`, although repository tests read and assert its contents. A change only to that file does not trigger its owning repository checks.
2. [Conformance workflow](https://github.com/OpenITStudios/M-LazyDesigner/blob/9d6f8a3c4bcfd90c6ee0b91c741381a2bbc55858/.github/workflows/mcp-conformance.yml#L7-L58) executes `mcp/scripts/operations/serve-conformance-runtime.ts` but omits that path from its trigger filter. A harness-only change does not trigger conformance execution.

These are source-derived routing findings, not deliberately pushed reproduction commits.

Correction: include the two exact paths in their owning filters; cover their routing with small tests. Keep irrelevant documentation changes from triggering heavyweight installer builds.

Acceptance: each relevant single-file change maps to its owning check; unrelated changes remain scoped. A focused PASS must not be labeled full acceptance.

### DOT-03 — Candidate advisory classifier validates count, not identity (P2, confirmed, still open)

Owner: [candidate classifier](https://github.com/OpenITStudios/M-LazyDesigner/blob/9d6f8a3c4bcfd90c6ee0b91c741381a2bbc55858/.github/workflows/dependency-security.yml#L268-L270).

Observed: it requires exactly five findings, none resolved for Windows and all resolved for Linux. It does not compare the reviewed advisory IDs, categories, crate names, or versions.

Counterexample: replacing one reviewed warning with a new Linux-only warning preserves count and platform conditions and can pass. Existing text-presence tests do not execute this case.

Correction:
- Compare an exact multiset of reviewed `(advisory ID, category, crate, version)` tuples.
- Report additions, removals, changes and duplicates for renewed review.
- Use a small pure classifier shared by workflow and executable fixture tests; no new generic framework.
- As defensive consistency hardening, require a root-reachable dependency and nonempty path for a positive root-path classification. No actual orphan-node failure was established.

Required fixtures:
- Known five findings and expected dependency paths: pass.
- Same-count replacement with a new advisory: reject.
- Same-count duplication while dropping another finding: reject.
- Changed category/crate/version: reject.
- Newly Windows-reachable warning, missing Linux package, malformed input or unprovable root path: reject with clear diagnostics.

Boundary: this is a candidate-diagnostic false-pass risk. The [strict production RustSec command](https://github.com/OpenITStudios/M-LazyDesigner/blob/9d6f8a3c4bcfd90c6ee0b91c741381a2bbc55858/.github/workflows/dependency-security.yml#L496-L500) still denies unmaintained, unsound and yanked findings. No production audit bypass was found.

### DOT-04 — Contributor guidance contradicts scoped policy (P3, confirmed)

[CONTRIBUTING.md:62–69](https://github.com/OpenITStudios/M-LazyDesigner/blob/9d6f8a3c4bcfd90c6ee0b91c741381a2bbc55858/CONTRIBUTING.md#L62-L69) introduces focused CI, then retains the old claim that every Local push runs `verify:full`.

Correction: reconcile that existing paragraph with current executable routing. Preserve the distinction between scoped checks, manual milestone proof and native proof; do not create another policy owner.

## Previous dependency evidence, explicitly not latest-SHA acceptance

At `54de9d75782c9e3d4e3090df17bd0a0c8880cb00`:
- MCP Verify, Conformance, Source Only Readiness and Desktop Verify passed.
- [Dependency Security 39280772464](https://github.com/OpenITStudios/M-LazyDesigner/actions/runs/39280772464) failed mandatory production RustSec auditing.
- Candidate artifact `12200012881` binds that SHA/run. Its five Linux dependency paths were consistent with its candidate Cargo.lock; Windows membership was false for those findings.
- Production Desktop passed integrated managed-bootstrap smoke on committed dependencies.
- Candidate Windows step results passed shell-only NSIS checks. Its job-listing status was inconsistent with the terminal workflow at inspection; no final job conclusion is asserted here.
- Neither result proves native Blockbench, update/downgrade/rollback, or Linux runtime safety.
- Candidate dependency files remain unaccepted; an old successful check cannot certify a later SHA.

The earlier npm lockfile parsing, overbroad `--ignore` assertion, and missing candidate npm audit were corrected before this review. Do not reopen them without new evidence.

## Residual dependency assessment

The candidate's four unmaintained findings and one unsound finding require different treatment:

- [glib RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) describes undefined behavior in VariantStrIter methods; the fix is >=0.20.0. Tauri 2.12.3 still selects GTK 0.18, which selects glib 0.18. Adding a separate glib 0.20 dependency does not remove the affected transitive version. No drop-in compatible remediation was established.
- [proc-macro-error RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html) is an unmaintained compile-time dependency in the inspected GTK path.
- [zvariant](https://rustsec.org/advisories/RUSTSEC-2026-0370.html), [zbus_names](https://rustsec.org/advisories/RUSTSEC-2026-0371.html), and [zvariant_derive](https://rustsec.org/advisories/RUSTSEC-2026-0372.html) are unmaintained standalone packages whose APIs moved into zbus 6. A routine patch upgrade does not establish resolution.
- [rfd 0.15.4's documented GTK3 backend](https://docs.rs/rfd/0.15.4/rfd/#linux--bsd-backends) is a bounded option for evaluating removal of its ashpd/zbus path. It changes Linux dialog behavior and requires corresponding compatibility tests; it does not fix glib. This is an option, not an approved implementation.
- Current commit messages mention Windows-only work, but this report does not grant or infer permission to drop another platform. Target-specific acceptance needs an explicit supported-target policy and evidence for build-time as well as runtime dependencies.

A RustSec JSON count of zero classified vulnerabilities does not mean zero risk or a successful strict audit.

## Recommended order

1. Correct the scoped test/policy mismatch, missing trigger inputs and contradictory contributor guidance as one coherent routing correction.
2. Correct advisory identity validation with executable negative fixtures.
3. Decide residual dependency treatment against the explicitly supported target policy, without blanket ignores or unrelated mass upgrades.
4. Accept generated dependencies only with reviewed coherent manifests/locks and appropriate same-SHA source/security/installer evidence.
5. Address source diagnostics and formatting in separate later units.

These are review recommendations. No implementation, acceptance, release authorization or automatic continuation is implied.
