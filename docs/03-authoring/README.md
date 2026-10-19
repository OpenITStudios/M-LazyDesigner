# 03 — Asset Authoring

Owns the durable semantic rules used after reference handoff during actual Minecraft Bedrock / Blockbench asset authoring.

```text
workflow.md
modelling/
texture/
animation/
validation/
finalization/
```

## Authority Boundary

```text
03-authoring docs = durable authoring policy
matching Skill     = execution procedure
Control projection = current task/reference/workspace subset
```

Do not load every authoring document together.

## Stage Routing

### Geometry / rig / pivots / UV

```text
GEOMETRY_CONTEXT
+ lazydesigner-modelling Skill
+ exactly one modelling profile
```

Conditionally read `modelling/standard.md`, `workflow.md`, or `validation/visual.md` only when a material policy question remains unresolved.

### Texturing / material / PBR

```text
TEXTURE_CONTEXT
+ lazydesigner-texturing Skill
```

Load only the relevant file under `texture/` when its specific material/render/pattern policy can change the decision.

### Animation / motion

```text
ANIMATION_CONTEXT
+ lazydesigner-animation Skill
```

Load `animation/standard.md` or `validation/visual.md` only when a durable motion/verification rule is materially needed.

### Finalization

Load `finalization/standard.md` only at finalization.

Full REQUIRED / CONDITIONAL / EXCLUDED bundles are owned by `../04-system/ai-context-loading.md`.
