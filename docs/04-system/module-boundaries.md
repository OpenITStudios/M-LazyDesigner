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

### Rust operator boundary — external Agent App only (2026-11-20)

The **only AI prompt/reasoning/execution surface** for Rust authoring is Codex
or another explicitly authorized external Agent App. LazyDesigner's Tauri,
Svelte and Three.js application is a native **manual editor and reviewer**,
not an AI client. `apps/desktop/code-mode/` contains the standalone
first-party agent-host integration, not a WebView or Tauri AI runner.

The first supported handoff is an exact saved-file boundary, using existing
operations instead of a new protocol:

1. The external agent chooses an exact saved `.bbmodel` and binds its SHA;
   unsaved GUI-only state is **not** implicitly available to the agent.
2. Its trusted host authorizes a bounded Rust CLI transaction and publishes a
   **new, non-overwritten sibling**. Code Mode itself never acquires native
   GUI write authority or certifies aesthetic quality.
3. The user selects that output through the existing GUI **Open Model…**.
   The Rust GUI validates and opens the file only after the existing
   dirty-session/discard guard; no automatic replacement or silent reload.
4. The editor handles manual changes, inspection, recovery, Undo/Redo and
   file exports as its existing native responsibilities. The user separately
   reviews native/Blockbench/visual output before acceptance.

Keep one Rust Core and **two adapters for different hosts**, not two AI
products. Do not introduce embedded chat/prompt UI, a WebView script runner,
an AI decision service, background file polling, a second file publisher or
automatic live writes merely for convenience. The optional Windows pairing
remains separately feature-gated, explicitly authorized and **read-only**;
it is not required for the baseline. Local's legacy Gateway and domain
Skills are preserved on their own branch.

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

**Rust modularity source increment (2026-11-20):** Existing Tauri and
headless CLI inline `#[cfg(test)]` suites have become `tests.rs`
child modules. The original test functions remain, with fixture paths
re-based on the new file location. `visual-review-policy.mjs` now owns
the trusted reviewer-declaration and pixel guard validation previously
embedded in the Code Mode RPC host. No host approval, Rust transaction,
source SHA, no-overwrite publisher or visual acceptance rule was removed.

**Scoped Rust modularization (2026-11-20):** The one-authority
`EditorSession` and EditPlan transaction/revision/Undo history remain in
`authoring/mod.rs`, while typed operation dispatch now belongs in
`authoring/edit_operations.rs`. Tauri's read-only Animation clip projection
belongs in `desktop_authoring/preview_animation.rs`; it cannot publish or
mutate saved data. Svelte's pure hierarchy row/reveal/parent selectors belong
in `rustOutlinerView.ts`, leaving reactive selections, focus, and IPC in
`RustEditorPage.svelte`. Existing Rust regressions retain their access to
the same projection/dispatcher through parent-local imports.
Tauri read-only texture and UV preview admission now lives in
`desktop_authoring/preview_texture.rs`; it does not own Paint, UV
mutations or independent model/bitmap state. Source-only
UI tests are included in the future canonical `verify:source` command
alongside Code Mode and Cargo checks. Nothing has been compiled or
executed in the held source-development phase.

**Source-bound Rust inspection ownership (2026-11-20):** Bounded
Geometry/Animation/Paint inspection functions and the ephemeral
`ValidatedInspection` facade now belong to `authoring/inspections.rs`.
The original function bodies are preserved; only parent-visible fields
and test-only private selectors are exposed within the same crate module.
The canonical Rust `EditorSession`, EditPlan validation, transactions,
Undo/Redo and saved file publisher remain unchanged in their owners.
No second model, bitmap cache, or editor engine was introduced. All
Rust tests remain NOT_EXECUTED under the active hold.

**Trusted host input modules (2026-11-20):** The trusted Code Mode
RPC/session/approval owner remains `host.mjs`. Its original path and
fresh-file rules belong to `trusted-local-files.mjs`; operator-picked
PNG/geometry evidence and synchronous fresh-image leases belong to
`visual-source-binding.mjs`; bounded SHA-pinned face inventory reads
belong to `source-face-coverage.mjs`. The code moved without changing
those validation decisions, guest capabilities, write authorization or
Rust no-overwrite publisher. Existing host regressions still exercise
these paths; focused source-authored regressions were added, not run.

**Svelte view-only presentation (2026-11-20):** The canvas Paint selection
overlay action, recovery list/dialog and opt-in read-only pairing dialog
have separate UI-only modules. `RustEditorPage.svelte` still owns native
restore/discard and dirty-session guards, source epoch/revision, focus,
pairing lifetime and Tauri invocation. The child views cannot acquire
model authoring, Code Mode privileges or change accepted artwork. UI
regressions were authored but no Svelte build/Windows focus test executed.

**Rust Animation and Texture UI owners (2026-11-20):** The view-only
`RustAnimationWorkspace.svelte` and `RustTexturesDock.svelte` now render
the prior Animation workspace and Texture dock controls. `RustEditorPage.svelte`
still owns selected animation, keyframe/playback clock, texture changes, native
revision/epoch, document commands, Undo/Redo and dirty-session guards.
Children receive typed projections/callbacks, not document or AI authority.
Original markup and disabled controls are preserved in source; static
regressions AUTHORED_NOT_RUN, native/Windows parity NOT_EXECUTED.
Paint workspace and the reactive parent remain substantial.

**Rust domain fixture ownership (2026-11-20):** The existing
`authoring/asset_handoff.rs` and `authoring/geometry_assembly.rs` retain
their read-only cross-domain handoff and deterministic geometry compilation
implementation. Their original in-module `#[cfg(test)]` suites now reside in
`asset_handoff/tests.rs` (handoff: PNG/UV/Animation) and
`geometry_assembly/tests.rs` (Geometry: frames/voids/sweeps); the original
private-parent imports and actual fixture paths were adjusted for nesting.
No production logic, transaction, validation or test assertions changed.
These regressions remain TEST_AUTHORED_NOT_RUN under the project hold.

**Rust EditOperation category ownership (2026-11-20):** The 64 exhaustive
typed operation arms are delegated by one `edit_operations.rs` router to
`edit_operations/hierarchy_edits.rs` (Bone/Cube hierarchy),
`geometry_edits.rs` (transforms/dimensions),
`animation_edits.rs` (clips/keys),
`texture_edits.rs` (RGBA8/material patches), and
`uv_edits.rs` (atlas and UV coordinates).
Original Rust arm bodies are preserved and a source-authored regression
enumerates the canonical operation enum and both routing layers. Category
handlers have no independent document/Undo/store; they refuse a category
mismatch. Rust compilation and regressions NOT_EXECUTED under the hold.

**Paint review and canvas presentation split (2026-11-20):** The
external PNG candidate comparison, semantic material candidate review, and
Paint atlas/mask/pointer canvas now have focused typed Svelte components
(`RustPaintExternalCandidate.svelte`, `RustPaintSemanticCandidate.svelte`,
`RustPaintAtlasCanvas.svelte`). The parent retains all native commands,
approved-source state, selection, revalidation, epochs/revisions and Paint
gesture/Undo. Pointer cancel/lost-capture, source review/disabled guards and
scoped styles were preserved in the moved views. Tests AUTHORED_NOT_RUN;
Windows/Svelte and visual parity NOT_EXECUTED. Main brush-control panel and
state controller remain large.

**Code Mode typed SDK selector domains (2026-11-20):** The client
continues to own its single authenticated Rust CLI transport, native call
metrics and write permission request. Shared bounded input primitives move
to `sdk-inputs.mjs`, read-only selector serialization and refusal to
`inspection-selectors.mjs`, and purely advisory changed-Cube overlap receipt
checks to `geometry-overlap-review.mjs`. No new SDK, sandbox, authorizer,
publisher or permissive fallback is created. Existing export names stay in
`client.mjs`; read-only source regression authored, NOT_EXECUTED.

**Trusted-host texturing readiness domain (2026-11-20):** The
read-only full-model Texture face coverage/reviewer-declaration decision
moves from the Code Mode RPC composition block to
`code-mode/texturing-readiness.mjs`. `host.mjs` still owns live visual
session/lease state, Deno RPC, user mutation permission, Rust publisher
and final response. Dynamic getter access retains current host revision
at the time the read occurs; existing fail-closed face count, source SHA,
visual reference freshness and no-false-artistic-PASS conditions remain.
No second workflow, reviewed-image store or write path is introduced.
Source regression authored NOT_EXECUTED.

**Additional Rust test-only categories (2026-11-20):** Existing
`project_navigation`, `analytics`, `system_status`, `authoring/geometry`,
`authoring/animation_semantic` and `authoring/animation_export`
test bodies now live under their corresponding child `tests.rs` modules.
All 83 named `#[test]` functions and original Rust assertions remain;
relative `include_bytes!` / `include_str!` paths were adjusted for
one deeper module directory. Production source, public functions, file
permission boundaries and native Rust authoring state were not changed.
No tests or compilation were executed due to the active test hold.

**Headless Rust CLI categories (2026-11-20):** The single
`bin/lazydesigner-authoring.rs` executable now delegates pure saved-model
projections to `focused_projections.rs`, bounded read-only selector/batch
queries to `inspection_batch.rs`, and its original native command switch
(including source SHA, fresh sibling publication and errors) to
`command_routes.rs`. Main/arguments/source checksum guards remain in the
binary root. No new binary, entrypoint, authoring engine, command name, file
publisher or write authority is introduced. Existing child Rust tests can
still reference parent-imported helpers. Source regression NOT_EXECUTED.

**Rust Outliner and Properties panels (2026-11-20):** The
`RustEditorPage.svelte` Outliner hierarchy rows and Cube/Bone/UV property
forms now render in independent `RustOutlinerPanel.svelte` and
`RustElementProperties.svelte` view components. They reuse the same
source-derived hierarchy helpers, selected Rust snapshot, disabled edit gates
and parent callbacks. Dock layout/resizing, focus hotkeys, native model
mutations and revision/Undo state remain parent/Tauri responsibilities.
No second model, mutator, or UI framework. Source regression authored
NOT_EXECUTED; Svelte/Windows focus and visual parity held.

**Rust Core source-owner extraction (2026-11-20):** The single
`authoring/mod.rs` retains all `AuthoringDocument` and `EditorSession`
types, EditPlan admission, source revision, transaction, Undo/Redo and public
file/export surface. Original private helpers are categorized into
`document_validation.rs` (identity and Outliner integrity),
`cube_uv_rules.rs` (Box/Auto UV and Cube admission),
`hierarchy_rules.rs` (tree, visibility and external UUID references), and
`animation_frame_rules.rs` (strict saved Bone animation acceptance).
Original function bodies and refusal codes are preserved; only parent
visibility and the original public UV admission re-export change.
Authored source regression remains TEST_AUTHORED_NOT_RUN; Rust compile
and native behavior are NOT_EXECUTED. No second document or history.

**Tauri immutable snapshot owner (2026-11-20):** Read-only
`EditorSnapshot` projection, ephemeral `ProjectionReuse` source keys,
immutable model freezing and bounded Texture/Animation/Outliner projection
have moved to `desktop_authoring/snapshot_projection.rs`. The original
`desktop_authoring.rs` still owns native Tauri commands, the store/lock,
revision and epoch admission, detached-edit publication, recovery and files.
The original projection bodies and tests remain, and parent-private symbols
continue to serve the same callers. Source regression AUTHORED_NOT_RUN;
Rust compile and Windows UI/native parity NOT_EXECUTED.

**Code Mode SDK input naming and ownership (2026-11-20):** The
large `client.mjs` now delegates three *input and receipt* concerns
to explicit semantic owners: `geometry-plan-input-transport.mjs` handles
deterministic Geometry plan identifiers and bounded proposal payloads;
`texture-correction-contract.mjs` holds the source-bound Texture correction
scope, reviewer diagnosis and Rust receipt checks; and
`semantic-material-intent-transport.mjs` validates a bounded material
proposal. The shared input digest format belongs to `sdk-inputs.mjs`.
Two existing public `client.mjs` exports retain their exact names and
bindings. These modules do not run Rust, grant permissions or implement
Geometry/Paint; the original trusted host and CLI remain authoritative.
Regression cases have been AUTHORED_NOT_RUN; native/Node parity not certified.

**Trusted Code Mode material reference naming (2026-11-20):** The
misleading internal `bindApprovedReference` function is now named
`assertUniqueSavedMaterialTextureUuid` and owned by
`material-reference-source-identity.mjs`. It checks exactly one selected
source Texture UUID through bounded SHA-bound catalog reads and refuses
missing, duplicate, malformed or incomplete results. It does not grant
visual/artistic approval, publish a file or allow a model write. The
existing trusted `host.mjs` still chooses the operator input, owns
authorization/leases and calls this check at the same boundary.
Source regressions were AUTHORED_NOT_RUN; native proof remains held.

**3D Paint control and brush preset view ownership (2026-11-20):**
`RustSurfacePaintControls.svelte` renders brush radius/tip/pattern, Shade Ink,
connected-color selection, seam and protected-region switches.
`RustBrushPresetControls.svelte` renders only the browser-local preset form.
The parent `RustEditorPage.svelte` still owns the 19 reactive form values,
preset persistence, admission guards, Paint callbacks, Rust epoch/revision
and Undo. Original sample/selection mutual exclusion, disabled states,
notes and scoped label presentation were retained as source. No bitmap
copy, new command, second store or authority introduced. Regression source
AUTHORED_NOT_RUN; Svelte/Windows/native proof still held.

**Saved Desktop Project preferences owner (2026-11-20):** All
schema-bounded saved preference reads, registered/pinned ID validation,
compare-and-replace writes, backup integrity checks and safe restoration
now belong to `project_navigation/saved_project_preferences.rs`.
The original `project_navigation.rs` keeps the one preference schema,
project identity, folder/model discovery, project navigation commands,
live Blockbench snapshot and path selectors. The original 14 helper
bodies and user-visible refusal text are preserved; tests using the
parent module still refer to the same helpers. No extra file writer,
new project database or change to destructive folder authorization.
Source regression AUTHORED_NOT_RUN; Windows and Cargo not executed.

**Remaining large stateful owners:** `RustEditorPage.svelte` is a reactive
UI controller/template; `authoring/mod.rs` is the Rust document/edit
authority; `desktop_authoring.rs` and `host.mjs` remain substantial
composition modules. Size alone does not authorize splitting shared
state or changing Tauri/Code Mode consumers. Do not call all godfiles
eliminated without native checks and a separate ownership review.

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
