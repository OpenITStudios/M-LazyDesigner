# Workspace Agent Routing

User-authorized autonomy replaces approval waits with verified checkpoints; never claim user approval.

## Agent Rules — seven-source bootstrap

For development/UI, use a **cheap seven-source applicability check**. **Karpathy Guidelines + Ponytail** are concise coding discipline; **Pstack / Poteto Mode** provides task playbooks if available; **Harness²** informs optional measured agent experiments; **DeepSeek Harness** informs plugin/tool/session lifecycle; **REA** informs authorized opaque-runtime investigation; **UI UX Pro Max** informs usability/accessibility/UI work. Read relevant detail only from [Agent Rules](docs/04-system/agent-rules.md), not all upstream repositories. No auto-install, CI, merge, model switch, extra agent loop, visible MCP UI or unrelated repo write. Root `AGENTS.md` works only when a compatible host actually loads this repo; generic ChatGPT chats do not automatically load GitHub files.

## Instruction priority

- Current user intent takes precedence over workflow guidance in `AGENTS.md` and Skills; repository safety/integrity rules and actual capability limits still apply.
- Do not invent approval gates; explain any rule that materially blocks an authorized action.

## Branch and boot

- `Local` is working authority; `main` changes only on explicit user request.
- Material GitHub work follows `GITHUB_RULES.md`.
- Working surfaces: ChatGPT + GitHub `Local` for research, design, source changes, reviews and commits; Codex for executable tests and actual LazyDesigner usage after a coherent system build is ready. Do not require the user's PC or an additional cloud test service. A Codex session is not evidence of an executable runtime unless its toolchain/checkout is actually available.
- Codex access is temporarily unavailable by user's instruction (2026-11-05). Continue complete independent ChatGPT/GitHub development; do not request, schedule, or require local/Codex/native tests, test handoffs or PC actions until the user explicitly reauthorizes them. Authored tests remain `NOT_EXECUTED`.
- Canonical documentation starts at `docs/README.md`; select one domain before loading deeper docs.

## Execution Context Gate

Choose the lowest **proven** context, not an intended label:
```text
CONTEXT: REMOTE_GITHUB | LOCAL_CODE | LIVE_BLOCKBENCH
SWITCH CONTEXT: <REMOTE_GITHUB | LOCAL_CODE | LIVE_BLOCKBENCH>
REMOTE_GITHUB   = GitHub source/commits only; verification CI disabled, no executed tests
LOCAL_CODE      = actual checkout + Bun/tests/build/generators
LIVE_BLOCKBENCH = LOCAL_CODE + installed, connected LazyDesigner Gateway/Runtime
```
Codex is not automatically LOCAL_CODE; Blockbench text does not imply LIVE_BLOCKBENCH. ChatGPT performs independent remote source work; Codex/local/native testing remains on user hold until explicitly reauthorized (2026-11-05). Tests authored now are `NOT_EXECUTED`. No PC instructions, extra cloud test prerequisite, unsupported PASS or whole-task transfer for one higher-context residue. Follow `GITHUB_RULES.md` for exact-commit proof.

### Observe / recover context

For read-only `amati`, inspect, audit, or recovery:

```text
AGENTS.md → GITHUB_RULES.md Core Rules
→ smallest owner/evidence that can answer the question
→ CONTEXT.md / docs/05-operations/next-action.md only when prior state is material
→ report → STOP
```

### Repository / Plugin Work

`AGENTS.md → GITHUB_RULES.md → actual context → Bounded | Standard | Complex → nearest owner`. Bounded requires Goal, first wrong owner, Acceptance, Proof and STOP. Standard adds metric, forbidden proxy, first evidence, in/out scope and higher-context residue. Read only decision-changing evidence.

### Bounded Maintenance

Concrete bug, stale rule/test, CI routing defect, or behavior-preserving cleanup starts at the exact owner. Do not load `lazydesigner-development-brief` merely because source code is involved.

### Complex / Ambiguous Development

Use `.agents/skills/lazydesigner-development-brief/SKILL.md` only when architecture, cross-owner ambiguity, unresolved success criteria, or a material unknown prevents a reliable standard contract. A clear optimization request does not become Complex merely because quality or efficiency matters.

### Skill System Work

Skill creation/audit/refinement/evaluation/retirement routes through `docs/04-system/skill-taxonomy.md` → `.agents/skills/lazydesigner-skill-development/SKILL.md` → only affected Skills/evidence. Do not use `lazydesigner-development-brief` for Skill maintenance.

Cross lane only with evidence: IN_USE defects stay with the active owner; proved MCP/runtime/plugin defects emit `DEVELOPMENT_HANDOFF` with observed/expected/minimum evidence, target owner and `resume_stage`; Skill-routing defects go to SKILL_SYSTEM. Suspicion alone is not evidence.

## Task Class After Context

### Reference Preparation

ChatGPT prepares references via `.agents/skills/lazydesigner-reference-preparation/SKILL.md` and `docs/02-reference/README.md`; Codex consumes approved artifacts. Icons/sprites use `lazydesigner-pixel-art-authoring`; particle references use `lazydesigner-particle-reference-authoring`; native atlas/UV/Painter remain Texturing. Produce minimum useful evidence and no sibling preload.

### Asset Authoring

LazyDesigner Control is the **only** normal asset router: one specialist per active stage, no sibling preload. Geometry/rig/pivots/UV → `lazydesigner-modelling`; atlas/material/PBR → `lazydesigner-texturing`; animation/motion → `lazydesigner-animation`. Reuse `known_context_ids` and fresh `control_delta`. Geometry and Texturing share AUTHORING; Animation crosses an explicit Runtime handoff. Use Stage GEOMETRY/TEXTURING/ANIMATION; `phase` identifiers remain compatibility names.
```text
Geometry APPROVED + UV Layout PASS → Texturing APPROVED → Animation eligibility
approved reference + current delta → Control → exact capability → mutate → fresh evidence
```
Do status/search/describe only for real unknown/stale capability, never as progress ceremony. Normal authoring skips source/tests/history/development brief. Native approval needs matching evidence; at FINALIZATION load `docs/03-authoring/finalization/standard.md`.

### ChatGPT + GitHub/cloud-only continuity

`GITHUB_RULES.md` owns `Local`, remote-only continuity, exact-SHA CI, recovery, security and STOP; do not require the user's PC. An `amati` request is read-only.

## Development Operating Standard

Material development follows `docs/04-system/development-operating-standard.md` before editing and at completion; no new lane or normal authoring preload.

Classify `INSPECT | PLAN | DIAGNOSE | DEVELOP | REPAIR | VALIDATE | RELEASE`. INSPECT/PLAN are read-only; lane changes need evidence. Apply permission preflight before writes, installs, networking, live mutation or release; a specialist cannot override denial.

Material commits use `Work`, `State`, `Proof`, plus conditional `Decision`, `Unresolved`, `Next`. Git owns history; `docs/05-operations/next-action.md` owns current continuation. Reconcile historical `Next` with current source.

## Source Precedence

current user → current source/proof → nearest `AGENTS.md` → Control-projected active specialist/context → selected canonical doc owner under `docs/` → operational continuity only when material → history.

## Work Discipline

- Fix the minimum complete owner; no fallback/framework/profile layers without evidence.
- Reuse fresh returned state; do not add reassurance reads or progress checks.
- Stop the same failed direction after two attempts without new evidence.
- `No change required` is valid; never claim proof above the context ceiling.
- **Authoring Efficiency** = cost to accepted result; **Static Footprint** = guardrail only.

```text
CURRENT-PROJECT VERIFIED
OFFICIALLY VERIFIED
LOCAL PROOF REQUIRED
UNSUPPORTED
UNKNOWN
```

## Product Boundary

LazyDesigner authors Bedrock visual assets, not Minecraft add-on development. `bedrock` remains default; `mcp/AGENTS.md` owns `mcp/**`.

## Canonical Owners

`docs/README.md` routes product `01-product/`, reference `02-reference/`, authoring `03-authoring/`, system `04-system/`, operations `05-operations/`. Project assets `workspace/active/<project>/README.md`, facts `CONTEXT.md`, Git rules `GITHUB_RULES.md`. One owner per durable fact; no duplicate ledgers.

## Repository Top-Level Discipline

Follow `README.md#repository-root-policy` and `docs/04-system/canonical-vocabulary.md`. Source under `mcp/apps/distribution`, instructions under `.agents/docs`, assets under `workspace`. Lowercase kebab-case directories; aliases only for compatibility, new docs extend current owner.

