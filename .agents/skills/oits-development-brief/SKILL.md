---
name: oits-development-brief
description: Scope complex repository implementation with unclear architecture, ownership, acceptance or cross-component effects. Use when development needs a real brief; not for bounded fixes, read-only audits or agent-quality work.
---

# Development Brief — Smallest Complete Plan

## Activation
Use for an authorized complex change that cannot safely proceed from a known bounded owner. Skip this skill for a trivial modification, an audit-only request or a domain procedure that already provides an adequate execution contract.

## Required contract
`Goal | Observable acceptance | Forbidden proxy | Selected repo/ref/HEAD | User permissions | Current holds | First wrong owner | Affected consumers | Tools available | Proof ceiling | STOP`.

## Readiness and source-grounded clarification

Use the existing intent/readiness decision in `decision-routing-and-ownership.md` before producing a complex implementation brief. Recover the user's goal and accepted decisions from the conversation and current source, not guessed requirements. On an explicit broad research request, compare relevant original publishers, meaningful alternative approaches and counterevidence using `execution-sop.md` and `evidence-and-recovery.md`; do not settle an important architecture choice from one attractive repository.

If a product-changing decision remains material, stay in `PLAN`, summarize goal/scope/acceptance, compare approaches and ask one specific question. Record the selected design, rejected material alternatives, affected owners, non-goals, evidence and remaining uncertainty within the existing project owner if persistent documentation is needed. **Do not implement a material unresolved design solely because the brief was written.** Research/design agreement and source-write authorization are separate. Do not invoke this Skill for clear bounded fixes.

## Procedure
1. Recover current authority from `AGENTS.md`, `GITHUB_RULES.md` and the local profile. Confirm work is `DEVELOP`/`MAINTAIN`, not `INSPECT`/`PLAN`.
2. Read minimal source, failing behavior and dependent contracts. Distinguish unverified hypothesis from observed root cause.
3. Specify non-goals and architecture boundary, preserving the existing canonical owner. Use a spec/change record only when complexity warrants one.
4. Break work into **coherent integration units**, not speculative micro-tasks. Choose the cheapest valid proof for each affected invariant.
5. Before any side effect: check branch/HEAD, action permission, protected paths, test/CI holds and actual host capability. One development brief is a conductor, **not a second router or multi-agent runtime**.
6. Implement within authorized scope, compare to acceptance and preservation invariants, and report matched source revision and real evidence.

## Failure and STOP
Classify source/test/tool/permission/native cause; fix the first wrong owner. If tools or approval are absent, finish safe independent work and report unresolved proof explicitly. Never manufacture PASS, start CI on hold, add unsolicited branches or continue after the outcome is achieved.

## Method selection within this Skill

Use the **Karpathy + Ponytail combined pass** for code changes; check assumptions, minimal complete source, callers/security and actual source-level proof. For difficult diagnosis or domain ambiguity, select **at most one relevant optional method** from `.agent-standard/methods.json` (e.g. Pstack for difficult investigation, Matt Pocock for domain or interface conflicts). Do not install external Skills, force localtest or add a second task router.

## Core references
Use `.agent-standard/core/engineering-and-review-methods.md` for one combined quality review and conditional deep diagnosis; use `handoff-and-state.md` only when several owners genuinely participate; use `tool-contracts-and-reliability.md` when capabilities, receipts or retries are material. Root/profile permissions always govern.


## Two-surface execution boundary

For all tasks in ChatGPT+GitHub, use `.agent-standard/core/work-surfaces-and-phase-gates.md` and `host-identification.md`. Complete available source architecture and review, **never require user localtest or replace it with GitHub Actions/cloud CI**. Actual local-PC validation belongs to a later user-selected Claude Code/Codex CLI/OpenCode session; a source report or this Skill does not authorize it.
