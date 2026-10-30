# LazyDesigner External Quality Intelligence Contract

External sources may improve authoring decisions only when they add evidence that the current approved reference, Bedrock specification, or native runtime does not already provide. This is a knowledge contract, not a second workflow, router, score system, or automatic style authority.

## Authority order

```text
explicit current user requirement
→ approved/current visual reference
→ persisted approved asset state
→ official Bedrock specification / native runtime evidence
→ bounded external quality intelligence
→ unresolved remains UNKNOWN
```

External knowledge never overrides an explicit user art direction, approved reference, target dimensions, native Blockbench state, or Bedrock schema/runtime truth.

## Canonical source classes

### Research-to-knowledge intake and asset-rights gate (2026-10-31)

A broad URL collection is **discovery**, not a Runtime knowledge source or permission to ingest copyrighted training data. Before using an external finding, deduplicate by the *decision question* against existing [Geometry](../03-authoring/modelling/research-sources.md), [Texture/UV](../03-authoring/texture/research-sources.md), [Animation](../03-authoring/animation/research-sources.md) and their current source-grounded cases.

For the *selected* new decision, retain in its existing domain owner: original canonical URL/title/publisher; last actually inspected date and depth (`PAGE`, `ABSTRACT`, `SOURCE`); upstream version and content hash **only when corresponding original bytes were obtained**; one observed fact distinct from an inference; `APPLY / REJECT / UNKNOWN` inputs; owning Control/Recipe/Texture/Validation consumer; license **scope** (text, code, image, 3D, weights/dataset), item-specific usage permission and native/human proof state. Do not introduce a global runtime registry, pre-load a broad URL index or treat source page text as agent instructions. [Croissant 1.1](https://docs.mlcommons.org/croissant/docs/croissant-spec-1.1.html) and [Creative Commons TASL](https://creativecommons.org/reusing-cc-licensed-content/) are metadata/attribution inspiration, **not** dependencies or grants of permission.

Use-specific restrictions seen on first-party pages as of 2026-10-31:
- [Quaternius](https://quaternius.com/license.html) presents **Quaternius Asset License (QAL) v1.0**, updated 2026-08-28. Do not assume a newly acquired pack has the former CC0 terms; verify each pack's actual applicable version/acquisition rights before importing or distributing files.
- [Poly Haven](https://polyhaven.com/license) says its assets are CC0 but separately forbids web scraping/data mining without express permission under site terms, and its example renders/other site content are distinct. Rights in assets do **not** imply authorization for every acquisition method.
- [Kenney](https://kenney.nl/support) states game assets on its asset pages are CC0; still identify the exact selected pack and its included terms. CC0 does not validate visual quality or target compatibility.
- Marketplace listings, proprietary studio tutorials, image thumbnails and research papers are **link/citation-only** until rights for a specific reproduction, redistribution, automated harvesting or training use are evidenced. Publisher/public URL, GitHub code license and linked asset license are separate.

Status: first-party *claims* inspected and conditional guidance written; no bulk dataset ingested, no rights approval for individual third-party assets, no production feature enabled, no native or human quality result. This is a scoped intake discipline inside the current source owners, not a new Runtime policy engine.

### Mojang Bedrock samples

Primary source:

```text
https://github.com/Mojang/bedrock-samples
```

Use only as advisory pattern evidence for real Bedrock composition such as animation/controller structure, Molang wiring, render/controller relationships, locator/effect usage, and entity organization.

Rules:
- do not clone Vanilla geometry or textures into a user asset;
- do not turn one Vanilla entity into a profile-wide preset;
- retrieve the smallest relevant pattern;
- preserve source file/path provenance;
- use the pattern to answer a concrete authoring question, not as general context padding.

Verified examples include player animation-controller state composition and Allay client-entity animation/controller wiring. These examples demonstrate supported Bedrock patterns; they do not define required style or motion for unrelated assets.

### Microsoft Minecraft Creator schemas/documentation

Primary sources:

```text
https://learn.microsoft.com/en-us/minecraft/creator/reference/content/schemasreference/
https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationsoverview
```

Use as normative format/semantic evidence. Track geometry, animation, texture-set, controller, Molang, and related schema/version changes that can affect export correctness.

Rules:
- specification evidence outranks community advice;
- source snapshots/diffs may create regression work, but never silently rewrite authored content;
- a schema change is not native-runtime proof until the affected path is exercised where required.

### Blockbench Minecraft Style Guide

Primary source:

```text
https://blockbench.net/wiki/guides/minecraft-style-guide/
```

Use only when Minecraft-native/Vanilla-compatible visual language is a requirement. Core evidence:
- recognizable overall form belongs primarily to model geometry;
- most surface detail belongs to texture;
- element count should be no higher than required for recognizability;
- pixel/model scale should remain coherent unless an explicit art direction says otherwise.

This guidance produces categorical review evidence, never an aggregate style score.

### Blockbench source/issues

Primary source:

```text
https://github.com/JannisX11/blockbench
```

Use confirmed, relevant editor/export quirks only to build deterministic regression cases. Historical issue text is not a permanent product rule.

A quirk enters LazyDesigner regression coverage only when:
1. the affected behavior is relevant to Bedrock authoring;
2. the behavior is reproducible or represented by a deterministic source/native test;
3. the expected semantic result is known;
4. the regression does not merely encode an obsolete Blockbench bug.

Candidate classes include identity/case handling, mirror pairing, pivots, UV orientation, interpolation/export, save/reopen identity, and codec round-trips.

## Grounded-image research adoption (October 2026)

Four external source systems provide relevant, **not directly imported** ideas:

| Source | Source-level capability | Bounded LazyDesigner adoption |
| --- | --- | --- |
| Meta [SAM 3](https://github.com/facebookresearch/sam3) | Promptable concept/instance segmentation from text, points, boxes, masks | Keep explicit `image ID → region → part ID` correspondence, without weights, GPU or a segmentation promise |
| IDEA [Grounding DINO](https://github.com/IDEA-Research/GroundingDINO) | Text phrase → detected image boxes | Keep semantic-part ID + normalized box as **proposed evidence**, never inferred authoritative geometry |
| AllenAI [Molmo2 / MolmoPoint](https://github.com/allenai/molmo2) | Point grounding across images/video | Retain named landmark-to-part association and source image hash instead of naked pixel coordinates |
| Meta [SAM 2](https://github.com/facebookresearch/segment-anything-2) | Promptable object masks and occlusion-aware video evidence | Record `DIRECT / PARTIAL / OCCLUDED` explicitly; absence from view is not physical absence |

Canonical executable owner for this minimal knowledge transfer:

```text
mcp/lib/reference/imageRegionEvidence.ts
```

`REFERENCE.json images[].regions` remains optional and bounded.
`mcp/gateway/control/referenceParser.ts` checks part-ID/view/UV integrity.
On-demand original-image delivery returns region claims and an owner/conflict
summary. Nothing calls SAM, Molmo, Grounding DINO or external inference.
No new public Gateway tool, duplicate approval authority, dense 3D
reconstructor or quality score is introduced. External systems' reported
benchmark results do **not** imply LazyDesigner performance.

The larger models' runtime/weight/dependency requirements make them unsuitable
as mandatory dependencies in the existing ChatGPT + GitHub architecture.
Use their **representational contracts** to expose uncertainty and improve
the next human/AI image-review decision, not as unearned native accuracy proof.

The deeper comparison with PartField, SAMPart3D, Open3DIS, OpenMask3D, OpenUSD, and Grounded SAM 2 for **Visual Part Correspondence** is scoped in [the bounded design decision](visual-part-correspondence.md). This documents the explicit source-region → semantic part → exact native UUID evidence boundary, not an adopted ML engine.

## Quality integrations

### Cross-view reference consistency

Canonical executable owner:

```text
mcp/lib/reference/crossViewEvidence.ts
```

Compare only semantic/world-space constraints that multiple **distinct** views explicitly claim about the same part. Normalize view identity (case/whitespace) and part IDs before comparison. Duplicate observations from one view must not create cross-view confidence; contradictory same-view observations still create conflicts. Never infer numeric scale from image pixels and never treat occlusion as absence.

Conflict classes:

```text
dimension_conflict
attachment_conflict
```

A material conflict stays `CONFLICTING` and blocks dependent construction until resolved. Do not average materially conflicting views.

### Minecraft-native representation evidence

Canonical executable owner:

```text
mcp/lib/reference/minecraftStyleEvidence.ts
```

Evidence classes:

```text
surface_detail_overmodeled
silhouette_under_modeled
motion_misowned
pixel_scale_conflict
```

This evidence is conditional on a Minecraft-native style requirement. Explicit non-Vanilla/MIVUBI art direction may intentionally depart from it.

### Animation contact integrity

Canonical executable owner:

```text
mcp/lib/animation/contactEvidence.ts
```

Contact evidence requires caller-supplied sampled world positions from real editor/runtime state. Supported constraint semantics:

```text
pair     marker follows another moving target
fixed    marker approaches/remains near a fixed target
planted  marker remains planted while the phase requires contact
```

Distance/contact PASS is geometric evidence only. It does not prove weight transfer, deformation, timing, or visual quality. Native reference-grounded playback remains required.

## Vanilla pattern intelligence

Vanilla examples are retrieved only for a named unresolved semantic question, for example:

```text
How does Bedrock represent state transition/blending?
How are several animations/controllers wired into a client entity?
What native composition exists for held-item or look-at behavior?
```

Return only the relevant pattern, source identity, and applicability boundary. Never return a preferred asset, style ranking, or automatic geometry plan.

## Bedrock specification tracking

Remote GitHub work may maintain source snapshots, schema inventories, provenance hashes, and regression fixtures. A spec update may produce:

```text
NEW_FIELD
CHANGED_SEMANTICS
DEPRECATED_FIELD
REMOVED_FIELD
VERSION_ADDED
```

but only a verified affected code path may be changed. Generated docs are regenerated from canonical source; do not hand-edit generated API artifacts.

## Native quirk regression corpus

Remote tests may encode deterministic parser/serializer/semantic regressions. Tests that depend on actual Blockbench editor behavior must remain explicitly `source contract / not live proof` until LOCAL_CODE or LIVE_BLOCKBENCH executes them.

Prefer:

```text
author semantic state
→ serialize/save/export
→ parse/reopen
→ compare semantic state
```

over screenshot-only or implementation-detail assertions when a round-trip can express the real requirement.

## Anti-overdevelopment rules

Do not add:
- a second Director/workflow engine;
- a separate approval system;
- an automatic Vanilla style selector;
- a scalar quality score;
- an always-loaded external knowledge corpus;
- network lookup in the normal authoring hot path;
- auto-mutation from external examples.

External quality intelligence is successful only when it improves a concrete decision while preserving the existing Control → Gateway → Runtime → Plugin ownership chain.


## Current External / Fork Closure

Current remote comparison against the experimental `Ref` research branch and `A-MIVUBI-Blockbench/chatgpt-dev` uses this decision boundary:

| External idea | LazyDesigner decision | Reason |
| --- | --- | --- |
| second Director / route system / model-spec compiler | REJECTED | duplicates Control → Gateway → Runtime and increases correction/state cost |
| quality decision router / separate approval engine | REJECTED | existing evidence + readiness owners already separate diagnostics from approval |
| persistent approved-asset / quality-profile registry | REJECTED | would create a second durable authority; approved reference/current workspace already own task truth |
| always-loaded normalized knowledge corpus / `bb_knowledge` equivalent | REJECTED | bounded external retrieval is preferred; no hot-path corpus/database |
| cross-view reference comparator | IMPLEMENTED | `mcp/lib/reference/crossViewEvidence.ts` |
| Minecraft-native representation/style evidence | IMPLEMENTED | `mcp/lib/reference/minecraftStyleEvidence.ts` |
| animation/contact geometric evidence | IMPLEMENTED | `mcp/lib/animation/contactEvidence.ts` plus native playback boundary |
| surface / physical UV / motion-craft diagnostics | IMPLEMENTED | existing Runtime evidence augmentation; no new public tools |
| synthetic benchmark ≠ measured baseline | IMPLEMENTED | existing six-case benchmark explicitly remains synthetic and categorical |
| fixed cuboid/bone/keyframe targets or aggregate quality score | REJECTED | complexity must be causal; quality remains vector/categorical |
| risk-derived minimum review views | ALREADY COVERED | Difference-First / Minimum Necessary Evidence rules already select evidence by diagnosed risk |
| geometry boundary caused by form/articulation/attachment/state rather than color alone | ALREADY COVERED | current representation and Minecraft-style evidence already enforce geometry-vs-texture ownership |
| uncertainty / identity-critical task metadata | DEFERRED | static research is promising but native accepted-result benefit is not yet proven |
| responsibility vocabulary `FORM | ARTICULATION | ATTACHMENT | STATE | FOLLOW | CONTROL` | DEFERRED | statically validated on `Ref`; do not promote to schema/workflow without native cost-to-accepted-result proof |
| automated upstream capability/source snapshot ingestion | DEFERRED | useful only when a concrete version-sensitive regression justifies maintenance cost |
| offline Bedrock conformance certification pipeline | DEFERRED | current export-integrity/native-acceptance owners cover authoring safety; release certification needs separate concrete product requirement |
| graphics/display/runtime fixture matrix | DEFERRED | use only for a named runtime-sensitive feature under LOCAL_CODE/LIVE_BLOCKBENCH, never as default authoring burden |

Closure rule: a deferred item is not a TODO by default. It becomes active only when a concrete LazyDesigner task exposes the missing evidence or when native testing demonstrates lower Cost to Accepted Result without adding duplicate ownership.
