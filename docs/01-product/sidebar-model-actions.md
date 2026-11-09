# Unified Sidebar — Model Actions and Safety Contract

**Scope:** LazyDesigner Desktop, right sidebar Projects/Status. **Branch authority:** `Local`. **State:** DESIGN_CONTRACT; Rename/Delete are NOT implemented. Native Blockbench remains the file-editing authority. No MCP/Gateway changes.

## Mental model

- **Recent Models** (first): shortcuts to previously observed files, not copies. An entry may disappear if the file is missing, and the list must not claim to be a complete file history.
- **Projects** (second): registered/pinned project folders and their observed models. A project shortcut is not a model file.
- **Status**: readiness, component/AI observations, and troubleshooting; never a fake activity log.
- **Open model…**: explicit native file picker. Clicking an available model opens it, or focuses it when it is the verified active model.
- **Show in Explorer**: locate the file without modifying it.
- **Rename model… / Move to Recycle Bin…**: future operations only after safe backend contract and UI review. Never expose as live buttons before implementation.

## Operation matrix

| Context | Open/Focus | Show in Explorer | Rename | Move to Recycle Bin |
| --- | --- | --- | --- | --- |
| Existing, closed, verified .bbmodel | Allow after existing native restoration gate | Allow | Future: after revalidation | Future: after confirmation |
| Active or open in Blockbench | Focus/open | Allow | Block pending safe close/save coordination | Block pending safe close/save coordination |
| Dirty or unknown dirty state | Existing native open workflow only | Allow | Block | Block |
| Missing file | Disabled with recovery explanation | Only if parent folder is verified and action supported | Block | Block |
| Stale/unverified navigation snapshot | Revalidate in Rust; do not infer file state | Revalidate | Block | Block |
| Directory, symlink, unsupported extension | Not a model target | No file mutation | Block | Block |

## Rename contract (future implementation)

1. Resolve opaque model ID in Rust from a fresh, profile-bound navigation observation; never accept a raw UI path as authority.
2. Require a regular existing `.bbmodel` file inside the expected project scope; reject symlinks, directories, path escapes and stale IDs.
3. Reject empty names, separators, reserved Windows names, trailing dots/spaces, control characters, and collisions under case-insensitive Windows rules. Preserve `.bbmodel` extension.
4. If model is open/active/dirty or state cannot be verified, do not rename; ask the user to save and close it in Blockbench first. Never auto-save or force-close.
5. Use a no-overwrite filesystem operation; fail closed on races, permission errors, cross-device or conflicting destination. Do not promise atomicity without platform proof.
6. Refresh authoritative project/recent observations after success. Report the actual new name; if refresh fails, show stale state instead of fabricating success.
7. No undo claim until a reversible mechanism exists.

## Delete contract (future implementation)

1. Label the action **Move to Recycle Bin…**, not ambiguous `Delete`, when recycle semantics are available.
2. Show a confirmation with exact model filename, parent project, and whether the action removes a real file rather than a shortcut.
3. Block active/open/dirty/unverified targets. Require a second revalidation immediately before mutation.
4. Use a supported OS recycle operation; if unavailable, fail without silently falling back to permanent deletion.
5. On success, refresh project and recent projections. Do not remove a row optimistically before backend acknowledgement.
6. On partial failure, preserve error details for Support and do not claim success.

## Other blind spots / acceptance

- **Duplicate names:** show project context in search/recent results; use opaque IDs, never a filename alone, for actions.
- **Recent list:** preserve Blockbench's observed order, deduplicate by model ID, omit missing/unavailable entries, and distinguish recent from active.
- **Menus:** only one project/model menu at a time; outside click and Escape close; keyboard focus returns to its trigger; touch users can discover the menu.
- **Unsaved:** a dirty dot is an observation, not a guarantee of current state. Never suppress native save prompts.
- **Errors:** separate missing, permission denied, stale observation, busy native window, and unsupported action.
- **Empty projects:** provide Open model… and Add existing project folder; do not fabricate a project.
- **Accessibility:** labels describe actual actions; no destructive keyboard shortcut without confirmation.
- **Visual scope:** right sidebar only, Projects/Status, readable tree, no duplicated toolbar commands, no fake native viewport.

## Evidence and implementation boundary

Existing `apps/desktop/src/projectNavigationTypes.ts` exposes `open-project-folder`, `open-folder`, `reveal-model`, `pin-project`, `unpin-project`, `remove-project-folder`, `restore-project-preferences`; **it does not expose model rename or deletion**. Existing Rust project-folder recycle support is not proof of model-file recycle support.

Acceptance requires a separate Rust-backed operation contract, UI confirmation, source-level regression cases, and later real Windows verification. Until then the sidebar must not present Rename/Delete as operational. Tests: NOT_EXECUTED; native behavior: UNVERIFIED.
