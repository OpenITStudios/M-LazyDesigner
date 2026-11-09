# Harness² isolated source audit — 2026-11-09

**Repository:** `OpenITStudios/M-LazyDesigner` · **source baseline:** `Local@4015a05518b17f978adf10d29e0374183b2a283d` · **authorized experiment:** `Harness` · **context:** `REMOTE_GITHUB`.

**Evidence ceiling:** exact GitHub tree and selected source/contract review, not a complete line-by-line audit or an executed test. The repository-wide tree inventory contains **2,536 entries** (**2,344 blobs**) at baseline. The latest **100 commits** were inventoried, not the entire history. **12** project Skills were enumerated. `mcp/tests/` contains **603 blobs** (source tests, fixtures and supporting files, not 603 executed tests). Counts describe tracked source, never runtime capability or achieved quality.

This document is isolated experimental analysis, **not** a production authority or an additional continuation state. Canonical semantic/source owners remain under `docs/`, `mcp/`, `.agents/`, and `apps/`; `docs/05-operations/next-action.md` remains the operations continuation owner. Never auto-promote this candidate into `Local`.

## Deep-scan coverage and findings

| Scope | Evidence inspected | Finding | Decision |
| --- | --- | --- | --- |
| Repository authority and safety | root `AGENTS.md`, `GITHUB_RULES.md`, `mcp/AGENTS.md`, permission helper and fixture | Previous preflight recognized only `Local`/`main`; a user-selected experiment branch could not pass the exact-file write gate. | Fixed narrowly on `Harness`, preserving fail-closed paths, tasks, lanes, release and `main` policy. |
| Desktop/UI | latest editor/UI commits, `apps/desktop/package.json`, Desktop README and current operations evidence | Approved HTML is a source preview; Svelte/Tauri/Windows/Blockbench native acceptance remains unverified. Closed-editor recovery and Detach are source-authored. | **Freeze approved UX**; treat native F3 integration as a separate release-blocking proof gate. |
| Control/Gateway | `mcp/gateway/control/readiness.ts`, `referenceParser.ts`, Control README, package rules | The existing routing/projection makes a crucial distinction between a resolvable Skill handle and content actually read by the agent; a model-facing readiness label is not proof of instruction use. | No duplicate router or broad Skill preload. Preserve explicit missing-evidence states. |
| Geometry/rig | `mcp/lib/geometry/modelQuality.ts`, authoring benchmark corpus and current validation owner | Coarse projected bounds are deliberately **not** a silhouette/visual-fidelity verdict. Recent sweep/contact/twist guards have source-authored regressions but no native proof. | Test causal shape, part attachment, negative space and pivot validity across profiles before visual promotion. |
| Texture/UV | texture/UV source inventory, quality benchmark dimensions, authoring-quality contract | Separate UV, seam, mapped surface and palette dimensions are present, but a static PASS cannot establish user-approved mapped appearance. | Preserve Geometry-owned UV sign-off and Texturing-owned atlas/material validation. |
| Animation | animation source inventory, quality corpus and Golden Task contract | Independent motion quality needs timed playback, contact/clearance and native Save/Reopen/Export. | Do not substitute keyframe counts or receipt success for motion acceptance. |
| Evaluation and efficiency | `mcp/scripts/evaluate/evaluate-harness-candidate.ts`, `compare-golden-sessions.ts`, tests and Golden docs | Candidate evaluation has provenance, session, reference and model gates. **But its CLI previously returned `REVIEW_REQUIRED` or `REJECTED_QUALITY` with only declared context hashes when context files were omitted.** | Gate the CLI's review/veto classification on actual selected context-byte verification, still without claiming agent consumption. |
| Universal quality evidence | `mcp/tests/fixtures/quality-benchmark-cases.json`, `golden-task-cases.json`, associated contracts | **Six benchmark profiles** exist as synthetic quality contracts, while **one** end-to-end Golden Task (Beacon Courier Bot, mechanical) is registered and marked `UNMEASURED`. | Strongest generalization gap. Do not attribute universal improvement to a single mechanical task or synthetic checks. |
| CI and reproducibility | `.github/workflows/`, `.github/disabled-workflows/`, package scripts and manual-workflow-policy test | Two active manual distribution workflows; **nine disabled verification workflows**. Source tests and benchmarks are available but no exact-SHA execution proof is established in this ChatGPT/GitHub context. | Leave CI disabled; never claim that an authored test passed. |

## Eight-method applicability check

- **Karpathy Guidelines + Ponytail — APPLY:** minimum causal change, failure-first negative cases, no unrelated refactor.
- **Pstack / Poteto — APPLY selectively:** investigation and bounded performance-review playbook; **not** a second Control router or unattended agent service.
- **Harness² — APPLY:** isolated `propose → probe → compare → reflect`; no autonomous rollout or promotion.
- **DeepSeek Harness — APPLY as research:** tool/session admission and lifecycle isolation; no host replacement.
- **REA — NOT_APPLICABLE:** no black-box target, authorized provider or native reverse-engineering task.
- **UI UX Pro Max — FROZEN:** preserve the approved user-facing design; no UI redesign in this task.
- **Matt Pocock engineering methods — APPLY selectively:** precise ownership, deep boundaries, Standards-versus-Spec review, regression intent.

**Skill loading:** The system's 12 project Skills are *available* but must **not** all be simultaneously loaded. Select one relevant owner for an actual task; this audit used repository development/Skill-boundary rules and did not pretend to run every visual specialist. `NOT_LOADED` is distinct from `EXECUTED`.

## Ranked experiment backlog (not accepted improvements)

| Priority | Controlled question | Falsifier / acceptance | Available here |
| --- | --- | --- | --- |
| P0 | Is the Harness comparison itself safe against unverified instructions? | Candidate cannot become review/reject-ready without selected file-byte identity; declared hashes alone yield `INCONCLUSIVE`. | Source fix + negative regression authored; executable test **NOT_EXECUTED**. |
| P0 | Can a complete asset be authored correctly and reproducibly? | Accepted native Golden report must include matched input/reference/runtime/session identity, current capture, correct UV/rig/texture/motion, and independent saved-artifact/human acceptance. | Existing contract only; measurement **UNMEASURED**. |
| P0 | Is native Blockbench host/recovery safe? | Actual selected HWND, center hit-test, Detach/recovery, focus, Undo/Save and persistence must work on matching Windows build. | Source review only; native **UNVERIFIED**. |
| P1 | Does geometry reasoning generalize beyond one object? | Paired cross-profile cases for furniture, vehicle, character, organic, mechanical and cutout; reject hallucinated parts, broken attachments, lost negative space and unsupported rotation/overlap. | Synthetic reference/contract reasoning possible; no empirical universal PASS. |
| P1 | Can texture and animation retain quality with less work? | Equivalent approved visual/material and timed playback at lower measured corrections/tool cost; no loss of UV or joint fidelity. | Existing QA and trace owners; no measured A/B. |
| P2 | Can Control reduce wasted routing/tool/context? | Equal accepted result with recorded fewer repeated reads/recoveries, using unchanged semantic authority and a comparable model/telemetry source. | Static diagnosis/negative cases possible; model-usage proof not available. |

## Brute Harness² protocol — safe, bounded, universal

1. **Propose** one causal hypothesis tied to an exact existing owner and a quality dimension, not one object-specific trick.
2. **Probe** with a matched baseline/candidate, fixed approved reference, starting asset, model, source and Runtime; vary **only** the selected harness instructions or a separately isolated source experiment.
3. **Falsify** with positive, negative, collision, pressure and boundary cases appropriate to the owner; source-only tests count as `REGRESSION_AUTHORED_NOT_RUN`.
4. **Compare** qualitative PASS/FAIL/UNVERIFIED **before** tool/tokens/time; call efficiency gain only after independently accepted, comparable output.
5. **Reflect** in the existing experiment evidence or exact commit; reject or revise a failing candidate rather than stacking speculative abstractions.
6. **Stop** after a coherent candidate. More iterations require new evidence or a new explicit hypothesis, not unbounded loops or automatic production promotion.

## Baseline / candidate record

- **Baseline:** `Local@4015a05518b17f978adf10d29e0374183b2a283d`.
- **Candidate A:** explicit selected-`Harness` branch with per-file authorization and negative branch-boundary regression; source-authored, **NOT_EXECUTED**.
- **Candidate B:** Harness CLI context-byte gate: no supplied context files → review/veto results are **INCONCLUSIVE** even if declared hashes differ; supplied verified bytes remain review-only and do **not** attest agent consumption. Regression authored, **NOT_EXECUTED**.
- **Quality change:** **UNMEASURED**; **efficiency change:** **UNMEASURED**. No new native app capability, benchmark PASS, release, UI design change, or automatic merge.

## STOP / next causal decision

The highest-value next investigation is **not** to add more agent methods or a new planner: isolate failures in the current reference → Geometry/part-relation reasoning → Control execution → native evidence chain. Create one falsifiable cross-profile failure case at a time in the existing quality corpus, prefer an existing evaluator, and require native acceptance before claiming superiority. Do not mutate `Local`, `main`, live projects or release configuration.

## Harness² iteration C — cross-view assembly causality (2026-11-09)

**Observed source defect:** `analyzeReferenceCrossViewEvidence` compared each part's parent claims only within that part. A two-part cycle (`frame → panel → frame`) could report `consistent_with_available_constraints` even when both views agreed, although no finite native parent hierarchy can realize the relation. This is a **semantic dependency** failure, not an object-specific modelling heuristic.

**Candidate:** use only unambiguous explicit parent edges, detect self-parent and longer cycles, canonicalize each cycle once, emit `attachment_cycle` with the exact part-ID chain. Conflicting or missing parent evidence is not converted into a guessed edge. Existing dimensions, optional planar spans, native approval and Control routing remain unchanged.

**Falsifiers authored:** two-view mutually cyclic assembly, single-view self-parent without independent support, conflicting parent claims and incomplete external parent evidence. These are deterministic source regression cases; **NOT_EXECUTED**. The evaluator cannot establish whether an image really depicts the claimed parent or whether a native Blockbench rig is correct.

**Expected value (unmeasured):** prevent internally impossible parent plans from being called cross-view consistent before Geometry/rig construction. No visual quality gain, time saving or native PASS is claimed.

## Harness² iteration D — Recipe positional dependency cycle parity (2026-11-09)

**Observed discrepancy:** `solveRecipeConstraints` rejects self-anchors and directed ANCHOR cycles, but the source-only `reviewDeclaredRecipeAssembly` previously labelled their relations `DECLARED_RELATIONS_UNVERIFIED` with no structural diagnostic. That allows planning to present an impossible assembly as merely awaiting reference review.

**Candidate:** construct bounded directed positional-dependency edges from already resolved Recipe instance IDs; mark `ANCHOR_DEPENDENCY_CYCLE` for every affected feature. Do not conflate these ANCHOR dependencies with native Bone parenting, and do not create a second solver. Negative cases cover a two-feature cycle and a self-anchor; existing acyclic baseline remains. **Tests authored, NOT_EXECUTED**; no native or visual PASS.

## Harness² iteration E — complete-batch causal compilation (2026-11-09)

**Source defect:** initial Geometry candidate construction compiled the Recipe after each individual feature. A valid predeclared ANCHOR from a detail to a primary body could fail before its target feature was emitted, despite a complete batch being compilable. This is a temporal planning/assembly bug, not an object-specific shape problem.

**Candidate:** preserve primary-form-first ordering; defer the canonical Recipe compilation and per-feature realized-count validation until the full candidate has been constructed. Continue using the existing compiler as the sole authority; no dependency inference, native mutation or reference-content approval is introduced. A missing target must still fail at final compile.

**Falsifiers authored:** primary/detail batch with a declared forward endpoint and a missing endpoint; assert original Recipe immutability and source-only status. **NOT_EXECUTED**. Curve construction retains its existing specialized path.

## Harness² iteration F — persisted source vs constrained geometry (2026-11-09)

**Source defect:** `reviewStoredAdvancedGeometrySource` regenerated an unconstrained expected Recipe, then compared it to a saved Recipe whose valid source-owned ANCHOR constraints had moved placements. This could falsely classify a valid saved shape as `SOURCE_RECIPE_MISMATCH` and block a subsequent bounded revision.

**Candidate:** replay only explicit constraints and symmetry within the exact reconstructed source-owned instance cohort before the existing compiled-placement comparison. Cross-cohort or unresolved endpoints still fail closed; no guessed attachment, image proof or native authorization. **Regression authored, NOT_EXECUTED**.

## Harness² iteration G — dependency-ordered symmetry provenance (2026-11-09)

**Source defect:** the persisted-source reviewer accepted only primitive pattern IDs as symmetry sources, even though the canonical Recipe symmetry compiler explicitly permits later relations to mirror previously emitted targets. A valid chained mirror could thus be rejected as `SOURCE_RECIPE_MISMATCH`.

**Candidate:** replay source-owned symmetry identity in canonical declaration order, allowing each target to become a source for subsequent relations; reject forward references, reused targets and foreign sources. Preserve the compiler as sole geometry authority and exact placement comparison. **Regression authored, NOT_EXECUTED**. No visual or native proof.

## Harness² iteration H — external dependency isolation (2026-11-10)

**Source regression identified by inspection:** the previous source-owned anchor replay rejected *all* constraints with an external endpoint, even if the external feature was merely dependent on the selected source cohort. That can falsely block valid persisted-source verification in multi-feature Recipes.

**Correction:** replay only ANCHORs whose dependent/source instance belongs to the source-owned cohort; reject external targets of selected instances, but ignore external dependents that cannot move selected instances. Symmetry selection follows generated ownership in declaration order; preserve the canonical final compiled-placement equality check. This is a bounded source-only correction, not visual proof. **Regression authored, NOT_EXECUTED**.

## Harness² iteration I — precompile anchor declaration validity (2026-11-10)

**Source defect:** the source-only Assembly Review checked ANCHOR endpoints but not duplicate/empty IDs, missing/duplicated axes or unsupported axis labels. The canonical Recipe constraint solver rejects these declarations, so review could otherwise label a structurally impossible plan merely `DECLARED_RELATIONS_UNVERIFIED`.

**Candidate:** reject invalid ANCHOR declaration structure in the existing review owner with `ANCHOR_DECLARATION_INVALID` for affected feature IDs. Preserve canonical compiler as the final authority; do not infer source geometry or native parenting. Negative cases: zero axes, duplicate axes, unsupported axis and duplicate constraint ID. **Tests authored, NOT_EXECUTED; native/visual UNVERIFIED.**
