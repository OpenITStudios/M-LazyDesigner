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

## ChatGPT-only delivery gate

The default authoring request is completed **inside ChatGPT**, using the relevant domain knowledge and actually available generation/file tools. No Codex, Control packet, Gateway, installed LazyDesigner app, local PC or Blockbench Runtime is required for a non-native deliverable. Select one domain from the actual request; never initiate a native stage sequence just to provide an image, texture design, animation plan or source file.

**Deliverable and proof must match.** The following are representative QA cases, not claims that these assets have already been generated or tested:

| Requested case | ChatGPT deliverable | Evidence to check before delivery | Not proven without native execution |
| --- | --- | --- | --- |
| Minecraft model/reference | Requested visual, dimensional design, part/hierarchy plan, or actual editable geometry file *only if produced* | Identity/silhouette, explicit dimensions and player scale, orientation, part counts, articulated attachments, and clearly stated unknowns | Blockbench project opened, native cube/rig/UV state, Undo, export compatibility |
| Texture/pixel art | Requested image, grid-authored texture, palette/material plan, or actual file *only if produced* | Exact requested grid size, palette, transparency/alpha, material markings and consistency with supplied reference | UV seams on an actual model, native Painter result, in-game render/PBR |
| Animation | Requested pose sheet, timing/keyframe plan, motion description, or actual animation file *only if produced* | Named movement, key poses, joint/pivot intent, plausible contact/clearance, timing/loop specification and file syntax where applicable | Native timeline playback, state-controller wiring, Minecraft motion |

Only claim **produced** for an actual generated artifact, and **verified** for checks actually performed. A reference image is not an editable `.bbmodel`; a timing plan is not tested playback. If the requested editable/native format cannot be created with available tools, provide the valid subset and state the remaining native requirement rather than fabricating completion.

Native authoring is an **optional connected branch**: activate existing Control/Gateway/Runtime stage routing only when the user explicitly requests native Blockbench work and an actual connected executor is available. Keep native Geometry APPROVED, UV Layout PASS, Texture PASS, Animation and checkpoint gates intact within that branch.

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
