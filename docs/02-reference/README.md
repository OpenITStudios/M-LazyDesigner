# 02 — Reference Preparation

Owns ChatGPT-side reference preparation and direct artifact delivery. Compact packages for Codex or other downstream native integrations are optional, not mandatory.

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

need to build/validate/consume an explicitly requested handoff package
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
→ optional downstream handoff on explicit request
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

For a reference-only request, finish when the usable artifact is delivered directly in ChatGPT. For a request that also includes design, source or an editable asset, continue with the relevant ChatGPT-side task and available tools without requiring Codex, Desktop or an installed Runtime. Actual native Blockbench mutation is an optional integration and requires a connected executor and separate evidence; its authoring standards live under `../03-authoring/`, while MCP implementation remains under `mcp/`.
