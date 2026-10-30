# Golden Task — Beacon Courier Bot

A **single complete end-to-end** Bedrock asset benchmark. This is new, original and independent of all user projects. It is a test fixture, **not** an Active Workspace model.

## Files

- `seed.bbmodel` — newly authored **blank** Blockbench Bedrock source; never modify it during a run.
- `reference/REFERENCE.json` — approved **input Reference Package**, with declared stage-reference readiness `READY` (not a native quality verdict).
- `reference/beacon-courier-approved.png` — exact user-approved four-view voxel-style visual source for Geometry, Texture and Animation.
- `reference/turnaround.svg` — separate original concept, retained as historical provenance and not registered as the approved active image.
- `../../golden-task-cases.json` — single canonical Golden Task ID, stages and acceptance dimensions.

## Approved input reference and byte provenance

On **2026-10-31** the user approved the separate ChatGPT-created voxel-style reference. This is **not** a rasterization of the original `turnaround.svg`; the SVG remains unchanged. The reference illustration contains front, left, back and right-arm signal pose, labeled dimensions and palette. Its pre-approval banner was replaced with the approved-visual banner before the final PNG was pinned.

- Canonical Git PNG: `reference/beacon-courier-approved.png`.
- Original ChatGPT artifact: `beacon_courier_bot_approved_visual.png`.
- Image: **1536 × 1024**, RGB, **1,640,048 bytes**.
- SHA-256: `ad8ecd1e07aa858bdecff779dc7097e49bcf5410c864d1320d252c9134e56245`.
- Git blob SHA-1: `d6d58841a884498f9e9ce76ef5991e18b18d47c5` (byte-identical to the approved source).
- Amber glow is a **visual pixel-art treatment**, not an installed emissive/PBR promise.

The canonical `reference/REFERENCE.json` now points to the verified-source PNG, with the user's design approval and all three reference stages declared `READY`. The source integrity is independently rechecked by Control at each read and by Golden's preflight. This approval applies **only to the reference used for authoring**; it does not imply a created model, native import, UV PASS, Animation playback, export, or acceptance of any finished asset. Native/quality proof is `NOT EXECUTED`.

## Object

**Beacon Courier Bot** — original copper-brass mechanical messenger with dark iron joints, amber chest/eyes, a separate rear vent and two articulated arms. Bounds: **32×44×24 Blockbench units** (2×2.75×1.5 Minecraft blocks); ground Y=0; front facing **-Z**. One 128×128 base-color atlas. Both legs/feet remain grounded; retain the negative space between the legs and arm/torso gaps.

Animation clips (original design intent): `animation.beacon_courier.idle` loops 2.4 seconds with restrained head/shoulder sway; `animation.beacon_courier.signal` is 1.6 seconds, rotates the right shoulder approximately 65 degrees and returns to neutral. The native outcome must be verified against the approved reference.

## Acceptance progression

1. At the exact checked-out revision, let Control re-verify the committed approved PNG and Reference Package; a declared `READY` status cannot override a mismatched image hash or native preflight.
2. On a matching current Runtime, independently open a **disposable byte-identical copy** of the blank seed; never author directly in this Git fixture or `workspace/active/` / `workspace/saved/`.
3. Geometry + rig/pivots → reference views and visual review → Geometry approved or authorized current-revision verification.
4. Production UV layout → UV PASS → Texture atlas + mapped seam/palette validation → Texture approved.
5. Explicit AUTHORING→Animation handoff → author idle and signal clips → playback/contact/loop evidence → Animation approved.
6. Native save/reopen/export geometry + atlas + animations. Verify saved output differs from immutable seed; accept only with fresh comparable views, all criterion PASS, no material defect and **separate human approval**.
7. Compare cost (calls, corrections, time, token telemetry if available) **only after** accepted quality. Preserve all file/revision provenance for both paired sessions.

The checked-in seed is **source-authored only**: Blockbench 5.x native opening/format validity, rendering, saved-file parity and accepted-result efficiency are **NOT EXECUTED**. All Golden Task results start `UNMEASURED` / `UNVERIFIED`.

## Output isolation

Use `mcp/.cache/golden-sessions/<session>/` or another disposable folder **outside tracked Workspace** for the working model, captured evidence, logs and exported output. Do not commit outputs as input fixtures. Never reset, delete, rewrite or harvest historical user asset folders.
