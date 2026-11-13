# Canonical State, Bounded Handoff and Convergence

**One fact, one owner.** Documentation, Skills, source, observations, permissions and recovery packets each have a distinct job. Never create a second authoritative state machine merely for easier prompting.

## Ownership table

| State or claim | Canonical producer |
| --- | --- |
| Current user goal / permission | the actual user and host authorization |
| Product semantics | approved product owner and canonical domain contract |
| Code behavior | current selected source/ref plus matching execution evidence |
| Skill procedure | one canonical `SKILL.md` selected by root/taxonomy |
| Skill identity and classification | registry/taxonomy, not independently duplicated prompts |
| Runtime outcome | real connected target / test / persisted artifact witness |
| Git history | current commit graph and original blob authority |
| Continuation | small, versioned checkpoint, **advisory only** |

A summary, handoff note or stale issue cannot supersede actual source/permission. For recovered tasks, trace CURRENT/SUPERSEDED/CONFLICTED/UNKNOWN decisions back to current owner and evidence; a handoff packet is advisory, not a second state authority.

## Typed handoff (only on real cross-owner work)

Each transfer should carry:

`CONSUMER | PRODUCER | QUESTION/REQUIRED_RESULT | SAFE_SOURCE_POINTER+REVISION | CONFIRMED_FACTS | UNKNOWNS/CONFLICTS | CHANGED_CONTRACTS | PROOF_CEILING | NEXT_OWNER | STOP`

- A supporting specialist returns the **smallest decision-changing result**, not a full copy of project data or prior prompt.
- The previous specialist stops after handoff. A single primary owner integrates and validates the final deliverable.
- Passing a pointer, issuing a tool command or finishing a stage is not automatically user approval or end-to-end acceptance.
- For sensitive/private sources, the recipient gets only information and access explicitly authorized; do not copy documents or proofs into a public Git repository.

## Transition gates

Every stage must name its input identity, accepted output, required proof and outstanding unknowns. Product-specific stage naming remains local. A quality or readiness label is valid only for the stage and revision actually observed; a geometry stage may pass without texturing/animation being ready.

**Mutation invalidation:** if a source/target revision changes, invalidate affected downstream evidence. Do not retain an earlier visual/native ACCEPTED label for a materially changed artifact. Prefer targeted revalidation over repeating every historical check.

**Correction convergence:** `Observed mismatch → owning stage → bounded correction → necessary dependent checks → updated receipt`. Count only verified changes toward progress; tool calls or reported completion alone do not prove convergence.

## Scoped history for durable handoff

Commit one coherent change with enough context for its risk: TRIVIAL subject-only requires a reviewed diff; new NORMAL needs `Surface / Goal / Work / State / Proof / Next`; CRITICAL also retains `Decision / Unresolved`. Older messages without `Surface` have an unrecorded environment, not implicit local proof. The stable `Work` topic indexes history, while the actual source and current project status own the present truth. A past `Next` never authorizes localtest, CI, merge or deployment. For cross-chat recovery follow `commit-continuity-and-recovery.md`, and do not open an unrelated latest workstream.

## Persisted checkpoints and unsaved handoffs

A checkpoint is an **advisory pointer** to canonical evidence, not a source of new instructions or a separate truth store. Use the existing current-status or decision owner, with project-specific authorization and privacy checks, for material events. Avoid writing a new status file or separate memory database just because a conversation is long.

| Save state | What is actually known | Permitted recovery action |
| --- | --- | --- |
| `PERSISTED` | Authorized write was acknowledged **and** destination/source state was read back at an identified revision | Re-pin current HEAD and reconcile changes before using it |
| `UNSAVED` | Only a copyable chat handoff exists; no durable destination receipt | Use as a clue; verify source and request missing material decisions |
| `UNKNOWN_OUTCOME` | A write was sent but acknowledgment, source or destination state is uncertain | Inspect the actual remote state before retry |
| `STALE` | Later relevant changes conflict with the checkpoint's revision or claims | Prefer current owner/source; resolve conflicts without rewriting history |

**For a lost acknowledgment or concurrent update, reread the actual remote state before any retry; do not force-push or blindly overwrite.** A committed checkpoint may record a previously observed branch SHA: its own commit advances HEAD, and the read-back/commit receipt identifies the persisted state without another bookkeeping commit. Copyable handoffs and chat messages alone are **UNSAVED**, not durable proof.

Keep the packet minimal: `TOPIC | WORK_ID | GOAL+ACCEPTANCE | SOURCE_REF+LAST_OBSERVED_HEAD | CURRENT_DECISIONS+ORIGIN | SUPERSEDED/CONFLICTS | HOLDS+PERMISSION | COMPLETED_PROOF | UNKNOWN_OUTCOMES | NEXT_SAFE_STEP | SAVE_STATE`. Do not duplicate sensitive project content in a public standard. This is a *description of what to capture*, not a requirement to create a new owner or to write without permission.

## Interrupted or ambiguous side effects

For a write/send/commit with lost acknowledgment, outcome is `UNKNOWN_OUTCOME`. Inspect actual remote state and idempotency key/commit/ref where supported **before** retry. Do not create a duplicate PR, message, report, file or payment merely to resolve uncertainty. A checkpoint without a receipt is not proof of success.

If current permissions/host are inadequate, complete independent safe source work and report the precise remaining proof. No background worker, daemon, external state DB, new issue tracker or unattended UI automation is implied.
