# Rust Desktop Authoring adapter — module ownership

**Entrypoint:** `../desktop_authoring.rs`. This module remains the only GUI-side
Tauri adapter for the canonical Rust `EditorSession`. It owns the active store,
epoch/revision admission, provisional edit publication, user file pickers,
saved-file exports, recovery entrypoints and registered Tauri commands.

**Derived views:** `snapshot_projection.rs`, `preview_animation.rs`, and
`preview_texture.rs` derive display-only state from an already admitted
Rust source. They cannot persist authoring state or grant user permissions.

**Temporary candidate verification:** `material_candidate_verification.rs`
rebuilds and checks provisional source-bound material candidates. Its helper
may mutate a disposable `EditorSession` *argument* but never publishes the
live store; the original Tauri edit command owns that boundary.

**Review capture admission:** `review_capture_validation.rs` validates a
bounded WebGL preview PNG and exact saved canonical `.bbmodel` source; it
does not certify visual quality, choose paths or write PNG files.

**Bedrock resource exports:** `bedrock_resource_exports.rs` implements the existing
native user-selected Geometry and Animation JSON export flows. It obtains
the same active-session revision checks and exclusive export lease,
rechecks on-disk source identity, and uses the original fresh-only Rust
storage publishers. The *Tauri commands and their public names* remain
registered in `../desktop_authoring.rs`; no guest authority or extra writer.

**Native regressions:** `tests.rs` contains existing Tauri and candidate /
capture tests. They are `TEST_AUTHORED_NOT_RUN` under the project hold.

Not here: Code Mode guest execution, a second model/Undo engine, silent
replacement of user files, native Blockbench visual-quality approval, or
another file publisher.
