# LazyDesigner UI Design Standard — Official

**Status:** ADOPTED design contract for new and modified Desktop UI on branch `Local` (2026-11-09).  
**Owner:** `docs/01-product/interface-ux.md` remains the product-behavior authority; this file owns visual consistency and interaction presentation. Source code owns implemented behavior. This standard does **not** certify a native build.

## 1. Product principles (MUST)

1. **Work first.** Show the current model/project before secondary actions and technical information.
2. **One purpose, one primary location.** Do not duplicate brand, active-model context, status, or actions across the toolbar and sidebar. Secondary shortcuts may link to the same destination, but must not compete visually.
3. **Truthful controls.** Every visible enabled button must have a real, named effect. Never render nonfunctional actions as working controls, fabricate connected/ready states, or call a support link an automatic repair.
4. **Native Blockbench is the editor.** Desktop is a companion shell. Never simulate or reimplement the native viewport, model editor, texture/UV, or animation tools.
5. **Safe before convenient.** Never hide a needed native-window recovery control. Do not promote Rename/Delete Model until a safe Rust-backed workflow exists. A canceled picker is not success.
6. **Accessible by default.** Keyboard, focus, disabled state, contrast, tooltip alternatives, and reduced motion are part of the UI contract.
7. **Improve within the approved structure.** No speculative dashboards, redundant top bars, glass effects, novelty icons, or wholesale redesign without a user-approved product change.

## 2. Approved Unified Editor hierarchy

- **Top toolbar (minimal):** Workspace navigation, `Editor` title, Focus control (if retained), conditional Open Blockbench, conditional Restore window, Support. The toolbar MUST NOT repeat the LazyDesigner brand or the active project/model already shown in the sidebar.
- **Native center:** empty reservation for the real Blockbench window. Never draw a faux Blockbench viewport.
- **One right sidebar:** brand `LazyDesigner`, two tabs `Projects` and `Status`, content, concise status footer. Do not add a permanent minimize/collapse button to the sidebar header.
- **Projects tab order:** Active project/current model (including explicit empty state) → Open existing model → Recent Models → Project folders (New folder, Add existing folder, search, tree). Active project is the orientation anchor, not a second editor. Search may hide the active summary while filtering; do not lose the active state.
- **Status tab:** System and AI summary, Refresh, conditional support action, collapsed Details with diagnostics and a working route to AI activity. Never present last-observed telemetry as live.
- **AI activity:** dedicated existing Analytics page, accessible from Status and Support. Back returns to the actual originating page. No invented gateway counters.
- **Compact layout:** one right sidebar or reachable rail; preserve a usable native Blockbench region and explicit recovery. A focus mode must have an obvious exit.

## 3. Visual tokens (Desktop dark companion)

Align to the pinned upstream Blockbench dark theme where source permits; do not claim to follow a custom theme of a separate native process. Prefer existing CSS semantic tokens; do not duplicate hex literals across components.

| Token | Default target | Rule |
| --- | --- | --- |
| Sidebar width | 260 px preferred, adjustable 220–300 px | Never squeeze native editor below its safety minimum |
| Body text | 13 px | Never shrink important controls to 10 px |
| Section heading | 13–14 px, semibold | Sentence case; no ornamental all-caps except compact metadata |
| Supporting text | 11–12 px | Contrast and wrapping must remain readable |
| Model/folder row | 34–36 px minimum | Consistent padding and icon alignment |
| Primary/secondary button | 34–36 px height | Visible disabled and busy states |
| Small inline action | 30–32 px minimum | Ensure keyboard and pointer affordance |
| Icon | 16 px typical | Use existing `EditorChromeIcon` library |
| Spacing | 4 / 8 / 12 / 16 px | Consistent rhythm, avoid arbitrary offsets |
| Radius | 5–7 px | Flat surfaces, restrained borders |
| Focus | 2 px accent outline + offset | Never rely on hover only |
| Accent | Blockbench-compatible blue | Status colors reserved for verified states |

Treat these as **design targets**, not claims that all current source styles already conform. If an existing upstream control differs, preserve it until a targeted change is reviewed.

## 4. Component contracts

### Active Project
- Always occupies the top context position when Projects is unfiltered.
- Show project name and current model; if unassigned, say `Current model`; if none, say `No active model`.
- Model focus is enabled only when backed by a valid observed model and permitted action; unsaved marker means **last observed**, not a live guarantee.
- Long names truncate visually with accessible full name on hover/focus.

### Recent Models
- Maximum three initial entries; preserve meaningful project identity to distinguish duplicate filenames.
- Clicking an available model uses the existing native-safe open path; missing files cannot be presented as openable.
- Reuse one model-action pattern when applicable; do not show unfinished Rename/Delete controls.

### Project folders
- `New folder` creates only an empty directory; `Add existing folder` registers a shortcut; neither creates a `.bbmodel`.
- Validate Windows names before the picker and again in Rust. Protect case-insensitive collisions.
- Distinguish **created**, **canceled**, **failed**, and **created but list refresh unverified**. Prevent duplicate submissions; keep input after cancel; do not invite a second creation after an acknowledged first creation.
- Search uses a clear input, result count, no-results state, and keyboard Escape behavior.
- Folder/model tree uses consistent row height, indentation, active/hover/focus, and `···` actions.

### Status and AI
- Primary ready state label is `Ready`; observed time is available on hover **and keyboard focus**.
- Show `Checking`, `Needs attention`, `Unavailable`, or a truthful specific state when appropriate; never color an outdated snapshot as verified.
- `Refresh` performs a real status request in Desktop; fixture preview must explicitly identify simulated behavior.
- Help/support link appears only when relevant. `Open AI activity page` navigates to the actual Analytics page; no dead link.
- Advanced technical detail remains collapsed by default.

### Menus and navigation
- One open context menu at a time. Escape closes and returns focus to trigger; outside click closes; keyboard tab switching closes old menus.
- Buttons describe effects: `Open model`, `Show in Explorer`, `Choose location`, `Open AI activity page`.
- Destructive actions require explicit confirmation and a verified safe backend. Never substitute permanent deletion for Recycle Bin.
- Leaving a native-composed Editor must await a successful Rust-owned detach receipt. On uncertainty, keep the Editor mounted and expose recovery.

## 5. Required states and responsiveness

Every component that performs an operation MUST account for: default, hover, focus-visible, disabled, pending, success, cancellation, failure, missing/unavailable data, stale observation, and narrow layout (only where applicable). Use content-first wrapping and ellipsis; do not hide a needed error or recovery control.

The sidebar must not be the sole place to discover critical native recovery when collapsed. No tooltip-only action explanation; accessible labels must convey the effect. Avoid layout shifts when model/project data is temporarily absent.

## 6. UI change checklist — mandatory before source commit

- [ ] The user goal, owner, and affected screen are named.
- [ ] Hierarchy matches §2; no duplicate brand, context, or competing CTA.
- [ ] Typography, row alignment, spacing, icon size and focus use §3.
- [ ] Every enabled control maps to a real action; no dead preview-only promise.
- [ ] Empty, stale, loading, error, cancellation and success states are accounted for.
- [ ] Keyboard navigation, accessible name, focus return and reduced motion remain valid.
- [ ] Native Blockbench ownership, safe detach and recovery remain intact.
- [ ] No unauthorized new model creation, destructive action, or MCP/Gateway control.
- [ ] Diff is scoped; no broad theme redesign or deletion of runtime/test infrastructure.
- [ ] Report `SOURCE_AUTHORED`, `TESTS_NOT_EXECUTED`, and native status separately. Never label source inspection as Windows acceptance.

## 7. Preview and release evidence

Explicit previews use **HTML_SOURCE_PREVIEW** pinned to a real `Local` commit, derived from actual Svelte/CSS and a declared fixture. Keep native center empty. Preview interactions may simulate navigation but must not claim native operation. A packaging/release readiness claim requires separate executable/native evidence and the repository release rules; source consistency alone is not sufficient.

## 8. Change control

Any change to sidebar information hierarchy, primary navigation, native-window safety, or the meaning of readiness requires an explicit product decision recorded in `docs/01-product/interface-ux.md`. Small visual fixes should update the existing tokens/components rather than create new competing systems.
