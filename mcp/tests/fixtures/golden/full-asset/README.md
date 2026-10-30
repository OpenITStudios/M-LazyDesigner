# Golden Task — Beacon Courier Bot

A **single complete end-to-end** Bedrock asset benchmark. This is new, original and independent of all user projects. It is a test fixture, **not** an Active Workspace model.

## Files

- `seed.bbmodel` — newly authored **blank** Blockbench Bedrock source; never modify it during a run.
- `reference/REFERENCE.json` — canonical Reference Package, with explicit **PENDING** approval and BLOCKED readiness.
- `reference/turnaround.svg` — original four-view concept (front, left, back, signal pose). Concept is not equivalent to approved PNG evidence.
- `../../golden-task-cases.json` — single canonical Golden Task ID, stages and acceptance dimensions.

## Visual candidate approval — binary handoff pending

On **2026-10-31**, the user approved the separate ChatGPT-created **voxel-style PNG design** as the visual direction for this Golden Task. The approved candidate is **not** a rasterization of the original `turnaround.svg`; the original SVG is retained unchanged for provenance. Only the preview's pre-approval status banner was updated; the rendered bot, four views, labels, palette and geometry are pixel-identical to the candidate reviewed.

- Candidate filename: `beacon_courier_bot_approved_visual.png` (ChatGPT conversation artifact, **not present in this Git tree**).
- Expected Git fixture location once byte transfer is supported: `reference/beacon-courier-approved.png`.
- PNG properties: **1536 × 1024**, RGB, **1,640,048 bytes**.
- Exact SHA-256: `ad8ecd1e07aa858bdecff779dc7097e49bcf5410c864d1320d252c9134e56245`.
- The glowing amber depiction specifies **visual styling**, not an installed emissive/PBR feature.

This records a **user visual design decision only**. `reference/REFERENCE.json` still points at the pending SVG, and therefore its approval fields and all readiness fields remain **PENDING/BLOCKED**. Do not set the canonical image to `APPROVED`, set `package_generation` to `APPROVED`, or unblock the Golden runner until the exact PNG bytes are committed, Control's image SHA/integrity is verified, and the package's other readiness prerequisites actually hold. This is not human acceptance of a finished model, native import, animation or export.

## Object

**Beacon Courier Bot** — original copper-brass mechanical messenger with dark iron joints, amber chest/eyes, a separate rear vent and two articulated arms. Bounds: **32×44×24 Blockbench units** (2×2.75×1.5 Minecraft blocks); ground Y=0; front facing **-Z**. One 128×128 base-color atlas. Both legs/feet remain grounded; retain the negative space between the legs and arm/torso gaps.

Animation clips (original design intent): `animation.beacon_courier.idle` loops 2.4 seconds with restrained head/shoulder sway; `animation.beacon_courier.signal` is 1.6 seconds, rotates the right shoulder approximately 65 degrees and returns to neutral. The native outcome must be verified against the approved reference.

## Acceptance progression

1. Use the user-approved voxel candidate above. Commit its **exact SHA-matching PNG** to the fixture, then update the declared image file/status and approval/readiness fields in `REFERENCE.json` only after Control can verify the package; do not infer approval from a script.
2. On a matching current Runtime, independently open a **disposable byte-identical copy** of the blank seed; never author directly in this Git fixture or `workspace/active/` / `workspace/saved/`.
3. Geometry + rig/pivots → reference views and visual review → Geometry approved or authorized current-revision verification.
4. Production UV layout → UV PASS → Texture atlas + mapped seam/palette validation → Texture approved.
5. Explicit AUTHORING→Animation handoff → author idle and signal clips → playback/contact/loop evidence → Animation approved.
6. Native save/reopen/export geometry + atlas + animations. Verify saved output differs from immutable seed; accept only with fresh comparable views, all criterion PASS, no material defect and **separate human approval**.
7. Compare cost (calls, corrections, time, token telemetry if available) **only after** accepted quality. Preserve all file/revision provenance for both paired sessions.

The checked-in seed is **source-authored only**: Blockbench 5.x native opening/format validity, rendering, saved-file parity and accepted-result efficiency are **NOT EXECUTED**. All Golden Task results start `UNMEASURED` / `UNVERIFIED`.

## Output isolation

Use `mcp/.cache/golden-sessions/<session>/` or another disposable folder **outside tracked Workspace** for the working model, captured evidence, logs and exported output. Do not commit outputs as input fixtures. Never reset, delete, rewrite or harvest historical user asset folders.
