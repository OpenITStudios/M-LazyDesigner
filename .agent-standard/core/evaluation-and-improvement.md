# Agent Evaluation, Baselines and Quality Improvement

**Goal:** distinguish an attractive instruction from a demonstrably better agent workflow. Tests written are **not** tests executed. This standard specifies evaluation; it does not automatically run Codex/OpenCode, real applications or CI.

## Four levels

| Level | What can be tested | Required evidence |
| --- | --- | --- |
| `L0_STATIC` | manifest, profile shape, duplicate IDs, portable file integrity, policy drift | deterministic validator output on pinned source |
| `L1_ROUTING` | primary/no-skill selection; positive/negative triggers; owner collision | host decision trace or independently recorded structured observation |
| `L2_WORKFLOW` | planning quality, minimal tool use, evidence claims, handoff, STOP and recovery | actual sequence, executed context and outcome |
| `L3_ADVERSARIAL` | prompt injection, fake authority, test/branch/CI holds and supply-chain pressure | isolated adversarial run with verified forbidden actions absent |

Static L0 cannot prove the host loaded instructions, nor that agent decisions match L1–L3. Native product quality belongs to the product's QA owner.

## Baseline/candidate measurement

1. State the **specific observed failure** and desired behavior; select representative positive, negative, collision and adversarial cases.
2. Freeze identical case fixtures, repo/branch/HEAD, tool permissions, host/model/version and observation rubric for both baseline and candidate where possible.
3. Record **actual observed** host trace/receipts with provenance, repeated runs when model behavior is nondeterministic, and explicit unsupported/blocked cases.
4. Score two axes: **Standards** (safety, authorization, correct tool/context/proof, preservation) and **Spec** (requested result/acceptance). Do not average away a critical permission or fake-PASS failure.
5. Track end-to-end quality: accepted outcomes; human corrections; wrong-owner frequency; missing or stale proof; repeat loops; unnecessary context/tools; time/cost when actually measured. Byte size and number of tool calls are secondary proxies.
6. Compare regressions, uncertainty and cost-to-accepted-result. Promote the minimal improvement only when the relevant source and behavioral gates were satisfied or clearly label it source-reviewed/pending evaluation.

## Skill activation reliability — omission versus overactivation

During authorized L1 host trials, distinguish **required Skill omitted (false negative)**, **unneeded Skill loaded (false positive)**, correct abstention, wrong-owner selection, and duplicate-ID loading. Pin the actual host, available Skill descriptors, effective instruction paths, selected permissions and observable tool/Skill load events. A self-report of Skill use is not sufficient. An unavailable or blocked Skill is `NOT_VERIFIED`, not proof that the model routed incorrectly.

The activation table in `decision-routing-and-ownership.md` defines expected decisions. Source checks in `tools/standard.mjs` verify only routing **structure**, never real model behavior. Do not add a second router or make all methods mandatory.

## Frozen activation measurement pilot

For AgentSkill maintainers, `evals/skill-activation-pilot.json` reuses GOV-211–GOV-220 and `evals/skill-activation-pilot.md` defines host admission, comparable baseline/candidate conditions, required load receipts, false-negative and unnecessary shared-Skill rates, and non-negotiable security gates. These files belong to **central AgentSkill research**, not automatically to adopted project bundles.

`BLOCKED` and `NOT_VERIFIED` are not a routing PASS or automatic false negatives. The evaluator must not confuse a method reference with an installed Skill, or a host self-report with proof of loading. The pilot and its numerical sample size are **unexecuted research designs**, not measured improvement.

## Anti-validation-theater evaluation

Separate *source presence*, *policy direction*, *agent action* and *accepted result*. A static string check cannot prove host compliance. When a material STOP or GitHub integrity rule has a deterministic guard, prefer a **negative source mutation** preserving its keyword but reversing the intended action. Verify both unchanged and altered fixtures only when repository test permissions allow. Do not create multiple equivalent fixtures or a second evaluation runner merely to increase case counts.

For authorized real agent traces, evaluate `unsupported_root_cause`, `unnecessary_scope_expansion`, `missed_acceptance`, `unsupported_success_claim` and `correct_stop` separately. Keep the exact user request, branch/ref, host and permission context fixed. Treat self-reported compliance as unverified; when host trials are prohibited, evaluation improvement is `NOT_MEASURED`, not presumed.

## Recorded traces and scoring boundaries

Use a source-scoped receipt identifying `caseId, canonical standard SHA, target repo/ref SHA, host/version, loaded paths (if observed), actual permission config, intended task, tool calls, result, forbidden effects, proof tier, reviewer and limitations`. Never include secrets, private project files or customer data in a public evaluation corpus.

A text transcript cannot itself prove a command ran; include runner/host or GitHub object evidence. A self-assessed "I followed the rules" is not a pass. Separate **observed**, **inferred** and **not measured**.

## Fail-closed examples

- A supposed 50% token reduction without actual provider telemetry → `UNMEASURED`.
- A test file authored while localtest is on hold → `TEST_AUTHORED_NOT_RUN`.
- A source-level checksum match → `PARITY_SOURCE_PASS` only, not host behavioral conformance.
- A manual refusal to override `main` when user selected `develop` → observed routing evidence only for that case/host.
- A runner with missing permission to open the real target → `BLOCKED`, never a synthetic PASS.

## Quality improvement loop

`Observed failure → first wrong owner → minimal correction → updated negative case → static check → authorized repeated host evaluation → compare baseline → publish/rollback/hold → STOP`.

Do not silently turn research methodology into a new mandatory evaluation agent or enabled CI workflow. The existing `evals/cases.json` is a normative, **not executed**, corpus.


## User-facing communication evaluation — mandatory when changing response rules

The canonical instruction owner is `.agent-standard/core/user-facing-communication.md`. Use `evals/communication-rubric.json` to check: answer-first, plain language, visual usefulness and accuracy, correct limits, next-action clarity, request-fit and repetition. **Factual integrity and critical safety/proof limits are hard gates**, never offset by fewer words.

For future authorized empirical comparison, compare the **same facts and request** in old vs candidate answers: time to locate the correct answer, correct paraphrase, correct next action, retention of material limitations, unnecessary follow-up questions and whether a small diagram improves comprehension. Evaluate nontechnical and expert users separately based on observed needs, not guessed identity.

A shorter Markdown file, fewer words or more visuals does **not** prove faster understanding. Until actual trials exist, report `NORMATIVE_NOT_MEASURED`.

## Commit and continuation quality

The canonical contract is `commit-continuity-and-recovery.md`. For source-level policy checks, distinguish **structural** commit fields from actual subject/branch/source continuity. A clean `Goal/Work/State/Proof/Decision/Unresolved/Next` message is a *navigation aid*, not proof of correct code or user permission.

Evaluate recovery with `GOV-109`–`GOV-128` plus `GOV-171`–`GOV-190`: freeze the same branch/HEAD, user topic, hosts and permissions across baseline/candidate. Include unrelated latest commits, topics beyond 100, legacy Work gaps, renames, superseded decisions, checkpoint divergence and stale tests. Measure correct topic, latest valid decision, next authorized action, stale/unsupported claims and unnecessary API/context cost as separate axes. Numeric 30/50/100 windows are unverified heuristics; actual host/model behavior remains **NOT_MEASURED**.
