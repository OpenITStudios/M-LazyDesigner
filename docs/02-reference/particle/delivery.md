# Particle Delivery Contract

Deliver a normal Minecraft Bedrock Resource Pack folder or ZIP unless the user explicitly requests another form.

This file owns **user-facing Particle delivery**. When the same authored particle is intentionally handed to Codex / LazyDesigner MCP, add the canonical LazyDesigner `REFERENCE.json` described by `../package/particle-handoff.md`; do not invent a separate Particle handoff manifest.

## Game-performance safety of delivered particles

A valid Resource Pack or handoff package may be delivered for **review** without implying it is performance-safe in Minecraft. Preserve separate statuses:

- `ASSET_READY_FOR_REVIEW` — JSON/texture/source requirements are complete for the requested artifact;
- `STATIC_GAME_COST_REVIEW_REQUIRED` — source-level risk drivers or child-event cycles need explicit resolution;
- `GAME_PERFORMANCE_UNVERIFIED` — no accepted target-game load/FPS result exists.

Do **not** label a package production-safe based solely on JSON validity, a small particle count, Snowstorm/Blockbench preview, or the editor `preview_workload` threshold. For gameplay-facing delivery, record the expected simultaneous player/mob/projectile usage, lower-end target device, the quality-critical visual elements to preserve, and whether a real with/without-effect game performance comparison has been accepted. Missing context remains **unknown**; do not fabricate targets. This is descriptive metadata in an existing README or handoff, not a new manifest, runtime process, or upload block.

Official performance guidance: https://learn.microsoft.com/en-us/minecraft/creator/documents/practices/improvingperformanceandresourceusage?view=minecraft-bedrock-stable

## 1. Output identity

Resolve one durable package identity before writing files:

```text
package_slug
namespace
effect_slug
main_identifier = <namespace>:<effect_slug>
```

Use lowercase ASCII snake_case for file/effect slugs unless an existing project convention explicitly requires another form.

Example:

```text
package_slug   = blue_flame
effect_slug    = blue_flame
namespace      = mivubi
identifier     = mivubi:blue_flame
```

Do not derive filenames independently from identifiers. One normalized slug should drive particle filename, texture filename, README references, and optional handoff metadata.

## 2. Canonical user delivery

```text
<PackageName>/
├── manifest.json
├── particles/
│   └── <effect>.particle.json
├── textures/
│   └── particle/
│       └── <texture>.png
├── texts/                  # optional
│   ├── languages.json
│   └── en_US.lang
└── README.md               # concise; required for standalone user delivery
```

Only include folders actually required by the effect.

For a multi-effect composition:

```text
particles/
├── <root>.particle.json
├── <child_a>.particle.json
└── <child_b>.particle.json
```

Keep one explicit root/main identifier in the README. Child names describe physical roles, not revision history.

## 3. Filename contract

Preferred forms:

```text
particles/blue_flame.particle.json
textures/particle/blue_flame.png

particles/volcano_eruption.particle.json
particles/volcano_eruption_debris.particle.json
particles/volcano_eruption_plume.particle.json
textures/particle/volcano_eruption.png
```

Rules:
- lowercase snake_case;
- semantic role names;
- no spaces;
- no timestamps;
- no `final`, `new`, `v2`, `fix2`, or other revision suffixes;
- no machine-specific absolute paths;
- child effect suffixes describe role (`_debris`, `_plume`, `_flash`) only when the child is materially distinct.

## 4. Identifier contract

Particle document identifiers and references must agree exactly with package intent.

```text
file:       particles/blue_flame.particle.json
identifier: mivubi:blue_flame
```

For child effects:

```text
mivubi:volcano_eruption
mivubi:volcano_eruption_debris
mivubi:volcano_eruption_plume
```

Do not use a different namespace or spelling between:
- document identifier;
- event child-effect reference;
- README;
- downstream `REFERENCE.json`.

## 5. Texture path contract

Custom texture paths use:

```text
PNG file
textures/particle/<texture>.png

Bedrock texture reference
textures/particle/<texture>
```

Never put `.png` inside the Bedrock texture reference string.

The texture basename does not have to equal the particle effect slug when sharing is intentional, but the relationship must be explicit and unambiguous.

Do not duplicate identical texture files merely to make filenames match each child effect.

## 6. Manifest contract

Standalone Resource Pack delivery includes one valid `manifest.json`.

Manifest authoring rules:
- generate unique UUIDs for header/module; never reuse placeholder UUIDs across separate delivered packs;
- keep header and module UUIDs distinct;
- use clean human-readable pack name/description;
- keep version fields intentional and stable for the delivered pack;
- set engine/version constraints only from an explicit target or verified project policy; do not invent a stricter minimum version than required;
- do not add dependencies unless the effect actually needs them.

Particle authoring should not create a second manifest format.

## 7. README minimum

Standalone delivery README should remain short and operational.

State:

```text
main effect identifier
child identifiers, if any
particle JSON path(s)
texture reference(s) and PNG path(s)
target: Bedrock / Snowstorm preview / both
one concise use/import instruction
important visual/runtime caveat, only when material
```

Do not include:
- ChatGPT transcript;
- internal execution packet;
- provisional reasoning history;
- QA scratch output;
- source research dump.

Example shape:

```text
Effect: mivubi:blue_flame
Particle: particles/blue_flame.particle.json
Texture: textures/particle/blue_flame.png
Texture ref: textures/particle/blue_flame
Target: Bedrock + Snowstorm
```

## 8. Packaging rule

Default user artifact:

```text
clean Resource Pack folder
or
ZIP whose root directly contains manifest.json + resource folders
```

Do not accidentally create:

```text
blue_flame.zip
└── blue_flame/
    └── blue_flame/
        └── manifest.json
```

unless the user explicitly requests a wrapper directory structure.

Do not create `.mcpack` unless explicitly requested.

## 9. Production-only file policy

Final user package contains only files needed to use/review the effect.

Exclude:
- generated reference sheets not used as textures;
- scratch PNGs;
- duplicate exports;
- temporary JSON variants;
- QA reports;
- debug logs;
- source notes;
- editor caches;
- stale child effects no longer referenced.

If a file is not referenced, required for the pack, or explicitly useful as concise documentation, omit it.

## 10. LazyDesigner downstream handoff

When the package is meant for Codex / MCP implementation or integration, the same resource files may be wrapped by the canonical Reference Package entry point:

```text
asset_reference/
├── REFERENCE.json
├── particles/
│   └── <name>.particle.json
└── textures/
    └── particle/
        └── <name>.png
```

`REFERENCE.json` carries only compact handoff metadata such as:

```text
asset.kind = PARTICLE
particle identifier
particle JSON relative path
texture reference + PNG relative path
texture readiness
recommended locator / animation / trigger intent
review state
blocking unknowns / readiness
```

The actual `.particle.json` and `.png` remain authoritative for authored resource content. `REFERENCE.json` must not duplicate their full contents.

Do not include `REFERENCE.json` in ordinary standalone user delivery unless downstream LazyDesigner/Codex/MCP handoff is actually intended.

## 11. Snowstorm compatibility

The delivered package must use ordinary Bedrock paths and JSON so the same authored assets can be inspected in Snowstorm and copied into a Bedrock resource/development resource pack.

Snowstorm-specific notes belong in README only when relevant. Do not make Snowstorm a packaging dependency for Bedrock-only delivery.

## 12. Handoff authority boundary

```text
ChatGPT Particle Reference Authoring
→ creates/reviews reference resource package

Codex / LazyDesigner MCP
→ consumes package when requested
→ inspects current runtime state
→ copies/patches/previews/binds through existing MCP capabilities
```

Do not run both authoring systems in parallel on the same revision without an explicit correction/handoff boundary.

Particle Reference Authoring does not require MCP to create the package and does not require registration into MCP before user delivery.

## 13. Delivery gate

Before final delivery or downstream handoff:

```text
[ ] manifest parses and has distinct valid UUIDs
[ ] every .particle.json parses
[ ] root/main identifier is explicit
[ ] identifiers are unique and internally consistent
[ ] child-effect references resolve
[ ] texture references match packaged PNG paths
[ ] README paths/identifiers match actual files
[ ] no absolute machine paths
[ ] no scratch/revision/temp files
[ ] no orphan child effects or duplicate unused textures
[ ] ZIP/folder root shape is intentional
[ ] no unresolved BLOCKING requirement
[ ] static warnings disclosed only when material
[ ] REFERENCE.json included only for downstream handoff
```

Packaging is deterministic from the approved effect identity and resource graph; revision history must not leak into delivered filenames.