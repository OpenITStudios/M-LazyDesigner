# Workspace Agent Routing

User-authorized autonomy replaces approval waits with verified checkpoints; never claim user approval.

## Instruction priority

- Current user intent takes precedence over workflow guidance in `AGENTS.md` and Skills; repository safety/integrity rules and actual capability limits still apply.
- Do not invent approval gates; explain any rule that materially blocks an authorized action.

## Branch and boot

- `Local` is working authority; `main` changes only on explicit user request.
- Material GitHub work follows `GITHUB_RULES.md`.
- Canonical documentation starts at `docs/README.md`; select one domain before loading deeper docs.

## Execution Context Gate

Classify by **actual capability**, not product/UI name:

```text
CONTEXT: REMOTE_GITHUB
CONTEXT: LOCAL_CODE
CONTEXT: LIVE_BLOCKBENCH
SWITCH CONTEXT: <REMOTE_GITHUB | LOCAL_CODE | LIVE_BLOCKBENCH>
```

A marker is intent, not proof. Without a marker, choose the lowest sufficient provable context. Never infer `LOCAL_CODE` from “Codex”; never infer `LIVE_BLOCKBENCH` from mentioning Blockbench. `LIVE_BLOCKBENCH` is never assumed.

```text
REMOTE_GITHUB   = GitHub repository + CI; no local worktree/Bun/installed Blockbench
LOCAL_CODE      = local checkout + Bun/tests/build/generators/filesystem
LIVE_BLOCKBENCH = LOCAL_CODE + deployed LazyDesigner runtime + functioning Gateway/runtime connection
```

Proof ceiling follows actual context; exact-commit source acceptance follows `GITHUB_RULES.md`.

```text
REMOTE_GITHUB → exhaust source/static/CI-verifiable work first
higher-context dependency → partition; prepare independent tests/harness/evidence here
handoff only the minimum higher-context residue
never transfer the whole task because one residue needs more capability
covered source result complete → accept CI proof; label only genuinely missing higher-context proof
```

### Observe / recover context

For read-only `amati`, inspect, audit, or recovery:

```text
AGENTS.md → GITHUB_RULES.md Core Rules
→ smallest owner/evidence that can answer the question
→ CONTEXT.md / docs/05-operations/next-action.md only when prior state is material
→ report → STOP
```

### Repository / Plugin Work

```text
AGENTS.md → GITHUB_RULES.md Core Rules → EXECUTION CONTEXT
→ Bounded | Standard | Complex
→ nearest AGENTS.md + exact owner
→ only evidence/continuity that can change the decision
```

#### Development Execution Gate

**Bounded contract**
```text
Goal
Failure Classification / first wrong owner
Acceptance
Proof Required
STOP Condition
```

**Standard contract**
```text
Goal
Success Metric
Forbidden Proxy / Non-Goal
First Evidence Required / first wrong owner
In Scope / Out of Scope
Execution Partition / higher-context residue
Proof Required
STOP Condition
```

### Bounded Maintenance

Concrete bug, stale rule/test, CI routing defect, or behavior-preserving cleanup starts at the exact owner. Do not load `lazydesigner-development-brief` merely because source code is involved.

### Complex / Ambiguous Development

Use `.agents/skills/lazydesigner-development-brief/SKILL.md` only when architecture, cross-owner ambiguity, unresolved success criteria, or a material unknown prevents a reliable standard contract. A clear optimization request does not become Complex merely because quality or efficiency matters.

### Skill System Work

Skill creation/audit/refinement/evaluation/retirement routes through `docs/04-system/skill-taxonomy.md` → `.agents/skills/lazydesigner-skill-development/SKILL.md` → only affected Skills/evidence. Do not use `lazydesigner-development-brief` for Skill maintenance.

Cross lane only with evidence: IN_USE defects stay with the active owner; proved MCP/runtime/plugin defects emit `DEVELOPMENT_HANDOFF` with observed/expected/minimum evidence, target owner and `resume_stage`; Skill-routing defects go to SKILL_SYSTEM. Suspicion alone is not evidence.

## Task Class After Context

### Reference Preparation

Reference generation belongs in **ChatGPT** through `.agents/skills/lazydesigner-reference-preparation/SKILL.md`; Codex consumes the approved/usable artifact rather than recreating that workflow. Use `docs/02-reference/README.md` and load only the selected branch:

```text
smooth visual/model reference → image reference branch
strict pixel icon/sprite/tile  → lazydesigner-pixel-art-authoring
Bedrock/Snowstorm particle     → lazydesigner-particle-reference-authoring
```

Generate minimum useful evidence. Pixel Art does not own Blockbench atlas/UV/Painter mutation; mapped texture production remains `lazydesigner-texturing`.

### Asset Authoring

LazyDesigner Control is the canonical routing/context authority. There is no separate asset-router Skill in the normal authoring path.

```text
current AGENTS.md
→ LazyDesigner Control
→ active stage context + required handles
→ exactly one active specialist

Geometry / rig / pivots / UV Layout → lazydesigner-modelling
Texture Atlas / Styling / PBR      → lazydesigner-texturing
Animation / motion                  → lazydesigner-animation
```

Do not preload sibling specialists or all profiles. Reuse unchanged `known_context_ids`; load another specialist only when semantic ownership changes.

Lifecycle remains:

```text
Geometry APPROVED + UV Layout PASS
→ Texturing APPROVED
→ Animation eligibility / AUTHORING↔Animation handoff when required
```

Geometry↔Texturing share the AUTHORING Runtime Surface; Animation is the Runtime Surface handoff boundary. Use `Stage` for GEOMETRY/TEXTURING/ANIMATION; existing `phase` identifiers remain compatibility names.

Hot path:

```text
approved reference + current delta
→ Control stage/context
→ exact known capability
→ mutate
→ reuse returned state/control_delta
→ minimum verdict-changing evidence
```

Use status/search/describe only for stale/unknown orientation, capability identity, or real schema uncertainty—not progress ceremony. Normal asset authoring does not load repository history, source/tests/CI, or `lazydesigner-development-brief` unless bounded evidence proves a product/runtime defect.

At `FINALIZATION`, load only `docs/03-authoring/finalization/standard.md`.

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

```text
documentation entry point → docs/README.md
product/flow              → docs/01-product/
reference preparation     → docs/02-reference/
asset authoring           → docs/03-authoring/
system/ownership          → docs/04-system/
current operations        → docs/05-operations/
asset continuity          → workspace/active/<project>/README.md
stable project facts      → CONTEXT.md
GitHub execution          → GITHUB_RULES.md
research                  → experiments/
managed distribution      → distribution/
```

Do not create duplicate navigation, review archives, decision logs, roadmaps, or parallel state systems.

## Repository Top-Level Discipline

Keep the root sparse and deterministic for Codex navigation.

Allowed top-level domains are `.agents/`, `.github/`, `apps/`, `distribution/`, `docs/`, `mcp/`, `workspace/`, and `experiments/`, plus repository-wide entrypoint/governance/toolchain files.

Do not add top-level feature, generated, fixture, benchmark, archive, temporary, or per-asset directories. Put them under the canonical owner.

Naming:
- directories use lowercase kebab-case;
- one semantic concept has one canonical name;
- aliases exist only for compatibility and must be explicitly identified as such;
- new documentation must extend an existing owner rather than create a parallel owner.


Canonical architecture vocabulary: `docs/04-system/terminology.md`.
