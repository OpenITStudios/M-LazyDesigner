# Evidence, Quality and Recovery Contract

## Proof taxonomy
| Label | Allowed claim | Not allowed |
| --- | --- | --- |
| `SOURCE_REVIEWED` | Exact files/commit inspected; source-level invariant checked | Runtime working |
| `SOURCE_COMMITTED` | Change committed; exact resulting SHA known | Tests passed |
| `TEST_AUTHORED_NOT_RUN` | Test cases or scripts prepared | Test successful |
| `EXECUTED_TEST_PASS` / `EXECUTED_TEST_FAIL` | Executed test and its actual result with runner, inputs and revision | Unexecuted host or native acceptance |
| `LIVE_TARGET_VERIFIED` | Actual connected target tested and observed; target identity and revision recorded | Transfer proof to a different host/version |
| `NOT_EXECUTED` | Evidence unavailable, tool absent, or testing held | PASS, CERTIFIED or READY |

Never invent an execution receipt, approval, performance number or claim of observed behavior. Source at one SHA and tests at another SHA are not a matched proof unless the equivalence is established.

## Surface and phase labels — never confused with test PASS

- `SOURCE_IN_PROGRESS` / `SOURCE_READY_FOR_LOCAL` are **architecture/source phase statuses**, not proof that an application was built or executed.
- `LOCAL_TEST_DEFERRED` is the correct default in `CHATGPT_GITHUB`. It requires **no user request or workaround**; explicitly state only when material.
- `LOCAL_VALIDATION` requires an observed user-PC agent host, actual local tool context and user-selected transition. `LOCALLY_VERIFIED` requires matched actual executed evidence.
- A source-only ChatGPT/GitHub run cannot claim local/native PASS even if a code sandbox, CI tool or uploaded transcript exists.

## Minimum evidence receipt
`taskId; repository; branch/ref; headSHA; actor/host; mode; changedOwners; action; testCommandOrObservation; outcome; evidencePointer; limitations; unresolved; timestamp(if actually observed)`.
The receipt is a reporting schema, not a command to create a separate status database for every task.

## Quality gates
1. **Standards adherence:** authorization, selected branch and core invariant preserved.
2. **Specification fit:** changed behavior satisfies the actual user goal, not a proxy metric.
3. **Preservation:** impacted consumers, interfaces, data safety and expected negative behavior checked.
4. **Proof fit:** test tier matches the claim and target context.
5. **Efficiency:** no redundant rounds or newly invented scaffolding with no decision value.

A completed source change may be `SOURCE_COMMITTED + NOT_EXECUTED`; that is a legitimate bounded result when execution is unavailable. Mark remaining evidence explicitly.

## Evidence integrity: observations, inferences and meaningful checks

For a **material source claim** retain the smallest decisive facts: `CLAIM | OBSERVED_SOURCE/RECEIPT | REVISION | COVERAGE | LIMIT`. Distinguish `OBSERVED` (actual GitHub/tool result), `INFERRED` (a plausible but not uniquely established explanation) and `UNKNOWN` (source/evidence unavailable). An assistant's assertion, commit message, passing text search or created test is not independent proof that the user's outcome works. Bounded known-owner fixes do not need a new report, database or ceremony.

When the cause is non-obvious, compare expected versus observed behavior, name one plausible alternative, and inspect the **smallest discriminating source evidence** before calling a hypothesis the root cause. Inspect the first wrong owner and necessary affected consumers; avoid inventing a cross-system refactor on a guess. After mutation, re-read the exact branch HEAD/commit and changed owner before claiming `SOURCE_REVIEWED`; do not carry old evidence across materially changed revisions.

**Validation of validation:** checking `includes("STOP")`, required headings or counts verifies structural presence **only**, not policy direction or model behavior. For an existing material static gate, author a *small negative control* that keeps the label but removes or inverts the operative prohibition; a useful validator should reject it **when executed**. Include the unchanged positive case where relevant. Avoid duplicate checks with no additional decision value. Never use text/regex checks as a security enforcement boundary.

Under a test hold, an authored negative test is `TEST_AUTHORED_NOT_RUN`, not `EXECUTED_TEST_PASS`. Static source inspection can establish that the check was written; only a permitted actual execution can show it rejects the fixture. Host Skill selection, native behavior and prompt-injection resistance require separate observed evidence.

## Research coverage, source quality and sufficiency

For a material research-backed recommendation, capture the smallest useful coverage summary: `QUESTION | ORIGINAL_SOURCE/REF | SOURCE_FAMILIES | ALTERNATIVES | COUNTEREVIDENCE | RECOMMENDATION | GAPS`. Broad research means **independent relevant approaches**, not a quota of URLs.

**Breadth and depth are separate.** Breadth should cover the current project's source, relevant original upstream publishers, competing implementations, and independent standards/empirical/community findings when useful. Depth should inspect the decisive original files, versions, implementation assumptions, dependencies and failure reports. Mirrors, snippets and community rewordings are weaker evidence than a verified original file. Follow references and related implementations to uncover materially different approaches when appropriate.

**Do not stop after the first favorable or convenient source.** Compare credible alternatives and seek conflicting evidence rather than only support for the first hypothesis. Continue while another relevant source could materially change architecture, acceptance, risk or cost. End when coverage of the relevant source families and major alternatives is sufficient to make a defensible choice and further search brings little new decision value. This is an **adaptive saturation judgment**, not proof of exhaustive global coverage.

Source quantity alone is not a quality metric. Distinguish `OBSERVED`, `INFERRED`, `UNKNOWN` and `RESEARCH_INCOMPLETE`. State exact publisher/path/commit when relevant and accessible, privacy and licensing limits, and missing evidence without invented confidence. No original Skill installation, PC runtime behavior, full repository coverage or user acceptance can be inferred from source research.

## Goal acceptance before STOP

Check **two independent axes** against the user's scoped result: **Specification** (the requested behavior/output and affected consumers are complete) and **Standards** (branch/permissions, safety, compatibility, absence of material regressions and truthful proof). A clean diff, passing formatting check, large number of files changed, or apparent progress cannot substitute for the actual requested result.

Use the **smallest sufficient evidence**: current authorized source owner, affected interfaces and changed-path reconciliation; relevant positive/negative cases if they change a decision; actual execution evidence only when the permitted host has really run it. Mark an unsupported runtime claim `NOT_EXECUTED`, not `PASS`, and do not repeatedly inspect unrelated sources to fill that gap.

At the source proof ceiling, decide: **CONTINUE** only for an unmet material in-scope acceptance item; **BLOCKED** for a required forbidden/unavailable action or unresolved material safety risk; or **DONE → STOP** when scope, preservation and available evidence are complete. Separate optional observations from unmet acceptance. A finished goal does not implicitly authorize a new goal or perpetual follow-up work.

**Reporting versus task state:** `DONE` remains the current scoped work state. If a finished read-only audit identifies a useful **separate** repair, the report may end **Next step — PROPOSED**, explicitly requiring fresh authorization, rather than **STOP** plus a new action. STOP has no actionable next instruction; CONTINUE denotes permitted unfinished scope and BLOCKED denotes an actual current prerequisite. PROPOSED is not permission to mutate source, a new execution mode or a substitute for source/runtime proof.


## Context and recovery checkpoint
Keep the smallest recoverable packet: `Goal | Task mode | Repo | selected branch | observed SHA | user-authorized effects | active holds | primary owner | accepted decisions | completed | remaining | proof tier | next safe action`. On recovery, re-pin HEAD and compare current source; do not replay a prior unconfirmed write.

Stop when the success condition is met; a required approval/permission is missing; a hold applies; the evidence ceiling prevents a claim; or retries do not reduce uncertainty. Make the blocker concrete, not a generic handoff request.
