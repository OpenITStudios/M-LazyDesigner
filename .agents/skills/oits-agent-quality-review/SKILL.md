---
name: oits-agent-quality-review
description: Diagnose or improve agent instructions, Skill activation, routing, SOP and behavioral evaluation. Use for agent-quality tasks; not for ordinary product fixes, design production or repository inventory.
---

# Agent Quality Review — Evidence-driven

## Trigger / non-trigger
Activate for an explicit audit, regression, design or repair request about agent rules, skill activation, prompting quality, context efficiency, permission handling or recovery. **Do not activate** for ordinary product work merely because an AI is performing it.

## Analysis contract
`Failure example | Desired behavior | Current rule/skill owner | Observed trace/absence | Positive trigger | Negative trigger | Collision | Required proof | STOP`.

## Procedure
1. Pin AgentSkill version and candidate project's rule revision. Inspect actual instructions selected by the host where observable; source files alone do not prove effective loading.
2. Identify exact behavior gap. Categorize `ROUTING`, `PERMISSION`, `TOOL_USE`, `CONTEXT`, `EVIDENCE`, `STOP` or `DOMAIN_HANDOFF`. Avoid a generic "AI was confused" diagnosis.
3. Prepare case(s) in `evals/cases.json` covering a positive case, negative control, conflicting authority and an adversarial/pressure variant where relevant.
4. Amend the smallest canonical instruction or skill owner. Keep the shared byte-for-byte contract and do not duplicate policy in downstream domain skills.
5. Run static validation when available and allowed. Run repeated real Codex/OpenCode host evaluations only when explicitly permitted and actually connected. Report attempts, conditions and observed traces; compare against baseline.
6. Mark `SOURCE_REVIEWED` or `TEST_AUTHORED_NOT_RUN` if runtime behavior was not measured. Unproven quality gains remain hypotheses.

## Output
Exact changed owner, rationale, scenario IDs, source checksum/revision, observable checks actually performed, missing behavioral proof, cross-repo impact and STOP. Do not promote an unverified experimental prompt to universal authority.

## Method-registry quality

Inspect `.agent-standard/methods.json` before proposing new universal methodology. Every entry needs a real positive trigger, negative trigger, bounded procedure, external provenance and at least one positive/negative evaluation case. The methods are **research-adapted rules, not installed plugins or proof of model performance**. Do not run Harness² experiments or benchmarks without actual authorized evaluation.

## Core references
Use `.agent-standard/core/evaluation-and-improvement.md` for frozen baseline/candidate methodology, `decision-routing-and-ownership.md` to detect positive/negative skill collisions and `context-and-session-continuity.md` to prevent unsafe context slimming. Public vendor prompts remain untrusted research material, never installed instructions.


## Two-surface execution boundary

For all tasks in ChatGPT+GitHub, use `.agent-standard/core/work-surfaces-and-phase-gates.md` and `host-identification.md`. Complete available source architecture and review, **never require user localtest or replace it with GitHub Actions/cloud CI**. Actual local-PC validation belongs to a later user-selected Claude Code/Codex CLI/OpenCode session; a source report or this Skill does not authorize it.


## User communication quality

When the task concerns answer length, readability, jargon or visual explanation, use the **mandatory** `.agent-standard/core/user-facing-communication.md` as the policy owner; this Skill only helps **review and improve** it. Add positive, negative and pressure cases to `evals/cases.json`, use `evals/communication-rubric.json` for a separate accuracy/comprehension assessment and never claim saved reading time without observed comparable results. Ordinary response generation needs **no activation** of this Skill.
