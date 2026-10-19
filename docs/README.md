# LazyDesigner Documentation

This is the single entry point for AI and human documentation discovery.

## Load Rule

Do not read all documentation by default. Resolve the task domain first, then load the smallest canonical set.

```text
PRODUCT / FLOW      → 01-product/
REFERENCE PREP      → 02-reference/
ASSET AUTHORING     → 03-authoring/
SYSTEM / CONTROL    → 04-system/
CURRENT OPERATIONS  → 05-operations/
```

Canonical AI context-loading contract:

```text
04-system/ai-context-loading.md
```

Canonical source/module dependency boundary:

```text
04-system/module-boundaries.md
```

Use it when deciding which Docs, Skills, reference fields, or current-state evidence belong in the active context.

When a repository-development question has no exact implementation owner, follow the
[System documentation router](04-system/README.md). This is an explicit
navigation edge, not permission to infer code ownership from document similarity.

## Canonical Hierarchy

```text
docs/
├── 01-product/      product identity, requirements, end-to-end flow
├── 02-reference/    ChatGPT reference preparation: image, pixel art, particle, handoff package
├── 03-authoring/    modelling, texture, animation, validation, finalization
├── 04-system/       Control, AI context loading, source ownership, Skill taxonomy
└── 05-operations/   current status, next action, local acceptance
```

## Fast Task Routing

```text
prepare/generate visual or model reference
→ 02-reference/README.md
→ image/ owner only

standalone pixel art / icon / sprite / pixel-reference conversion
→ 02-reference/README.md
→ pixel-art/README.md
→ .agents/skills/lazydesigner-pixel-art-authoring/SKILL.md

Bedrock/Snowstorm particle reference
→ 02-reference/README.md
→ particle/README.md
→ .agents/skills/lazydesigner-particle-reference-authoring/SKILL.md

model / geometry / rig / UV
→ 03-authoring/README.md
→ modelling owner only

texture / material / PBR / mapped production texture
→ 03-authoring/README.md
→ texture owner only

animation / motion
→ 03-authoring/README.md
→ animation owner only

change LazyDesigner source/system
→ 04-system/README.md
→ exact source owner

continue prior repository work / interpret proof
→ 05-operations/README.md
```

### Pixel Art Boundary Shortcut

```text
standalone pixel image or reference
→ REFERENCE PREP / Pixel Art

pixel design applied to actual model UV / atlas / Blockbench texture
→ ASSET AUTHORING / Texturing

pixel texture used by a particle
→ Pixel Art supplies visual asset
→ Particle retains emitter/runtime ownership
```

Do not create a Pixel Art Control stage or duplicate Texturing/Particle ownership.

## AI Context Policy

1. Start here only when the task domain is not already known.
2. Read the README of the selected domain.
3. Load only the canonical owner needed for the current decision.
4. Use `04-system/ai-context-loading.md` for REQUIRED / CONDITIONAL / EXCLUDED context bundles.
5. Do not load sibling domains unless the task crosses that boundary.
6. `05-operations/` is current-state context, not durable design authority.
7. Git history owns retired architecture and rationale; do not keep duplicate active docs for history.

## Authority Roles

```text
Docs     = durable semantic policy / contracts
Skills   = execution procedure
Control  = task/stage/context selection and projection
Source   = current implementation/runtime truth
Ops docs = current continuation/proof only
```

One concern must have one canonical semantic owner. Link to that owner instead of copying the full rule into another document.

## Authority Order

```text
explicit current user requirement
→ repository execution rules (AGENTS.md / GITHUB_RULES.md)
→ domain canonical documentation under docs/
→ matching execution Skill when applicable
→ active operation state under 05-operations/ when material
→ implementation/source evidence for implementation questions
```
