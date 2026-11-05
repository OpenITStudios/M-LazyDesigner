# Development Operating Standard — LazyDesigner

**Canonical owner:** material repository/product engineering discipline. Root `AGENTS.md` selects the existing work lane; `GITHUB_RULES.md` owns branch, commit, manual CI, verification and STOP; `mcp/AGENTS.md` owns package/runtime-specific implementation. This file is not a new Skill, router, execution state machine, or parallel project ledger.

## Applies to

Material `DEVELOP` and `REPAIR` work, including cross-owner architecture corrections. `INSPECT`, `AUDIT`, and `PLAN` are read-only unless scoped mutation is explicitly authorized. `VALIDATE` executes only its requested proof; `RELEASE` retains explicit release authorization. Normal Asset Authoring and Reference Preparation keep their Control/specialist operating procedures.

## Development decision chain

```text
NORMALIZE intent, constraints, acceptance and non-goals
→ PIN repository, exact HEAD, owner, caller and consumer
→ DISCRIMINATE source fact / inference / hypothesis / UNKNOWN
→ DIAGNOSE earliest incorrect canonical owner
→ DESIGN smallest complete correction
→ IMPLEMENT only owner + affected consumers/contracts
→ VERIFY cheapest falsifiable evidence, positive and negative cases
→ COMMIT coherent outcome + actual continuity/proof metadata
→ STOP
```

Before material mutation, identify Goal, Success Metric, First Evidence, First Wrong Owner, In Scope / Out of Scope, Forbidden Proxy, Required Proof, Execution Context and STOP. Read 1–3 decision-changing owners by default; broaden only to resolve a material unknown. Follow `docs/04-system/ai-context-loading.md` REQUIRED / CONDITIONAL / EXCLUDED bundles.

## Agent Rules — seven-source adaptive development

For material development and UI/UX decisions, apply [Agent Rules](agent-rules.md): **Karpathy Guidelines, Ponytail, Pstack/Poteto Mode, Harness², DeepSeek Harness, REA and UI UX Pro Max**. Assess all seven lenses, load only decision-relevant upstream sources, and keep current repository governance, Control ownership, permissions, native safety and actual proof authority. This method does not install external executors, run recursive experiments, promote Skills, generate UI, or make unrelated new ChatGPT sessions automatically open this repository. Normal asset authoring retains its existing Control-specialist hot path.

## Minimum complete change

```text
no change required?
→ remove obsolete behavior safely?
→ correct existing canonical owner?
→ reuse an existing native capability?
→ smallest justified extension
→ new abstraction only with proven repeated responsibility or trust/protocol boundary
```

Do not add parallel routers, managers, registries, compatibility layers, persistent state, caching, retry/fallback stacks or `v2/new/latest/final` copies to disguise incomplete diagnosis. Preserve public versioning for genuine release/format/compatibility contracts. Trace affected producer/consumer interfaces, imports, negative cases, generated source ownership, tests, security and native behavior before changing an existing contract.

## Permission preflight — action, target and capability

For a concrete repository-agent operation use the deterministic, import-safe decision helper `.agents/permissions/preflight.mjs` (also callable with a JSON request from Node). `mcp/tests/fixtures/agent-permission-cases.json` owns its positive/negative/approval fixtures. `lane`, `task`, `action`, explicitly pinned `branch`, exact `path`, `task_scope_paths` (an explicit exact-file list), `execution_context` and explicit `authorized_scope` form the bounded request. An allowed source write requires both `branch: Local` and membership in the task file list; a boolean authorization claim alone cannot select arbitrary files. Unknown operations and unsafe paths fail closed. `ask` is **not** permission; do not invoke a blocked action. This is advisory preflight for AI/tool use, not a GitHub/Blockbench runtime interception layer; claimed authorization must be checked against the actual user request.

Work lanes and domain specialists do not grant blanket permission. Before writes, network execution, installs, publishing or native mutation, classify:

| Operation | Decision |
| --- | --- |
| Read public exact-head repository and selected canonical documents | ALLOW |
| Edit user-authorized `Local` canonical source, necessary contracts and tests | ALLOW only inside the requested scope and write-once preflight |
| Execute an existing targeted verifier in a genuinely available environment | ALLOW with bounded proof and no invented results |
| Access external network, install dependencies or execute third-party code | ASK when provenance/authorization is not established; do not execute untrusted input |
| Modify `main`, default branch, protection, rulesets, GitHub settings or permissions | ASK for separate explicit authority |
| Create/publish release, use signing secrets, delete tags or bypass deployment gates | ASK for exact release authority; retain safeguards |
| Mutate an asset, the live Blockbench session or user's private files | ASK unless the selected active authoring task expressly permits it |
| Leak secrets, force rewrite history, execute untrusted arbitrary code or edit unrelated owner | DENY |

`ALLOW` never expands task scope or upgrades proof. `ASK` blocks the operation pending authority, not a reason to change branches or tools. `DENY` is terminal for that method. Specialist advice cannot override a denied lane permission. These rules instruct agent decisions and repository policy tests; they are **not a claim of machine-enforced Runtime permissions**.

## Proof, security and efficiency

Separate source/static, executable unit/integration, packaging, `LOCAL_CODE`, and `LIVE_BLOCKBENCH` native/visual proof; never mix SHAs or upgrade a static fixture into runtime evidence. Preserve immutable Actions pins, least privilege, lockfiles, safe paths, secret exclusion, generated source ownership, licensing and release approval.

Optimize cost to a *correct accepted result*, not file count or short prompts. Reuse authoritative exact-owner source, known context handles and semantic impact planning. Avoid broad scans, repeated reassurance reads and full-suite reruns without risk justification. A stale test may be corrected only after proving the canonical implementation has moved; valid assertions may not be weakened for green CI.

## Completion review

Check no scope drift, duplicate state owner, dead abstraction, unsupported PASS claim, missing negative regression, unconsumed artifact, stale new route or unintended loss of capability. Report actual changed files, matching proof ceiling and exact unresolved native/local residue. Stop when the bounded outcome is satisfied; do not start adjacent repairs automatically.
