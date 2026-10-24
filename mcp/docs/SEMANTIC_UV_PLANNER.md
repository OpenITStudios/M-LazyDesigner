# Semantic UV Planner

Status: SEMANTIC PLANNER SOURCE IMPLEMENTED; end-to-end native registration pending
Updated: 2026-10-16
Branch: Local

## Goal

Replace coordinate-oriented UV island manipulation with deterministic semantic planning:

```text
surface/world extent
+ material cohort
+ texel density
+ symmetry share/unique policy
+ locked authored regions
+ previous placement state
+ affected IDs
→ bounded atlas plan
→ semantic diff
→ intended native affected-only UV integration (not wired to the public Runtime yet)
```

## Implemented source foundation

- deterministic MaxRects packing;
- reserved/locked rectangle support;
- default, per-cohort and per-island texel density;
- explicit shared UV ownership for symmetry/reuse;
- affected-only replanning that reserves unchanged previous placements;
- deterministic semantic diff with upserts/removals/unchanged identities.

## Important limits

Semantic `atlas_width`, `atlas_height`, reserved positions and MaxRects placements use **physical bitmap pixels**. Before native application, the existing `nativeApplyPlan` compiler requires explicit bitmap and logical atlas dimensions and converts physical pixel coordinates to Blockbench logical UV independently per axis; do not pass pixel placements as native UV. This conversion is internal source code, not proof of a registered/live workflow.

This layer does not yet mutate Blockbench faces. It also does not infer Cube face islands automatically from geometry. Native UV extraction/application is Geometry/Modelling-owned inside the shared AUTHORING Runtime surface. Native source/apply/rollback components now exist under `mcp/lib/uv/` and `mcp/server/runtime/uv/`, but the semantic planner is not yet a registered MCP executor. Undo, pixel-grid correctness, Box-UV/native rotation and save/reopen still need matching native proof before registration.

Shared UV is explicit. The planner never guesses reuse from equal dimensions alone.

Locked regions are treated as authored authority and cannot be displaced by incremental packing.

## Next integration

1. derive semantic island candidates from existing face/Box-UV state and Authoring Recipe symmetry policy;
2. preserve exact pixel-grid mapping and cohort density contracts;
3. compile a native affected-only UV apply plan;
4. integrate through the existing Geometry/Modelling UV owner rather than adding another public tool family;
5. benchmark changed-island count, payload, wall-clock and correction rounds against explicit UV editing.
