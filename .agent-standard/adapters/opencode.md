# OpenCode — Actual Local-PC Host Adapter

**Scope:** the **OpenCode application** (CLI/desktop with local execution on the user's PC). Using an Anthropic/Claude model in OpenCode does **not** turn the host into Claude Code; using an OpenAI model does **not** turn it into Codex CLI.

## Confirm real host and execution origin

- Identify actual OpenCode client/session, selected primary agent (`build` or `plan` or custom), selected model/provider, current working directory, project root, Git branch/HEAD, active permissions and **where the OpenCode server executes commands**.
- OpenCode may connect to a background service or an explicitly remote server. A local-looking UI or URL doesn't prove the server/tool executor targets the user's PC.
- For localtest, verify local filesystem and shell are truly under user-PC control, not hosted cloud/SSH remote execution. User-selected phase and repo holds remain necessary.

## OpenCode V2 source-loading facts (as checked 2026-11-13)

- V2 uses `AGENTS.md`; it **does not** use `CLAUDE.md` as a fallback. Additional configured instruction sources/global/nested project rules may combine and conflict; inspect actual loading and config.
- Portable `.agents/skills/<id>/SKILL.md` is supported. IDs are path-derived and case-sensitive; an ID registered from a later-precedence source can replace earlier content. Check `.claude/skills`, `.agents/skills`, `.opencode/skills`, global skills and configured sources for shadowed `oits-*` IDs.
- V2 permissions use `permissions` ordered rules with actions `shell`, `edit`, `subagent`, etc.; the **last matching rule** wins. Do **not** paste V1 `permission/bash/task` examples into V2 without migration.
- `plan` and `build` are distinct primary agents. They are OpenCode agent roles, not the AgentSkill execution surfaces `CHATGPT_GITHUB` / `LOCAL_PC_AGENT`.

## Skill activation evidence (real host only)

Inspect the current OpenCode skills discovery, **path-derived case-sensitive ID**, description and any `opencode/autoinvoke` suppression. Check the active agent's ordered `skill` permissions; denied Skills can be hidden and later-precedence sources can shadow an ID. Distinguish **not discovered**, **shadowed**, **blocked** and **wrongly selected**.

For a matching task, verify the actual native Skill load response and effective file content; for an unrelated task, correct abstention is expected. A source file or global installation does not prove use on the user's PC. Do not alter permissions or install Skills to manufacture proof. If no host trace exists, report `NOT_VERIFIED`.

Official references: https://opencode.ai/docs/skills and https://opencode.ai/docs/permissions . Check the actual installed host version before applying version-specific rules.

## Localtest admission

Do not run tests automatically just because `build` grants shell access. Run local checks only after the user moves the task into local validation, the host command runner is verified to target their PC, necessary fixtures are present and project holds allow it. **No GitHub Actions/cloud CI fallback**; no browser/ChatGPT control claims.

## Official documentation (checked 2026-11-13)

- https://opencode.ai/docs/instructions
- https://opencode.ai/docs/skills
- https://opencode.ai/docs/agents
- https://opencode.ai/docs/permissions
- https://opencode.ai/docs/cli

**Conformance state:** source-documented, effective loading/host behavior `NOT_EXECUTED`.
