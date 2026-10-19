# LazyDesigner End-to-End Flow

Updated: 2026-10-10

This file owns only the **product-level sequence**. It must not duplicate detailed Reference, Authoring, Control, or Operations contracts.

## Canonical Flow

```text
USER
↓
CHATGPT REFERENCE PREPARATION
↓
REFERENCE EVIDENCE
↓
REFERENCE PACKAGE WHEN DOWNSTREAM HANDOFF IS REQUESTED
↓
LAZYDESIGNER CONTROL
↓
CODEX
↓
GATEWAY
↓
RUNTIME
↓
BLOCKBENCH
↓
VERIFY / REVIEW / CONTINUE
↓
FINALIZATION
```

Domain owners:

```text
Reference Preparation  → ../02-reference/README.md
Asset Authoring        → ../03-authoring/README.md
Control / System       → ../04-system/README.md
Current Operations     → ../05-operations/README.md
```

## Two execution paths at a glance

These diagrams are navigation projections, not separate routing/state authority.
Refer to [Implementation Map](../04-system/implementation-map.md) only when
source ownership is the question; normal Codex asset authoring stays on Control.

```mermaid
flowchart TD
  U[User request] --> M{Task class?}
  M -->|ASSET_AUTHORING| R[Approved reference / requirements]
  R --> C[Control: active stage and minimum context]
  C --> S[Exactly one active specialist]
  S --> G[Stable four-tool Gateway]
  G --> N[Runtime / Blockbench native]
  N --> V{Affected evidence valid?}
  V -->|Correction needed| C
  V -->|Ready for review| A[Approval / authorized checkpoint]
  A --> F[Finalization]
  M -->|SYSTEM_DEVELOPMENT| O[Exact source owner / scope]
  O --> I[Dependency impact / affected tests]
  I --> W[Bounded source change]
  W --> P[Matching proof / commit]
```

Only AUTHORING↔Animation changes Runtime surface; Geometry↔Texturing
changes semantic owner inside AUTHORING. A missing Reference Package means
`NEEDS_ORIENTATION` for authoring readiness, not a claim of quality failure.
Existing-asset corrections can reuse the accepted reference and skip unrelated
asset intake; `SYSTEM_DEVELOPMENT` never inherits authoring stage gates.

## 1. Request Classification

LazyDesigner has two top-level work classes:

```text
ASSET_AUTHORING
SYSTEM_DEVELOPMENT
```

`ASSET_AUTHORING` covers new assets, continuation, correction, Geometry, Texture, Animation, validation, and finalization.

`SYSTEM_DEVELOPMENT` covers MCP, Gateway, Runtime, plugin, build, generator, packaging, refactor, and bug-fix work.

The two classes may share Control as a front line, but they do not share the same readiness gates.

## 2. Reference Preparation

For asset work, ChatGPT resolves only the ambiguity needed before Codex authoring. A Reference Package is a handoff artifact, not a mandatory output of standalone reference creation.

```text
user intent / source evidence
→ requirement gate
→ approved visual authority when needed
→ standalone reference result, OR
→ compact Reference Package when Codex/LazyDesigner handoff is requested
```

Reference Preparation must not invent missing design facts. It uses one primary visual sheet by default and expands only when useful information would otherwise become unreadable.

Exact rules: `../02-reference/README.md`.

## 3. Control Intake

Control preserves the original user request and projects only the minimum context needed for the current decision.

For asset work it resolves:

```text
asset / task
current lifecycle stage
reference/readiness state
workspace/project identity
active semantic owner
legal next action
minimum context projection
```

For system development it resolves:

```text
problem / feature class
source owner
impact boundary
direct dependencies
minimum implementation context
```

Control must not become a second knowledge base, second Runtime, or creative modelling engine.

### One-flow context integrity before authoring

Control identifies the active specialist and selected Geometry profile by content
hash and semantic revision. A resolvable context handle is **not** proof that
the client actually loaded the Skill or that the agent applied its instructions.
The AI client must load the applicable current Skill content (and only the
decision-relevant deeper guidance) before relying on its procedures. It may
reuse a previously loaded copy only while that content is still available in
the active client context and its handle remains valid; after compaction or
restart without retained content, omit the stale `known_context_ids` and
reload the required guidance.

If the Control Reference projection reports
`REFERENCE_PROJECTION_INCOMPLETE`, the projected facts must not be used as
a complete design inventory. Reorient from the unchanged canonical Reference
Package and the exact stage document/part relationship needed for the next
decision. This is an evidence gap, not permission to invent facts or to stop
independent low-risk work.

## 4. Asset Lifecycle

Canonical authoring progression:

```text
REFERENCE / REQUIREMENTS
→ GEOMETRY
→ GEOMETRY VERIFY
→ UV READINESS PREFLIGHT
→ USER GEOMETRY APPROVAL
→ PRODUCTION UV LAYOUT (GEOMETRY / MODELLING OWNER)
→ UV LAYOUT PASS
→ TEXTURING (ATLAS / PIXEL / MATERIAL OWNER)
→ TEXTURE VERIFY
→ USER TEXTURE APPROVAL
→ ANIMATION READINESS when required
→ ANIMATION when required
→ FINALIZATION
→ COMPLETE
```

Exact authoring rules: `../03-authoring/README.md`.

## 5. Semantic Ownership

```text
Geometry / rig / pivots / UV Layout
→ Modelling owner

Texture Atlas / Styling / material / PBR
→ Texturing owner

Animation / motion / controllers / effects
→ Animation owner
```

Production UV mapping, packing, lock and UV Layout PASS remain Geometry/Modelling-owned after Geometry approval. Texturing consumes that accepted mapping to create/style/verify the atlas and materials. The existing `create_texture(type=template)` may invoke Blockbench's native template/UV arrangement only as a bounded part of that approved UV workflow; using a shared Runtime Surface never transfers UV Layout approval to the Texturing specialist. The future `manage_uv_layout` capability is not registered and cannot be presented as a currently executable route.

Geometry and Texturing share the AUTHORING Runtime surface. Crossing AUTHORING ↔ Animation uses the explicit phase handoff.

## 6. Codex Execution

Codex owns modelling/coding reasoning once it receives the minimum current context.

Typical direct path:

```text
known task
→ known owner
→ known capability
→ mutate
→ reuse returned state
→ verify only affected evidence
```

Search/describe/status are fallbacks for uncertainty or stale operational state, not mandatory rituals.

## 7. Gateway / Runtime / Blockbench

Gateway is the stable client boundary:

```text
status
search_capabilities
describe_capability
invoke_capability
```

Runtime executes Blockbench-facing capabilities. Blockbench is live asset truth.

Control routes; Gateway transports; Runtime executes. Do not collapse these responsibilities.

## 8. Verification and Review

Tool success is not visual approval.

```text
MUTATE
→ VERIFY affected evidence
→ internal PASS?
   ├─ no  → diagnose smallest material cause → correct → verify
   └─ yes → READY_FOR_USER_REVIEW when user approval is required
```

A material causal correction failing twice without new evidence becomes `BLOCKED` instead of an endless retry loop.

User approval and internal verification remain separate states.

## 9. Dependency Invalidation

Invalidate only what a material change actually affects.

```text
Geometry change affecting mapped surfaces
→ UV affected
→ dependent Texture affected

UV change
→ dependent Texture affected

unrelated accepted state
→ preserve
```

Control may project this dependency impact but does not become the persistent authority for asset state.

## 10. Persistence

Persistent asset continuity lives in:

```text
workspace/active/<asset>/README.md
```

Persist meaningful boundaries such as approval, handoff, resume, park, and completion. Git history owns older revisions.

## 11. Finalization

Finalization runs only after all required upstream gates are ready.

```text
check current approved state
→ validate hierarchy / dimensions / UV / textures / animation references
→ requested export/save
→ remove temporary/debug residue
→ reconcile workspace state
→ COMPLETE
```

Finalization must not silently redesign approved work.

## 12. Existing Asset / Correction

```text
USER CHANGE REQUEST
→ recover current accepted state
→ preserve unaffected authority
→ classify affected domain/dependencies
→ project minimum context
→ mutate
→ verify affected evidence only
→ review when required
→ continue
```

Do not rebuild the entire Reference Package for a bounded correction unless the correction changes reference authority itself.

## 13. System Development

```text
USER SYSTEM REQUEST
→ Control: SYSTEM_DEVELOPMENT
→ resolve source owner + impact boundary
→ minimum source / Skill / test context
→ Codex implementation
→ build / generate / deploy owner when required
```

System development does not pass through asset-specific reference/dimensions/animation readiness gates.

## 14. Efficiency Objective

Primary optimization target:

```text
COST TO ACCEPTED RESULT
```

Reduce avoidable:

```text
context scans
repeated documentation loading
capability discovery
schema reads
status rereads
wrong-owner routing
phase bouncing
full-view recaptures
retry loops
```

Never reduce context by removing information that can materially change the accepted result.

## Non-Goals

LazyDesigner Control must not become:

```text
second MCP server
second workflow authority
duplicate Tool/Skill knowledge base
creative modelling engine
visual judge replacing Codex/user
persistent model database
```

Its core verbs remain:

```text
INTAKE
RESOLVE
PROJECT
ROUTE
INVALIDATE
CONTINUE
```
