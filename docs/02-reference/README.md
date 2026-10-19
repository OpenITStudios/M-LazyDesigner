# 02 — Reference Preparation

Owns ChatGPT-side reference preparation and the compact artifacts handed to Codex or other downstream authoring systems.

## AI Read Rule

Do not preload this whole domain.

```text
reference task starts
→ flow.md

need durable evidence/authority rule
→ policy.md

need to generate/edit smooth reference imagery
→ image/README.md

need deliberate integer-grid pixel art, icon, sprite, tile/pattern, or pixel conversion
→ pixel-art/README.md

need to author a Bedrock/Snowstorm particle reference asset
→ particle/README.md

need to build/validate/consume Codex package
→ package/README.md
```

`policy.md`, `image/`, `pixel-art/`, `particle/`, and `package/` are conditional owners, not mandatory boot context for every reference request.

## Independent capability branches

Reference capabilities are independent. Select only the branch required by the current request.

```text
VISUAL / MODEL REFERENCE
→ image/
→ optional package/

PIXEL ART REFERENCE / STANDALONE ASSET
→ pixel-art/
→ strict grid-authored icon / sprite / tile / object / texture reference
→ optional Texturing / Particle / downstream handoff

PARTICLE / VFX REFERENCE
→ particle/
→ clean Bedrock/Snowstorm particle package
→ optional Codex / MCP handoff
```

Rules:
- a particle-only request does not require image or pixel-art reference generation unless a visual texture dependency actually requires it;
- a pixel-art-only request does not require smooth image-reference generation;
- an image/model-reference request does not require pixel-art or particle authoring;
- use multiple branches only when the user explicitly needs them or one materially depends on another;
- do not create cross-branch artifacts merely to complete a template;
- actual Blockbench atlas/UV/Painter mutation belongs to `lazydesigner-texturing`, even when the desired style is pixel art.

The Pixel Art and Particle branches are ChatGPT-side reference-authoring capabilities. They are not new MCP authoring stages or runtime subsystems.

## Boundary

This domain ends when the approved/usable reference artifact or requested package is ready for downstream use. Actual Blockbench asset authoring belongs to `../03-authoring/`; MCP implementation remains under `mcp/`.
