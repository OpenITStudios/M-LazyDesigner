# Desktop UI Layout and Alignment Contract — Cross-Panel Geometry

**Status:** ADOPTED source-level guideline; native visual acceptance remains NOT_EXECUTED.
**Scope:** LazyDesigner Desktop surfaces and transferable principles for other OpenITStudios desktop applications. Product-specific layout authority remains in each repository.
**Source baseline:** M-LazyDesigner `Local` commit `c1d493e033312ec71ca92f45c4c47cadad999310` (2026-11-09).
**Owners:** [UI Design Standard](ui-design-standard.md), [UI Engineering Standard](ui-engineering-standard.md), [Icon & SVG Registry](icon-svg-registry.md), [Human Interface Contract](interface-ux.md). This document adds testable layout geometry rules, not a new theme or component owner.

## 1. Fundamental alignment rule

**Align by one parent geometry and shared variables, not visually similar magic numbers.** Related regions that meet across a seam (sidebar footer vs content action dock, toolbar vs panel header, nested split panes) MUST derive their boundary from a common layout track or semantic height token.

- Use a single grid/flex shell for the visual frame. Avoid independent `position: fixed` or `absolute` offsets for two sections meant to share an edge.
- Shared footer/dock boundary MUST be one baseline in the same containing block, or both heights MUST reference the same semantic token. Example: `--app-bottom-dock-height`.
- Borders on adjacent columns use one agreed 1px token (`--ui-divider-width`) and one color token (`--ui-divider-color`). The two segments must share an identical Y coordinate and optical thickness at supported scaling.
- Own each seam once when possible; do not stack two adjacent 1px borders and accidentally produce a 2px/darker seam.
- Layout tracks must account for `box-sizing: border-box`, scrollbars, scaling, safe area and internal padding; content may scroll but shell tracks MUST NOT drift.
- The app frame controls header and footer alignment; individual panels own only their contents. A child popup MUST NOT change the measured height of the parent bottom dock.

**Illustrative CSS, not a mandate to retrofit legacy implementation:**

```css
.app-shell {
  --app-bottom-dock-height: 70px; /* Product-specific approved token */
  --ui-divider-width: 1px;
  --ui-divider-color: var(--surface-divider);
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) var(--app-bottom-dock-height);
  min-height: 0;
}
.sidebar-footer, .content-dock {
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  border-top: var(--ui-divider-width) solid var(--ui-divider-color);
}
```

The example's 70px is **not** a universal LazyDesigner requirement; its numeric value belongs to the consuming application's approved layout.

## 2. Design tokens and ownership

| Class | Required rule |
| --- | --- |
| Geometry | One owner for header height, sidebar width, footer/dock height, row height, control height, divider thickness |
| Spacing | Prefer existing 4/8/12/16/24px scale; no arbitrary per-item nudges without evidence |
| Typography | Existing Desktop system font and semantic sizes; label hierarchy must be apparent |
| Surfaces | Semantic background/border/text/status tokens, scoped to each surface |
| State | Default, hover, focus-visible, selected, disabled, loading, error, stale, empty |
| Icon | Existing locked typed registry; 24px viewBox, default 16px, 1.85 stroke and accessible parent label |
| Responsive | Explicit minimum-width and clipping behavior; CSS zoom/scaling cannot separate shared seams |

Do not replace LazyDesigner's green global Desktop accent or Blockbench-blue local companion accent with a universal color. Cross-product reuse means **rules and semantic roles**, not identical hex values or identical information architecture.

## 3. Optical and mechanical alignment

- Baseline-align icon/text/action controls inside rows; use common control heights and icon slots.
- The clickable hit area must not depend on the SVG shape. SVG is decorative unless standalone meaning is explicitly described.
- Maintain consistent indentation for nested rows, including icon, label, badges, and context action.
- Long titles truncate with a discoverable full name on pointer and keyboard access; do not create horizontal overflow.
- Hover, selected and focus rings may not change row height, border thickness, or shift adjacent items.
- Fixed-position popovers and menus must anchor to their actual trigger/row; flip or constrain to available viewport area with a capped scroll region.
- Align content by actual measured box edges; a screenshot that merely 'looks centered' is not proof.

## 4. One action, one truth

- Every duplicate entry point (row, context menu, toolbar, shortcut) shares the same eligibility and disabled explanation.
- A status such as `Ready` is short in the primary UI; last-observed time and provenance remain reachable with keyboard and pointer.
- Pending async actions guard stale focus updates, duplicate clicks, old menu placement and navigation races.
- Dismissal returns focus to the relevant origin; deleted origins require a stable fallback.
- No action is enabled in a fixture if it would promise a native effect that the fixture cannot perform.
- Delete/rename/move semantics require the authorized backend and confirmation; UI cannot create permissions.

## 5. Accessible responsive QA matrix

Test or explicitly mark **NOT_EXECUTED** for:
1. Viewport widths: 1920, 1440, 1280, 1024, 800, and minimum supported; heights: tall and short windows.
2. Scaling: 100%, 125%, 150%, 200%, and high-DPI fractional pixel rounding.
3. Seams: header/bottom dock/side borders share exact x/y; no 1px or 2px discontinuity.
4. States: idle, focus, menu open, busy, empty, long names, error, warning, stalled/stale, deleted item.
5. Accessibility: keyboard-only tab sequence, Escape, return focus, screen reader names, contrast and reduced motion.
6. Positioning: popover fully reachable, menu flip/scroll near all four edges, no overflow at 200% zoom.
7. Truthfulness: source-driven preview vs compiled application vs actual native acceptance are separately labeled.

**Layout acceptance criterion:** cross-panel divider positions must agree within **1 CSS pixel** in an actual rendered measurement, and should be on the same coordinate when the shell shares a grid track. A measured discrepancy beyond 1px is a failure; a design specification or screenshot approximation alone is not evidence. At high DPI check device-pixel rasterization separately.

## 6. Preview provenance and QA gates

- `SOURCE_REVIEWED` — source was read at a pinned commit.
- `SOURCE_AUTHORED` — source change was written; not necessarily executed.
- `HTML_SOURCE_PREVIEW` — source-faithful HTML/CSS with declared fixtures and approximations, **not** the app.
- `TESTS_NOT_EXECUTED` — local/browser/native verification not performed.
- `NATIVE_UNVERIFIED` — no actual Windows/Blockbench run was proven.
- `VISUAL_VERIFIED` only with real rendered evidence at stated viewport/scale and source SHA.
- `PACKAGE_READY` only after the repository's independent release requirements.

Review and diff the source with a pinned commit. Never upgrade preview/static findings into executable/native PASS. Document approved exceptions with their scope, owner, reason, and re-evaluation trigger.

## 7. Adoption by other apps

An adopting project (for example TranslateIT) MUST map its own header/sidebar/footer component owners, design tokens and action semantics before claiming compliance. It can adopt the geometry, accessibility, SVG quality and evidence rules, but MUST NOT copy LazyDesigner-specific Blockbench behaviors, native recovery affordances, project hierarchy, icon paths, source-dependent dimensions, or theme accents.

**Stop boundary:** this document does not modify existing Svelte components, CSS, runtime, release setup, or disabled CI. Implement or verify in the owning application's source only when authorized.
