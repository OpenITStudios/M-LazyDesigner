# LazyDesigner — Product Overview

**Status:** Active Policy  
**Updated:** 2026-09-18

## Purpose

LazyDesigner helps an AI modeller create or revise clean, editable Minecraft Bedrock Entity models in Blockbench through MCP from an approved visual reference.

Primary output:

```text
<model-name>.bbmodel
```

The model should remain understandable and editable by a downstream Bedrock modeller/developer.

## Problem

The important failure is not whether MCP can create Cubes. An agent can create technically valid geometry while the whole object is visually wrong.

Common failures include guessed coordinates, default zero rotations despite visible slopes, arbitrary pivots, detail that hides a wrong primary form, and tool/build/save success being mistaken for visual success.

## Product Goal

```text
Approved Modelling Brief
↓
Whole-form spatial reasoning
↓
Intentional primary Cube/Group authoring
↓
Structural + visual observation
↓
Global/local diagnosis
↓
Causal correction
↓
Secondary structure / surface / motion only after prerequisites are sound
```

Detailed sequence: [Current Flow](flow.md).

## Responsibility Split

### AI / Modeller

Owns whole-form interpretation, primary masses/relationships, proportion/silhouette/orientation, global-vs-local diagnosis, causal correction, and visual approval.

### MCP / Blockbench Runtime

Owns deterministic mechanics: project/model observation, exact element mutation, identity/parent targeting, Undo/recovery, view capture, texture/animation operations, and export where supported.

MCP does not automatically infer anatomy, reconstruct an image into Cuboids, or issue visual `PASS`.

## Success Criteria

LazyDesigner succeeds when approved evidence drives visible form honestly; primary form is recognizable before detail expands; transforms and pivots are intentional; structural and visual evidence stay separate; downstream texture/animation are purposeful; runtime claims match proof; and the final project stays editable.

## Product Constraints

- Reference pixels are not metric calibration.
- Declared dimensions are the numeric whole-model target when available.
- Successful MCP calls and saved files do not prove visual correctness.
- Automatic image→geometry reconstruction or similarity scoring is not modelling authority.
- Local/model-facing behavior stays `LOCAL PROOF REQUIRED` until directly tested.

## Related

- [Product Requirements](requirements.md)
- [Reference Preparation](../02-reference/README.md)
- [Geometry Standard](../03-authoring/modelling/standard.md)
- [Texture Standard](../03-authoring/texture/standard.md)
- [Visual Validation](../03-authoring/validation/visual.md)
- [Current Flow](flow.md)
