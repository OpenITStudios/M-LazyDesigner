# LazyDesigner Authoring Workspace

This workspace is for **Minecraft Bedrock Entity asset authoring through LazyDesigner Gateway**.

## Boot

Before any mutation:

```text
current workspace instructions
→ LazyDesigner Control
→ exactly one matching specialist
```

Specialists:

```text
Geometry / rig / pivots / UV Layout → lazydesigner-modelling
Texture / Painter / PBR             → lazydesigner-texturing
Animation / motion                  → lazydesigner-animation
```

No mutation until Control orientation is current, the matching specialist is loaded, and prerequisite gates are satisfied.

For reference-driven decisions, call `status` with the actual approved `reference_package_path`, current `workspace_path` when available, and latest `current_user_delta`. After compaction, asset/reference changes or a new material correction, reorient only the affected decision; a cached handle is not proof that image pixels or Skill contents remain loaded. If the approved source is unavailable, do not claim visual fidelity.

For multi-call mutation cohorts, reuse the **current** `control.task_context_id` from `status` as the outer `invoke_capability.task_context_id`; use `CONTINUE` only for planned intermediate edits and `COMPLETE` for the last. Missing identity must not be invented or silently reused from a different task. Use standalone `COMPLETE` when no verified cohort exists. Keep the user's configured agent and reasoning effort; do not switch models or thinking levels automatically.

## New Model Intake

Require:

```text
Asset
Approved Reference Image
Dimensions: width × height × length in Minecraft blocks
Animation Required: YES | NO
```

LazyDesigner uses one native Geometry authoring path. Do not ask the user to choose a modelling strategy and do not revive retired 3D-assisted/Hunyuan/PrimitiveAnything routes.

## Gateway

Use the installed LazyDesigner Gateway. Normal client surface is exactly:

```text
status
search_capabilities
describe_capability
invoke_capability
```

Known capability → invoke directly. Unknown/stale → one bounded search; describe only when schema detail is needed. Reuse fresh mutation results instead of confirmation reads.

Geometry↔Texturing stays on shared AUTHORING. AUTHORING↔Animation uses `switch_authoring_phase` through Gateway and continues the same task/chat.

## Evidence / Safety

- Actual approved image is required for reference-driven visual PASS.
- Dimensions are numeric authority (`1 block = 16 Blockbench units`).
- Tool success is not visual approval.
- Same causal correction failing twice without new evidence → `BLOCKED`.
- Preserve user assets and current project state.
- Do not scan repository source/tests/CI during normal asset authoring.
