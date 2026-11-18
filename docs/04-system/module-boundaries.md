# LazyDesigner Module Boundaries

This document defines the maintainability boundary for active LazyDesigner source. It is an architectural ownership contract, not a proposal for a big-bang rewrite.

## Goals

- one canonical owner for each concern;
- dependency direction is explicit and testable;
- domain logic does not accumulate in shared root namespaces;
- compatibility aliases are temporary migration surfaces;
- refactors preserve Runtime behavior, MCP public surface, schemas, validation and native Blockbench semantics.

## Rust branch authoring authority

This section applies to the independent `Rust` editor, **not** the
existing `Local` Gateway/Blockbench runtime. The [Implementation Map](implementation-map.md#rust-source-ownership-and-entrypoints)
owns the exact path inventory; this file owns only dependency direction.

```text
Human: Svelte controls / Three.js derived viewport
    → Tauri desktop_authoring.rs (session + epoch/revision)
    → Rust authoring/mod.rs (document + transaction + validation)
    → geometry / paint / animation / bbmodel / asset_handoff / storage

AI: Deno permission-denied guest → trusted Node host + approval
    → Rust CLI (saved-file SHA + no-overwrite publication)
    → SAME Rust authoring/mod.rs implementation, DIFFERENT session

Legacy Local: Control → Gateway → Blockbench Runtime (preserved)
```

- **Rust Core is authoritative:** `AuthoringDocument`, typed edits,
  preflight, transaction/Undo/Redo, validation and file serialization
  belong to the shared Rust library. Domain modules own Geometry/UV,
  RGBA8 Paint and Animation semantics; they do not gain separate
  document stores. `bbmodel.rs` is a format adapter, not a second schema.
- **Presentation is derived:** Svelte/Three.js may hold UI selection,
  playback preview, layout and transient gesture values. A rendered
  mesh/pose or WebView cache is never saved authoring truth or a native
  visual-quality verdict; mutations always go through Rust.
- **Code Mode is a client, not an engine:** Deno never receives
  unrestricted Node/file/pipe access. The trusted Node host owns
  authorization; the CLI enforces SHA-bound operations and fresh-output
  publication. Live GUI and headless file sessions remain separate.
- **Cross-domain checks remain independent:** `asset_handoff.rs`
  reads the actual Rust Geometry/PNG/Animation exporters and canonical
  `.bbmodel` fingerprint. It may report defects but cannot grant
  approval, mutate model data or certify Blockbench native quality.
- **Legacy stays isolated:** `mcp/`, old Desktop machine-control
  modules and the 12 domain Skills remain intact for `Local`. No
  retirement, API cutover, migration or test-hold release follows from
  adding navigation or reorganizing a Rust module.

Do not split `authoring/mod.rs`, `desktop_authoring.rs`, the large
Svelte page or Code Mode host merely for file size. Split only when an
actual independent semantic owner and its affected callers can be
moved coherently while preserving the current contracts and proof gates.

## Layer direction

```text
Core / shared contracts
        |
        +--> Authoring lifecycle truth
        +--> Reference evidence vocabulary
        +--> Geometry / UV / Texture / Rig / Animation / Particle
        +--> Authoring Recipe
                 |
                 v
          Orchestration
                 |
                 v
              Runtime
                 |
                 v
              Gateway
                 |
                 v
             AI client
```

Dependencies must not point upward.

Key rules:

```text
authoring/       -X-> authoringRecipe/ or orchestration/
authoringRecipe/ -X-> orchestration/
orchestration/   -X-> server/ or gateway/

orchestration/   -> authoringRecipe/ and shared domain contracts
Runtime          -> lib/ domain contracts
Gateway execution -> Runtime + Control + capability/session contracts
production       -X-> scripts/, tests/, root distribution/, experiments/
```

Product Control may consume bounded Gateway development projections, but repository-development intelligence is canonically owned by `mcp/gateway/development/`.

## Current physical owners

```text
mcp/lib/semantic/        semantic core
mcp/lib/capabilities/    canonical Runtime capability metadata
mcp/lib/authoring/       lifecycle truth: health/readiness/validation/history
mcp/lib/authoringRecipe/ declarative recipe semantics + bounded plan/apply lifecycle
mcp/lib/reference/       reference/correction/visual-evidence shared vocabulary
mcp/lib/animation/       animation domain helpers
mcp/lib/geometry/        geometry analysis/evidence helpers
mcp/lib/uv/              UV planning/evidence helpers
mcp/lib/texture/         texture domain helpers
mcp/lib/rig/             rig domain helpers
mcp/lib/particle/        particle domain helpers
mcp/lib/orchestration/   cross-domain execution/verification/correction flow
mcp/lib/receipts/        shared mutation receipt contracts

mcp/server/tools/        authored capability implementations
mcp/server/runtime/      Runtime registration, routing and lifecycle composition
mcp/server/resources/    Runtime resources

mcp/gateway/capabilities/ AI routing/search/schema + semantic freshness core
mcp/gateway/context/      neutral authoring domain + specialist context paths
mcp/gateway/execution/    capability execution orchestration above Runtime
mcp/gateway/runtime/      Gateway-to-Runtime transport/lifecycle/affinity
mcp/gateway/control/      product context/readiness/projection
mcp/gateway/development/  repository-development diagnosis/impact/planning
mcp/gateway/surface/      stable Gateway surface-profile contract
mcp/gateway/experimental/ opt-in experimental implementation only
mcp/gateway/providers/    leaf local providers
mcp/gateway/presentation/ normalized AI-facing result/status projection
mcp/gateway/contracts/    stable Gateway protocol/output contracts
```

## Root `mcp/lib` policy

The root of `mcp/lib` is a migration/shared-contract surface. Existing domain-prefixed files may remain while callers are migrated, but **new domain implementation files must not be added there**.

New domain code belongs under a domain directory. Examples:

```text
animation*  -> lib/animation/
texture*    -> lib/texture/
rig*        -> lib/rig/
```

Geometry, UV and Particle now have dedicated canonical domain directories. Their remaining root-level files are compatibility-only where explicitly registered by repository guards. New implementation belongs directly in the canonical domain directory.

Do not create a generic `shared`, `common` or `helpers` dumping ground. A shared primitive must have at least two real owners and no domain-specific semantics.

## Public module rule

A mature domain should expose a small public entry surface and keep implementation details internal. External callers should prefer the domain entry surface rather than reaching into unrelated implementation internals.

This is introduced incrementally. Existing direct imports are not justification for new ones.

## Compatibility lifecycle

Compatibility wrappers are allowed only for controlled migration:

```text
canonical owner
     ^
compatibility wrapper
     ^
legacy caller
```

Lifecycle:

1. introduce canonical owner;
2. migrate production imports;
3. retain wrapper only while callers remain;
4. verify zero active callers;
5. delete wrapper.

A compatibility path must not become a second canonical owner.

## Large-module rule

Large files are not automatically wrong. A split is required when a file owns multiple independent reasons to change.

Priority review surfaces:

- `server/net.ts`: transport, serialization, request context, generation and affinity should progressively become focused transport modules;
- `gateway/runtime/backend.ts`: backend composition should continue delegating catalog cache, invocation, lifecycle, queue and affinity policy to focused runtime owners. The root `gateway/backend.ts` path is compatibility-only.

The facade may remain stable while implementation moves underneath it.

## Compile-time direction

TypeScript project references are the preferred hard boundary. The long-term graph should progress toward domain-level projects rather than one broad Runtime compilation universe.

Do not add project references only for appearance. A new project boundary is justified when it:

- prevents an invalid dependency;
- enables focused affected builds/tests;
- separates independently changing ownership.

## Migration order

1. freeze new root-domain drift;
2. move one low-coupling domain cluster at a time;
3. preserve compatibility only where active callers require it;
4. add project-reference boundaries after physical ownership is stable;
5. split Runtime transport and Gateway backend by responsibility;
6. retire obsolete wrappers.

Every step must preserve existing MCP capability behavior and pass the smallest affected contract suite before broader verification.

## Non-goals

This work does **not**:

- change the four-tool Gateway public surface;
- reduce capability intelligence;
- replace retained executors with generic abstractions;
- introduce a second Runtime or Control system;
- turn every domain into a plugin;
- add abstraction without an ownership or dependency benefit.

## Repository navigation contract

Navigation is part of the architecture. Large source surfaces must expose a local `README.md` that answers only three questions: what belongs here, what does not belong here, and where the canonical owner is.

Path status is explicit:

```text
canonical      implementation/source-of-truth
entrypoint     composition or registrar boundary
compatibility  temporary import/name preservation only
generated      machine-owned output; never hand-edited
```

A compatibility path must never be documented as a canonical owner. Generated MCP API output under `mcp/docs/` is separate from durable product/system documentation under repository-root `docs/`.

Repository tests enforce the stable MCP package navigation surface so new root folders or ambiguous unclassified top-level files require an intentional architecture change rather than accumulating silently.


## Stable / experimental direction

```text
stable production source -> experimental implementation  forbidden as a static dependency
experimental             -> stable contracts            allowed
Gateway composition root -> experimental registration   allowed only via explicit lazy startup selection
benchmark/evaluation      -> experimental               allowed
```

The stable Gateway profile contract lives under `mcp/gateway/surface/`. Experimental implementation lives under `mcp/gateway/experimental/` and is not a stable implementation owner.

## Product / engineering direction

```text
engineering scripts/tests -> production source  allowed
distribution              -> production artifacts allowed
production source         -> engineering tooling forbidden
production source         -> distribution forbidden
```

Build code may create deterministic artifacts and watch production inputs. Machine mutation, local deployment and live sync remain engineering operations.
