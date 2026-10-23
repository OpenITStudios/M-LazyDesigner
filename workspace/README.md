# Asset Workspace

`workspace/` is repository-backed continuity for **one persistent Blockbench Asset Model per project folder**. It is not MCP runtime input, not a general cache, and not a transcript store.

## Layout

```text
workspace/
├─ active/
│  └─ <asset>/
│     ├─ README.md
│     ├─ <asset>.bbmodel          # only after baseline/checkpoint save
│     ├─ references/
│     │  └─ approved-reference.png
│     ├─ assets/
│     ├─ exports/
│     └─ .cache/
└─ saved/
   └─ <asset>/
```

A completed project remains under `active/` until the user explicitly requests moving it to `saved/`.

## New Model Workspace Order

```text
Approved Reference handed to Codex
→ create workspace/active/<asset>/
→ store reference + continuity
→ Requirement Gate
→ no .bbmodel yet
→ all mandatory intake complete
→ create Blockbench project
→ author Geometry
```

Workspace creation does not authorize modelling.

## Active Project Contract

Each active project has one compact README owning current asset continuity:

```text
Asset / Goal
Approved Reference
Requested Dimensions
Animation Required: YES | NO | UNSPECIFIED
Current Stage + stage states
UV Layout gate
Current model file
Material handoff constraints (scale/front_direction/pose override when material)
Current next step — one concrete step
Known blocker(s), if any
Current handoff state — only when an AUTHORING↔ANIMATION Runtime Surface transition/resume is pending
```

LazyDesigner uses one native Geometry authoring path; no modelling-strategy state is required.

### Exact machine-readable lifecycle fields

Keep one field per label in the active asset README. Use \`Current Stage:\`
with one of the canonical values below and \`Known blocker(s): none\` only
when that declaration is literally true. Separate free-form explanations,
deferred work, and native-proof limitations into prose outside those fields.

Control accepts inherited \`Known blockers:\` for read compatibility but new
authoring should use only \`Known blocker(s):\`. Conflicting declarations,
an unrecognized or missing Current Stage, or qualified phrases such as
\`None for the delivered asset. ...\` are **orientation issues** until the
README is clarified; they are not interpreted as approval, cleared blockers,
or evidence of a failed Runtime. Known blockers require review before
Control reports an authoring decision READY. No saved model is rewritten by
this parser.

## Current Stage State

```text
Current Stage:
  INTAKE | GEOMETRY | TEXTURING | ANIMATION | FINALIZATION | COMPLETE

Geometry:
  NOT_STARTED | IN_PROGRESS | READY_FOR_USER_REVIEW | APPROVED | INVALIDATED | BLOCKED

UV Layout:
  NOT_STARTED | IN_PROGRESS | PASS | INVALIDATED | BLOCKED

Texturing:
  NOT_STARTED | IN_PROGRESS | READY_FOR_USER_REVIEW | APPROVED | INVALIDATED | BLOCKED

Animation:
  NOT_REQUIRED | NOT_STARTED | IN_PROGRESS | READY_FOR_USER_REVIEW | APPROVED | INVALIDATED | BLOCKED
```

`UV Layout` is a **Geometry-owned technical gate**, not a separate user stage. Fresh/rebuilt production UV Layout starts only after user Geometry `APPROVED`; Texturing cannot enter `IN_PROGRESS` until `UV Layout: PASS`.

`INVALIDATED` is only for a previously accepted stage/gate whose assumptions became materially invalid because an upstream accepted state changed. `INTERNAL_VERIFY` is transient and is not persisted.

`front_direction` means the canonical object front used by `capture_model_views`: `+z` or `-z`. Record it once when material and reuse it. Requested dimensions stay in Minecraft blocks plus resolved Blockbench units when resume-critical (`1 block = 16 Blockbench units`).

When an AUTHORING↔ANIMATION Runtime Surface transition/resume is pending, keep only:

```text
current_stage: <GEOMETRY|TEXTURING|ANIMATION>
current_surface: <AUTHORING|ANIMATION>
completed_gate(s): <latest verified/approved gates only>
target_stage: <GEOMETRY|TEXTURING|ANIMATION>
target_surface: <AUTHORING|ANIMATION>
resume_target: <current model/project + immediate target identifiers>
blocker: <none|specific blocker>
```

Do not persist `phase` as a new semantic concept. Existing protocol/settings fields containing `phase` are compatibility identifiers only.

Do not turn README into a decision log, per-Cube plan, UUID registry, or tool transcript.

Prefer **one current editable `.bbmodel`** per project. Git history owns older iterations.

### Save / Save As distinction

Use the same active, authoritative `.bbmodel` path for an explicitly needed
checkpoint or final save. `export_model(codec_id=project, path=...)` is a
**native save lifecycle operation**, not a side-effect-free snapshot. When
`path` exactly matches the active native project `save_path`, the receipt
reports `NATIVE_PROJECT_SAVE`; a changed path reports
`NATIVE_PROJECT_SAVE_AS` and may change the editor's active project identity.
A case/alias-different path is not automatically assumed identical. Both
path-backed operations keep their existing explicit overwrite-consent check
when the target exists.

Do not invent `before-*`, `checkpoint-v2`, `final-final`, or diagnostic
`.bbmodel` variants after every mutation. For a read-only diagnostic compile,
omit `path` and treat the result as compiled content, **not** a saved
checkpoint. A saved checkpoint must still satisfy the stage's actual
native/persistence requirements; a compile receipt alone cannot authorize
Animation handoff. User-owned historic backups are preserved unless the
user explicitly authorizes cleanup.

## Meaningful Persistence

Persist/checkpoint the current `.bbmodel` and update README at meaningful approval/resume/park/completion boundaries:

```text
Geometry APPROVED  → checkpoint save + UV Layout remains/returns NOT_STARTED unless preserved valid UV is explicitly accepted
UV Layout PASS     → checkpoint/update README before Texture Styling
Texturing APPROVED → checkpoint save
Animation APPROVED → checkpoint save
Finalization PASS  → final save + COMPLETE
```

Do **not** save/checkpoint after every MCP mutation or capture. Mutation count alone is not a checkpoint trigger. Before first Geometry approval, a new model has no authoritative `.bbmodel` checkpoint in workspace.

## Existing `.bbmodel` Intake

For an untracked user-supplied `.bbmodel`:

```text
create Active Workspace
→ store supplied file as the single current editable baseline
→ persist baseline before first mutation
→ minimum targeted baseline inspection
→ determine affected stage(s)
```

Do not create `original`, `backup`, `v2`, `final-final`, or duplicate historical model files. Git history owns prior baselines/checkpoints.

## Reference Persistence

Persist the actual approved modelling reference under `references/`. An image explicitly handed to Codex for modelling is approved unless marked draft/not ready. Stored path/prose is continuity only; fidelity judgement still requires the actual image visible in active multimodal context.

If Approved Reference changes, replace the canonical approved reference and invalidate only the accepted stage/gate state whose assumptions materially changed. Git history owns old versions.

## Downstream Invalidation

```text
unaffected downstream stage/gate → keep accepted state
materially affected stage/gate   → INVALIDATED → repair → required approval/PASS again
```

Geometry changes invalidate UV only when mapping assumptions change. UV changes invalidate only affected Texture assumptions. Do not reset all stages automatically.

## Codex Resume Rule

```text
user names/continues asset
→ workspace/active/<asset>/README.md
→ current .bbmodel only if it exists
→ only files needed for next decision
→ LazyDesigner Control resolves current stage/context/readiness
→ current-worktree active specialist only
→ verify persisted prerequisite gate before mutation
```

The Control + active specialist loading contract comes from root `AGENTS.md`; remembered Skill content is not sufficient. If stored Stage/Surface and live MCP compatibility phase fields disagree, reconcile through Gateway rather than broad-searching tools. Do not scan every active project when asset is known.

## Reference Generator Boundary

Reference Generator output remains image-only. Workspace persistence does not make it produce manifests, geometry blueprints, ZIPs, coordinate sheets, or sidecars.

## What Not To Store

Do not retain tool-call transcripts, screenshot histories, speculative geometry plans, persistent per-element UUID registries, duplicate historical `.bbmodel` files, model weights, external environments, or generic provider caches.

Use `.cache/` for transient working output. Git history owns old revisions.

## Saved Projects

`saved/` means the user explicitly archived/parked the asset. Do not move there automatically after final save. Move back to `active/` before later authoring resumes.
