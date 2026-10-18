# LazyDesigner Compatibility Identifier Boundary

Updated: 2026-10-15

This file owns the migration boundary for identifiers that still contain `BlockIT` / `blockit` after the product rename.

```text
presentation identity may migrate independently
protocol / persisted / install identity may not
```

Do not bulk-replace `blockit` across the repository.

Likewise, compatibility fields containing `phase` remain serialized as-is until an atomic protocol/settings migration. Human-facing and new semantic code use **Stage** for workflow position and **Runtime Surface** for capability exposure.

## Active Decision — Canonical LazyDesigner-only Installation

User direction on 2026-10-15: **BlockIT is the retired product identity. The target installation, launched Runtime, client registration and product-facing paths must use one canonical LazyDesigner identity.** Legacy binaries/plugins/managed installations must not be silently selected as a working fallback for current LazyDesigner. This supersedes the older *indefinitely retain* priority below, but does not authorize destructive removal of user files or bypass of Blockbench trust.

The development branch now contains a **coordinated canonical source cutover** covering plugin registration, embedded build banner, package/manager, Codex client key, Gateway identity, TLS/Runtime configuration, Desktop paths and CI artifact naming. **This is not a completed executable/native or installed migration.** The retired identifiers inventoried below remain as read-only migration evidence. Do not install or publish the new candidate until matching Windows build, protocol, installer, rollback and profile acceptance succeeds.

### Target identity contract

| Domain | Canonical target | Compatibility requirement during transition |
| --- | --- | --- |
| Desktop/managed executable | `lazydesigner.exe` | Never start the old executable as a substitute for the new manager |
| Managed root | `%LOCALAPPDATA%\\LazyDesigner\\managed` (canonical; distinct from navigation folders) | Legacy `BlockIT` root is detection/import evidence only, not an active install fallback |
| Blockbench plugin filename + registered ID | `lazydesigner_mcp.js`, `lazydesigner_mcp` | Do not load two Runtime plugins, bind to the same endpoint, or rewrite Blockbench installed-plugin trust state |
| Client connection | `mcp_servers.lazydesigner` | Detect legacy client entries; never silently adopt, shadow or remove unrelated user configuration |
| Network and authorization keys | New `LAZYDESIGNER_*` keys and canonical LazyDesigner affinity headers | Change Gateway and Runtime atomically; preserve loopback, TLS verification and credential safety |
| Managed manifest/bundle/release tooling | `lazydesigner-package.json`, `lazydesigner_mcp.js`, consistently named verified artifacts | Match production build SHA, checksums, installer staging, rollback and exact-SHA test inputs |
| Project navigation + native model data | Keep existing `LazyDesigner` navigation owner and `.bbmodel`/texture assets | Never make usable model selection contingent solely on legacy manager metadata; preserve matching profile identity and original files |

### Required implementation order

1. Map every producer, consumer and serialized/persisted identifier (plugin registration, shared library constants, manager, build scripts, CLI, Tauri resources, Codex config, HTTP affinity, TLS/auth, test/release pipeline).
2. Implement one coherent canonical LazyDesigner package/installer and new-mode state/provenance checks. Do **not** create a permanently dual-runtime product or a second installer authority.
3. On first run, detect legacy installation/plugin/client state **read-only** and classify it accurately. A separate explicit, user-confirmed migration may safely back up and transition recognized legacy-owned files. Unknown/modified files fail closed; never auto-delete, overwrite, or run old manager binaries. If transition cannot be verified, preserve the old state untouched and show a useful recovery path.
4. Make Workspace/Project Navigator availability independent of a missing manager where the intended Blockbench profile/project snapshot is safely provable. Never guess a profile or treat a stale model as a live session. A failure in manager setup should disable only actions requiring the manager.
5. Verify source/package/installer and negative collision cases at the same SHA, then verify Windows Blockbench one-plugin ownership, client reconnection, model Continue/Open, profile/TLS safety, Undo/reopen and recovery. No installed/native or performance PASS may be inferred from static source.

STOP before deployment, old plugin removal, old directory deletion, config replacement or `main`/release changes without the matching target-specific verification and user authorization.

## Compatibility-Bound Identifiers

These are **retired, historical** values. They are not active identifiers in the canonical LazyDesigner distribution and must never be treated as a running fallback. Persistent installations using them require deliberate verified migration.

| Identifier | Retired value | Historical owner | Why recorded |
| --- | --- | --- | --- |
| npm/package identity | `blockit-bedrock-entity-mcp` | `mcp/package.json` | package/build/dependency identity |
| production bundle path | `dist/blockit_mcp.js` | package/build/deploy owners | installed file/update continuity |
| Blockbench plugin id | `blockit_mcp` | `mcp/index.ts` | installed plugin identity/reload continuity |
| Gateway MCP server name | `blockit-gateway` | `mcp/gateway/contract.ts` | client/server identity continuity |
| Runtime URL env prefix | `BLOCKIT_RUNTIME_*` | `mcp/gateway/runtime/backend.ts` | deployment/config compatibility |
| Gateway queue env key | `BLOCKIT_GATEWAY_MAX_QUEUE_DEPTH` | `mcp/gateway/runtime/backend.ts` | deployment/config compatibility |
| project affinity header | `x-blockit-project-uuid` | `mcp/gateway/projectAffinity.ts` | Gateway↔Runtime protocol compatibility |
| authoring Stage affinity header (legacy serialized name) | `x-blockit-authoring-phase` | `mcp/gateway/projectAffinity.ts` | Gateway↔Runtime protocol compatibility; `phase` is compatibility wording only |
| extended-family localStorage key | `blockit_mcp.extended_families_enabled` | `mcp/ui/settings.ts` | persisted user setting continuity |
| authoring Stage setting id (legacy serialized name) | `mcp_authoring_phase` | `mcp/lib/authoringPhase.ts` | persisted Blockbench setting continuity; do not use `phase` as a new product concept |
| extended-family setting id | `mcp_extended_families_enabled` | `mcp/lib/registrationProfile.ts` | persisted Blockbench setting continuity |

Primary LazyDesigner Skill paths are **not** compatibility-bound. REFERENCE_PREPARATION, ASSET_AUTHORING, and PRODUCT_DEVELOPMENT primary Skills now use canonical `lazydesigner-*` identities; removed legacy paths must not return as aliases.

Some deprecated TypeScript export names and historical documents may retain `Blockit`/`BLOCKIT` wording for compile-time source compatibility only; their runtime string values are canonical LazyDesigner. Do not add a second active identity, router or protocol. Remove remaining internal aliases after exhaustive source callers/tests have migrated.

Retired distribution names `blockit.exe`, `blockit-package.json`, `blockit-windows-x64.zip`, `blockit-*` artifacts and `blockit-v*` tags are historical evidence only. New publishing and installing paths use LazyDesigner names and must never fall back to them.

## Presentation Identity

Human-visible product language should use **LazyDesigner** when it does not change a serialized identifier or external contract.

Safe presentation migration now covers current source for:

```text
MCP server initialize/instructions
Gateway backend status/errors
plugin lifecycle/install/dev-sync messages
Blockbench panel + status bar
local install guidance
mcp/llms.txt
packaged authoring AGENTS + package source notice
repository operating-rule headings
active product/reference/authoring policy documents
```

Safe presentation migration includes:
- docs/headings/descriptions;
- QuickMessages and logs;
- human-readable errors;
- comments describing the current product;
- MCP titles/descriptions where protocol names remain unchanged.

Do not expose compatibility residue as a second product name.

## Active Runtime Configuration Boundary

The canonical Gateway reconnect settings are `LAZYDESIGNER_GATEWAY_RECONNECT_MIN_MS` and `LAZYDESIGNER_GATEWAY_RECONNECT_MAX_MS`. The optional local Asset Browser cache override is `LAZYDESIGNER_VANILLA_ASSET_CACHE_DIR`. Retired `BLOCKIT_*` configuration must not silently control the active LazyDesigner Runtime. The vanilla asset cache directory itself retains Blockbench's actual `minecraft_assets_cache` name; this is a third-party filesystem convention, not a retired product identity.

## Generated Documentation Boundary

`mcp/scripts/generate/generate-docs.ts` owns the API HTML presentation. The generator template and its prompt/export/install source descriptions now use LazyDesigner, but checked-in `mcp/docs/api.json` and `mcp/docs/index.html` still contain pre-rename generated output. Those files remain generator-owned; never hand-edit them.

Because the current context is `REMOTE_GITHUB` and canonical generated output requires `LOCAL_CODE` generator execution, treat this as one bounded source+generation residue:

```text
LOCAL_CODE
→ use current canonical generator source on one exact Local SHA
→ bun run generate:owned-artifacts
→ inspect generated API/HTML, prompt manifest and Hybrid-4 schema diffs
→ commit only generator-produced outputs from that same source state
→ bun run docs:build through the canonical generator, then bun run docs:check and matching-SHA source verification
```

The source/output mismatch is an OPEN generator-coupled residue, not a passing documentation gate. Do not claim docs:check or release readiness until the output is regenerated and verified.

## Migration Preconditions

A compatibility-bound identifier may change only when all of the following are mapped in one coherent migration:

```text
producer(s)
consumer(s)
persisted/install state
generated/build outputs
tests/CI/deploy scripts
rollback/recovery behavior
```

For persisted/install identifiers, migration must define whether old state is read, transformed, dual-read temporarily, or intentionally invalidated. Do not create permanent dual identity.

## Current Priority

```text
1. deliver a complete LazyDesigner-only managed identity and distribution
2. validate the canonical source cutover with full executable tests before a release
3. preserve model files, user configuration and Blockbench trust; old state is read-only evidence
4. eliminate legacy identifiers from the final actively installed/runtime product
5. leave native migration and destructive cleanup unclaimed until verified and explicitly approved
```

## Proof Boundary

This document and source regressions can prove repository intent and string ownership. They do not prove installed migration, persisted-setting upgrade, live Gateway compatibility, regenerated API output, or Blockbench plugin replacement behavior until exercised in the appropriate local/live context.
