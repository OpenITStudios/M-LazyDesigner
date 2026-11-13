# Decision, Routing and Ownership Contract

**Owner:** OpenITStudios AgentSkill. **Applicability:** all adopted repositories; project-specific taxonomy may narrow domain selection but not core authority or permissions.

## Decision before action

For a bounded task, infer only the smallest safe contract needed. For complex work, record:

`GOAL | RESULT | MODE | SCOPE/NON-GOALS | SELECTED_REPO/REF/HEAD | CURRENT_HOLDS | PRIMARY_OWNER | MATERIAL_UNKNOWN | NEXT_SAFE_ACTION | REQUIRED_PROOF | STOP`

Do not turn this into a user-facing questionnaire or a mandatory planning document. The agent should work directly when requirements and authority are already clear.

**Two independent axes:**
- **Mode** = `INSPECT`, `PLAN`, `DEVELOP`, `MAINTAIN`, `VALIDATE`, `PRODUCE`, `RELEASE`. A request to review/audit/research is read-only, regardless of how many improvements are discovered. Validation is not permission for repair; production is not permission for system development.
- **Complexity** = bounded / standard / complex. Use a fuller development brief only when ownership, acceptance, architecture or cross-component implications are genuinely ambiguous.

## Intent and research readiness — mandatory decision, conditional depth

Before material implementation, inspect the user's actual goal, selected source/ref, current decisions, scope/non-goals, acceptance, and real permissions. Choose the **lightest** justified outcome. This decision check is mandatory; a new Skill, form or persistent checklist is not.

| Decision | When and what to do |
| --- | --- |
| `PROCEED_DIRECTLY` | Result, owner, acceptance and authority are clear; deliver the bounded requested outcome |
| `RESEARCH_MORE` | The user requests broad research or a material technical choice lacks original-source or alternative evidence; search further before recommending |
| `DISCUSS_FIRST` | A choice materially changes architecture, security, data, major UX behavior or acceptance and cannot be resolved from current source or a safe stated assumption; show alternatives and ask one high-impact question |
| `BLOCKED` | Missing permission, source or dependency prevents safe work; report the exact reason and complete only independent permitted work |

**Read before asking.** Do not request information already supplied by the user, current project or accepted decisions. When the user explicitly requests discussion or design first, keep implementation read-only; propose the smallest useful design, show relevant options and obtain a decision about the unresolved consequence.

**Separate the gates:** `DESIGN_READY` means the material goal, acceptance and risks are sufficiently understood; `ACTION_AUTHORIZED` means the actual current user request, repository profile, tool capability and permissions independently authorize the specific side effect. **Design approval does not grant mutation permission.** Neither a completed plan, external Skill nor historical `Next` grants new repository authority.

Research depth and source sufficiency are owned by `execution-sop.md` and `evidence-and-recovery.md`. A clear, bounded edit must not be held for a ceremonial broad literature search or an obligatory development brief.

## One accountable owner

Select the **semantic owner of the requested final deliverable**, not the programming language, file extension or most frequent keyword. Distinguish:

| Question | Canonical owner |
| --- | --- |
| What the product is expected to do | product/foundation contract and current authorized user intent |
| How a behavior is implemented | source module and its interfaces |
| Which domain procedure to follow | one primary domain `SKILL.md` |
| Which task/skill is active | root routing and project skill registry/taxonomy |
| Which branch or file may change | selected branch, repository profile and real tool permission |
| Whether a result actually works | matching executable/runtime/observation evidence |
| What to do on next session | compact checkpoint; current source remains authoritative |

An implementation technology alone does not justify a new Skill. No separate Skills merely for TypeScript, Rust, packaging, screenshots or a one-off fix unless repeated work demonstrates a distinct **reusable semantic responsibility**.

## Methods are not Skills

After identifying the **one primary semantic owner**, a material source change gets the **Karpathy + Ponytail single-pass** check from `.agent-standard/methods.json`. Use a conditional lens (Pstack, Harness², DeepSeek Harness, REA, UI UX Pro Max, or Matt Pocock) only for its positive trigger, and skip it on its negative trigger. A method is **not** a new installed Skill, agent, permission, mode or alternative project router.

## Conditional skill selection

1. Resolve mode and final output.
2. Determine the first wrong or necessary owner. A direct source/owner path may require **no** Skill for a bounded correction.
3. Check positive and **negative** triggers. Select one primary Skill only where it contributes a real procedure or judgment.
4. Read only its required source and direct references; supporting skills answer narrowly defined questions, not create parallel control planes.
5. A handoff **ends** the previous specialist's responsibility; one actor remains accountable for final integration.

## Activation decision table

This is the **single canonical routing decision map**, not a new agent, Skill registry, or model-generated checklist. Apply it when the task's owner/Skill is non-obvious. Mode and permissions still come from root/profile. Evaluate positive and negative triggers; do not preload every Skill or method.

| Route ID | Positive trigger | Primary selection | Negative trigger / abstain |
| --- | --- | --- | --- |
| repository-audit | Read-only repository inventory, architecture inspection, branch or rules comparison | `oits-repository-audit` | Not for repairing source, agent-behavior tuning, or creating a commit from findings |
| agent-quality | Explicit request to improve agent routing, Skills, instructions, evaluation, or agent behavior | `oits-agent-quality-review` | Not for ordinary product fixes, design production, or general repository inventory |
| complex-development | Authorized implementation with ambiguous ownership, architecture, contracts, or cross-component acceptance | `oits-development-brief` | Not for bounded known-owner fixes, read-only audits, or agent-rule quality tasks |
| bounded-change | Authorized small change with clear owner, known acceptance, and no complex cross-owner uncertainty | `NONE` | If complexity is material, select complex-development instead; no mandatory meta Skill |
| domain-production | User requests a real product, visual asset, model, map, or other domain deliverable | `DOMAIN_LOCAL` | Do not substitute central meta Skills for project-owned domain Skills, or infer uninstalled Skills exist |
| validation-only | User asks to validate or explain evidence without authorizing repair | `NONE` | Do not mutate the target or claim executed tests from source review; use a domain validation Skill only if genuinely available and relevant |
| release-intent | User explicitly requests an authorized release or publication workflow | `NONE` | A draft, version discussion or review alone is not release approval; follow repository release/permission gates |

`NONE` is **deliberate Skill abstention**, not omission of applicable root safety, communication or proof rules. `DOMAIN_LOCAL` selects the existing product Skill under its actual host discovery and permissions; never shadow it with a central meta Skill. For material code, apply Karpathy + Ponytail as **one adapted method pass**, separate from the primary Skill or no-Skill decision. Optional methods require positive and negative checks of `.agent-standard/methods.json`.

**Activation evidence:** identify candidate → exclude negative matches/collisions → verify actual advertised Skill ID/source and host permission → load only the selected procedure → perform the authorized task → verify the outcome. When host discovery/load is inaccessible, use the applicable source-owned procedure if available but label the Skill itself `NOT_VERIFIED`. A registry URL or repo file is not proof of activation. An explicit Skill request cannot grant missing host access or override a hold.

### Collision examples

- "Amati repo" → `oits-repository-audit`, **not** development or an implicit commit.
- "Fix a typo in existing README" → bounded owner directly, **not** the meta development Skill.
- "Refactor contracts across engine/UI" → `oits-development-brief`, plus exact domain owners in sequence.
- "Improve how the AI selects skills" → `oits-agent-quality-review`, **not** a domain production Skill.
- "Create a model/map/document" → project domain Skill; core review/brief only if a separate system problem is authorized.
- "Validate a result" → actual evidence check, **not** permission to mutate the original target.

## Cross-owner ambiguity and handoff

If several owners appear relevant, ask which owns the output if the file format/tool changed. If still ambiguous, inspect the current canonical domain docs and existing callers. Do not create another router to settle a documentation gap. Refer to `handoff-and-state.md` for typed handoff.

## Quality boundary

Skill selection is an evaluated decision; a substring keyword match is only a discovery hint. A correct router must **abstain** when no skill adds value. Project-specific skill sets and approvals are not imported as a universal eight-agent hierarchy.
