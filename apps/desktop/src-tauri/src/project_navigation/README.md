# Project Navigation — Rust source owners

**Status:** source architecture for the `Rust` branch; Cargo and Windows checks remain `NOT_EXECUTED`.

- **Entrypoint — `../project_navigation.rs`:** the public Desktop navigation projection and commands, source snapshot/model discovery, registered-folder authorization, and one set of Project/navigation data structures.
- **Canonical manifest identity — `project_manifest_identity.rs`:** source-derived manifest names, stable IDs, collision handling, project root inference, and existing test-only compare-and-replace manifest helpers. It cannot independently delete models or authorize navigation.
- **Canonical saved preferences — `saved_project_preferences.rs`:** bounded local pinned/registered folder preferences, metadata compare-and-replace and recovery. It is not the asset publisher.
- **Tests — `tests.rs`:** existing Rust Project Navigation regressions, under the active hold.

Never add a second Project database, read native models to generate manifest identities, or bypass explicit registered-folder restrictions. For related Tauri operations see `../lib.rs`; for metadata integrity see `../metadata_io.rs`.
