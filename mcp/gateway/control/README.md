# LazyDesigner Control

Canonical front-line intake, context projection, routing metadata, and continuation-delta layer for the stable four-tool Gateway.

```text
user task
→ Control intake
→ Reference Package / Workspace / Runtime orientation
→ stage or development projection
→ minimum canonical context
→ Gateway capability
→ Runtime
→ Blockbench
→ control_delta
→ deterministic continuation action
```

## Ownership

Control owns:
- `ASSET_AUTHORING | SYSTEM_DEVELOPMENT` task classification;
- project/runtime/workspace orientation needed for routing;
- Reference Package projection;
- `GEOMETRY_CONTEXT | TEXTURE_CONTEXT | ANIMATION_CONTEXT`;
- content-addressed Skill/profile handles;
- bounded **projection** of development source/specialist/test ownership
  (canonical mappings belong to `../development/sourceOwners.ts`);
- capability-domain metadata;
- mutation invalidation and next-intent delta.

Control does not own:
- canonical system-development source-owner mappings or verifier selection;
- user/reference truth;
- Skill prose or modelling knowledge;
- Tool schemas/implementation;
- persistent asset state;
- Blockbench live state;
- Codex creative/technical reasoning.

## Canonical source

```text
types.ts              compact Control contracts
referenceTypes.ts     REFERENCE.json projection contracts
referenceParser.ts    pure REFERENCE.json normalization
referencePackage.ts   REFERENCE.json filesystem/cache boundary
referenceImageEvidence.ts   bounded source-image integrity + opt-in MCP media delivery
workspace.ts          Active Workspace projection
contextProjection.ts  stage-specific authoring context
contexts.ts           Skill/profile paths + content-addressed context handles
sourceOwners.ts       compatibility-only re-export of Development source owners
registry.ts           compatibility facade
snapshot.ts           live Gateway/Runtime orientation
packetContext.ts      task identity + context delivery/cache semantics
readiness.ts          lifecycle/readiness policy
packetData.ts         empty workspace + packet summaries
packet.ts             task packet orchestration
receipt.ts            phase/project receipt derivation
outputEvidence.ts     source-only existing-receipt/Control snapshot comparison; no state store
capabilities.ts       capability decoration
routingPolicy.ts      direct-first route policy
developmentIntent.ts  bounded SYSTEM_DEVELOPMENT routing
capabilityProjection.ts Control-only projection of canonical capability metadata
delta/                post-operation freshness/invalidation engine + Gateway projection
delta.ts              compatibility facade
orchestration.ts       ephemeral execution reducer + deterministic next action
index.ts              public module exports
```

## Context economy

Geometry normally receives:

```text
Modelling Skill
+ exactly one selected profile when available
```

Texturing and Animation receive only their active specialist by default. Unchanged context is reused by content-addressed handle; Control does not load the old router Skill or all sibling domains as reassurance.

Research-derived authoring guidance stays in canonical authoring docs, the active specialist, and the selected Geometry profile. Control must not add duplicate stage-context fields or prose for ownership-reuse, variant, Locator-parent-motion, family-rig, or rig/clip/controller rules.

## Reference boundary

`REFERENCE.json` stays the structured reference authority. Control selects only active-stage document/image identities and preserves:

```text
original_user_intent
current_user_delta
selected_profile
scale requirements
stage readiness
workspace revision
```

A stage is blocked by its own readiness, not by unrelated future-stage unknowns.

## Delta boundary

`control_delta` invalidates only evidence that can be affected by the mutation when Runtime evidence is sufficient. Ambiguous structural mutation evidence fails conservatively. Ordinary mutation does not force a full `status` reread; project/phase authority changes may require one.

## Orchestration boundary

The Gateway keeps one **ephemeral** execution reducer. It does not persist asset
truth or chat history. After an attached mutation delta, the reducer derives one
bounded continuation action:

```text
CONTINUE | STATUS | RECOVER | HANDOFF
VERIFY_FOCUSED | VERIFY_VISUAL | REVIEW_RETURNED_EVIDENCE
```

This converts verification class, phase/project changes, particle-texture
handoff, and unknown outcomes into deterministic flow policy without another
LLM/planner call. Unknown mutation outcomes never become automatic retries.

Native output receipts describe the completed **write**, not the asset's
complete output set. On an Entity readback, Control may continue authoring but
must state that requested deliverables/approvals remain separate. On a
Particle JSON write, `REVIEW_PARTICLE_RESOURCE_DEPENDENCIES` requires a
focused resource/conditional-texture review even if the write's
`verification_class` is `receipt_only`. The existing cohort's
`pending_verification` retains this focused debt through `CONTINUE` and
`COMPLETE` instead of treating the later receipt as an all-clear.
An uncertain native outcome still takes precedence and never permits an
automatic retry, while incomplete exported bytes remain `focused_read`.
No new public action type, output field, cache or native tool is introduced.

Control consumes canonical capability metadata from `mcp/lib/capabilities/manifest.ts` through `capabilityProjection.ts`. Branch-level AI routing metadata remains owned by `gateway/capabilities/`; Control adds context/freshness/orchestration semantics without rebuilding those tables.

## Output receipt continuity (source-only)

`captureOutputControlContext` takes a bounded snapshot of the existing
Control project binding, Runtime generation (requires a concrete
instance/startup identity), Reference/Workspace fingerprints and task ID. `reviewAssetOutputAgainstCurrentControl` compares a
caller-supplied receipt's captured snapshot with a later Control Packet and
reuses the canonical `lib/receipts/assetOutput.ts` reviewer.

Context identity equality **does not prove native freshness**: manual
Blockbench edits can bypass those fingerprints. Only the existing
Finalization-only Entity `.bbmodel` accepted/current readback may report a
bounded **same-file** match with a specific `export_model` receipt only
when a same-status bound Runtime native save_path exactly equals that
receipt's wrote_to_path. Without current native status, without a saved
bound project, or after Save As to a different file, a matching SHA alone
must not claim current output identity; a Particle
write or a geometry/animation compile cannot borrow that claim. The review
never authenticates a caller-supplied receipt, writes native files, adds
Gateway tools, or awards visual/user/Minecraft/Finalization PASS. No
independent cache, ledger or persisted receipt state is introduced.

## Gateway boundary

The client-facing surface remains exactly:

```text
status
search_capabilities
describe_capability
invoke_capability
```

Control is internal to this stable Gateway boundary; it is not a second MCP server or public tool family.

## Proof boundary

Source structure and static contracts can prove ownership/routing semantics. Installed Runtime behavior, live Blockbench state, visual quality, and measured end-to-end usage reduction require later local/live evidence.

## Development projection boundary

Control may project bounded `SYSTEM_DEVELOPMENT` routing into client context, but repository-development diagnosis is canonically owned by `../development/`. Control must not duplicate development intent rules, semantic impact logic, or affected-execution planning.
