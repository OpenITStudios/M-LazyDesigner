---
name: oits-repository-audit
description: Read-only inventory of repository rules, Skills, permissions and architecture. Use for repository audits and inspections; not for implementation, agent-behavior improvement or migration.
---

# Repository Audit — Read-only

## Activate / decline
Use when the authorized user requests observation, structural review, rules inventory, skill comparison or migration feasibility. **Do not activate** to implement features or to treat a discovered issue as consent for repair.

## Procedure
1. Identify exact repo(s), selected ref(s) and user scope. For each repo pin current HEAD and record read-access limits; do not guess that default `main` is the working branch.
2. Read root/nearest `AGENTS.md`, `GITHUB_RULES.md`, local policy profile (if present), registries, skill names and evidence pointers. For missing sources verify against the exact ref before asserting absence.
3. Classify each observed rule as `CORE`, `PROFILE`, `DOMAIN`, `HISTORY` or `CONFLICT`. Preserve existing branch/CI/test holds and privacy restrictions.
4. Inspect actual skill triggers, IDs, nested instruction paths, owner collisions, missing proof, negative cases and instruction-loading risks. Read only affected files, not entire repository trees.
5. Report findings with evidence by path/ref and an ordered bounded recommendation. Separate observed defects from hypotheses, and source inspection from executable proof.

## Output
Repository/ref/HEAD; owners inspected; direct evidence; conflict matrix; adoption implications; known unknowns; no-write confirmation; recommended next authorized action.

## Proof and STOP
`SOURCE_REVIEWED` is the highest claim without a real executor. No commits, PRs, issues, CI dispatch, branch edits, migrations or data exports on a read-only audit. STOP when the requested review is explained or the permission boundary prevents further evidence.

## Core references
For multiple repos or ambiguous skill ownership, consult `.agent-standard/core/decision-routing-and-ownership.md` and `context-and-session-continuity.md` via the root policy index. Preserve confidentiality when source repositories are private; see the public research ledger's publication boundary. Never escalate inspection into a write.


## Two-surface execution boundary

For all tasks in ChatGPT+GitHub, use `.agent-standard/core/work-surfaces-and-phase-gates.md` and `host-identification.md`. Complete available source architecture and review, **never require user localtest or replace it with GitHub Actions/cloud CI**. Actual local-PC validation belongs to a later user-selected Claude Code/Codex CLI/OpenCode session; a source report or this Skill does not authorize it.
