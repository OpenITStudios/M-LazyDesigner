# LazyDesigner Workspace Context

Source contract refreshed: 2026-11-18 (GitHub inspection, not native execution)  
Stability: branch-scoped design contract; implementation/proof tracked separately

This file owns **stable project facts only**.

```text
Documentation entry → docs/README.md
Continuation        → docs/05-operations/next-action.md
Proof               → docs/05-operations/current-validation.md
Ownership           → docs/04-system/implementation-map.md
Asset continuity    → workspace/active/<asset>/README.md
Routing             → AGENTS.md
```

## Product

**Rust branch — standalone authoring target (SOURCE_ONLY, NOT_EXECUTED):**
one Rust-owned document, history, UV/Texture/Animation transactions and editable
`.bbmodel` format adapter serve the Tauri/Svelte/Three.js editor and the
first-party Code Mode host/typed SDK/Rust CLI. Geometry, Texturing and Animation
fidelity precede UI/UX refinement. The release-critical route is Rust export
→ editable `.bbmodel` → actual Blockbench reopen/edit/visual review; reverse
import covers only a safe supported subset. The earlier Blockbench 1:1 UI and
unrestricted bidirectional parity targets were explicitly superseded on Rust.
Source files and authored regressions are not installed or native acceptance.
For current gates use `docs/04-system/rust-native-editor-plan.md`,
`docs/04-system/code-mode-migration.md` and `docs/05-operations/`.

**Local branch — existing Blockbench-hosted implementation:** LazyDesigner
uses a local MCP authoring path for Minecraft Bedrock Entity assets. The
AI-client boundary is the stable Gateway; the Blockbench plugin is the
execution Runtime behind it. Its Control, Gateway, Runtime and 12 domain Skills
are not replaced by the unvalidated Rust source.

LazyDesigner also has a separate optional **Desktop machine control plane** under `apps/desktop/`. Desktop owns installation/runtime health presentation, Blockbench discovery/launch, compatibility projection, and explicit managed maintenance actions. It is not part of the authoring execution chain and does not own Control context, Gateway protocol behavior, Blockbench authored state, update/package semantics, or Runtime tools.

Primary editable output is `.bbmodel`. Tool/file/coordinate success is not proof of visual resemblance.

### Asset-only product scope

LazyDesigner is an **asset authoring system**, not an add-on development system.

Normal scope includes Geometry, rig/bones/pivots/locators, UV Layout, Texture Atlas/Styling/PBR, texture variants, visual material/render intent, Animation clips, artist-facing Animation Controller composition, effect cues, preview/validation, and native visual-asset export.

Normal scope excludes Behavior Pack components/component groups/events/AI/spawn rules, Script API gameplay logic, server-side behavior animation/controller logic, manifest/pack assembly, addon packaging, and `client_entity`/render-controller file construction as a deliverable.

Resource-Pack semantics are retained only where they affect the Blockbench-authored asset's appearance or export compatibility. Opaque/cutout/blend/emissive knowledge is therefore in scope; building an RP file graph is not. Animation Controller support means clip composition, transition/blend continuity, and artist-facing effect preview. External gameplay state/property integration stays outside the normal authoring boundary.

## Reference-Grounded Authoring

Reference image creation belongs in ChatGPT. Reference Preparation uses the unified adaptive system under `docs/02-reference/`.

Default behavior:

```text
minimum useful visual evidence
→ 1 primary sheet by default
→ additional sheets only for real information overflow
→ Sheet 01 locks identity + scale
→ Sheet 02+ preserves both
```

View selection is decision-driven; no fixed turnaround board is mandatory.

Asset sizing is anchored to Minecraft player/world scale unless stronger explicit dimensions exist. Exact dimensions remain authoritative when explicitly supplied.

For authoring, Codex consumes the approved reference package rather than reconstructing the original ChatGPT conversation.

The approved image is visual authority. Confirmed dimensions and scale constraints are numeric/world-scale authority. LazyDesigner uses one native Geometry authoring path; there is no modelling-strategy selection gate.

### Shared AUTHORING surface and stage ownership (Local)

```text
AUTHORING Runtime surface
  Geometry focus  → shape, hierarchy, rig foundation, pivots, UV Layout
  Texturing focus → Texture Atlas, Painter/styling, PBR/materials, Texture Verify

ANIMATION Runtime surface
  Animation       → motion/keyframes/effects/controllers when required
```

Geometry and Texturing retain distinct semantic owners, but both tool families are callable in the same AUTHORING Runtime surface. Geometry↔Texturing correction therefore does not require `switch_authoring_phase`; the setting remains a startup/guidance focus. `HANDOFF_REQUIRED` is reserved for crossing AUTHORING↔Animation through the Gateway.

Codex internally verifies meaningful stage checkpoints. Internal PASS means `READY_FOR_USER_REVIEW`; user inspects live Blockbench and explicitly approves before checkpointing unless autonomous execution was explicitly authorized. Same material causal correction failing twice without new evidence → `BLOCKED`.

Naturally movable structurally distinct parts remain meaningfully transformable even when Animation is not currently required. When Animation is required, needed hierarchy/pivots/attachments must already be animation-ready before Geometry approval.

## Texture vocabulary

- **UV Layout** = geometry-to-atlas mapping.
- **Texture Atlas** = bitmap/PNG canvas that stores pixels.
- **Texture Styling** = authored color/material/shading/detail.
- **Texture Verify** = fresh atlas + mapped-model visual validation.

New Bedrock projects use logical UV resolution **128 by default**, 256 opt-in.

## Persistence

On the Blockbench-hosted Local path, persistent Asset Model state lives in `workspace/active/<asset>/`. Workspace is created before Blockbench project creation; a new authoritative `.bbmodel` checkpoint first appears after Geometry user approval or the corresponding explicitly authorized autonomous verification boundary.

README owns current intake/stage/next-step/blocker state. Git history owns older revisions. Completed assets remain `active/` until the user explicitly archives them.

## No normal Standard / Extended profiles

Normal authoring has no Standard/Extended choice. Runtime internal `bedrock_entity` remains default; `extended` exists only for **Legacy UI Fallbacks** debug/maintenance compatibility. `risky_eval` and `from_geo_json` remain disabled.

## MCP Architecture

Blockbench-hosted Local authoring path (not the Rust Code Mode route):

```text
AI client
  ↓ stdio
LazyDesigner Gateway
  ↓ loopback Streamable HTTP
LazyDesigner Runtime inside Blockbench
  ↓
Blockbench
```

Machine-management sidecar:

```text
LazyDesigner Desktop
  ↓
managed blockit.exe status / update / repair / recover
  ↓
Managed Distribution

LazyDesigner Desktop
  ↓
Blockbench process/install discovery + explicit launch
```

Desktop observes Gateway/Runtime health but does not insert itself between AI client, Gateway, Runtime, and Blockbench.

Gateway exposes exactly:

```text
status
search_capabilities
describe_capability
invoke_capability
```

Current semantic phase union retains **54 callable Bedrock tools** after retirement of the two legacy 3D-assisted capabilities. Geometry and Texturing startup stages expose the same 47-tool AUTHORING surface; Animation exposes the separate 18-tool Runtime surface. Installed evidence is tracked separately in `docs/05-operations/current-validation.md`. Direct Runtime MCP remains for Inspector/conformance/debugging, not normal AI-client authoring.

Gateway keeps the same task/chat alive across focus/surface handoff. Catalog/connection invalidation after phase-affinity changes remains conservative in current source; relaxing Geometry↔Texturing same-AUTHORING reuse requires the targeted LOCAL_CODE transport proof recorded in `docs/05-operations/next-action.md`.

## Repository / Runtime Separation

Repository source/docs/CI work follows `GITHUB_RULES.md`. Static proof never proves live Blockbench/runtime/visual quality.

## Navigation

- documentation → `docs/README.md`
- product flow → `docs/01-product/flow.md`
- reference preparation → `docs/02-reference/README.md`
- authoring policy → `docs/03-authoring/README.md`
- system ownership → `docs/04-system/README.md`
- current operations → `docs/05-operations/README.md`
- workspace contract → `workspace/README.md`
- research → `experiments/`
