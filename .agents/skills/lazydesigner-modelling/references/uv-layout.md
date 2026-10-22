# LazyDesigner Modelling UV Layout Reference

This file is loaded only for its named modelling decision. Durable Geometry policy remains in `docs/03-authoring/modelling/standard.md`; the modelling Skill owns hot-path execution triggers.


Load only after Geometry is user-approved and production UV layout or UV Layout PASS is the active decision.

## Native UV Layout / Texel Integrity
`Geometry APPROVED → create_texture(type=template), explicit pixel_density, rearrange_uv=true, power_of_two=true → native UV/template → audit → UV Layout PASS → Texturing`.

No guessed/stretched islands. Prefer per-face UV; use minimum proven native power-of-two packing. Audit padding/aspect/orientation/overlap/reuse/asymmetry. `uv_audit.production_gate=ready` is hygiene, not UV Layout PASS. Requested atlas size and density are constraints. Do not silently enlarge the atlas.
Before atlas packing, resolve `SHARED | UNIQUE` UV ownership for true symmetric/repeated semantic parts. Reuse pixels only when material, orientation, exposure, decals and geometry-aware treatment are compatible; unique wear/logos or unequal contact/shading require separate regions. `optimization_opportunities.uv_stack_opportunities` and semantic stack proposals are **review evidence**, not permission for unverified automatic overlap. Group distinct owning islands before MaxRects packing; never rely on matching dimensions alone. Native `manage_uv_layout` activation remains generator/live-gated.

Review the actual atlas and mapped adjoining surfaces together: group islands by editable semantic cohorts, allocate detail to identity-critical regions, and explain intentional mirroring or seams. Record technical validity separately from this layout verdict. Fractional logical UV can be valid when physical pixel mapping is integral; never resize approved Geometry solely to obtain integer logical coordinates.
Native packing is a starting layout. Keep named body/head/appendage cohorts in readable zones with coherent order and gutters. Reposition exact native islands via UV offsets without stretching; verify bounds/overlap. Scattered placement fails editability even if the audit is ready. Unused atlas stays transparent.
