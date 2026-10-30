# Golden Task — Beacon Courier Bot

A **single complete end-to-end** Bedrock asset benchmark. This is new, original and independent of all user projects. It is a test fixture, **not** an Active Workspace model.

## Files

- `seed.bbmodel` — newly authored **blank** Blockbench Bedrock source; never modify it during a run.
- `reference/REFERENCE.json` — canonical Reference Package, with explicit **PENDING** approval and BLOCKED readiness.
- `reference/turnaround.svg` — original four-view concept (front, left, back, signal pose). Concept is not equivalent to approved PNG evidence.
- `../../golden-task-cases.json` — single canonical Golden Task ID, stages and acceptance dimensions.

## Object

**Beacon Courier Bot** — original copper-brass mechanical messenger with dark iron joints, amber chest/eyes, a separate rear vent and two articulated arms. Bounds: **32×44×24 Blockbench units** (2×2.75×1.5 Minecraft blocks); ground Y=0; front facing **-Z**. One 128×128 base-color atlas. Both legs/feet remain grounded; retain the negative space between the legs and arm/torso gaps.

Animation clips (original design intent): `animation.beacon_courier.idle` loops 2.4 seconds with restrained head/shoulder sway; `animation.beacon_courier.signal` is 1.6 seconds, rotates the right shoulder approximately 65 degrees and returns to neutral. The native outcome must be verified against the approved reference.

## Acceptance progression

1. Approve the **new visual reference**. Export an approved **PNG** (same view/content authority), update the image file/status and readiness in `REFERENCE.json`; do not claim approval from a script.
2. On a matching current Runtime, independently open a **disposable byte-identical copy** of the blank seed; never author directly in this Git fixture or `workspace/active/` / `workspace/saved/`.
3. Geometry + rig/pivots → reference views and visual review → Geometry approved or authorized current-revision verification.
4. Production UV layout → UV PASS → Texture atlas + mapped seam/palette validation → Texture approved.
5. Explicit AUTHORING→Animation handoff → author idle and signal clips → playback/contact/loop evidence → Animation approved.
6. Native save/reopen/export geometry + atlas + animations. Verify saved output differs from immutable seed; accept only with fresh comparable views, all criterion PASS, no material defect and **separate human approval**.
7. Compare cost (calls, corrections, time, token telemetry if available) **only after** accepted quality. Preserve all file/revision provenance for both paired sessions.

The checked-in seed is **source-authored only**: Blockbench 5.x native opening/format validity, rendering, saved-file parity and accepted-result efficiency are **NOT EXECUTED**. All Golden Task results start `UNMEASURED` / `UNVERIFIED`.

## Output isolation

Use `mcp/.cache/golden-sessions/<session>/` or another disposable folder **outside tracked Workspace** for the working model, captured evidence, logs and exported output. Do not commit outputs as input fixtures. Never reset, delete, rewrite or harvest historical user asset folders.
