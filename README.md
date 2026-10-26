# LazyDesigner

LazyDesigner is an AI-assisted **Minecraft Bedrock Entity** authoring workspace built around a local Blockbench MCP Runtime, a stable AI-client-facing Gateway, and a lightweight Control front line for context-efficient Codex work.

**Former project name:** BlockIT. New source/build, managed installer, plugin and Gateway identities are canonical LazyDesigner; old BlockIT machine state is detected only for safe explicit migration and is never selected as the active Runtime.

**Project snapshot:** `v0.1` (separate from the MCP package version).

## Branch Model

```text
Local  → active development / working authority
main   → stable / release authority; changes only by explicit promotion
```

Routine repository development uses `Local`. Repository behavior is routed by `AGENTS.md`; GitHub execution/history/CI rules are owned by `GITHUB_RULES.md`.

For a new ChatGPT repository chat, provide this `Local` URL and intended task. ChatGPT follows current root rules, works GitHub/cloud-first without requiring the user's PC, and treats `amati` as read-only. Continuity comes from current source and relevant work commits, not chat titles.

## Canonical Product Flow

```text
User request
→ ChatGPT Reference Preparation
→ Reference Package
→ LazyDesigner Control
→ Codex
→ Gateway
→ Runtime
→ Blockbench
→ verification / approval / checkpoint
→ Finalization
```

ChatGPT owns **reference preparation**, not Blockbench execution. Control remains a thin routing/context layer and must not duplicate canonical Skills, Tool schemas, workspace state, or creative reasoning.

The approved image is visual authority. Requested dimensions are numeric authority. LazyDesigner has **one native modelling path**; the retired 3D-assisted/Hunyuan/PrimitiveAnything path is not part of current authoring.

## Documentation

Start from:

```text
docs/README.md
```

The documentation is organized for selective AI retrieval:

```text
docs/
├── 01-product/      product identity, requirements, end-to-end flow
├── 02-reference/    ChatGPT reference preparation and Codex handoff package
├── 03-authoring/    modelling, texture, animation, validation, finalization
├── 04-system/       Control, source ownership, Skill taxonomy
└── 05-operations/   current proof, next action, local acceptance
```

Do not load the whole documentation tree by default. Select the current domain and read only its canonical owner(s).

Current state owners:

- documentation entry point → `docs/README.md`
- stable project facts → `CONTEXT.md`
- product flow → `docs/01-product/flow.md`
- reference preparation → `docs/02-reference/README.md`
- reference package → `docs/02-reference/package/README.md`
- authoring policy → `docs/03-authoring/README.md`
- system/source ownership → `docs/04-system/README.md`
- repository/plugin continuation → `docs/05-operations/next-action.md`
- current proof state → `docs/05-operations/current-validation.md`
- asset continuity → `workspace/README.md`

Historical audits, retired product paths, obsolete continuation, and old roadmaps belong in Git history rather than parallel current-state owners.

## Current Product Surface

```text
Control                     front-line context/readiness/routing
Gateway client surface      4 fixed tools
Active Stage-union catalog 54 tools
AUTHORING source surface   47 tools
Animation source surface   18 tools
```

Gateway tools are always:

```text
status
search_capabilities
describe_capability
invoke_capability
```

Geometry and Texturing startup focus values resolve to the same shared AUTHORING capability set. AUTHORING↔Animation handoff is Gateway-managed and continues the same task/chat; normal client use does not require a manual MCP reconnect.

Normal authoring has no Standard/Extended profile choice. Internal `extended` remains Legacy UI Fallback compatibility only; `risky_eval` and `from_geo_json` remain disabled.

Installed Runtime counts and lifecycle behavior are proof results, not hand-maintained product facts. See `docs/05-operations/current-validation.md`.

## Evidence Boundary

Static source/CI proof can establish routing, contracts, schemas, deterministic build output, and fail-closed source behavior. It does **not** prove installed Blockbench state, live Gateway survival, visual fidelity, native Undo/playback/persistence, or accepted asset quality.

## Repository Map

One repository contains two distinct responsibilities. Choose the relevant owner before reading or writing.

| Responsibility | Canonical owner | Contents |
| --- | --- | --- |
| Product development | `mcp/` | Gateway, Control, Runtime/plugin, schemas, generators, source tests and package-local builds |
| Desktop development | `apps/desktop/` | Tauri/Svelte/Rust application and machine control plane |
| Product distribution | `distribution/` | Managed install, update, rollback and packaging |
| Working system | `.agents/` | Agent routing, specialist Skills and permission preflight; not asset storage |
| Working guidance | `docs/` | 01-product, 02-reference and 03-authoring guide asset work; 04-system owns architecture/ownership; 05-operations owns current proof and continuation |
| Asset projects | `workspace/` | Persistent `active/<project>/` and explicitly saved `saved/<project>/` packages |
| Research | `experiments/` | Bounded experiments and retained research inputs; not production dependencies |
| GitHub configuration | `.github/` | Repository automation and templates |

Control's implementation stays in `mcp/`; its authoring instructions and projected context use the existing working-system owners. Do not copy source, Skills or policy into a second development/authoring tree. Start documentation discovery at [docs/README.md](docs/README.md), development at [CONTRIBUTING.md](CONTRIBUTING.md), and asset work at [workspace/README.md](workspace/README.md).

## Repository Root Policy

This is the canonical layout and naming policy. The root is a navigation facade, not a storage area.

Allowed source directories: `.agents/`, `.github/`, `apps/`, `distribution/`, `docs/`, `experiments/`, `mcp/`, `workspace/`.

Allowed source files: `.bun-version`, `.editorconfig`, `.gitattributes`, `.gitignore`, `AGENTS.md`, `CONTEXT.md`, `CONTRIBUTING.md`, `GITHUB_RULES.md`, `LICENSE`, `package.json`, `README.md`, `SECURITY.md`.

Git metadata `.git` may be a directory or worktree pointer file. Ignored local state may use `.cache/`, `.codex/`, `.claude/`, `.idea/`, `.vscode/`, local `.env`/`.env.*` files, and OS metadata `.DS_Store`, `Thumbs.db`, `Desktop.ini`. Existing `.blockit/`, `.capture/` and `.sample-renders/` are compatibility-only local state, not destinations for new work. Local state must never be tracked or contain the only copy of a reference or authored asset.

Layout rules:

1. A new root entry requires a demonstrated repository-wide toolchain/governance need and a matching policy/test update. Feature, fixture, benchmark, archive, temporary and per-asset directories belong under their existing owner.
2. Each file has one canonical owner. MCP implementation/tests belong in `mcp/`; Desktop implementation/tests in `apps/desktop/`; installers/packages in `distribution/`. Working instructions use `.agents/` and `docs/`; authored outputs use `workspace/`.
3. Images, GIFs, videos, ZIPs and models never belong loose at root. Retain project references with their project; research inputs with their experiment. Never infer asset association from appearance alone.
4. New directories and ordinary retained artifact names use lowercase kebab-case and describe their role. Keep mandated toolchain names, language identifiers, Bedrock exports and explicitly documented compatibility identifiers intact. Avoid `misc`, `stuff`, download timestamps and `final-final` as permanent names.
5. Asset packages follow [workspace/README.md](workspace/README.md): project `README.md`, one current editable model, `references/`, `assets/`, `exports/` and disposable `.cache/` as needed. Do not create empty placeholder directories. Move active work to `saved/` only on explicit user instruction.
6. Cache is reproducible/disposable. Durable references, editable models and delivery exports stay with their owner. Generated artifacts follow their canonical generator and package build destination.
7. A move must preserve content and update affected imports, links, generators, installers and tests. Check existing destinations before moving; never overwrite user work or delete an unverified duplicate.
8. One concept has one canonical name. Compatibility aliases must be identified explicitly. Use `stage` for Geometry/Texturing/Animation semantics; legacy `phase` survives only where compatibility requires it.
9. New documentation extends the existing canonical domain. Git owns history; do not create parallel policy registries, archives or state systems.
10. Run `bun --cwd mcp run verify:repository` after layout changes. Its root contract checks files, directories and tracked local state, reports offending paths, and never moves or deletes them automatically.

`distribution/` may consume production artifacts; production Runtime/Gateway source must not depend on distribution. `experiments/` is non-authoritative research. Production source and active asset state must not depend on it.

## Development

LazyDesigner source/builds come from this repository; do not use an upstream hosted plugin as runtime authority for this repository. The canonical generated plugin bundle is `dist/lazydesigner_mcp.js`. Any retired BlockIT artifact is not a supported active installation fallback.

The repository root is the developer navigation facade; package-specific implementation commands remain owned by `mcp/package.json` and `apps/desktop/package.json`.

```bash
bun run check
bun run verify

bun run dev:mcp
bun run dev:desktop

bun run build:mcp
bun run build:desktop
```

For MCP-only work, the package-local commands remain available:

```bash
cd mcp
bun install --frozen-lockfile
bun run verify:full
```

Recommended local development sync:

```bash
bun run dev:sync
```

Build/watch without deployment:

```bash
bun run dev:watch
```

Manual development deployment to the canonical plugin filename remains explicit:

```bash
bun run deploy:local -- /absolute/path/to/lazydesigner_mcp.js
```

Normal AI-client use connects through Control and the Gateway. See `mcp/gateway/README.md`.

## Contributing

Repository development conventions, verification routing, commit discipline, and transient-file rules are documented in `CONTRIBUTING.md`.

## License

LazyDesigner is distributed under the GNU General Public License v3.0. See `LICENSE` for the full terms.