# Host and Execution Origin Identification — Fail-Closed

**Purpose:** identify **where the agent actually executes** and **which agent application controls the tools**. Do not infer from the name of the model ("Claude", "GPT"), an earlier conversation, a file named `CLAUDE.md`, a branch named `Local`, or a user-supplied transcript.

## Required dimensions (separate; never conflate)

| Dimension | Values | Source of truth |
| --- | --- | --- |
| `interface` | `CHATGPT_CONVERSATION` / `LOCAL_AGENT_APP` / `UNKNOWN` | actual invocation context and agent client, not repository prose |
| `tool_origin` | `GITHUB_API` / `USER_PC_WORKSPACE` / `HOSTED_CLOUD` / `UNKNOWN` | observed tool connection, execution target and environment |
| `host_app` | `CHATGPT` / `CLAUDE_CODE` / `CODEX_CLI` / `OPENCODE` / `UNKNOWN` | actual running client/session metadata; **not** underlying LLM provider |
| `model_provider` | OpenAI/Anthropic/other/unknown | model metadata, useful only for compatibility, **not** execution permission |
| `source_identity` | repo, worktree path or remote ref, HEAD, dirty status | explicit current Git state from the relevant host |
| `confidence` | direct host observation / user report / insufficient | record which facts were directly verified; user report alone never fabricates a shell |

### Resolution rules

- **In a ChatGPT conversation using connected GitHub operations without actual user-PC tools:** `CHATGPT_GITHUB`, irrespective of which computer the user is physically holding. Source-only limits apply immediately, no questions needed.
- **In Claude Code, Codex CLI/IDE or OpenCode on the actual user's PC:** `LOCAL_PC_AGENT` only after an authentic client/runtime session provides a real local workspace and executable tools, and the user has selected/authorized that workflow.
- A CLI name, installed binary, environment variable, directory path, local-looking OS, or model ID **alone** is not proof of current host or PC origin. Read/confirm the actual host's session info and tool target. Commands executed inside a hosted environment or AI cloud sandbox remain `HOSTED_CLOUD`, not `USER_PC_WORKSPACE`.
- **Codex Cloud ≠ Codex CLI on user's PC. Claude Code Cloud ≠ local Claude Code. OpenCode connected to a remote server ≠ automatically local.** Host product and actual tool execution location are separate.
- **Claude model via OpenCode = host_app OPENCODE**, not CLAUDE_CODE. GPT model via OpenCode = OPENCODE, not Codex CLI.
- If local evidence conflicts or host origin cannot be established, return `UNKNOWN_SURFACE` for any executable/local action, keep source read/review safe and do not suggest cloud fallback.
- After a confirmed local host session starts, **do not repeatedly ask which agent or where**. Carry the recorded host and workspace across the session; refresh only when context/host/worktree changes, compaction removes necessary information, or an action's permissions change.

## Machine-readable operational receipt (for future actual local host adapters)

Use a small per-session **ephemeral** record, not a second canonical source-of-truth database or public report:

`surface | host_app | host_version_observed | model_provider_observed | interface | tool_origin | workspace_identity | ref+HEAD | command_runner_observed | native_target_observed | permission_scope | active_holds | proof_ceiling | observation_source`.

This is an observation/routing contract, **not cryptographic attestation**. A JSON file or user-authored "verified=true" cannot prove a local PC or grant permissions. Host-specific adapters/hook integration may enforce rules **only** when the actual host supports them and after separate implementation/evaluation.

## Agent adapters — exact product mechanics

- Canonical AgentSkill source: `docs/adapters/codex-cli.md`, `claude-code.md` and `opencode.md`.
- Distributed, byte-identical host reference guides: `.agent-standard/adapters/codex-cli.md`, `claude-code.md` and `opencode.md`.
- Codex CLI: `AGENTS.md`/overrides, distinguish Codex Cloud.
- Claude Code: `CLAUDE.md` and `AGENTS.md` loading/version checks; hooks only if installed and authorized.
- OpenCode: actual server/agent target, model/provider separation, AGENTS/skill ID shadowing and versioned permissions.

Never install all adapters in every repo, or create three competing AGENTS files. The **core standard is byte-identical**; host adapters merely explain how to load and enforce it in their own client.

## Ambiguous examples and required resolution

| Observation | Resolution |
| --- | --- |
| "I am on my PC" written to ChatGPT with a GitHub link | `CHATGPT_GITHUB`, not local execution |
| A branch named `Local` | Branch identity only; no host origin evidence |
| ChatGPT reads a Codex localtest transcript | ChatGPT is still `CHATGPT_GITHUB`; transcript is evidence data, not tool execution by ChatGPT |
| Agent runs `pwd` in an OpenAI sandbox | Hosted tool execution, not the user's native machine |
| OpenCode uses Claude model | `OPENCODE` is the agent host, provider is Anthropic |
| Claude Code reads `CLAUDE.md` but not root `AGENTS.md` | Instruction conformance unverified; use version/config-specific adapter |
| Local agent has checkout but test tools unavailable | `LOCAL_PC_AGENT` established, `NOT_EXECUTED` for absent checks; never claim pass |
