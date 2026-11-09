# Project Folders — Desktop UX and File Ownership

**State:** DESIGN_CONTRACT; source UI already exposes Add existing folder. Creating a new on-disk folder is not yet implemented.

## Purpose
Projects organizes folders containing Blockbench model files. LazyDesigner Desktop may create or register a **folder**, but must never fabricate an empty `.bbmodel`, geometry, textures, or a Blockbench model document. New model generation remains an MCP AI / native Blockbench workflow.

## Hierarchy
1. Recent Models — recent file shortcuts, not a project container.
2. Project folders — each row is one actual folder; expand to reveal discovered models and existing asset subfolders.
3. Status — separate sidebar tab.

## User actions
- **Add existing folder…**: choose an existing folder; register its shortcut without copying files.
- **New project folder…** (future): choose a parent directory and provide a folder name; create exactly one directory; register it only after successful creation.
- **Open folder**: reveal project root in Explorer.
- **Pin/Unpin**: local ordering preference, not filesystem mutation.
- **Remove from Projects**: remove shortcut only; never delete folder contents.
- **Open existing model…**: native file picker; no model creation.
- **Create model with AI**: a separate MCP AI workflow, not an empty local file action.

## New-folder safety contract
- UI provides a folder name only; native folder picker supplies parent directory.
- Rust validates name again (Windows reserved names, path separators, empty/whitespace, trailing dots/spaces, control characters, length).
- Reject symbolic links/reparse points, unverified parent, existing target, inaccessible parent, or conflicting case-insensitive name.
- Create with non-overwriting directory creation; never recursively create unexpected parent paths.
- Register only the successfully created folder. If registration fails, report that the folder exists but is not registered; do not silently remove user files.
- Do not auto-create Models/References/Textures/Exports subdirectories. Show these when they actually exist; folder creation is a separate explicit future action.
- Avoid model creation buttons, fake .bbmodel placeholders, or AI-ready claims without actual MCP connection.

## Empty states
- No project folders: `Add existing folder` and future `New project folder` only.
- Empty folder: `This folder has no models yet.` Explain that models are created in Blockbench via the MCP AI workflow, not by clicking a file manager control.
- Missing folder: preserve shortcut, show unavailable state, allow removing shortcut or re-registering an existing folder.
- Name conflict or permissions error: show actual error; never claim success.

## Evidence
Source UI change is authored on Local; new folder creation, native behavior and regression execution remain NOT_EXECUTED / NOT_IMPLEMENTED as applicable.
