# LazyDesigner

LazyDesigner is an AI-assisted **Minecraft Bedrock Entity** authoring workspace with two independent development paths: a standalone Rust-first authoring editor on `Rust`, and the existing Blockbench-hosted Gateway/Runtime on `Local`. The Rust engine owns the model, transactions, validation and export; Svelte/Three.js provide presentation and Deno Code Mode composes authorized Rust operations. This does **not** imply that the Rust editor is installed, tested, or replacing the `Local` runtime.

**Former project name:** BlockIT. New source/build, managed installer, plugin and Gateway identities are canonical LazyDesigner; old BlockIT machine state is detected only for safe explicit migration and is never selected as the active Runtime.

**Project snapshot:** `v0.1` (separate from the MCP package version).

## Branch Model

```text
Local  → existing Blockbench-hosted development line
Rust   → standalone Rust editor (Edit/Paint/Animate source; native QA pending)
main   → stable / release authority; changes only by explicit promotion
```

Legacy Blockbench-hosted development uses `Local`; the standalone Rust-native editor is developed on `Rust` under its own branch-local profile and [Phase 0 contract](docs/04-system/rust-native-editor-plan.md). The 2026-11-15 priority is **Geometry → Texturing → Animation**, UI/UX last; editable export to Blockbench, not pixel-identical UI or unrestricted reverse imports, is the product gate. The [Code Mode migration](docs/04-system/code-mode-migration.md) is now the user-selected **Rust AI interface target**, using host-run JS/TS and the existing Rust CLI; legacy MCP remains separately preserved. The Rust branch contains source-authored Rust Core, direct CLI, and Tauri/Svelte Edit, Paint and Animate slices; none is an installed or native-accepted replacement. The established Blockbench-hosted product remains separately on `Local`. Repository behavior is routed by `AGENTS.md`; GitHub execution/history/CI rules are owned by `GITHUB_RULES.md`.

For a new ChatGPT repository chat, provide the selected `Local` or `Rust` URL and intended task. ChatGPT follows current root rules, works GitHub/cloud-first without requiring the user's PC, and treats `amati` as read-only. Continuity comes from current source and relevant work commits, not chat titles.

## Rust source map — start here

Work on the `Rust` branch uses one Rust authoring engine, not the legacy
Blockbench plugin. The [canonical source-owner map](docs/04-system/implementation-map.md#rust-source-ownership-and-entrypoints)
is the first lookup when choosing which module to change.

| Task | Start with | Responsibility |
| --- | --- | --- |
| Rust model/transactions | [`authoring/mod.rs`](apps/desktop/src-tauri/src/authoring/mod.rs) | `AuthoringDocument`, `EditorSession`, typed `EditOperation`, Undo/Redo |
| Geometri / Rig / UV | [`authoring/geometry.rs`](apps/desktop/src-tauri/src/authoring/geometry.rs) + [`subtree.rs`](apps/desktop/src-tauri/src/authoring/subtree.rs) | Geometry/Bedrock export and Bone hierarchy helpers; shared mutation definitions remain in `mod.rs` |
| Texture / Paint | [`authoring/paint.rs`](apps/desktop/src-tauri/src/authoring/paint.rs) + [`face_regions.rs`](apps/desktop/src-tauri/src/authoring/face_regions.rs) | Rust-owned RGBA8 pixel edits and UV-bound patch admission |
| Animasi | [`authoring/animation_export.rs`](apps/desktop/src-tauri/src/authoring/animation_export.rs) + [`animation_clip.rs`](apps/desktop/src-tauri/src/authoring/animation_clip.rs) | Supported animation data, curves and Bedrock resource export |
| Export/interop/quality | [`bbmodel.rs`](apps/desktop/src-tauri/src/authoring/bbmodel.rs) + [`asset_handoff.rs`](apps/desktop/src-tauri/src/authoring/asset_handoff.rs) | Editable .bbmodel and cross-domain source checks |
| Desktop UI | [`RustEditorPage.svelte`](apps/desktop/src/RustEditorPage.svelte) + [`RustViewport.svelte`](apps/desktop/src/RustViewport.svelte) | Read-only projections and user input requests; never a second model |
| AI Code Mode | [`code-mode/`](apps/desktop/code-mode/README.md) | Deno guest → trusted Node host → Rust CLI; separate saved-file session |

To understand allowed dependencies, read
[module boundaries](docs/04-system/module-boundaries.md). For actual
interoperability targets and held evidence, read
[the Rust architecture contract](docs/04-system/rust-native-editor-plan.md).
`mcp/`, the old Desktop machine-control route and existing 12 project
Skills are retained; they are **not** proof of an active Rust runtime.

## Rust-native Code Mode development surface

The selected Rust branch now contains source-authored code for a primary
programmatic AI entrypoint: one model-facing Code Mode tool, a local
Deno permission-denied JavaScript guest, a trusted Node host with explicit
write approval, and the existing canonical Rust authoring CLI.
This is an independently developed source path; it does not replace the
installed Local Blockbench Gateway, require cloud Workers, or prove a native
runtime. Start at
[Code Mode host setup](apps/desktop/code-mode/HOST_INTEGRATION.md) and
[Code Mode migration contract](docs/04-system/code-mode-migration.md).

**Rust operator flow (source contract, native unverified):** The user gives
prompts only to **Codex or another authorized external Agent App**. Its trusted
host runs Code Mode/Deno and the first-party Rust CLI against a specifically
selected, saved `.bbmodel`, with per-write permission and source-SHA checks.
The host publishes a **new sibling model**, not an automatic modification of
the model open in LazyDesigner. The human opens that candidate using the
existing **File → Open Model…** editor action, reviews it and saves/exports
only through Rust-owned operations. The editor contains **no AI prompt/chat,
agent executor or second authoring engine**. The optional native pairing is
read-only, feature-gated and not needed for ordinary saved-file work.
Neither file handoff nor a tool receipt implies visual acceptance.

## Existing Blockbench-hosted Product Flow (Local implementation baseline)
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


## Related Lazy-family handoff (source coordination only)

LazyDesigner owns Blockbench-authored **Minecraft Bedrock Entity** visual assets (`.bbmodel`), not a packaged behavior/add-on or playable world. The related public projects have separate responsibilities: [Lazy-Developer](https://github.com/OpenITStudios/M-Lazy-Developer/tree/Local) audits explicitly selected Bedrock/Education `.mcworld` artifacts, while [LazyTester](https://github.com/OpenITStudios/M-Minecraft-Emulator/tree/Local) manages independent Minecraft Education runtime profiles and optional native evidence.

A visual export becomes relevant to a gameplay audit **only after the authorized map owner has incorporated and packaged it** into the selected world. Carry the exact artifact SHA-256, relevant edition/version, repository source revision, owner authorization and evidence/proof tier with any reviewed handoff. An asset/viewport PASS, a map source finding, and a native Education observation are different results; none automatically certifies another.

These relationships do **not** install a shared Gateway, package assets, transfer worlds, connect to another repository, dispatch tests, or grant native access. Each project keeps its own domain Skills, AgentSkill profile, working branch and held validation gates.

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

The Gateway/catalog counts below describe the **legacy Blockbench-hosted `Local` implementation**, not the Rust CLI or Deno Code Mode surface. Live installations require separate runtime evidence.


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

The repository retains both the Rust-first editor and the legacy Blockbench-hosted implementation. Choose the branch and its canonical owner before reading or writing; a directory shared by both lines does not imply shared running state.

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