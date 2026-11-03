# LazyDesigner Blockbench Plugin UI — AI-first editor surface

Source baseline for this first vertical slice: `Local` at `5a0941ce800c7676b599059165b3ba041f6612a6`. This is source implementation, **not installed/live acceptance**. The source-only design follows the Blockbench plugin API (Panel, Action, Dialog, Undo); the exact Blockbench 5.2.2 behavior requires native verification.

## Product intent

AI continues to call the existing four-tool MCP Gateway and its capability schemas; AI **does not** click the plugin. A Blockbench artist needs only three human-facing categories: **Geometry, Texture, Animation**. Selecting a category is UI navigation; it MUST NOT change Control Stage, expose hidden capabilities, publish stage receipts, or claim AI-client connection.

Keep the plugin in the existing right-docked Panel, with one optional Tools menu shortcut. Match Blockbench theme variables, keyboard-focus behavior and the native editor. No overlay, separate framework, new HTTP endpoint, duplicate Gateway, or new persistence manager.

## First functional slice

| Category | User controls | Canonical owner and proof ceiling |
| --- | --- | --- |
| Geometry | Inspect Model | Existing `geometryHygieneRuntime` and `rigGraphRuntime` native readers; bounded technical warnings, NOT visual PASS |
| Geometry | Safe Cube Cleanup | Existing `manage_cubes(operation=simplify)`: 1–32 explicitly selected UUIDs, review via `dry_run=true`, fresh state/plan check, then canonical `dry_run=false` executor and one native Undo |
| Texture | Inspect Textures | Native texture count/material groups/logical atlas dimensions/names only; NOT a seam/pixel-quality judgement |
| Texture | Preview Palette | Existing pure `generateTexturePalette` (7 shades, `mode=preview`); must never mutate palette or bitmap |
| Animation | Inspect Animations | Native clip/controller count and selected identity only; NOT motion QA or playback acceptance |

The new panel does not expose raw MCP capability JSON, server endpoints, debug schema forms, or controls for unregistered UV/cluster/advanced Motion sources. This is a deliberate source-verified first slice; Texture and Animation authoring/repair tools remain follow-on work after equivalent native planning and Undo acceptance.

## Concurrency and target safety

- Shared `runRuntimeOperationExclusive` serializes manual inspections/edits with AI/Gateway Runtime mutations. Do not call an executor outside the native queue.
- Before Cube review and Apply: recheck plugin generation, exact project object, Bedrock format, Geometry Stage, registered/enabled capability, selected UUID order, all Cube transform/UV fields, and the dry-run plan.
- If selection/project/state changes, reject the stale proposal. Do not retry a mutation with unknown outcome.
- Existing native executor retains mapping, span, UV ownership and texture-stretch protection. A warning/plan alone does not authorize edit.
- Unload/reload removes dialogs, listeners, status indicator, panel and Tools Action; a pending callback must not re-open UI for a retired generation.
- The panel may be used while the AI client is disconnected; it must not claim Gateway connected from the Runtime status indicator.

## Source-level QA hardening (2026-11-03)

- Dialogs have a unique review generation: reopening or cancelling retires stale pending preview/apply callbacks; double-Apply is refused.
- Cleanup review binds the project UUID/format and UV resolution, selected Cube transforms/faces and parent Group transform chain. A second serialized dry-run and native-state comparison occur before Apply.
- A missing/incomplete fidelity receipt fails closed. Painted-face mapping, incomplete face inventories and Box UV template changes are not auto-applied from the UI.
- The panel discards queued inspection results after project/selection/category/plugin changes; edit, Undo and Redo events invalidate previous displayed diagnostics.
- The three tabs use roving arrow-key focus; one Tools menu Action uses the supported MenuBar API. UI teardown releases resources independently so one failed optional cleanup cannot prevent the rest.

These controls are authored and receive focused source regressions. **Bun/typecheck/native UI execution is still NOT EXECUTED**, including whether the installed Blockbench matches the typed API and the actual Undo, save/reopen and visual results.

## Native acceptance (NOT EXECUTED from GitHub-only context)

Use a disposable Bedrock `.bbmodel` matching installed plugin build + Blockbench version. Required falsifiable checks:

1. Load/unload/reload twice; exactly one Panel, status button and Tools action; no stale listeners/dialogs.
2. Geometry/Texture/Animation tabs switch without a network request or Stage change. Check keyboard operation and right-sidebar narrow width.
3. Empty project and non-Bedrock format fail clearly; no mutation. Verify no false AI-client connected status.
4. Geometry Analyze produces bounded live Cube/Group counts; malformed/unavailable inventory yields an error rather than fake PASS.
5. Cube selection (1/32/33), no-op rounding, collapsing spans, rotated Cube, ambiguous/duplicate UUID, texture stretching and missing UV ownership.
6. Preview must leave Cube/UV/palette, Undo history and dirty state identical.
7. Change selection, source Cube/UV or project tab while Review is open: Apply fails before Undo.
8. Competing AI request and UI Apply serialize. Unknown/failed native mutation never auto-retries.
9. Successful Apply: exact coordinates, one Undo, Redo, save/reopen, no unintended atlas or animation change.
10. Texture palette preview changes no bitmap; Animation inventory changes no keyframes, playback, selected clip or Timeline.time.

Source and test definitions do **not** prove the above. Bun/typecheck/build/installed Blockbench, live visual QA, native Undo/save/export remain **NOT EXECUTED** with verification CI disabled. Do not publish a release based on source inspection.

## Research authority

- Official plugin guide: https://blockbench.net/wiki/docs/plugin/
- Typed API reference: https://web.blockbench.net/docs/
- Native version adoption: `docs/05-operations/blockbench-5.2-native-adoption.md`
- Existing UI lifecycle: `mcp/ui/index.ts`, `mcp/plugin/blockbenchIntegration.ts`
- Existing runtime queue and cleanup: `mcp/lib/runtime/lifecycle.ts`
- Existing native Cube safety: `mcp/server/tools/geometry/cubes.ts`
