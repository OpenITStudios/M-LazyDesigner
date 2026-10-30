# Semantic UV Native Boundary

Status: SOURCE IMPLEMENTED / LIVE PROOF PENDING
Updated: 2026-10-31
Branch: Local

## Ownership

Semantic UV remains internal intelligence below the existing UV/Texturing owners. No second public UV capability family is registered.

## Native policy

### Per-face UV
Eligible for semantic planning and affected-only native realization.

### Box UV
Fail-closed. Box UV is treated as a native net with its own layout semantics. Semantic per-face automation must not silently switch `box_uv=false`. Explicit conversion is a separate user-authorized workflow and is not implemented by this source foundation.

## Source flow

```text
Authoring Recipe
→ semantic face islands
→ density/cohort/share/lock planning
→ affected-only MaxRects plan
→ semantic diff
→ exact native targets + fingerprint
→ native transaction plan
→ one affected-only Undo transaction
```

The transaction rejects stale source fingerprints, duplicate face targets, non-finite UVs, out-of-bounds logical UVs, non-integral **physical-pixel** mapping (fractional logical UV can be valid), Box-UV targets, and concurrent Blockbench edits. The semantic placement-to-native compiler now preserves signed U/V corner order and existing 0/90/180/270-degree face rotations, applying a requested 90-degree packing turn relative to the authored rotation. Collapsed or non-finite native source UV is rejected before mutation. Semantic MaxRects placements are in **physical bitmap pixels**, whereas the Blockbench Cube face stores **logical UV units**. The compiler now requires both bitmap and logical dimensions, maps the two axes independently (including rectangular atlas sizing; animated textures require separately verified frame dimensions), and rejects missing scale or non-integer physical placements before a transaction can be built. Static code/regression coverage is not native save/reopen proof.

## Painted-atlas native ownership safety

The unregistered bitmap+UV atomic migration adapter contract refuses moved
**active** faces whose native Texture ownership is null, absent or unlisted,
before RGBA candidate generation or Undo. Native untextured/disabled faces
outside the moved island remain allowed. A complete Cube/Texture/face ledger
is still mandatory; this guard neither attests native scene completeness nor
activates a production migration tool.

The adapter-only transaction computes expected before/after RGBA revisions
from immutable snapshots and candidates. After native apply it compares
**every byte** of each atlas (and its identity/dimensions) with the already
hashed candidate, then independently re-reads the scene before the synchronous
Undo commit. It does not re-hash the same proven-equal native bytes during
that window. The receipt's after revision is thereby tied to actual decoded
RGBA, not a visual PASS or saved-file claim; rollback and OUTCOME_UNKNOWN
semantics remain unchanged.

## Proof boundary

REMOTE_GITHUB establishes contracts/source ownership only. It does not establish that Blockbench Undo restores every mutated face/rotation exactly, that save/reopen preserves the semantic result, or that visual seams/reference fidelity are accepted. Those remain LIVE_BLOCKBENCH evidence.

## Explicit conversion residue

A future Box-UV→per-face conversion, if required, must:
- be an explicit user-authorized mutation;
- preserve or document texture appearance changes;
- run in one native Undo transaction;
- produce a fresh face-UV state before semantic planning;
- never occur implicitly as a side effect of packing.
