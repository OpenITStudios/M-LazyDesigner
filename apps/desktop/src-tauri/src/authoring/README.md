# Rust-native authoring core — Phase 1/2 source integration

This folder owns the **single authoritative Bedrock Entity Geometry/UV model** shared by the headless CLI and the Rust-branch Tauri/Svelte Edit UI. Cargo, WebView2, Windows and native Blockbench have NOT_EXECUTED status. The legacy Runtime, Gateway, Desktop source, Skills and all user assets remain preserved.

## Source owners

- `src/authoring/mod.rs` — typed authoritative Rust `AuthoringDocument`, pinned format-5.0 Bedrock codec, cube/group/outliner checks, bounded Geometry/UV/Rotation transactions, revision guards and in-memory Undo/Redo. Its validation rejects malformed rotation/UV-mode fields, performs bounded native Auto UV 1/2 Move and single-edge Resize mapping, and recalculates Box UV offsets/faces on single-edge Resize.
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

`new --output <fresh.bbmodel> --name <name> --model-identifier <identifier>` creates an empty Bedrock project entirely in Rust. `apply` supports `add_bone`, `add_cube`, `translate_cube`, `set_cube_bounds`, `set_cube_rotation` and `set_face_uv` as a bounded **atomic batch**. The edited example plan also requests a Cube rotation of 22.5° about Y using the exact same Rust engine as the GUI. Each CLI command returns machine-readable JSON; structured error codes do not echo potentially private project paths.

The in-process `EditorSession` revision starts at 0 when opening a file. The CLI also requires the exact source-file SHA-256 from `inspect` to refuse stale input. `apply` rechecks that source before publication, then writes only a **new sibling .bbmodel** in the same directory to retain relative texture references. The original source is never overwritten. Atomic publication uses a sync'd same-directory staging file and an exclusive hard-link; a file system lacking hard-link support fails closed. File-system race/Windows reparse-point safety remains subject to authorized native review; do not treat source intent as an executed security guarantee.

## Strict format scope

The admitted shape is `meta.model_format="bedrock"` with `meta.format_version="5.0"` from pinned Blockbench `v5.2.1`. This slice supports cubes, six face UV arrays, groups/bones, outliner identity, Cube rotation and read-only preservation of opaque texture/animation/controller/custom JSON fields. A new rotation is saved using Blockbench's optional `elements[].rotation` triplet, while an all-zero rotation omits the field as Blockbench does. Existing Bone rotations and Cube rotation metadata are validated before lossless JSON preservation. It **does not** interpret/edit texture pixels, play animation, support mesh/locator variants, implement Paint/Animate UI, or export Bedrock geometry/animation files yet. **UV mapping boundary:** The shared Rust engine remaps Auto UV modes 1/2 for Cube Move and unambiguous single-edge Resize; Box UV single-edge Resize updates its offset and derived face rectangles. The same behavior is available to CLI and Tauri via the existing edit operation, with UI controls no longer disabled for those supported transformations. Manual per-face UV editing in Auto UV now switches the Cube to manual UV in the same Rust transaction; Box UV still refuses per-face edits. Ambiguous multi-edge Resize, unsupported Auto UV face rotation and per-texture/multi-file UV rules still fail closed with stable error codes. Native Blockbench parity is not yet established. No arbitrary geometry editing or native Blockbench equivalence is implied. Unsupported elements/versions, inconsistent outliner references and invalid texture indexes are rejected rather than silently flattened.

The remaining proof is a **real editable Blockbench bidirectional round-trip** and actual Windows/Tauri/Svelte/Three.js acceptance. Source-authored Edit commands are integrated; Paint, Animate, texture rendering, OS-detached floating panels, advanced edit gestures and full Blockbench 1:1 UI remain NOT_IMPLEMENTED. The Rust GUI is not an installed or proven editor. Cargo, Windows, Blockbench, visual fidelity and token savings remain NOT_EXECUTED / UNVERIFIED under the current hold. See [Rust-native Editor Plan](../../../../../docs/04-system/rust-native-editor-plan.md).

Explicit imported `per_texture_uv_size: true` project/metadata flags now also block Auto UV Move/Resize remapping; Blockbench v5.2.1 can resolve per-face texture UV dimensions under that format capability. This is a conservative refusal, not implemented per-texture mapping or native format validation.

**Audited source correction (2026-11-14; NOT_EXECUTED):** New Bedrock Entity projects now use Blockbench 5.2.1's Box UV default; newly added Cubes get derived Box UV face rectangles in the Rust transaction. Explicit Face UV projects retain manual face editing. Unknown non-string `multi_file_ruleset` values now refuse Auto UV remapping. Position, Size, Rotation and UV inspector inputs use the shared finite decimal parser in `src/rustNumericInput.ts` with authored-only `src/rustNumericInput.test.mjs`. Native `.bbmodel` two-way acceptance remains UNVERIFIED.

**Box UV Inspector (source-only):** The existing Tauri/CLI `apply` supports `set_box_uv_offset` with exact finite integer atlas U/V offsets for a Box UV Cube. The Rust transaction updates derived face rectangles and history atomically. The Svelte Inspector exposes these two fields only in Box UV mode. Per-face Box UV edits and native drag/clamp parity remain unsupported; source regressions are NOT_EXECUTED.

**Synthetic texture-bearing fixture (SOURCE_ONLY, NOT_EXECUTED):** `fixtures/bedrock-texture-interchange.bbmodel` exercises format-5.0 texture asset metadata, an embedded data-URL placeholder (not a valid PNG), an external relative texture path, indexed/null Cube face references, nested bone hierarchy, Animation and opaque extensions. `src/authoring/tests.rs` asserts loss prevention through Rust Edit and export/reimport. This does not establish native Blockbench reopen/edit acceptance or textured rendering. Do not use the placeholder image as paint/viewport proof.

**Read-only embedded PNG projection (SOURCE_ONLY):** `desktop_authoring.rs` exposes only bounded `data:image/png;base64` candidates from the Rust document. Per-texture/multi-file UV resolutions, external file/network paths and unsupported wrap modes are not projected. `RustViewport.svelte` derives per-face UV for unrotated faces and uses temporary Three.js textures. Rust remains the only document owner; browser PNG decoding, animated/rotated/wrapped UV fidelity and real Blockbench compatibility remain UNVERIFIED.
