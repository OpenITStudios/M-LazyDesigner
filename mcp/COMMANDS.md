# MCP Developer Commands

Use the smallest stable command surface first.

## Default facade

```bash
bun run check
bun run verify
bun run benchmark
bun run release
```

Meaning:

```text
check      fast repository + type sanity
verify     full source verification
benchmark  benchmark suite
release    security + full release gate
```

Normal Codex work should prefer these commands unless the affected owner requires a narrower command.

For a bounded source change with known changed paths, prefer the affected route before a broad gate:

```bash
bun run plan:affected -- <changed-path> [...]
bun run verify:affected -- <changed-path> [...]
```

This resolves canonical source ownership, anchor tests, shared contracts, project-graph checks, and domain invalidation from the changed paths. Use `verify`/full verification only when the planner requires it or for explicit final acceptance.

## Deterministic authoring plan (read-only)

```bash
bun run plan:texture-treatment -- --input ./plan.json --json
```

This accepts a `TextureTreatmentPlanInput` JSON document with explicit
`regions` and, for complete bounded face accounting, `required_faces`.
It calls the existing `lib/texture/treatmentPlan.ts` planner and returns
a source-declaration-only plan. `ready` means planning prerequisites,
**not** native mutability, approved source-image comparison, completed
texture, or user acceptance. The command neither starts the Gateway nor
writes a .bbmodel. Local host/Bun execution remains on hold.

A second read-only plan checks declared variant identity, geometry, UV,
rig, material and render references through the existing
`reviewBedrockAppearanceVariantContinuity` owner:

```bash
bun run plan:appearance-variant -- --input ./variant.json --json
```

These source routes are also wired into the existing managed executable:

```text
lazydesigner.exe plan-texture-treatment --input plan.json --json
lazydesigner.exe plan-appearance-variant --input variant.json --json
```

They become available only in a matching future verified Windows build;
source integration is **not** evidence that an older installed package
provides it.

Copied upstream CLI-Anything method (Apache-2.0, source only):
`third_party/cli-anything/README.md`; it does not install or activate
a new Skill, MCP server or external Python runtime.

Geometry diagnosis reuses canonical numeric and rig evidence owners. It does
not render the model, infer artistic fidelity, or certify native revisions:

```bash
bun run analyze:geometry -- --input ./geometry.json --json
```

The same route is available on a matching compiled `lazydesigner.exe` as
`analyze-geometry --input geometry.json --json`. Input may supply bounds,
rig groups, and bounded surface warning text; missing inputs stay unverified.

## Compare captured Texture PNG bytes (read-only)

```bash
bun run analyze:texture-pair -- --input ./pair.json --json
# Matching future Windows managed build:
# lazydesigner.exe analyze-texture-pair --input pair.json --json
```

The `lazydesigner-texture-pair-input-v1` manifest declares
`mode: REVISION | VARIANT`, `source` and `candidate` entries, and optional
`allowed_change_regions` / `require_alpha_identity`. Each entry supplies
`png_file`, `png_sha256` (64 lowercase hex), `project_uuid`,
`texture_uuid`, and optionally `full_rgba_revision` from a matching
`get_texture` result. Save both real PNG image payloads as ordinary files
beside the manifest. Only sibling regular PNGs are read; directory traversal,
symbolic links, unsupported PNG layouts, incorrect SHA-256 and mismatched
declared RGBA revisions fail closed. The report uses the existing
`decodeVerifiedPngRgba`, `computeTextureRevision`, and `diffTextureRegion`
owners, reporting changed pixels, alpha changes and declared-mask violations.
It does **not** call Blockbench, prove native file origin, establish that a
declared mask is approved, or make artistic/whole-model PASS claims. Use on
coherent review boundaries, not per paint transaction. The compiled
route smoke checks help/dispatch only; full input checks are
`TEST_AUTHORED_NOT_RUN` until local validation is permitted.

## Compare a source and current model alpha silhouette (read-only)

```bash
bun run analyze:visual-silhouette -- --input ./visual.json --json
# On a matching, verified managed Windows build:
# lazydesigner.exe analyze-visual-silhouette --input visual.json --json
```

The bounded `lazydesigner-visual-silhouette-input-v1` JSON manifest
contains `reference` (approved source image ID, canonical view, SHA-256,
integrity/status/mime_type and a sibling `png_file`), `capture` (current
project UUID, `modelcapture:` evidence handle, view, PNG SHA-256,
width/height and sibling `png_file`) and explicit `pairing`.
Both PNG files must use the strict supported non-interlaced 8-bit RGBA
format and be small, regular sibling files. The existing
`compareBoundPngAlphaEvidence` computes bounded overlap metrics only
when approved alpha and model images have comparable dimensions/view and
the caller has explicitly declared `REVIEWED_SAME_FRAME`. Otherwise the
result remains `UNVERIFIED` with a specific reason. The capture handle is
available only on relevant stable native correspondence observations; do
not invent it if unavailable. Matching SHA-256 demonstrates file-byte
integrity, not an actual loaded Blockbench project or camera calibration.
The output is a **diagnostic, not an artistic PASS** or automatic geometry
repair. Prefer existing matched captures; never screenshot per Cube.

## Diagnose authored Animation timing and contact (read-only)

```bash
bun run analyze:animation -- --input ./animation.json --json
# Matching verified managed Windows build:
# lazydesigner.exe analyze-animation --input animation.json --json
```

The bounded `lazydesigner-animation-analysis-input-v1` JSON manifest
declares `animation_uuid`, `duration_seconds`, `loop_mode` and up to
128 track objects with `group_uuid`, `group_name`, `is_root`, `channel`
(position/rotation/scale), and numeric or explicitly nonnumeric
`keyframes` (`time`, `value`, optional `interpolation`,
`data_point_count`). Optional `contact_constraints` use the existing
world-marker `pair|fixed|planted` sample contract, bounded to 64
constraints and 2048 samples. Optional `max_review_frames` (2..5) and
`focus_bone_uuid` / `focus_time_range` constrain candidate review
times.

It reuses canonical `lib/animation/quality.ts`,
`motionDynamics.ts`, `batchPlanning.ts`, `contactEvidence.ts` and
`temporalEvidenceSampling.ts`. The CLI detects source-declared
near-coincident key times, loop-seam concerns, contact drift and
incomplete sample windows. Any proposed still-image times are
**candidates only**; the CLI does not sample native Timeline, solve IK,
observe playback, or certify visual PASS. Input state and contact
markers must come from a real, current inspected clip when used to
guide a correction; no native provenance follows automatically from
JSON or a clean report. Use on consequential animation decisions,
never after every keyframe.

## Narrow command namespaces

```text
typecheck:*   compiler/type checks
test:*        focused test groups
verify:*      focused verification gates
measure:*     static/context/surface measurements
benchmark:*   benchmark implementations
eval:*        evaluation harnesses
analyze:*     bounded source/semantic analysis
audit:*       static audits
plan:*        deterministic execution planning
generate:*    generated indexes/schemas/artifacts
report:*      generated diagnostic reports
compare:*     bounded result/session comparison
finalize:*    result/session finalization
snapshot:*    canonical diagnostic snapshots
deploy:*      local/verified deployment
setup:*       local environment setup
conformance:* conformance harness serving
prompts:*     prompt artifact generation
docs:*        documentation build/check/serve
security:*    dependency/security audit
```

These are implementation-level commands, not equivalent entrypoints.

## Rule

Do not add an unnamespaced script unless it is a stable developer facade with a distinct purpose. New specialized commands must use the narrowest existing namespace instead of creating synonyms such as `validate`, `verify-all`, `full-check`, or `test-everything`.