# LazyDesigner Canonical Vocabulary

Updated: 2026-09-30

This file owns **product vocabulary only**. It prevents multiple names from describing the same concept and prevents one name from carrying unrelated meanings.

The rule is strict:

~~~text
one concept → one canonical term
legacy serialized identifier → compatibility boundary only
~~~

Do not create synonyms for style. Prefer the canonical term even when another word sounds natural.

## Canonical Terms

| Concept | Canonical term | Meaning |
| --- | --- | --- |
| top-level kind of work | **Task Class** | `ASSET_AUTHORING` or `SYSTEM_DEVELOPMENT` |
| grouping of visual asset output intent | **Asset Category** | `models_3d`, `textures_2d`, or `visual_effects`; not a Runtime Surface |
| one target visual asset/output contract | **Asset Profile** | `entity`, `attachable`, `custom_block`, `item_icon`, `animated_texture`, `player_skin`, or `particle`; not the modelling profile or Registration Profile |
| current semantic authoring position | **Stage** | `GEOMETRY`, `TEXTURING`, `ANIMATION`, `FINALIZATION` |
| currently exposed Runtime capability family | **Runtime Surface** | `AUTHORING` or `ANIMATION` |
| semantic specialist ownership | **Domain** | Geometry, Texturing, Animation, or Core ownership; not lifecycle position |
| executable semantic operation | **Capability** | one discoverable/invocable operation; its canonical Operation Class is QUERY, MUTATION, PREVIEW, EXPORT, CONTROL, VALIDATION, or UNKNOWN |
| MCP implementation object | **Tool** | Runtime registration/validation/execution mechanism for a Capability; not the semantic identity itself |
| Runtime registration grouping | **Family** | implementation grouping such as `animation`, `textures`, or `elements`; not Stage |
| Runtime exposure compatibility mode | **Registration Profile** | `bedrock_entity` or `extended`; not Stage, quality level, or modelling strategy |
| stable AI-client MCP boundary | **Gateway** | transport/catalog/recovery boundary; not workflow reasoning |
| Blockbench-facing executor | **Runtime** | capability registration, validation and execution |
| deterministic task/context projector | **Control** | intake, selection, projection, invalidation and continuation |
| optional local lifecycle application | **Desktop Manager** | install/health/launch/update/repair/recover sidecar |
| source/user material used to decide what to build | **Reference Evidence** | text/images/requirements before packaging |
| normalized Codex/LazyDesigner handoff artifact | **Reference Package** | compact machine-readable handoff; required only when downstream handoff needs it |
| current durable asset continuation | **Asset State** | current Stage/gates/next step for one asset |
| result of a mutation | **Mutation Receipt** | structured evidence returned by an authored change |
| related mutations from one user intent | **Verification Cohort** | optional task-scoped grouping that defers verification until the explicit cohort boundary; it does not replace native per-tool Undo transactions |
| semantically invalidated dependency | **Dirty Scope** | evidence that must be re-established after a material change; downstream ownership/recheck semantics come from the Asset Dependency Graph |
| technical/evidence check | **Validation** | evaluates a bounded property; never implies user acceptance |
| explicit human acceptance | **Approval** | user acceptance of the current revision |
| permission to cross a gated boundary | **Transition Eligibility** | prerequisite result for Stage/Runtime Surface transition |

## Architecture Data-Shape Terms

Use these terms consistently in source and documentation:

| Term | Canonical meaning |
| --- | --- |
| **Manifest** | declarative source-owned facts or metadata; not mutable runtime state |
| **Registry** | bounded keyed lookup/index over already-owned objects; it does not create a second semantic source |
| **State** | current mutable process/session/project truth |
| **Snapshot** | immutable observation of State at one point in time |
| **Plan** | intended future work that has not executed yet |
| **Receipt** | evidence describing completed execution or an authority transition |
| **Projection** | reduced/derived view of canonical data for a specific consumer |
| **Catalog** | searchable/readable collection exposed to a consumer; may be derived from a Manifest |

Rules:

~~~text
Manifest → may project Catalog / Graph / Schema views
Registry → indexes canonical objects; never owns a competing truth
State → mutable current truth
Snapshot → read-only captured State
Plan → future intent
Receipt → completed-work evidence
Projection → consumer-specific reduction, never a second authority
~~~

Do not use `registry`, `store`, `manifest`, or `state` interchangeably merely because each may contain a Map/object internally.

## Capability vs Tool

These are related but not interchangeable.

~~~text
Capability = semantic operation identity
Tool       = MCP/Runtime implementation object
~~~

Example:

~~~text
manage_cubes
→ Capability

createTool(...), ToolSpec, Runtime registration
→ Tool implementation
~~~

Use **Capability** when discussing what the AI can request or discover.
Use **Tool** when discussing MCP registration, schema validation, execution objects, or Tool-specific implementation mechanics.

## Profile vs Family

**Asset Profile** is a distinct product concept: it defines visual asset
output intent, allowed authoring domains and applicable quality gates.
Authoring-domain access and output-quality approval are independent: Particle
can use the existing ANIMATION Runtime Surface without requiring a model
Animation clip.

The canonical contract is `mcp/lib/product/assetProfiles.ts`. The existing
`selected_profile` field still means a **modelling subtype** such as
`HUMANOID`, not an Asset Profile. Source declaration never proves native
executor availability or output acceptance.

~~~text
Registration Profile
→ decides which Runtime Families may be registered

Family
→ groups implementation/registration owners
~~~

A Profile is not a user-facing quality preset, Stage, Runtime Surface, or modelling strategy.
A Family is not a Stage.

Canonical source:

~~~text
Registration Profile → mcp/lib/capabilities/registrationProfile.ts
Stage                → mcp/lib/capabilities/authoringStage.ts
Runtime Surface      → mcp/lib/capabilities/authoringStage.ts
Capability metadata  → mcp/lib/capabilities/manifest.ts
~~~

## Stage vs Runtime Surface

These are intentionally different.

~~~text
Stage GEOMETRY  ─┐
Stage TEXTURING ─┴→ Runtime Surface AUTHORING

Stage ANIMATION ───→ Runtime Surface ANIMATION
~~~

Geometry↔Texturing is a **Stage change inside the same Runtime Surface**.

AUTHORING↔Animation is a **Runtime Surface transition**.

Do not describe Geometry↔Texturing as a Runtime phase transition, reload, or handoff.

## Validation vs Approval

Never use bare `PASS` as a complete semantic statement.

A validation result must identify what was checked, for example:

~~~text
UV Layout: PASS
Geometry visual validation: PASS
Animation playback validation: PASS
~~~

`PASS` means the named check passed. It never means user approval.

~~~text
Validation → technical/evidence result
Approval   → explicit user acceptance
~~~

Persisted legacy gate strings such as `UV Layout: PASS` remain valid because the subject is explicit.

## Readiness Vocabulary

Avoid unqualified `readiness` in new prose.

Use the specific concept:

~~~text
Stage Readiness
→ required reference/input evidence for the active Stage is sufficient

Transition Eligibility
→ prerequisites for moving to another gated Stage/Runtime Surface are satisfied

System State
→ READY | DEGRADED | OFFLINE for Runtime/Gateway availability
~~~

Existing protocol fields named `readiness` remain compatibility contracts until a separately mapped migration.

## Reference Boundary

Reference creation and Reference Package creation are not the same operation.

~~~text
standalone reference task
→ Reference Evidence / approved reference artifact
→ STOP

downstream Codex/LazyDesigner authoring requested
→ Reference Evidence
→ compact Reference Package
→ Control
~~~

Do not package merely to satisfy a template. When downstream authoring is requested, package creation is part of that handoff and does not require a second ceremonial request.

## Compatibility-Only Vocabulary

The following names are retained in persisted settings, TypeScript/API types or public capabilities as compatibility contracts. The **current** Runtime wire header is `x-lazydesigner-authoring-stage`; the retired `x-blockit-authoring-phase` may appear only in historical/migration evidence, never as an active request header:

~~~text
mcp_authoring_phase
x-lazydesigner-authoring-stage
switch_authoring_phase
McpAuthoringPhase
phaseAffinity
phaseTransitionReceipt
~~~

Their semantic interpretation is:

~~~text
legacy phase value geometry|texturing|animation
→ Authoring Stage

phase affinity / switch crossing AUTHORING↔ANIMATION
→ Runtime Surface transition
~~~

Do not introduce new product concepts named `phase`. Do not bulk-rename compatibility identifiers.

## Avoided Ambiguous Terms

Do not create new product architecture around these generic names:

~~~text
core
manager
director
router
handler
helper
mode
phase
generic PASS
generic readiness
~~~

Exceptions require a concrete existing compatibility contract or a clearly qualified technical meaning. `Desktop Manager` is the canonical qualified name for the optional machine lifecycle sidecar.

## AI Efficiency Rule

Vocabulary is part of the token-efficiency contract.

When the current Stage, Runtime Surface, Capability and Dirty Scopes are known:

~~~text
do not rediscover them
do not restate synonyms
do not translate them into alternate internal names
do not run status/search/describe as reassurance
~~~

Control projects current state; Codex reasons once; Runtime executes; Mutation Receipts identify Dirty Scopes; the deterministic Asset Dependency Graph maps those scopes to the minimum downstream rechecks.

For several already-known mutations that implement one user intent, reuse the current `task_context_id` and mark intermediate calls `cohort_boundary=CONTINUE`. Mark the final mutation `COMPLETE`. Control merges verification requirements and emits one cohort-end action. Do not use a Verification Cohort to hide uncertain mutation outcomes, Runtime Surface transitions, handoffs, or recovery boundaries.

## Ownership

~~~text
canonical vocabulary          → this file
product sequence              → ../01-product/flow.md
context-loading policy        → ai-context-loading.md
Stage cross-context semantics → authoring-stage-context.md
source ownership              → implementation-map.md
legacy serialized identifiers → compatibility-identifiers.md
~~~


## Capability Operation Class

Operation Class describes **what kind of action a Capability performs**, not which Stage owns it.

~~~text
QUERY       → read/inspect authored or Runtime state
MUTATION    → changes authored/persisted state
PREVIEW     → produces bounded visual evidence without becoming authored truth
EXPORT      → writes requested output from current authored state
CONTROL     → changes editor/workflow/control state rather than authored asset semantics
VALIDATION  → evaluates a bounded technical contract
UNKNOWN     → capability lacks canonical metadata; schema/ownership must not be assumed
~~~

Search may expose Operation Class together with the existing Verification Class and non-default Execution Class. This is intended to eliminate unnecessary `describe_capability` calls when the capability identity and arguments are already known. Operation Class does not replace MCP safety annotations, Dirty Scopes, receipts, or verification policy.

For consolidated capabilities, a semantic branch may override the capability-level Operation Class when one facade mixes read/control/mutation behavior. Example:

```text
manage_material_instances(operation=list|get)
→ QUERY

manage_material_instances(operation=set|bulk_set|clear)
→ MUTATION
```

Search and full describe must project the same branch override. Branch operation metadata participates in the semantic routing revision.

Branch metadata may also override Execution Class and Verification Class when the branch is behaviorally homogeneous. Query branches can therefore be projected as fast/not-applicable even when their consolidated facade also owns mutations.

Do not force an override onto a mixed branch. For example, `manage_animation_timeline(operation=timeline)` still contains both editor/timeline control and authored clip-property mutation actions, so receipt/result semantics remain authoritative there.

When a mixed branch has a stable nested discriminator such as `action`, nested action semantics may live on that same branch entry. This does not create another routing layer or public tool.

```text
manage_animation_timeline(operation=timeline, action=set_time)
→ CONTROL
→ successful execution does not create authoring continuation

manage_animation_timeline(operation=timeline, action=set_length)
→ MUTATION
→ normal receipt/freshness/verification path
```

Unknown nested actions fail closed and do not inherit a state-neutral classification.
