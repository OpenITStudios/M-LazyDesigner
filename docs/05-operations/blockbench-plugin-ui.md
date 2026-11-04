# LazyDesigner Blockbench Plugin UI — product-value gate

Source authority: current `Local` implementation in `mcp/ui/panel.html` and `mcp/ui/index.ts`. This specifies **source-authored UI**, not verified installed-plugin behavior.

## Product rule: no nonproductive UI

The normal AI workflow uses the existing four-tool Gateway and canonical Runtime capabilities directly. The user only needs the native editor panel when it improves a specific **human decision or action**. The plugin shall not recreate Blockbench's Texture list, palette controls, Animation clip list or Timeline as trivial copies.

The docked human panel presents Runtime status, current project and actionable **Geometry checks** only. No empty Texture or Animation tabs are rendered; those native editing tasks remain in Blockbench while AI invokes the existing Gateway capabilities. Geometry/Texturing/Animation remain semantic authoring Stages, **not** human-panel navigation tabs. No second Gateway, route registry, progress engine, polling loop or screenshot-as-QA.

## Shipped-source scope in this slice

| Area | Visible feature | Input | Output / real outcome | Proof ceiling |
| --- | --- | --- | --- | --- |
| Geometry | **Geometry Change Review** | Current Bedrock Project + latest applied native Undo edit | Read actual `before.elements` and `post.elements` snapshots, compare Cube transforms/face mapping, report exact changed Cube UUIDs; **Locate Cube** selects the corresponding native object | Source-authored; installed native Undo data and selection unverified |
| Geometry | **Geometry Issue Navigator** | Current Bedrock Project + native Cube and Group inventories | Canonical geometry diagnostic findings tied to exact Cube/Group UUIDs; one-click **Locate in Outliner** selects the native object and scrolls it into view | Source-authored; installed native navigation unverified |
| Geometry | **Safe Cube Cleanup** (secondary utility) | 1–32 selected Cubes, selected increment/field | Existing `manage_cubes(operation=simplify)` dry-run, UV and hierarchy review, native Apply and Undo | Existing executable path; exact installed Undo/visual preservation unverified |
| Texture | No duplicate editor feature | — | AI continues using the current Texturing MCP surface; Blockbench owns native texture editor | Not a new feature |
| Animation | No duplicate editor feature | — | AI continues using existing Animation MCP surface; Blockbench owns native timeline | Not a new feature |

The previous `Texture Inventory`, `Preview Palette` and `Animation Inventory` buttons were removed from the human panel because they did not edit assets or improve a review decision, and duplicated native editor information. **The underlying MCP capabilities were not removed.**

## Geometry Change Review — an AI-first human review, not a new editor

- This is a **post-edit** inspection of the *latest applied native Blockbench Undo entry*; it does **not** invent an AI proposal, show a pre-Apply approval gate, or distinguish AI changes from manual changes.
- `mcp/ui/geometryChangeReview.ts` reads only `Undo.history` snapshots; native `UndoEntry.before.elements` and `UndoEntry.post.elements` are the source of before/after truth. It never calls `Undo.initEdit`, mutates a Cube, or creates an undo entry.
- Skip selection-only history entries; **do not** skip a later Texture/Animation edit to present an old Geometry edit as current. If the most recent authored edit has no Cube snapshots, disclose this rather than fabricate a result.
- Compare named supported fields: `name`, `from`, `to`, `origin`, `rotation`, `inflate`, `box_uv`, `uv_offset`, `mirror_uv`, `autouv`, `visibility`, and bounded per-face UV/material mapping. Compare only finite/valid fields present in both snapshots; missing data is not a proven change.
- Show at most 8 changed Cubes, but report the exact changed count. The review can inspect up to 2500 saved Cube snapshots and otherwise fails explicitly. Added and removed Cubes have distinct labels; removed Cubes cannot be located.
- `Locate Cube` verifies plugin generation, exact Project object, current Undo revision identity and exact Cube UUID using the existing native `select()` + `showInOutliner()` navigator. The existing Runtime-native queue serializes this against AI operations. Native selection can change; authored state cannot.
- Any new edit/Undo/Redo/project switch/hot reload invalidates the review. Selecting a Cube does not invalidate it. The UI does not offer a duplicate Undo action or false AI-completion progress.
- This is a **supervision and location feature**, not Geometry repair. A true pre-Apply AI-proposed correction still needs an explicit, canonical proposal-to-UI transport and native acceptance; do not label this review as a functioning approval workflow.

## Measurable value requirement

On a disposable asset with at least 100 Cubes, run the same AI geometry edit and compare time/clicks required to identify and inspect the changed Cube(s) using native history/outliner alone versus Geometry Change Review. Require correct UUID targeting, exact before/after values, zero authored mutations/Undo entries during review, and a demonstrable improvement in inspection speed. If no measurable benefit, remove the feature rather than adding decorative status panels.

## Canonical Geometry evidence and issue contract

- Reuse `geometryHygieneRuntime()` and `rigGraphRuntime()` as-is; these already wrap `analyzeGeometryHygiene` and `analyzeRigGraph`.
- Only present **targeted** findings from real `degenerate_cubes.examples`, `duplicate_bone_names.examples[].groups`, and `box_uv_subunit.examples`. Every issue contains the actual native UUID, type, name and a cautious description.
- Intentionally omit tiny precision drifts from the primary findings list; keep them in optional counts. Avoid treating zero-thickness design panels or coincident pivots as automatic defects.
- Limit visible findings, disclose truncated examples, and never infer visual PASS from a clean bounded scan.
- Locate revalidates the project/generation and current UUID-backed issue under the shared `runRuntimeOperationExclusive` queue. Reject stale, missing and duplicate UUIDs. Use the native `select()` and `showInOutliner()`, not duplicate selection or viewport code.
- Selecting a finding should **not clear the issue list**. Geometry edits, project changes, Undo, Redo and plugin reload invalidate the analysis. No model mutation or Undo entry is created by locating an object.
- This does not claim the AI's previous job finished successfully; no inferred AI receipt, status or fake progress.

## Existing Safe Cube Cleanup invariants

- Before Apply, recheck project/format, Geometry Stage, exact selected UUIDs, parent/UV/transform state and fresh canonical dry-run result.
- Reject incomplete UV inventory, mapped painted-face stretch, Box UV template risk, stale plan, concurrent native edit, retired generation and duplicate Apply.
- Apply only via the canonical `manage_cubes` native executor under the shared Runtime operation queue. Never replay an ambiguous mutation.
- A successful source-level receipt is **not** a visual reference-accuracy PASS.

## Acceptance criteria: minimum for any "useful tool" claim

1. **Change review:** Construct a disposable Bedrock asset with one real Cube transform edit, one rename, one UV edit, one deleted Cube, and one Texture-only edit. Review shows actual native before/after snapshots, names the latest edit without inferring AI origin, and never guesses missing data. Selection-only Undo entries are ignored; later non-Geometry edits must not surface an outdated Geometry edit.
2. **Fixture / locator:** Construct disposable Bedrock asset with two degenerate Cubes, distinct duplicate-named Groups and a sub-unit Box UV Cube. Every exposed finding is anchored to the exact UUID; clicking **Locate in Outliner** selects and reveals the correct native node, not the first name match.
3. **No mutation by inspection:** Inspecting and locating must not change transforms, UVs, animation curves, textures, dirty state or Undo history; editor selection changes are intentional and visible.
4. **Context isolation:** Switching project, editing the source Cube, deleting/replacing an UUID, or plugin reload invalidates stale findings. Queue a simultaneous AI edit and user locate; they must serialize without stale replay.
5. **Review honesty:** Limit and truncation are disclosed; no visual or export acceptance is inferred from technical checks.
6. **Cleanup:** Preview has no Undo; explicit Apply has one Undo unit and correct Redo. Block mapped-texture/Box UV hazards; re-open/save preserves the asset.
7. **Normal UX:** Docked panel, Geometry actions and disclosures are keyboard-operable; no empty tabs, redundant palette/clip lists, abandoned dialogs/actions after reload, or raw MCP schemas in the human panel.
8. **Value benchmark (not yet run):** Measure time and clicks to find an exact problem Cube in a 100+ Cube asset with and without the Issue Navigator. Keep the feature only if it demonstrates an objective gain without mistaken targets.

## Verification state / boundary

- `REMOTE_GITHUB`: source inspection, Git object verification and authored regression tests **only**.
- `LOCAL_CODE`: `bun test tests/plugin-geometry-change-review.test.ts tests/plugin-authoring-ui.test.ts tests/human-ui-surface.test.ts tests/plugin-surface-hardening.test.ts tests/cube-simplify.test.ts`, then `bun run typecheck` and build.
- `LIVE_BLOCKBENCH`: installed plugin and 5.2.x native selection, Undo/Redo, save/reopen, concurrent AI Runtime, visual/persistence acceptance.
- Until those checks complete, do not label the plugin **tested**, the issue navigator **working in native Blockbench**, or any model **visually approved**.
- Existing CI is disabled by policy; do not enable or create workflows or publish releases to manufacture verification.

## Source references

- `mcp/ui/geometryChangeReview.ts`: read-only, native Undo-backed per-Cube change review.
- `mcp/ui/authoringTools.ts`: canonical issue review and native target navigation.
- `mcp/ui/index.ts`, `mcp/ui/panel.html`, `mcp/ui/panel.css`: panel and event/selection lifecycle.
- `mcp/ui/geometryCleanupDialog.ts`, `mcp/server/tools/geometry/cubes.ts`: existing bounded native cleanup.
- `mcp/lib/geometry/quality.ts`, `mcp/lib/geometry/modelQuality.ts`: canonical analyzers.
- `mcp/lib/runtime/lifecycle.ts`: shared queue.
- Official plugin guide: https://blockbench.net/wiki/docs/plugin/
- Official native API: https://web.blockbench.net/docs/
