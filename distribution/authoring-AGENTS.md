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

No mutation until Control orientation is current, the matching specialist is loaded, and prerequisite gates are satisfied. The first current `status` delivers the exact canonical content of missing active Skill/profile handles in text blocks named `AUTHORING_CONTEXT_BEGIN`; read and apply that content before authoring. When the same content is genuinely still present, supply its ID through `known_context_ids` to avoid retransmission. After compaction or a change of stage/reference, omit stale IDs so Control can resend. The response establishes source delivery, never proof that the AI used it. A Codex session started outside the authoring workspace may not automatically discover its `AGENTS.md` or Skills; the Gateway content delivery is a recovery path, not a replacement for opening the intended workspace.

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

For a complex, already scoped material/face treatment plan, the optional local
`lazydesigner.exe plan-texture-treatment --input plan.json --json` (or Bun
`plan:texture-treatment` in a source checkout) is a **read-only** preflight.
Use it only when the current, matching CLI build is available and the plan
can change a decision. It does not load approved image pixels, modify native
Blockbench state, certify quality, or replace the four-tool Gateway. Do not
search for the third-party Python CLI-Anything harness during normal art work;
its copied source is development reference only.

For bounded Geometry analysis where native bounds, rig or surface warning
evidence already exists, the optional `lazydesigner.exe analyze-geometry
--input geometry.json --json` (or Bun `analyze:geometry` from a source
checkout) may provide a read-only structural diagnosis. Do not add the CLI
solely to recheck each Cube. Envelope scores are not source-matched image
comparisons, and no numeric/rig finding permits a visual PASS.

For a planned appearance variant with concrete, current source/proposed UV,
rig, material and rendering declarations, the optional local
`lazydesigner.exe plan-appearance-variant --input variant.json --json`
(or Bun `plan:appearance-variant` from a source checkout) can detect
declared continuity conflicts before a costly native variant change.
Source fingerprints from JSON do not prove fresh native data or actual
blue/red pixel equality; required native visual review stays unchanged.

When comparing a completed Texture cohort or a blue/red variant, the optional
`lazydesigner.exe analyze-texture-pair --input pair.json --json` (or Bun
`analyze:texture-pair` in a checkout) can inspect already saved
`get_texture` PNG bytes at a review boundary. Use only real source/target
PNG bytes with checked SHA-256 and any available full RGBA revisions; the
explicit allowed-change mask is a client declaration, not approved authority.
A clean diff does not replace current mapped native views or user review,
and cannot justify restoring pixels reverted by Undo. Do not export/reload
every pixel solely to call this CLI.

Only at an actual Geometry reference-review boundary, if an APPROVED
transparent PNG reference and a fresh SHA-identified model capture with
a valid `modelcapture:` handle already exist, optionally run
`lazydesigner.exe analyze-visual-silhouette --input visual.json --json`
(or Bun `analyze:visual-silhouette` in a source checkout). A
`REVIEWED_SAME_FRAME` declaration must follow real camera/framing review;
it is not inferred from matching `front`/other labels. This command
reuses the existing PNG/alpha overlap analysis and may identify silhouette
differences but does not establish native provenance, material style,
actual camera calibration, or visual PASS. Do not generate extra
captures per Cube or invent a missing reference/capture handle.

Geometry↔Texturing stays on shared AUTHORING. AUTHORING↔Animation uses `switch_authoring_phase` through Gateway and continues the same task/chat.

## Evidence / Safety

At each material review boundary (not after every Cube, pixel or keyframe):

1. Before broad geometry, material or motion propagation, compare the smallest judgeable change with the current approved reference and latest explicit user correction. Preserve unrelated approved regions and user Undo/reversals. If the required image or matching current state is missing, leave that decision UNVERIFIED; continue independent safe work.
2. After a coherent cohort, use its fresh receipt and the smallest necessary source/model views, texture coverage or relevant motion playback evidence. An omitted face, missing rear/side view or stale capture stays UNVERIFIED; `varied`, technical READY and mutation success are not artistic PASS.
3. At review/exit, report only the verified scope and concrete remaining differences as `PASS | FAIL | UNVERIFIED`. Internal PASS means `READY_FOR_USER_REVIEW`, not user approval. Never claim the entire asset is finished from partial evidence, and never silently repeat a failed correction direction without new evidence.

- Actual approved image is required for reference-driven visual PASS.
- Dimensions are numeric authority (`1 block = 16 Blockbench units`).
- Tool success is not visual approval.
- Same causal correction failing twice without new evidence → `BLOCKED`.
- Preserve user assets and current project state.
- Do not scan repository source/tests/CI during normal asset authoring.
