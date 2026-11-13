# Claude Code — Actual Local-PC Host Adapter

**Scope:** an actual Claude Code terminal/IDE/desktop session with tools targeting the user's PC, **not** a Claude model running inside OpenCode, Claude Code Cloud, or ChatGPT discussing Claude.

## Host identification

Confirm the actual running client/session, version, local worktree path, branch/HEAD, available local tool executor, effective permissions and source handoff. A `CLAUDE.md` file or Anthropic model name alone does not establish the client or machine location.

### Single canonical AGENTS.md (important version-specific behavior)

As of the official Claude Code memory documentation checked 2026-11-13, Claude Code **v2.1.277+ can read AGENTS.md directly**, but by default a project `CLAUDE.md` or `CLAUDE.local.md` in the working directory/ancestors makes it load those files rather than `AGENTS.md`. Thus a repository with both files may **silently miss the OpenITStudios shared core** unless configured.

For an authorized local project, select one of these **after checking effective config**:

1. **No competing project CLAUDE.md**: use the shared root `AGENTS.md` directly in a supported Claude version.
2. **Existing CLAUDE.md must remain**: add the single import `@AGENTS.md` to project `CLAUDE.md` (with only Claude-specific additions below) **or** configure the supported Project instructions value `claude-md-and-agents-md`. Do not duplicate/copy the body of the universal core.
3. **Older/unsupported version**: use supported `CLAUDE.md` import path, or mark loading as unverified until adapter is reconciled. Do not assume `AGENTS.md` was seen merely because the file exists.

Check Claude session's actual instruction-loading report. Host-specific directives may narrow operations but cannot weaken branch, user permissions, test holds or the user's no-cloud workflow.

## Skill activation evidence (real host only)

Check the actual Claude Code session's available Skill descriptions, user/project/plugin sources, and effective selected path. An installed Skill may be hidden from model invocation by `disable-model-invocation`, a settings override or a competing definition. Distinguish explicit user invocation from model-selected invocation; neither grants side-effect permission.

For relevant tasks, observe the Skill load and applied procedure; for unrelated tasks, confirm abstention. If no reliable host trace can be obtained, report `NOT_VERIFIED`. Do not add hooks or run tests to prove discovery.

Official reference: https://code.claude.com/docs/en/skills . Effective behavior depends on the actual host version/configuration.

## Deterministic permissions

Claude Code has hooks, including `SessionStart` and `PreToolUse`, that can enforce local policy **if explicitly installed and configured**. Hooks are not present by default in AgentSkill and must not be claimed active without real settings. Prefer a host-owned permission rule to prevent dangerous commands over a Markdown warning alone. Never install a hook to launch tests automatically while the project/source phase or user preference defers localtest.

## Localtest

Only execute local test/build/native checks after verified user-local workspace, authorized `LOCAL_VALIDATION` phase and real tool availability. No Claude Code Cloud, cloud runner or GitHub Actions substitute. Use local evidence receipts with exact source HEAD and test results. A failure should be diagnosed at its code owner, not handed back as a vague request for the user to "test it themselves."

## Official documentation (checked 2026-11-13)

- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/skills

**Conformance state:** source-documented, effective loading/host behavior `NOT_EXECUTED`.
