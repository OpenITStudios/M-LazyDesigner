# LazyDesigner UV Authoring Engine

Status: SOURCE IMPLEMENTED BELOW REGISTRATION; Bun/Blockbench acceptance pending  
Updated: 2026-10-16  
Branch: `Local`

## Purpose

Replace coordinate-first UV authoring with a maintainable intent-driven UV subsystem for Minecraft Bedrock / Blockbench.

The target interaction is:

```text
authoring intent / constraints
→ deterministic UV plan
→ dry-run metrics
→ atomic native apply
→ audit / lock
```

AI and UI should normally express intent. They should not calculate raw UV coordinates unless an explicit low-level correction is required.

## Architecture Boundary

```text
Blockbench project state
        ↓ adapter
UvLayoutSnapshot (plain data)
        ↓
Island extraction
        ↓
Constraint + density planning
        ↓
Packing backend candidates
        ↓
Scorer / stable-layout policy
        ↓
UvLayoutPlan (plain data)
        ↓ adapter / transaction
Blockbench Undo + native UV state
        ↓
existing UV audit / visual verification
```

The UV Core MUST NOT store Blockbench `Cube`, `Texture`, `Project`, canvas, or UI objects.

Runtime/native ownership remains at the adapter/apply boundary.

## Source Layout

Current source ownership (only `orientation.ts` and `blockbenchTemplate.ts` below are planned):

```text
mcp/lib/uv/
├── contracts.ts
├── islands.ts
├── density.ts
├── constraints.ts
├── packing/
│   ├── types.ts
│   ├── maxRects.ts
│   ├── scorer.ts
│   └── planner.ts
├── stacking.ts              source implemented
├── receipt.ts               source implemented
├── invalidation.ts          source implemented
├── planRegistry.ts          source implemented
├── transaction.ts           source implemented
├── service.ts               source implemented
├── orientation.ts           planned, not present
└── adapters/
    ├── blockbenchCubeUv.ts  source implemented
    └── blockbenchTemplate.ts planned, not present
```

Registered Runtime operations remain the active native UV authority until the source-implemented planner/apply service is explicitly registered, generator-backed and verified. Their canonical implementation owners are:

- `mcp/lib/uv/boxLayout.ts` — existing Box UV layout helper;
- `mcp/lib/uv/physicalEvidence.ts` — physical UV evidence;
- `mcp/server/tools/texture/atlas.ts` — current atlas/UV inventory;
- `mcp/server/tools/texture/create.ts` — native template creation;
- `mcp/server/tools/geometry/cubes.ts` — `manage_cubes` native UV fields.

The former root paths `mcp/lib/boxUvLayout.ts`, `mcp/lib/uvPhysicalEvidence.ts`, `mcp/server/tools/texture-atlas.ts` and `mcp/server/tools/texture-create.ts` are compatibility **re-export facades**, not implementation owners. Preserve them for existing consumers; do not create a parallel engine. Source transaction/receipt tests exist, but matching-SHA Bun and native apply/Undo/reopen verification plus Runtime registration are still required before switching production to `manage_uv_layout`.

## Data Model

### UvIsland

An island owns:

- stable ID;
- source Cube identity;
- one Box-UV region or one explicit face region;
- current UV rectangle;
- physical area and density basis;
- declarative constraints.

### Constraints

Constraint policy is independent from packing:

```text
locked
rotation allowed / step
density PRESERVE / NORMALIZE / CUSTOM
stack_group
lock_group
semantic_group
mirror_policy
unique_detail
padding_pixels
priority
```

Conflicting rules fail closed. Packer order must never decide semantic intent.

### Versioning

Current `UvLayoutPlan` and `UvLayoutReceipt` source types retain:

```text
schema
planner_version
backend
backend_version
mode
```

The contract uses `backend` and `backend_version` (not `packing_backend` or `packing_backend_version`). A separate constraint-schema version field is **not currently recorded** in these plan/receipt types; it remains a future migration consideration, not an implemented guarantee. Changing a backend implementation must not silently rewrite established project layouts.

## Density Contract

Density is expressed in physical pixels per model unit.

Logical UV and bitmap size remain distinct:

```text
logical 128 × bitmap 256
→ 2 physical pixels per logical UV unit
```

The density layer:

- measures current U/V density;
- reports anisotropy;
- supports PRESERVE / NORMALIZE / CUSTOM;
- proposes island sizes only;
- does not choose placement.

Box UV uses its native logical footprint as the density basis so Bedrock template semantics remain stable.

## Packing Backend

### maxrects_v1

Primary source implementation uses a small deterministic TypeScript MaxRects-style backend.

Reasons:

- Bedrock Cube UV is rectangle-dominant;
- no native/WASM dependency;
- deterministic CI fixtures;
- 90-degree rotation can be constraint-controlled;
- backend can be replaced without changing UV intent;
- readable and maintainable in the current Bun/TypeScript stack.

The backend owns placement only. It MUST NOT decide:

- semantic groups;
- stacking permission;
- mirroring;
- logo/text uniqueness;
- texel-density policy;
- lock policy.

### Blockbench native

Native `TextureGenerator.generateTemplate` remains:

- Bedrock compatibility path;
- existing production fallback;
- regression/reference oracle;
- template rebuild owner until new atomic apply is proven.

Do not vendor/copy Blockbench internal source into UV Core.

### xatlas

General mesh unwrap remains a future optional adapter only.

Do not integrate xatlas until:

- Cube-centric U0-U8 is stable;
- Blockbench Mesh authoring demonstrates a real accepted-result gap;
- native/WASM/build maintenance cost is justified.

## Stable Packing Modes

Source planner currently defines:

```text
REPACK_ALL
ADD_ONLY
AFFECTED_ONLY
REPACK_SELECTED
```

Behavior:

- locked islands are fixed obstacles;
- ADD_ONLY keeps all existing islands fixed;
- affected/selected modes move only explicit island IDs;
- missing IDs fail closed;
- rotation is retained in placement metadata;
- physical-pixel padding is converted to logical UV units before packing.

Global rebuild is not the default answer to a small model update.

## Scoring

Packing quality is multi-dimensional. Do not reduce it to occupancy only.

Current score contract separates:

```text
valid
hard_violations
occupancy_ratio
density_error
movement_cost
fragmentation
semantic_spread
```

Some fields remain zero/placeholders until their owning planners land. They must not be interpreted as measured quality yet.

Priority order:

1. zero hard violations;
2. declared density/rotation/lock constraints;
3. minimum destructive movement;
4. packing efficiency / fragmentation;
5. semantic locality when implemented.

## Implementation Status

```text
U0 core contracts + versioned plan types     SOURCE IMPLEMENTED
U1 deterministic island extraction           SOURCE IMPLEMENTED
U2 physical-pixel / density planner           SOURCE IMPLEMENTED
U3 declarative constraints + conflict guard  SOURCE IMPLEMENTED
U4 deterministic MaxRects planner/scorer     SOURCE IMPLEMENTED
U5 stable incremental packing modes           SOURCE IMPLEMENTED
U6 evidence-driven stack proposals             SOURCE IMPLEMENTED
U7 native adapter / stale guard / atomic apply SOURCE IMPLEMENTED
U7 Runtime capability registration             LOCAL_CODE GENERATOR PENDING
U8 native compatibility / save-reopen proof   LIVE_BLOCKBENCH AFTER U7 REGISTRATION
U9 optional mesh/xatlas investigation         DEFERRED
```

Current U0-U5 code is read-only planning infrastructure. It does not replace native UV mutation yet.

## U6 — Stack / Symmetry

SOURCE IMPLEMENTED as proposal/evidence logic only. Candidate discovery remains separate from application.

Evidence may include:

- matching physical dimensions;
- matching face topology;
- mirrored counterparts;
- repeated semantic components.

Reject automatic stacking when:

- `unique_detail=true`;
- mirror policy forbids it;
- identity/text/logo intent is unique;
- directional artwork requires independent pixels.

Output must be proposals with evidence, not automatic hidden overlap.

## U7 — Native Apply

SOURCE IMPLEMENTED below the Runtime registration boundary.

Implemented source contracts now include:

1. exact native UV source snapshot;
2. content-addressed source fingerprint including geometry bounds relevant to UV density/footprint;
3. stale-plan rejection before Undo/apply;
4. plan validation for identity, bounds, fixed islands, overlap and representable rotation;
5. Box-UV 90-degree rotation rejection because uv_offset cannot represent it;
6. exact native instruction postconditions;
7. atomic apply harness with rollback;
8. scoped UV receipt;
9. precise downstream mapping/seam/texture/PBR invalidation model;
10. bounded content-addressed plan registry with source-revision-wide
    one-shot claims: an actionable apply consumes its own handle **and all
    competing handles** from the same UV snapshot before native execution.
    A successful or outcome-unknown mutation cannot reuse an alternate
    pre-mutation plan. Unrelated source revisions retain their handles;
11. compact dry-run report;
12. Blockbench read/apply/restore/Undo adapter with rollback fingerprint
    verification, uncertain native Undo commit isolation, and preserved failure
    provenance;
13. plan/apply request schemas, import-safe tool definition and uncalled
    registration/executor owner for future `manage_uv_layout` activation;
14. project UUID-scoped native UV fingerprints and native transaction
    ownership checks, so matching Cube/UV bytes in a different Blockbench
    project cannot reuse a stale plan or receive its rollback. Native
    uniqueness also checks the actual open-tab object against `ModelProject.all`,
    rejecting duplicate copied UUIDs before plan or apply;
15. native Cube UUID uniqueness and all-target preflight for UV apply and
    restore, so duplicate/blank identities and invalid later Cube faces or
    modes cannot partially modify earlier Cubes;
16. the shared native snapshot builder rejects blank/duplicate Cube UUIDs and
    repeated face identities even for non-Blockbench source callers;
17. the atomic transaction rejects a zero-delta plan before reading native
    state or beginning Undo (defense in depth with the service preflight).

The source-ready integration intentionally does NOT register a new Runtime capability yet. The existing `server/runtime/uv/layoutService.ts` now exports its declarative tool specification and an uncalled registration function, so the future activation can reuse one persistent plan/apply service instance without a new engine or Gateway API. Registration changes generated MCP API documentation, and repository policy forbids hand-editing generated outputs. LOCAL_CODE must run the canonical docs generator when `manage_uv_layout` is wired to the Geometry/Modelling owner on the shared AUTHORING Runtime surface. Source presence alone is not native acceptance or UV Layout PASS.

Planned runtime surface after that generator-backed integration:

```text
manage_uv_layout(operation=plan)
→ returns compact plan_id + source_fingerprint + dry-run report

manage_uv_layout(operation=apply)
→ requires plan_id + expected_source_fingerprint
→ atomic native apply + receipt/invalidation
```

This remains one Runtime capability behind the existing four stable Gateway meta-tools; no fifth Gateway tool is introduced.

## U8 — Compatibility

Requires LIVE_BLOCKBENCH after generator-backed registration. Prove:

- Box UV state survives save/reopen;
- per-face mapping survives save/reopen;
- Undo/Redo restores exact UV state;
- native template generation remains compatible;
- logical/physical pixel mapping remains integral;
- downstream texture invalidation is precise;
- established layouts do not change because a planner backend version changed.

## Stop Rules

Do not:

- place MaxRects logic inside `manage_cubes`;
- let packer infer semantic intent;
- create a UV coordinate-generating AI prompt as the primary workflow;
- add GPU/WASM/workers before CPU evidence requires them;
- integrate xatlas just because it exists;
- copy Blockbench GPL internals;
- mutate existing styled UV globally when an incremental plan can preserve it;
- claim visual UV quality from occupancy or audit numbers alone.

## Proof Boundary

REMOTE_GITHUB can prove:

- pure planner determinism;
- constraint behavior;
- packing validity;
- density math;
- source-level rollback contracts once implemented;
- static integration ownership.

LOCAL_CODE is required for:

- representative packing benchmark;
- memory/GC measurements;
- backend heuristic comparison when performance matters.

LIVE_BLOCKBENCH is required for:

- native UV apply;
- Undo/Redo;
- save/reopen;
- template compatibility;
- visual seam/orientation/texture acceptance.
