# Blockbench Compatibility Boundary

LazyDesigner treats Blockbench compatibility as an explicit product boundary rather than an implicit property of whichever Blockbench build happens to be installed.

## Canonical owner

```text
mcp/compatibility/blockbench.json
→ machine-readable compatibility policy

mcp/lib/blockbenchCompatibility.ts
→ deterministic policy evaluation

mcp/index.ts
→ plugin installation minimum + startup diagnostic gate
```

The compatibility manifest is intentionally small. It is the future shared input for the planned LazyDesigner Desktop control plane; do not create a second version table in the Desktop app.

## Status semantics

```text
validated
→ exact Blockbench version AND active plugin bundle build identity match a
  recorded successful native acceptance entry. Version-only evidence is insufficient

compatible-unverified
→ version is at or above the minimum and below the review boundary,
  but no exact live-validation claim is made

review-required
→ version is at or beyond the next compatibility review boundary;
  Runtime may start, but the user receives a warning and the version
  must not be described as validated

unsupported
→ version is below the minimum and startup is blocked

invalid
→ version text cannot be evaluated and startup is blocked
```

The review boundary is not a claim that a future Blockbench version is incompatible. It is a guard against silently treating an unreviewed feature release as proven-compatible.

## Current policy

The declared source typing baseline is now Blockbench types 5.2.0 (2026-10-20). This changes TypeScript declarations only, not native validated host builds. Historical repository
records mention native tests on Blockbench 5.2.0, but they are not validation
for the current plugin build. `liveValidatedBuilds` starts empty: 5.2.0,
5.2.1 and 5.2.2 are allowed with `compatible-unverified`, not `validated`.
The native plugin supplies its embedded `sha256:<bundle>` identity; Desktop
version-only discovery cannot claim current-build native proof.

When Blockbench publishes a new feature release:

```text
release/beta appears
→ inspect Blockbench technical/API changes
→ run existing LazyDesigner source gate
→ run bounded LIVE_BLOCKBENCH compatibility harness
→ add {version, buildIdentity} to liveValidatedBuilds only after matching
  exact-bundle and live-editor acceptance evidence is recorded with source SHA
→ move reviewBoundaryVersion only after the new family is reviewed
```

Do not fork Runtime implementations per Blockbench version unless a real incompatible API boundary requires a small adapter. Prefer feature/version probes at the narrowest owner over parallel Runtime trees.

## Operation-level native gates

The active editor version remains *advisory*, not blanket permission to mutate. Feature checks live in `mcp/lib/blockbench/nativeFeatureGates.ts` and are enforced at each native owner:

- `bone_rigging(set_ik_controller)` checks native Null Object IK source/pole fields **before Undo**. Other rigging actions remain usable if those fields are absent in a newer editor.
- `texture_layer_management(flatten_layers)` requires an actual native `flatten()` method; other operations are not globally disabled if that method changes.
- Structural layer actions continue to use `requireFlatLayerStructure` and reject active layer-group hierarchies before mutation. Read-only and safe non-structural actions remain independent.
- The Desktop project navigation snapshot and human editor panel are optional. Missing native FS, timers, events or changed Panel APIs must not prevent Runtime initialization; failures are logged for diagnosis.
- The Desktop health lease uses native timers when available. If scoped timers are unavailable, the lease is not advertised as live, but the authoring listener can continue; shutdown still releases other owners.

A feature probe proves only that an operation's minimal entrypoint appears available. It does **not** prove save/reopen, Undo/Redo, data preservation, or visual correctness. Those require live native acceptance. Do not add new accepted Blockbench versions or mark a build `validated` from static probes.

## Cross-version diagnostics and lease fix

The Blockbench Runtime lease is schema **2**. Heartbeat and cleanup ownership now require the same schema, product ID and instance ID used by the lease writer; otherwise Desktop can incorrectly age out an otherwise running Runtime. A cross-platform pure test catches regression, while the Windows scoped-FS lifecycle test retains native platform coverage.

