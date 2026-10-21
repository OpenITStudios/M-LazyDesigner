# Saved Asset Projects

`workspace/saved/` contains completed or intentionally parked asset packages. **Full workspace lifecycle rules live in `../README.md`.**

Saved packages are not current authoring authority. Resume work by moving the package back to `workspace/active/` and refreshing its compact project README only with current resume-critical facts. Git history owns historical iterations.

## Citadel asset inventory

Ten standalone editable Blockbench model sources, plus five Snowstorm class holograms. Canonical names are retained.

| Package | Editable source | Bytes |
|---|---|---:|
| citadel-bolt | [citadel_bolt.bbmodel](citadel-bolt/citadel_bolt.bbmodel) | 7822 |
| citadel-camp | [citadel_camp.bbmodel](citadel-camp/citadel_camp.bbmodel) | 149950 |
| citadel-caster | [citadel_caster.bbmodel](citadel-caster/citadel_caster.bbmodel) | 179493 |
| citadel-core | [citadel_core.bbmodel](citadel-core/citadel_core.bbmodel) | 322565 |
| citadel-guardian | [citadel_guardian.bbmodel](citadel-guardian/citadel_guardian.bbmodel) | 241789 |
| citadel-guardian-statue | [citadel_guardian_statue.bbmodel](citadel-guardian-statue/citadel_guardian_statue.bbmodel) | 90258 |
| citadel-minion | [citadel_minion.bbmodel](citadel-minion/citadel_minion.bbmodel) | 200409 |
| citadel-sentinel | [citadel_sentinel.bbmodel](citadel-sentinel/citadel_sentinel.bbmodel) | 141030 |
| citadel-siege | [citadel_siege.bbmodel](citadel-siege/citadel_siege.bbmodel) | 254421 |
| citadel-tower | [citadel_tower.bbmodel](citadel-tower/citadel_tower.bbmodel) | 159156 |

Model source total: **1,746,893 bytes**. Inventory: **612 cubes, 23 model textures, 27 animation clips, 4 locators**. Guardian Statue remains static.

Tower/Core death tracks retain 1,010 and 2,522 keys respectively. This is an approved motion approximation, not exact curve identity. Jungle/boss idles use lightweight Molang; Bolt is a single cube with Ember/Azure variants and a two-expression flight loop. Geometry/UV/pixel integrity and native previews were checked during authoring; Minecraft runtime remains unverified.

## Snowstorm class holograms

`citadel-class-hologram/particles/` contains Duelist, Warden, Ranger, Arcanist and Luminary effects, each with its original PNG under `textures/particle/`. Billboard envelope 1.5×1.5 blocks, six-second subtle bob, one persistent particle per emitter. Duelist was imported and previewed in Snowstorm; all five identifiers and texture paths were checked. The earlier Blockbench prototype is archived outside saved.

## Developer delivery

[threefold-citadel-developer-kit.zip](threefold-citadel-developer-kit.zip) contains **87 files**, **866,932 bytes**: 10 sources, 10 native geometry files, 9 native animation files (27 clips), 23 model PNGs, 5 particle JSONs, 5 original icon PNGs, metadata, guides and checksums. Every entry and checksum was read back and verified.

SHA-256: `ae983b5865c8a2f0fa223f386d7be37fe7dbaf68109e31de7a3c5924f656e3ea`.

This ZIP is the current approved component revision. It is not an installable resource/behavior pack: gameplay bindings, render controllers, class selection, particle placement/lifetime ownership and Minecraft testing remain downstream development work. No historical checkpoints, scripts or previews are included. Recovery copies remain in `D:/Work/AI Stuff/Threefold-Citadel-Recovery/`.

Handoff note (2026-10-21): this inventory and its authoring claims were recovered from the older PC checkout. The package bytes and ZIP checksum are verified during transfer; native/visual acceptance is not repeated by this upload. Generic saved-workspace lifecycle rules above remain authoritative.
