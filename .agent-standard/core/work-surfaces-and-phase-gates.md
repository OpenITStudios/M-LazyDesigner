# Execution Surfaces and Phase Gates — Two Methods, Never Silent Substitution

**Status:** normative OpenITStudios-wide policy. **Purpose:** distinguish how work is performed from what the task is. This contract takes precedence over generic suggestions to "run tests", "try CI", or "use a cloud agent" in project development documents. It does not override platform security or explicit stricter project holds.

## Two approved execution surfaces

| Property | `CHATGPT_GITHUB` — method A | `LOCAL_PC_AGENT` — method B |
| --- | --- | --- |
| Actual interface | ChatGPT conversation, GitHub connector/tools | Claude Code, Codex CLI/IDE, or OpenCode **actually running against user's PC workspace** |
| Repository authority | Exact GitHub repository/ref/HEAD | Exact locally checked-out repository/branch, dirty status and synced commit |
| Capabilities | GitHub source reads and authorized source edits, diffs, architecture, docs, test/fixture authoring | Local filesystem, actual shell/toolchain, build, localtest, installed/native app checks **when permitted** |
| Cannot claim | Local PC access, native execution, build/test PASS, direct runtime observation | Tests PASS until they actually run; ChatGPT user session control from CLI |
| Primary outcome | **Finish main architecture and coherent source implementation**; SOURCE_READY_FOR_LOCAL later | Execute local acceptance and fix source/runtime feedback after explicit transition |
| Forbidden substitute | **No GitHub Actions, cloud CI, hosted runners, remote sandbox, cloud agent, web-based emulator or synthetic PASS** in place of localtest | Same ban on substituting cloud for desired local/native acceptance |

`UNKNOWN_SURFACE` is a safe fallback, **not a third approved work method**: no tests, no new mutation authority and no claim of local-PC proof until actual context is established.

## Hard rules for CHATGPT_GITHUB

1. **Assume no access to the user's local machine.** A GitHub API/connector, an uploaded file, an attached transcript, a browser running on the user's PC, a branch called `Local`, or an incidental cloud container does not provide a user-PC runtime.
2. **Do all source work that can be done via the available authorized GitHub tools:** architecture, contracts, interfaces, module integration, error handling, domain rules, data models, tests/fixtures as source, documentation, static source inspection, compare exact commits and source-level review. Do not leave easy source defects open merely because there is no localtest.
3. **Never ask the user to localtest during active source-architecture development,** never demand repetitive localtest between features, and never make localtest a prerequisite to completing available source work. Do not propose cloning, uploading code, reinstalling tools, or using their PC as a remote command runner in this lane.
4. **Never run or offer GitHub Actions, cloud CI, hosted sandboxes, GitHub runner dispatch, cloud agent or browser emulation as a workaround.** Even if a tool exists or CI is enabled in a repository, it is **not** part of this workflow's source-development validation. Do not create a workflow to circumvent the boundary.
5. **Source-only completion is legitimate.** Report `SOURCE_REVIEWED`, `SOURCE_COMMITTED`, `TEST_AUTHORED_NOT_RUN` and `LOCAL_TEST_DEFERRED` as appropriate, never `EXECUTED_TEST_PASS`, `LIVE_TARGET_VERIFIED` or `PRODUCTION_READY`.
6. After the **main architecture and integrated source scope** are complete, prepare one compact, pinned `SOURCE_READY_FOR_LOCAL` package. **Do not demand the user act on it immediately.** Stop in ChatGPT when source scope is complete or when actual repo permission blocks a specific action.

### SOURCE_READY_FOR_LOCAL admission (source-level, not tested)

Use this label only if all are satisfied for the agreed source scope:
- Architectural decisions and ownership are resolved, not left as known material contradictions.
- Related code/contracts/integration changes and necessary tests/fixtures have been authored coherently on the authorized ref.
- Cross-component impacts, API/data/compatibility boundaries and first-wrong-owner risks are inspected with currently available source evidence.
- Branch, exact commit SHA, change map, known limitations, deferred commands and target-specific acceptance criteria are recorded.
- No statement that build/runtime was verified. Any unknown that only actual local/native execution can settle is explicitly `LOCAL_TEST_DEFERRED`.
- A known unresolved **source architecture blocker** means `SOURCE_IN_PROGRESS` or `SOURCE_BLOCKED`, **not** `SOURCE_READY_FOR_LOCAL`.

A user may end a session before full source scope completes; report the current independent result and STOP without escalating to local.

## Hard rules for LOCAL_PC_AGENT

1. Enter only from **positive, current host/workspace evidence**: actual Claude Code/Codex CLI/OpenCode interface, project checkout accessible through that agent's local tools, shell/toolchain genuinely targeting the user's PC, plus user-selected local workflow. Provider/model name alone is insufficient. See `host-identification.md`.
2. Pin local checkout root, branch, HEAD, dirty/worktree state, OS/versions and actual available tools. Distinguish a real local PC from WSL/local containers, remote SSH, Codespaces, cloud hosts or sandbox; none of these count as the user's PC automatically.
3. Read source handoff and exact revision. Reconcile pending changes before applying patches or executing tests. Never force-reset or overwrite uncommitted user files to obtain a clean status.
4. Run targeted permitted local checks, installed app/native tests and correction cycles based on the accepted source architecture and actual user instructions. **No GitHub Actions/cloud fallback.**
5. Report observed failure with runner/environment/command/target SHA, reproduce source cause, patch smallest correct owner, rerun affected local checks, and return an exact correction receipt to source governance.
6. Changes to branch, release, deploy, production data and cross-repo writes still require their own approval. Local tool capability is **not** global permission.

## Work phases (orthogonal to surfaces)

`SOURCE_ARCHITECTURE → SOURCE_INTEGRATION → SOURCE_READY_FOR_LOCAL → LOCAL_VALIDATION → LOCAL_ADJUSTMENT → LOCALLY_VERIFIED`.

- Default when doing authorized ChatGPT/GitHub development: remain in `SOURCE_ARCHITECTURE` / `SOURCE_INTEGRATION` until main architecture and source scope are coherent. Not every component handoff reopens localtest.
- `SOURCE_READY_FOR_LOCAL` is a **handoff artifact**, not a command to test now, production approval or evidence that local is connected.
- `LOCAL_VALIDATION` requires an explicitly selected local-PC host and an approved timing, not a source commit or a "ready" text alone.
- `LOCALLY_VERIFIED` means actual matching executed checks passed; native/visual quality needs corresponding native observations.
- Feedback after localtest may be worked back through ChatGPT/GitHub source corrections **without demanding another localtest until a suitable consolidated cycle**. Distinguish the new untested HEAD from prior verified SHA.
- Releases and promotions remain independent opt-in actions, not automatic next phases.

## Communication standard

In ChatGPT/GitHub replies write a brief status only when material:

`Surface: CHATGPT_GITHUB | Task mode: DEVELOPMENT | Source: repo/ref@SHA | Architecture: IN_PROGRESS/INTEGRATED/SOURCE_READY_FOR_LOCAL | Proof: SOURCE_REVIEWED/SOURCE_COMMITTED/TEST_AUTHORED_NOT_RUN | Localtest: DEFERRED, NOT REQUESTED | CI/cloud: NOT USED`.

In local-PC replies:

`Surface: LOCAL_PC_AGENT | Host: CLAUDE_CODE/CODEX_CLI/OPENCODE | Workspace/ref@SHA | Local tools observed | Tests actually executed/results | Native acceptance | Remaining discrepancies`.

Never falsely label a ChatGPT/GitHub session as a local-PC agent just because the user opened ChatGPT on a desktop computer.
