# Particle Appearance and Rendering Knowledge

Provenance labels:
- **OFFICIAL BEDROCK** — Microsoft Bedrock particle documentation.
- **SNOWSTORM / WINTERSKY** — editor/preview-specific behavior.
- **EMPIRICALLY VERIFIED** — reproduced in accepted authoring work.
- **HEURISTIC** — authoring guidance.

## Render contract

Particle description owns:

```text
material
texture
```

Appearance components then control billboard geometry, UV selection, tint, and lighting. Rendering problems should be diagnosed separately from emitter and motion problems.

## Material families

Common Bedrock particle materials:

```text
particles_opaque
particles_alpha
particles_blend
particles_add
```

### `particles_opaque`
Use for fully opaque sprites.

### `particles_alpha`
Use for crisp alpha/cutout-style sprites where soft blending is not the goal.

### `particles_blend`
Use for translucent smoke, mist, clouds, and soft energy.

### `particles_add`
Use for additive glow-like content such as sparks, magic, energy, and flashes.

**HEURISTIC:** choose material from intended blend behavior, not from the effect category name alone.

## Billboard component

`minecraft:particle_appearance_billboard` controls:
- size;
- facing mode;
- direction settings where relevant;
- UV selection;
- flipbook animation.

Size may be Molang-driven and is evaluated dynamically according to the component/runtime contract.

## Facing modes

Current official references expose modes including:

```text
lookat_xyz
lookat_y
lookat_direction
rotate_xyz
rotate_y
direction_x
direction_y
direction_z
emitter_transform_xy
emitter_transform_xz
emitter_transform_yz
```

Use `billboard-direction.md` for exact directional/emitter-transform semantics and low-speed edge cases.

## Size authoring

Useful patterns:

```text
birth expansion
age-based shrink
distance-appropriate scale
stable random size class
```

Do not use emitter age to switch all living particles between size classes when persistent per-particle identity is intended.

## UV authoring

UVs can use texture dimensions plus a static region or flipbook region.

When atlas math matters:
- author explicit texture dimensions;
- keep UV cells in bounds;
- keep transparent gutter around visible sprite pixels;
- verify source PNG dimensions match JSON assumptions.

## Flipbook

Common controls:

```text
base_UV
size_UV
step_UV
frames_per_second
max_frame
stretch_to_lifetime
loop
```

Flipbook animates texture frames; it does not replace physical motion or particle-class ownership.

**Source-only visibility sanity:** The existing particle semantic inspector warns when a literal billboard dimension is zero, a static tint has zero alpha, a multi-frame flipbook has no FPS/lifetime stretch, or numeric lifetime is shorter than the known frame sequence at its authored FPS. These are *warnings*, not rendering verdicts: transparent materials, hidden/visible source PNG pixels, MoLang expressions, camera and engine-specific blending still require a native visual check. No frame simulation or texture rasterizer is introduced.

## Tinting forms

`minecraft:particle_appearance_tinting` supports multiple official representations.

### Static hex

```text
#RRGGBB
#RRGGBBAA
```

Use for constant tint when no Molang progression is required.

### RGB/RGBA array

```text
[r, g, b]
[r, g, b, a]
```

Channels may be numeric/Molang according to the target schema.

### Gradient object

Conceptually:

```text
color: {
  gradient: ...,
  interpolant: <Molang>
}
```

`interpolant` selects where the particle lies across the gradient.

## Gradient representation

Official documentation supports gradient data as either:
- an ordered/evenly distributed color sequence; or
- a keyed object mapping positions/time-like keys to colors.

Keyed gradients are appropriate when color stops are not evenly spaced.

Example intent:

```text
0.00 → white-hot
0.15 → yellow
0.45 → orange
1.00 → dark smoke
```

Do not assume evenly spaced stops when precise timing/color position matters.

## Gradient interpolant ownership

A clean particle-lifetime interpolant is:

```text
variable.particle_age / variable.particle_lifetime
```

with zero-lifetime protection when needed.

Use particle age when each particle should progress independently. Use emitter age only when synchronized emitter-wide color progression is actually desired.

## Hex alpha caution

Current generated tint documentation describes 8-digit hex as `#RRGGBBAA`.

If an older tool/editor/example implies a different channel interpretation:
1. follow the target-version schema;
2. verify Snowstorm rendering separately;
3. do not silently reorder channels by assumption.

For critical alpha behavior, explicit RGBA arrays can be easier to audit than ambiguous legacy examples.

## Tint + source texture interaction

Tint multiplies/affects authored source color; it does not magically turn every colored source texture into a clean recolorable mask.

For strongly tint-driven effects, prefer source art with controlled neutral/value structure.

Failure modes:
- saturated source texture fights the tint hue;
- source alpha already fades while tint alpha also fades, producing unexpectedly weak output;
- additive material plus near-white tint clips visual hierarchy;
- gradient interpolant uses emitter time and synchronizes all particles unintentionally.

## Alpha ownership

Keep these distinct:

```text
texture alpha
→ static per-pixel opacity structure

tint alpha
→ particle-level authored opacity multiplier/progression

material
→ how the renderer combines the result
```

Avoid solving every transparency problem by changing only one of these layers.

## Lighting

`minecraft:particle_appearance_lighting` enables particle lighting behavior where supported.

Treat it as render interaction, not emitted world light.

## Texture asset contract

Production textures should have:
- true RGBA transparency when needed;
- no baked checkerboard;
- no accidental matte/halo;
- intentional atlas cells;
- safe transparent gutter;
- consistent visible bounds across related frames;
- no duplicate cells unless intentional.

## Transparency sorting and overdraw

Large translucent billboards can create:
- heavy overdraw;
- sorting artifacts;
- muddy silhouettes;
- opacity stacking.

For large smoke/plume effects, reduce redundant overlap and avoid filling invisible interiors with translucent sprites.

## Long-distance readability

A particle must be sized and contrasted for intended viewing distance. High source resolution does not help if the final projected sprite is only a few screen pixels across.

Use static angular-size reasoning as guidance, then rely on actual visual review for acceptance.

## Snowstorm preview boundary

When preview differs unexpectedly:
1. confirm texture path/alpha;
2. confirm material;
3. confirm billboard facing mode;
4. confirm UV/flipbook dimensions;
5. confirm tint representation and gradient interpolant;
6. confirm Molang expressions;
7. compare in Minecraft when the issue may be editor-specific.

## Common appearance failures

- wrong material for alpha behavior;
- white matte/baked background;
- billboard too small at target distance;
- UV dimensions mismatch texture dimensions;
- flipbook steps into adjacent cells;
- directional billboard lacks meaningful direction;
- emitter-age tint/size synchronizes all living particles;
- keyed gradient positions are authored incorrectly;
- source color fights tint;
- source alpha and tint alpha compound unexpectedly;
- too many translucent sprites form a solid wall.

## Debug order

```text
material
→ texture RGB/alpha
→ billboard size/facing
→ UV/flipbook
→ tint representation
→ gradient/interpolant
→ lighting
→ overlap/overdraw
→ Snowstorm vs Minecraft
```

## Sources

- https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/examples/particlecomponents/particle_appearance_tinting?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlecomponents/minecraftparticle_appearance_billboard?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/examples/particlecomponents/particle_effect_component?view=minecraft-bedrock-stable
