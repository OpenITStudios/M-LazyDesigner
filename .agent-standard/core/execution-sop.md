# SOP — Universal Agent Workflow

**Owner:** AgentSkill. **Status:** normative v0.1.0-draft. A task need not execute every stage; stages are logical checks, not demands for extra artifacts.

## 0. Identify the actual work surface — before task mode

- `CHATGPT_GITHUB`: ChatGPT conversation using GitHub for complete source architecture/integration. **No localtest request, no GitHub Actions/cloud CI workaround.** Never stop early to demand localtest while available source work remains.
- `LOCAL_PC_AGENT`: actual user-PC workspace controlled by a verified Claude Code, Codex CLI/IDE or OpenCode session, with separately chosen `LOCAL_VALIDATION` phase. Only this surface can provide actual user-PC execution proof.
- `UNKNOWN_SURFACE`: fail closed for local execution; finish safe read/source work.

See `work-surfaces-and-phase-gates.md` and `host-identification.md`. A model name, repo URL or branch `Local` does not define the work surface.

## Continuity boot for returning GitHub tasks

When the user says "lanjutkan" or starts a new conversation, use `commit-continuity-and-recovery.md`: derive the **same topic** from the user, pin the selected ref/HEAD and read current source/holds first. Read historical commit continuity fields only when current source, status or accepted decisions leave a material gap. Resume the smallest permitted work; the newest Git commit may belong to a different topic and is never a task instruction.

## 1. BOOT and current authority
Capture `repo`, `selectedRef`, `currentHead`, `userGoal`, `userScope`, `taskMode`, `profileVersion`, available tools and active holds. A read-only request needs no mutation pipeline. Resolve the present owner from actual source, not recency of commits.

## 2. CLASSIFY intent, risk and complexity
- `INSPECT`: observe/audit/explain; no writes, issue/PR creation or CI.
- `PLAN`: research/design/specify; no mutation unless separately requested.
- `DEVELOP` / `MAINTAIN`: authorized source or policy changes within designated path/branch.
- `VALIDATE`: check actual behavior or source at permitted proof ceiling; validation is not implicit repair authorization.
- `PRODUCE`: execute a domain task with target-specific input/output/approval boundaries.
- `RELEASE`: separately controlled promotion, packaging or deployment.

For ChatGPT/GitHub source work, select the FAST / STANDARD / CRITICAL effort lane below instead of repeating a second bounded/standard/complex classification. Only material complexity needs a fuller decision record. Other task modes still use proportional review without creating another classifier.

## Task-cost lanes — work effort, not commit risk

In `CHATGPT_GITHUB`, use the **least costly complete** workflow that meets acceptance. These are effort lanes, not new agents, task modes, authorization classes or commit formats.

| Lane | Suitable work | Cost-proportionate response |
| --- | --- | --- |
| **FAST** | Narrow, low-complexity task with known owner, scope and approval | Read current required rules/profile and owner, check affected consumers, make a complete edit, verify source and STOP |
| **STANDARD** | Several related source, contract or regression files | Inspect only relevant owners/consumers, prepare one coherent acceptance unit before writing and verify integration |
| **CRITICAL** | Material interface, security, permission, migration, architecture or unresolved design | Review applicable decisions, risks, affected consumers and compatibility before any authorized change |

**FAST does not waive branch, permission, security, compatibility or proof checks.** A one-line policy change can be CRITICAL. Do not force broad research, unnecessary approvals, long specs or extra validators for a known harmless correction; do not use FAST when scope or safety is unresolved. Existing task modes still govern authorization.

**Task-cost lane and commit-message tier are independent.** Apply existing `TRIVIAL/NORMAL/CRITICAL` commit rules by change risk. Prefer one coherent acceptance unit per commit; multiple commits are appropriate when independent milestones or rollback boundaries justify them. Neither fewer commits nor fewer API calls defines success.

## 3. ROUTE once
Resolve first wrong semantic owner. Read root/profile, relevant canonical documentation and one primary `SKILL.md`. Use helper skills only for independently needed capability; avoid preloading every skill and avoid duplicate router roles. Verify every skill's positive/negative trigger and host capability.

## 4. DEFINE a decision-complete contract
`Goal → observable acceptance → forbidden shortcuts → selected owner → inputs/evidence → allowed actions → verification → STOP`. Record assumptions that affect implementation; do not manufacture requirements. For complex work add non-goals, architecture boundaries, affected consumers and rollback conditions.

## Clarification and broad research — before material implementation

Use the `decision-routing-and-ownership.md` readiness decision after examining **already available** user context and current source; do not start with a generic questionnaire.

1. **Interpret:** identify the intended result, existing problem, limits/non-goals, affected owner, acceptance and permission. Distinguish user instruction, current repo source, external evidence and agent inference.
2. **Inspect before asking:** read the selected source/ref and relevant callers when warranted; reuse previously approved decisions and do not ask the user to repeat available information.
3. **Research when material or explicitly requested:** search relevant original maintainer repositories and exact files, official vendor/standards documents, and genuinely independent alternatives. On an explicit broad/deep research request, **expand beyond the first credible answer** to other implementations, maintainer discussions, empirical or community evidence where they may affect the design. Look for contradictions, known limits and counterevidence. Search results and mirrors are discovery, not original-source proof.
4. **Synthesize:** compare serious approaches on applicability, tradeoffs, actual source evidence, safety/compatibility and remaining gaps. Prefer a decision-oriented comparison over a large undifferentiated link list; do not claim an exhaustive or up-to-date survey without supporting coverage.
5. **Discuss material unknowns only:** offer a concrete interpretation and meaningful alternatives. Ask **one decision-changing question per turn** only when the answer changes the deliverable and context cannot settle it. If the user requested design discussion first, remain in `PLAN` until the design decision is clear.
6. **Gate and stop:** continue searching while a plausible relevant source family, alternative or conflict could change the decision. **Do not stop after the first convenient result.** Stop when the significant original and alternative sources have been considered, their key contradictions addressed or disclosed, and further targeted searching has little decision value. If critical access remains missing, state `RESEARCH_INCOMPLETE`, not `FULLY_RESEARCHED`; choose `DISCUSS_FIRST` or `BLOCKED` as appropriate.

**Do not implement a materially ambiguous design merely because sources were found.** A mature research summary is not an implementation authorization. Conversely, do not delay an already clear small fix with broad research, unnecessary interviews or new plan files. Preserve ChatGPT/GitHub source-only and test-on-hold restrictions.

## Goal lock, scope guard and terminal STOP

**Canonical owner of goal completion.** At task start, retain a small internal decision contract: `USER_GOAL | REQUIRED_RESULT | ACCEPTANCE | SCOPE/NON-GOALS | AUTHORIZED_ACTIONS | PROOF_CEILING | STOP`. Derive it from actual user intent and current project source; do not make every small task a new spec, checklist, issue or user questionnaire. In long conversations, preserve this contract through compaction rather than replacing the original goal with the newest interesting detail.

Before any **newly discovered subtask** or another round of changes, classify its necessity:

- **REQUIRED_FOR_ACCEPTANCE:** needed to deliver the requested result or fix an affected caller, interface, security invariant or material regression. Do the smallest complete in-scope correction and verify only the affected evidence. A missing essential consumer or security check is **not** “minor polish”.
- **BLOCKER_OR_CONFLICT:** directly prevents safe completion, requires different authorization, or exposes a material unresolved risk. Diagnose and resolve only within current permission; otherwise report the concrete blocker and stop the forbidden action.
- **OPTIONAL_OR_UNRELATED:** minor style tweaks, speculative abstractions, extra logging, new framework/agent/router, exploratory “while here” fixes, broad cleanup or further analysis with no decision value. **Do not implement or automatically queue them.** Mention at most one material separate suggestion if it affects the user's next decision; otherwise omit.

**Terminal STOP decision:** after the user-visible result exists, scoped acceptance and preservation checks are satisfied **at the currently available proof ceiling**, authorized GitHub source changes are committed and reconciled if applicable, and no material in-scope blocker remains, set the scoped work `DONE`, report actual proof, and **STOP**. Do not reopen it for small aesthetic preferences, one more audit, version churn, new agents, extra test infrastructure or open-ended polish. Do not turn a historical `Next` into authorization for a fresh task.

**Reporting decision (not a new work mode):** STOP = completed scope with no actionable follow-up presented; CONTINUE = remaining authorized in-scope work; BLOCKED = currently requested work cannot proceed because a concrete permission/evidence/dependency gate is missing; PROPOSED = a separate future task recommended after a completed read-only audit or discussion, **not authorized for implementation**. A scoped audit may be `DONE` while the final user-facing label is PROPOSED. Never write "Next step — STOP" and then instruct the user to start another task. Keep the final label accurate without changing task authorization.


If local/native checks are held in `CHATGPT_GITHUB`, do not keep coding or request localtest merely to obtain runtime PASS; state `SOURCE_COMMITTED / LOCAL_TEST_DEFERRED` where accurate and stop at the source boundary. Conversely, do **not** stop early while an essential source defect or affected consumer still blocks the authorized specification. If the user explicitly gives a **new goal**, begin a fresh scoped decision instead of silently extending the completed one.

## ChatGPT-GitHub source efficiency

Use the read/write/receipt selection in `tool-contracts-and-reliability.md` and source-reuse rules in `context-and-session-continuity.md`. If exact source remains present and its blob is confirmed unchanged, reuse it; do not repeatedly fetch identical files, all Skills or long history. When HEAD changes, inspect affected paths and refresh only stale owners. A hash or summary without source content is not sufficient.

Prepare related changes and necessary regression source together. Do not create extra reports, validators or cleanup rounds without material acceptance value. Refresh HEAD and permissions before mutation; inspect the actual branch, parent, changed files and relevant source after writing. **Reducing tool calls never justifies unsafe writes, missing dependencies, skipped permissions or false proof.**

## 5. EXECUTE only authorized effects
Before each mutation perform the action-level preflight in `permission-and-security.md`. Check selected ref, current HEAD, file owner and hold. Prefer one coherent change, no duplicate state or framework stacking. Changes with irreversible effects need the actual platform's approval capability and user authorization.

## Source-to-local phase transition (not automatic)

Do not impose a localtest step between source features. In ChatGPT/GitHub, finish agreed architecture and integration, document source-only evidence, author relevant tests, and produce one source-ready handoff when genuinely complete. Do not demand immediate user action. Local validation starts only when the user explicitly chooses an actual local PC agent and the prepared source revision is reconciled.

## 6. VERIFY using a proof ceiling
Use `evidence-and-recovery.md`. Source-level inspection can prove source properties only; an authored test cannot prove executable behavior. If tests are held, do not run them. Verify negative cases, preservation of critical invariants and affected consumers at the available level; never dilute a gate.

## Material Git commit and future ChatGPT recovery

For material changes, select **NORMAL** (five continuity fields) or **CRITICAL** (seven fields) according to real scope; reserve **TRIVIAL** for proven one-word non-policy documentation edits. Apply `commit-continuity-and-recovery.md` and the existing proof ceiling. A commit history note is not localtest, deployment authorization, or a new user instruction. Recovery is branch- and work-topic-scoped, with current status/source winning over old Next.

## Commit/object evidence reconciliation

When reporting a material GitHub commit, confirm the selected branch and exact commit identity through the **current GitHub source connection**. Check real parent/changed paths, partial file pages, and the user-approved scope. A commit-body syntax check or offline snapshot assessor is **not** an authenticated GitHub read, source-semantic acceptance or localtest. See `commit-continuity-and-recovery.md`.

## 7. REPORT and STOP
**User-facing presentation must follow `user-facing-communication.md`:** answer first; write for the reader, not for the tool log; use a compact start-to-end diagram for complex flows when it is clearer; make technical details optional and never obscure uncertainty or source-only proof.
Return concise: goal/result, repository/ref+SHA, changed owner/files, checks actually run and outcomes, pending proof, known risk, next authorized dependency. STOP when the goal is met, action denied, approval genuinely required, a blocker cannot be resolved safely, or retries no longer add evidence.

## Failure and recovery
Observe the exact failure → classify source/test/tool/runtime/permission/context → identify falsifiable cause → apply bounded correction if allowed → revalidate at matching proof ceiling. If interrupted, checkpoint `goal/ref/head/owner/permissions/holds/completed/pending/evidence`. Re-read current source; never replay stale writes blindly.
