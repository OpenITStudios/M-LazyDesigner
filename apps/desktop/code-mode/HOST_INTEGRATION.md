# Local Code Mode host integration — source handoff

**State:** HOST_NOT_CONNECTED; SOURCE_ONLY / NOT_EXECUTED. A GitHub branch, source SDK or code sample is not a PC-local Codex session or a configured sandbox. This is a host setup/acceptance contract, not a request to start the held localtest phase.

## Runtime boundary (must be real, not prompt-only)

```text
User-selected LOCAL_PC_AGENT (Codex CLI/IDE or another verified host)
  -> host-restricted code execution (filesystem/network/permissions)
  -> host-injected client with approval callback
  -> first-party lazydesigner-authoring CLI (shell=false)
  -> single Rust AuthoringDocument + checked transactions
  -> new sibling file + authoritative receipt
```

The source SDK itself is **not a sandbox**. A generated program executed by unrestricted Node can import child_process, read files, create its own fake authorizer, or call the binary directly. The trusted host must provide actual OS/process isolation, path/credential restrictions, and require human approval when needed. Running this SDK from an unrestricted Node shell without those protections **does not meet the Code Mode host gate**.

## Host acceptance contract

1. Identify actual user-PC agent host, observed version, selected checkout root, current branch/HEAD, unsaved worktree state and effective `AGENTS.md`/local policy. Only a user-authorized later transition to `LOCAL_PC_AGENT` can satisfy this proof. GitHub and cloud containers do not.
2. Use the *compiled first-party Rust binary* from the authorized checkout and record its exact build/source SHA. Never fetch or execute unknown binaries, auto-install an upstream Code Mode package, run GitHub Actions or silently switch to the legacy Blockbench Runtime.
3. Restrict code execution to the approved model workspace and granted output directory; keep sensitive paths, credentials and network origins unavailable. `authorizeMutation` is supplied by **trusted host code**, not by the model-generated program. The host should pass the model a fixed, capability-limited SDK reference; no direct arbitrary shell or filesystem by default.
4. Treat `newModel`, `apply`, `importPng`, `exportPng` and `exportGeometry` as writes. Before each write, show/check the exact input/output, current expected SHA, requested operation kinds/count and `planSha256` for a batch, then decide permission. A generic task approval does not permit deleting unrelated user files. Return `true` only after actual authorization. Missing/denied approval must remain a no-execution error.
5. A `project` from `openRustCodeModeProject(client,input)` is a path/SHA-bound **read-only view plus guarded write methods**; it does not store a second mutable scene. All writes require Rust CLI SHA/revision validation and exclusive new-sibling publishing; never overwrite originals. If a process exits uncertainly, inspect filesystem/source state before any retry.
6. Agent output should report compact receipts (`output_sha256`, `changed_uuids`, revision) and decision-changing audit findings. Do not expose full embedded PNG, arbitrary imported metadata or private model data in the agent transcript. `audit.visual_verdict` remains `UNVERIFIED` until real six-angle/close-up native inspection and user review.
7. Verify the host's actual sandbox and process permissions with an **explicitly authorized** held-test transition before claiming Code Mode available: read-only inspection, denied write, approved atomic write, stale SHA, output collision, ambiguous failure, and native format round trip. Authoring this checklist is **not** test execution.

## Positive and negative source paths

| Case | Required behavior |
| --- | --- |
| `inspect`, `catalog`, `audit` | Read-only; bounded text; exact file SHA; no implicit model mutation |
| No `authorizeMutation` | `CODE_MODE_MUTATION_AUTHORITY_REQUIRED`; no Rust CLI write call |
| Approval returns anything other than `true` | `CODE_MODE_MUTATION_NOT_APPROVED`; no Rust CLI write call |
| Correctly approved, source SHA still matches | Existing Rust `EditorSession` validates and publishes a new sibling; report receipt only |
| Incorrect/stale source SHA | Rust rejects; old source remains intact |
| Timeout, signal, partial output | Outcome uncertain; inspect actual files, never auto-replay mutation |
| Unsupported image, UV, geometry or animation metadata | Rust refuses rather than silently dropping imported data |
| Program accesses other paths or network | Actual host sandbox must prohibit; SDK alone cannot enforce |

## Example division of responsibility

```js
// Executed by the *trusted host setup*, not pasted into model-generated JS.
// Illustrative only: hostDecision is a REAL host-owned authorization callback.
import { createRustCodeModeClient, openRustCodeModeProject } from './client.mjs';
const client = createRustCodeModeClient({
  binary: absoluteVerifiedFirstPartyBinary,
  authorizeMutation: hostDecision,
});
const project = await openRustCodeModeProject(client, approvedAbsoluteModelPath);
// Host makes only this restricted project API available to the agent program.
```

A code-generating agent then uses the supplied `project.catalog`, `project.inspect`, `project.audit` and, when explicitly approved, `project.apply`. If the host cannot isolate the generated script from the full Node runtime or inject a non-forgeable capability, retain read-only code use and do **not** claim a secure write-enabled Code Mode integration.

## Evidence and ownership

The current source phase takes place in `CHATGPT_GITHUB`. `.agent-standard/adapters/codex-cli.md` owns Codex host identification and skill loading; `docs/04-system/code-mode-migration.md` owns Rust-specific migration, and `docs/05-operations/current-validation.md` owns proof status. The existing 12 LazyDesigner domain Skills, `Local` Gateway/Control and all CI/test holds remain preserved.

Official guidance (reviewed as research, not installed software):

- OpenAI agent sandbox security: https://developers.openai.com/api/docs/guides/agents-api/environments/security
- OpenAI self-hosted environment responsibilities: https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted
- Node VM is not a security boundary: https://nodejs.org/api/vm.html
