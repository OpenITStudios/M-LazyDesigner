# Rust-native authoring core — Phase 1/2 source integration

This folder owns the **single authoritative Bedrock Entity Geometry/UV model** shared by the headless CLI and the Rust-branch Tauri/Svelte Edit UI. Cargo, WebView2, Windows and native Blockbench have NOT_EXECUTED status. The legacy Runtime, Gateway, Desktop source, Skills and all user assets remain preserved.

## Source owners

- `src/authoring/mod.rs` — typed authoritative Rust `AuthoringDocument`, pinned format-5.0 Bedrock codec, cube/group/outliner checks, bounded geometry/UV batch transactions, revision guards and in-memory Undo/Redo.
- `src/authoring/bbmodel.rs` — isolated Blockbench v5.2.1 wire codec; the internal Rust model does not use the wire object's field names.
- `src/authoring/storage.rs` — shared bounded project I/O and non-overwriting output publication for CLI and Tauri.
- `src/lib.rs` — shared Rust library entrypoint for CLI and GUI.
- `src/bin/lazydesigner-authoring.rs` — headless CLI (`new`, `inspect`, `apply`) using the same engine.
- `src/desktop_authoring.rs` — Rust-owned Tauri editor session, explicit native file pickers and read-only UI projection.
- `apps/desktop/src/RustEditorPage.svelte` — Edit mode operations (New/Open/Save Copy, Add Cube, Outliner, Position/Size/UV, Undo/Redo).
- `apps/desktop/src/RustViewport.svelte` — Three.js derived untextured Geometry, selection, orbit/pan/zoom and framing.
- `fixtures/bedrock-basic.bbmodel` — **synthetic** one-bone/one-cube data for authored regression intent, not native compatibility proof.
- `src/authoring/tests.rs` — Rust source regressions, AUTHORED_NOT_EXECUTED.

## Future authorized PC-local usage (NOT_EXECUTED)

From `apps/desktop/src-tauri`:

~~~text
cargo run --bin lazydesigner-authoring -- inspect --input fixtures/bedrock-basic.bbmodel

cargo run --bin lazydesigner-authoring -- apply \
  --input fixtures/bedrock-basic.bbmodel \
  --output fixtures/bedrock-basic-edited.bbmodel \
  --expected-sha256 <inspect result SHA-256> \
  --plan fixtures/edit-cube.plan.json
~~~

Example plan for the **synthetic** cube:

~~~json
{
  "expected_revision": 0,
  "operations": [
    {
      "op": "translate_cube",
      "uuid": "00000000-0000-4000-8000-000000000002",
      "delta": [1, 0, 0]
    },
    {
      "op": "set_face_uv",
      "uuid": "00000000-0000-4000-8000-000000000002",
      "face": "north",
      "uv": [1, 1, 5, 5]
    }
  ]
}
~~~

`new --output <fresh.bbmodel> --name <name> --model-identifier <identifier>` creates an empty Bedrock project entirely in Rust. `apply` supports `add_bone`, `add_cube`, `translate_cube`, `set_cube_bounds` and `set_face_uv` as a bounded **atomic batch**. Each CLI command returns machine-readable JSON; structured error codes do not echo potentially private project paths.

The in-process `EditorSession` revision starts at 0 when opening a file. The CLI also requires the exact source-file SHA-256 from `inspect` to refuse stale input. `apply` rechecks that source before publication, then writes only a **new sibling .bbmodel** in the same directory to retain relative texture references. The original source is never overwritten. Atomic publication uses a sync'd same-directory staging file and an exclusive hard-link; a file system lacking hard-link support fails closed. File-system race/Windows reparse-point safety remains subject to authorized native review; do not treat source intent as an executed security guarantee.

## Strict format scope

The admitted shape is `meta.model_format="bedrock"` with `meta.format_version="5.0"` from pinned Blockbench `v5.2.1`. This slice supports cubes, six face UV arrays, groups/bones, outliner identity and read-only preservation of opaque texture/animation/controller/custom JSON fields. It **does not** interpret/edit texture pixels, play animation, support mesh/locator variants, implement Paint/Animate UI, or export Bedrock geometry/animation files yet. Unsupported elements/versions, inconsistent outliner references and invalid texture indexes are rejected rather than silently flattened.

The remaining proof is a **real editable Blockbench bidirectional round-trip** and actual Windows/Tauri/Svelte/Three.js acceptance. Source-authored Edit commands are integrated; Paint, Animate, texture rendering, floating panels, advanced edit gestures and full Blockbench 1:1 UI remain NOT_IMPLEMENTED. The Rust GUI is not an installed or proven editor. Cargo, Windows, Blockbench, visual fidelity and token savings remain NOT_EXECUTED / UNVERIFIED under the current hold. See [Rust-native Editor Plan](../../../../../docs/04-system/rust-native-editor-plan.md).
