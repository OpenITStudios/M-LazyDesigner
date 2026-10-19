# LazyDesigner — Bedrock Entity MCP

LazyDesigner uses a stable MCP **Gateway** for normal AI-client connections and a Minecraft **Bedrock Entity-focused** Runtime/plugin inside desktop Blockbench. `Local` is the development authority.

Do **not** use an upstream hosted plugin as runtime authority for this repository. LazyDesigner source/builds come from this repository. The canonical production bundle filename is `dist/lazydesigner_mcp.js`. Old BlockIT binaries are never selected as a current Runtime.

## Repository Lanes

Within `mcp/`, source ownership is intentionally split by role:

```text
PRODUCTION
  index.ts, server/, gateway/, lib/, plugin/, prompts/, macros/

ENGINEERING
  build/       deterministic artifact generation/watch only
  scripts/     development, verification, measurement, benchmark and local operations
  tests/       contract/integration/regression proof

GENERATED / OUTPUT
  dist/, generated API/docs artifacts
```

Production source must not import `scripts/`, `tests/`, repository-root `distribution/`, or `experiments/`. Engineering code may consume production source. Product install/update/rollback ownership lives at repository-root `../distribution/`.

## Developer Command Facade

Use the stable facade first:

```bash
bun run check
bun run verify
bun run benchmark
bun run release
```

Focused implementation commands remain namespaced; see `COMMANDS.md`. Do not treat every package script as an equivalent entrypoint.

## Build / Verify

From `mcp/`:

```bash
bun install --frozen-lockfile
bun run verify
```

Verification is layered:

- `test:runtime` → executable/import-safe Runtime contracts;
- `verify:authoring` → authoring semantics;
- `verify:repository` → repository/docs/CI contracts;
- `verify:mcp` → executable/public MCP + authoring compatibility;
- `verify:full` → repository + MCP final gate without rerunning the same subset twice.

Use the smallest targeted test during iteration.

## Normal Client Boundary

```text
AI client
  ↓ persistent stdio session
LazyDesigner Gateway
  ↓ reconnectable loopback Streamable HTTP
LazyDesigner Runtime
  ↓
Plugin / Blockbench
```

Normal AI-client use points at the Gateway, not the native Runtime endpoint. Runtime/plugin reload, Runtime rebuild, phase handoff, temporary Runtime loss or Blockbench restart must recover beneath the same Gateway process; only replacing the Gateway process itself requires a client reconnect.

Gateway surface:

```text
status
search_capabilities
describe_capability
invoke_capability
```

Native Runtime/debug endpoint:

```text
https://127.0.0.1:3000/bb-mcp
```

Direct Runtime access is for Inspector/conformance/focused debugging only.

Before the first native load, run `bun run setup:tls` (OpenSSL required; Git for Windows includes it). This creates a machine-local certificate/key outside the repository: `%APPDATA%/LazyDesigner/tls` on Windows, or `$XDG_CONFIG_HOME/LazyDesigner/tls` (default `$HOME/.config/LazyDesigner/tls`) elsewhere. `BLOCKIT_TLS_DIR` may override this with an absolute path shared by Blockbench and the Bun Gateway/live scripts. The private key is never bundled or committed. Blockbench requests native `https` and filesystem permissions through its normal permission mechanism.

The Bun Gateway/live scripts trust that certificate only for loopback requests, retain hostname/expiry validation, and reject redirects. A separate random 256-bit machine-local Runtime credential is created alongside TLS on managed setup (or safely initialized by an existing installed Runtime). The native listener requires it for health and MCP requests; the canonical HTTPS client injects it from the same protected directory. Plain HTTP remains for isolated protocol fixtures only. This blocks uncredentialed local/browser requests but does not isolate arbitrary native code running as the same OS user. No Windows/system trust-store changes or TLS-verification bypass are needed. The self-signed identity expires after 365 days; setup reuses a valid pair and refuses to overwrite an invalid/incomplete pair. To renew, stop Runtime, explicitly back up/remove both files and rerun setup, then reload Runtime. Clients reread the certificate on each request. Explicit HTTP URLs remain available for isolated protocol/conformance fixtures, not as a native fallback.

## Authoring Model

```text
Approved Reference + Dimensions + Requirements
→ native LazyDesigner Geometry on shared AUTHORING
→ Geometry approval
→ UV Layout PASS
→ Texturing/PBR on shared AUTHORING
→ Texture approval
→ Animation surface when required
→ Finalization
→ validated .bbmodel
```

Geometry and Texturing retain distinct semantic owners but share the AUTHORING Runtime surface. `HANDOFF_REQUIRED` + `switch_authoring_phase` is reserved for AUTHORING↔Animation.

The previous 3D-assisted/Hunyuan/PrimitiveAnything modelling path is retired. Normal modelling has one native Group/Cube authoring path.

Generated API docs and prompt manifests must never be hand-edited.

## Current Source Runtime Surface

```text
Gateway client surface        4 fixed tools
Active Stage-union catalog   54 tools
AUTHORING surface            47 tools
Animation surface            18 tools
```

Generated source-doc/prompt snapshots may be stale until the next canonical generator pass. Generated artifacts never override current source/runtime ownership.

Installed Runtime counts and lifecycle state are proof results; see `../docs/05-operations/current-validation.md`.

## Capability Priority

```text
PRIMARY      normal authoring hot path
SUPPORT      valid conditional capability
EXPERIMENTAL explicit matching intent only
MAINTENANCE  legacy/debug fallback; de-prioritized
```

Tiering affects discovery priority only. Known capabilities are invoked directly; bounded search is fallback-only.

Gateway fallback discovery is local and deterministic: BM25 lexical scoring is combined with branch-level semantic metadata and the active authoring phase as a ranking prior. Search may return a compact branch hint (for example `manage_cubes operation=update`); clients should pass that branch to `describe_capability` so unrelated schema branches remain deferred. No embedding model, vector database, external API or extra LLM routing call is required.

Branch-level routing metadata is canonicalized in `gateway/capabilities/manifest.ts`. Semantic discovery, dependency/precondition graph and deferred branch-schema projection are derived from that manifest so those three AI-facing decisions cannot drift independently. Runtime executor schemas remain the validation authority; lifecycle/execution metadata stays separately owned until its migration is proven by contract tests.

Routing quality is guarded separately from static schema-size budgets by `bun run eval:capability-intelligence`, which exercises the actual Gateway search path for Top-1/Top-3 discovery, branch accuracy and bounded projected search payload size.

## Tool / Quality Contract

Tool consolidation is routing-only. Original executors, schemas, validation, native handling and authoring intelligence remain retained.

Technical state is not visual acceptance:

- Validator clear does not mean visual/reference PASS;
- internal quality PASS does not mean user approval;
- tool/export success does not authorize phase handoff;
- Animation handoff requires canonical readiness + checkpoint.

## Legacy UI Fallbacks

Normal authoring has no Standard/Extended choice. Internal `bedrock_entity | extended` identifiers remain compatibility only; `extended` exposes Legacy UI Fallback families for debug/maintenance. `risky_eval` and `from_geo_json` remain disabled.

## Local Development Loop

`LAZYDESIGNER_PLUGIN_PATH` selects the canonical development plugin destination. Configure it, or pass the path as the optional `dev:sync` argument, then run:

```bash
bun run dev:sync
```

`dev:sync` performs development rebuild → exact-byte deploy → native plugin reload → live build-identity verification. Expected states are `LIVE_SYNCED`, `DEPLOYED_OFFLINE`, or `STALE_BUILD`.

Build only:

```bash
bun run dev:watch
```

Manual deploy:

```bash
bun run deploy:local -- /absolute/path/to/lazydesigner_mcp.js
```

Gateway:

```bash
bun run gateway
```

Native Runtime proof examples:

```bash
bun run verify:stateless-local
bun run verify:geometry-live -- --confirm-disposable
```

These do not prove visual fidelity or accepted asset quality.

## Surface / Context Guard

Static footprint guardrails are maintained by `scripts/measure/measure-default-surface.ts` and `scripts/measure/measure-stage-surfaces.ts`. Control payload diagnostics use `scripts/measure/measure-control-context.ts`. They are not Authoring Efficiency proof.

Normal authoring loads one active specialist. Geometry may additionally load exactly one selected modelling profile. The shared Stage Context document is the canonical cross-stage semantic owner but is loaded only for a material cross-stage/approval/freshness/convergence/handoff ambiguity; it is not a routine second payload.

## Current Capability Shape

Normal authoring includes Cube/Group authoring, hierarchy/rig/pivots, Locator/Null lifecycle, canonical capture, UV Layout mutation/audit, Texture Atlas/Painter/PBR/material instances/render-profile bindings, animation/timeline/effects/controllers, Particle asset support, Undo/history, `.bbmodel` persistence, Bedrock geometry export and stage control.

## Source Layout

```text
lib/capabilities/         canonical capability-level metadata (tier/phase/lifecycle/effects)
gateway/capabilities/     canonical AI routing metadata + search/dependency engines
gateway/runtime/          Gateway↔Runtime connection/affinity/recovery
gateway/providers/        lazy Gateway-local capability providers
gateway/control/          canonical LazyDesigner Control
gateway/                  stable client boundary + Runtime adapter/recovery
index.ts                  thin Blockbench plugin orchestration
plugin/                   RuntimeHost + Blockbench integration + dev reload
server/net.ts             Runtime HTTP/MCP transport + serialization
server/runtime/           registration/surface/consolidation/phase/bootstrap
server/tools/             authored Tool implementations
server/resources/         Runtime Resources
lib/                      shared/domain-pure helpers; root facades only where compatibility remains
lib/authoring/            handoff readiness + validation semantics
lib/bedrock/              Bedrock project identity + project semantics
lib/product/              product identity
lib/protocol/             resource/protocol helpers
lib/runtime/              connection/affinity/fetch/lifecycle primitives
ui/                       Blockbench UI implementation used by integration owner
prompts/                  canonical runtime workflow + generated manifest
build/                    build/docs/manifest tooling
scripts/                  developer command implementations; start at scripts/README.md
tests/                    contract/integration regressions; start at tests/README.md
docs/                     generated Runtime API output + non-authoritative engineering notes; see docs/README.md
```

Detailed source ownership: `../docs/04-system/implementation-map.md`.

Generated API/prompt artifacts follow canonical source + generator output and must never be hand-edited.

## LazyDesigner-only Installation Identity

New packages use `lazydesigner.exe`, `lazydesigner-package.json`,
`lazydesigner_mcp.js` (Blockbench ID `lazydesigner_mcp`),
`mcp_servers.lazydesigner`, canonical `LAZYDESIGNER_*` environment
variables and `x-lazydesigner-*` headers. The manager root is
`%LOCALAPPDATA%/LazyDesigner/managed`. The canonical owner is
`compatibility/lazydesigner-identity.ts` and distribution owns activation.

Retired BlockIT installed files/configuration are compatibility hazards, not current runtime identities. Do not bulk-rename them. They are never run, removed,
automatically adopted or treated as newer simply because they exist. A
legacy client entry or retired plugin in the target Blockbench profile
refuses activation pending an explicit, backed-up migration; existing
user models and preferences remain untouched. Source migration still
requires exact-SHA executable + native Windows acceptance before release.

## Proof Boundary

Continuation → `../docs/05-operations/next-action.md`. Proof interpretation → `../docs/05-operations/current-validation.md`.

Source/static success cannot prove installed Runtime freshness, live Gateway recovery, native Undo/playback/persistence, visual fidelity or measured whole-task savings unless those surfaces actually ran.