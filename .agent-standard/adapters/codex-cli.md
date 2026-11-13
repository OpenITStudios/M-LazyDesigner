# Codex CLI / IDE — Actual Local-PC Host Adapter

**Scope:** use only after an actual Codex CLI or IDE session is verified to execute tools against the user's local PC. This is a **host-specific loader and proof guide**, not a separate AGENTS.md or permission override. User preference: source architecture is completed in ChatGPT+GitHub before the planned localtest phase.

## What to observe

1. Actual host application is **Codex CLI or Codex IDE extension**, not simply a GPT model, Codex Cloud or a GitHub-connected ChatGPT conversation.
2. The currently active session can inspect the intended **local checkout** and run commands in the desired user-PC environment with real tool responses. A cloud container or SSH-only remote execution cannot be silently classified as local PC.
3. Record repo root, branch, exact local HEAD, staged/dirty worktree, OS/tool availability and source handoff SHA. Don't assume branch `Local` means local execution.
4. Compare effective global/project/nested instruction sources. Codex checks `AGENTS.override.md` before `AGENTS.md` at a directory and merges relevant instructions from global to working directory. Conflicting overrides must be addressed before trusting 1:1 behavior.
5. Record `host_app=CODEX_CLI`, observed version/model, proof ceiling, and active user-specified task permissions. Distinguish model/provider from execution origin.

## Skill activation evidence (real host only)

In an authenticated Codex CLI/IDE session, inspect which Skill descriptions are **advertised** from effective global/project/nested discovery paths, and verify the selected Skill's identity and content source. A GitHub `SKILL.md` is not proof Codex discovered it. Examine relevant instruction overrides before trusting the shared route.

For matching tasks, record the actual **selected Skill**, whether its `SKILL.md` was **read**, and whether the procedure was followed. Record correct abstention for bounded tasks and `NOT_VERIFIED` when the Skill was unavailable or no load trace exists. No automatic installation, localtest, CI or cloud executor is authorized.

Official references: https://developers.openai.com/api/docs/guides/tools-skills and https://developers.openai.com/plugins/concepts/skills . Local Codex behavior is version/config dependent and was not executed in ChatGPT/GitHub.

## Localtest admission

The local host **may** perform local checks only after user-selected move to `LOCAL_VALIDATION`, using the source-ready handoff, available real tools, safe test fixtures and project-specific test permissions. Never use GitHub Actions, Codex Cloud or cloud CI as substitute. Report actual commands, exits and target SHA; no PASS from test code being present.

## Do not infer

- `codex` installed or a project `~/.codex` directory exists ≠ Codex is the current agent host.
- GitHub API access ≠ local checkout access.
- A Codex-generated transcript in ChatGPT ≠ ChatGPT has executed anything on the user's PC.
- A local checkout alone ≠ permission to run every test or release.

## Official documentation (checked 2026-11-13)

- Codex CLI: https://learn.chatgpt.com/docs/codex/cli
- AGENTS.md discovery and overrides: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- Codex vs hosted/self-hosted execution surfaces: https://developers.openai.com/api/docs/guides/agents-api/architecture

**Conformance state:** source-documented, effective loading/host behavior `NOT_EXECUTED`.
