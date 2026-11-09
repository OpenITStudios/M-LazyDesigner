# LazyDesigner UI Engineering Standard — SVG, Components, Accessibility and QA

**Status:** ADOPTED companion to [UI Design Standard](ui-design-standard.md). **Applies to:** Desktop Svelte/Tauri companion, source-grounded previews and future UI changes on `Local`. **Precedence:** product semantics and safety in [Human Interface Contract](interface-ux.md), visual hierarchy in UI Design Standard, then this engineering specification. Existing runtime is the implementation authority; deviations are tracked, not automatically declared fixed.

## Cross-panel layout geometry — mandatory companion

For any screen with adjoining sidebar/content panels, shared footer or action dock, or continuous dividing lines, apply the [Cross-Panel Layout and Alignment Contract](ui-layout-alignment-contract.md). It owns seam alignment, shared height/divider tokens, precise measured viewport acceptance and responsive alignment regression checks. It does **not** change the approved UI hierarchy, theme or SVG registry. Source-only adoption is not visual verification.

## A. Design system architecture

- Prefer **semantic design tokens**, not one-off hex colors, per-element CSS overrides, copied inline SVG or independently invented spacing.
- Distinguish **Desktop global tokens** (`apps/desktop/src/tokens.css`, green brand accent) from **Unified Editor/Blockbench companion tokens** (`--ed-*`, blue Blockbench-compatible accent). **Do not globally replace green with blue**: those surfaces have different established visual authority.
- Scope styles to component ownership. Prefer existing `EditorChromeIcon`, shared controls and semantic variables. Do not introduce an icon package, fonts, network-hosted assets or runtime dependencies for cosmetic changes.
- Responsive states and keyboard accessibility are product features, not optional polish.

## B. SVG/icon specification (MUST)

| Property | Requirement |
| --- | --- |
| Format | Inline SVG in Svelte component; no untrusted HTML or `{@html}` for icon markup |
| Geometry | Consistent `viewBox="0 0 24 24"` |
| Default size | 16×16 CSS pixels; optional 14/18/20 only when role requires |
| Stroke | `currentColor`, `fill="none"`, width `1.85` default |
| Ends | `stroke-linecap="round"`, `stroke-linejoin="round"` |
| Decorative icons | `aria-hidden="true"`, `focusable="false"`; parent button supplies accessible name |
| Meaningful standalone icon | Must have an accessible text alternative; do not rely on SVG title or color alone |
| Fill | Allowed for intentional solid dots/indicators; not a random mixture of solid and outline glyphs |
| Icon source | One typed `EditorChromeIcon` name registry; reuse before adding |
| Naming | Lowercase kebab-case, action/object meaning, no duplicate aliases |
| Transform | Avoid nonuniform scaling, clipping, off-grid coordinates, and rasterized SVG |
| Color | Inherit `currentColor` from semantic state, not a hardcoded fill on every path |
| Interaction | SVG never owns clicks, focus or tooltip; wrap it in a real `button` or link |
| Safety | No scripts, `foreignObject`, external references, embedded images, inline event handlers, or remotely fetched SVG |
| QA | Inspect 16px and 20px, light/dark backgrounds where used, disabled/hover/focus and high DPI; check consistent optical weight |

**Icon semantics:** `model`=model file; `folder`=directory; `folder-open`=revealed/open directory; `search`=search; `more-horizontal`=context actions; `activity`=AI activity; `diagnostic`=system details; `support`=help; `focus`=focus mode. Never use the same glyph for unrelated actions solely to fill space. Chevron direction must match expansion/navigation.

**SVG acceptance:** any new glyph requires a documented name, action/meaning, 24px path design, source reference if adapted, accessible parent label, and screenshot/source review at actual rendered size. Icon artwork must be original or license-compatible; do not embed third-party brand marks without rights and provenance. No custom font file sharing.

## C. Typography, spacing and surfaces

- Use Segoe UI/system sans for Desktop; do not introduce external font downloads. Use 13px as compact sidebar body baseline, 13–14px semibold headings, 11–12px secondary labels; preserve larger existing global Desktop scale outside Unified Editor.
- Numeric status/metric columns should align with tabular figures. Avoid truncated status meaning; for long project/model names use ellipsis **plus** accessible full-name/title.
- Spacing rhythm: 4, 8, 12, 16, 24px. Row targets: 36px model/folder, 34–36px ordinary buttons, 30–32px inline secondary actions. Touch-first surfaces may require larger hit targets.
- Consistent left alignment of icons, labels, action menus, and nested indentation. Do not place a model menu over adjacent actions without stacking and viewport-edge handling.
- Borders use semantic soft/normal/strong levels; status colors convey observed state only. Prefer flat surfaces over gradients, glass, heavy shadows or novelty effects.
- UI text uses sentence case, concrete verbs and short states. `Ready` with observed-time tooltip is preferable to repeating a long sentence. No unexplained Gateway terminology in the primary surface.

## D. Component anatomy and state matrix

Every interactive control has: accessible name, visible affordance, action destination, disabled reason where needed, keyboard handling, focus ring, hover, pending state, failure handling, and successful completion feedback. Nonfunctional preview buttons must be labeled simulated or disabled.

| Component | Required states | Key behavior |
| --- | --- | --- |
| Button | idle/hover/focus/disabled/busy/error | Single in-flight action; no false success |
| Tabs | selected/unselected/focus | Arrow/Home/End; selected panel matches `aria-controls` |
| Search | empty/typing/results/no-results/focus | Escape clears, Enter only when unambiguous |
| Tree row | active/inactive/hover/focus/missing/dirty | Current model and unsaved observations distinguishable |
| Context menu | closed/open/keyboard/outside-click | One menu at a time; Escape restores trigger focus |
| Disclosure | closed/open/focus | `summary` describes actual details, no misleading live claims |
| Tooltip | pointer/keyboard/touch alternative | Informational, never sole way to perform an action |
| Form | empty/invalid/submitting/canceled/failed/succeeded | Keep data on cancel; do not submit twice |
| Status | loading/ready/stale/unavailable/error | Last checked timestamp and provenance |
| Notification | info/success/warning/error | Specific result, next step, dismiss control |
| Native recovery | detached/presented/deferred/uncertain | Uncertain must remain recoverable and never silently disappear |

## E. Accessibility contract

1. Target WCAG 2.2 AA where applicable; verify contrast of body/secondary text (4.5:1) and non-text UI indicators (3:1) against actual adjacent surfaces. Do not assert a ratio without measurement.
2. Visible keyboard focus must be at least 2px and not clipped by scroll containers or `overflow:hidden`.
3. Keyboard order follows visual reading order; focus returns to trigger after menu close or dialog cancel. No keyboard trap outside a modal.
4. Every icon-only button has an accessible label describing its effect, not its shape. Disabled controls expose reason in nearby copy when not obvious.
5. Never communicate ready, dirty, missing, or error solely through color or a dot.
6. Honor reduced-motion preference for nonessential transitions; no mandatory animation, blinking status or auto-scrolling.
7. Inputs use associated labels, errors are announced, live regions are limited to real state changes, and updates do not steal focus.
8. Tooltip on hover must also be available to keyboard users; touch users need visible text or a discoverable alternative.
9. Screen-reader labels must not say `active` or `connected` when only a stale observation exists.

## F. Responsive and density contract

- One right sidebar owns Projects and Status. No second permanent left project dock.
- Keep native Blockbench center usable: existing 320px minimum admission logic remains authoritative until native acceptance.
- On narrow widths, use the existing reachable rail or compact mode; never silently hide the only Restore window route.
- Prevent horizontal scroll for ordinary content. Long filenames, paths, diagnostics and timestamps may wrap or truncate with full-value access.
- Test at representative widths: 1920, 1440, 1280, 1024, 800 and narrowest supported shell; validate high DPI, Windows text scaling and 200% browser zoom when runtime access becomes available.
- Popovers and menus must remain inside viewport, with scroll and stacking handled; do not assume mouse hover.

## G. Copy and information architecture

- Sidebar: `LazyDesigner` → Projects/Status → Active project → Open existing model → Recent Models → Project folders → concise footer.
- Active Project is a read-only orientation context with an explicitly available focus action when verified, not a fake project switcher.
- `New folder` creates an empty directory only. `Add existing folder` registers a location. `Open existing model` opens a model picker. Do not merge these verbs.
- Technical details are behind a disclosure; `Open AI activity page` routes to actual Analytics and returns to origin.
- Remove redundant chrome before adding new chrome. Support is navigation, not automatic repair. A diagnostic button must not be labeled as a repair.
- Error copy: **what happened → what remains safe → one next action**. Keep one clear sentence per line where possible.

## H. Security and trust boundaries

- Do not interpolate user filenames into `innerHTML`, SVG path markup, CSS selectors or executable URLs. Svelte text bindings escape by default; keep native path validation in Rust.
- No remote icon packs, tracking pixels, embedded SVG script or external resources in previews.
- Never expose secrets, filesystem absolute paths, user IDs or sensitive diagnostics in visual fixtures.
- Preview must not invoke Tauri/MCP or claim backend behavior; mark fixtures and native limits.
- Destructive controls require backend-confirmed eligibility, confirmation, Recycle Bin semantics and no permanent-delete fallback.

## I. Definition of Done: UI source vs packaging

**Source UI complete** only when: approved hierarchy, real handlers, no duplicate/dead controls, responsive rules, state matrix, accessible interactions, and documented design deviations are reviewed. **Preview reviewed** only when source-grounded HTML is pinned to a commit and explicitly identified as simulated. **Native accepted** only after executable build, Windows native window recovery, input/focus, scaling and functional operations have actual evidence. **Package-ready** requires the repository's separate release gates. These are distinct; source authored ≠ tests passed ≠ package-ready.

## J. Blind-spot register (current, not yet accepted)

| Severity | Gap | Closure evidence |
| --- | --- | --- |
| P0 | Unified Editor is gated by `import.meta.env.DEV` | Explicit production-route and native restore safety decision, actual executable verification |
| P0 | Rename/Delete Model is only preflight/spec, not complete safe native operation | Rust commands, dirty/open protections, confirmation and Recycle Bin receipt |
| P1 | Legacy two-dock layout state remains in source | Bounded state simplification without breaking narrow rail or native recovery |
| P1 | Global Desktop tokens (green) and Unified Editor tokens (blue) are not fully consolidated | Documented per-surface mapping; no global recolor |
| P1 | Sidebar CSS still contains historical overrides and small-font exceptions | Scoped cleanup, style audit, source diffs, visual review |
| P1 | Preview HTML is simulated and may diverge from Svelte | Pin source commit, record coverage and fixture, no native claim |
| P1 | Menu edge collision, touch alternatives and keyboard behavior lack runtime proof | Focus/viewport acceptance when executable testing resumes |
| P1 | Actual SVG rendering, contrast and scaling not verified | Icon/contrast/zoom matrix with measured evidence |
| P2 | Some secondary labels and status details are verbose | Copy audit against short-state contract |
| P2 | Empty/missing/dirty/refresh-failure paths need end-to-end review | State inventory and real operation receipts |

**Rule:** an item stays open until there is matching evidence. A document alone does not close an implementation gap.

## K. Source inspection record — 2026-11-09

**Pinned scope:** `apps/desktop/src/EditorChromeIcon.svelte`, `tokens.css`, `UnifiedWorkspacePage.svelte`, `App.svelte`, the existing standards and skill owner. **Context:** REMOTE_GITHUB. **Evidence:** source inspection and commits only; no native/browser runtime.

- **SVG baseline observed:** `EditorChromeIcon` uses a typed union of 13 glyph names, a common 24×24 viewBox, 16px output, currentColor, 1.85 stroke, round caps/joins, and decorative aria-hidden SVG. This is an existing positive baseline; it is **not** proof of optical alignment or contrast at runtime.
- **Token split observed:** global Desktop tokens have a green accent while Unified Editor uses blue Blockbench-compatible local tokens. Preserve their scoped ownership until a deliberate cross-surface mapping is implemented.
- **CSS debt observed:** Unified Editor is a large component with historical style rules and repeated overrides; blind deletion risks breaking responsive layout and native placement. Cleanup should be selector-by-selector, not a broad rewrite.
- **Closed in source:** missing Recent Models now visibly identify missing files and disable opening; AI verified label is concise and detailed observation text is available on focus/hover. These are source-authored, **not executed**.
- **Open:** native acceptance, production Editor route, safe Rename/Delete, responsive/zoom measurements, contrast measurements, menu clipping, and systematic dead-selector removal. The UI must not be labeled package-ready while these remain unverified.

**Review rule:** each subsequent UI change must update this record or the blind-spot register with exact source evidence, and must never mark a runtime gap closed based on a document or a preview alone.

## L. Status and AI Activity source audit — 2026-11-09

- **Resolved in source:** the Status Refresh action referenced `EditorChromeIcon name="refresh"`, but the typed SVG registry did not contain `refresh`. The glyph is now implemented with the existing 24×24, currentColor, 1.85px stroke contract.
- **Resolved in source:** the Status details link to AI Activity is disabled in fixture mode, avoiding a preview-only action that suggests real navigation; disabled styling is explicit.
- **Observed navigation safety:** `App.svelte` records the Analytics origin and its Back action returns to that origin. Leaving Editor is gated on the native detach receipt; source inspection is not native proof.
- **Still open:** actual Refresh/Analytics click behavior, keyboard and screen-reader checks, fixture appearance, production Unified Editor gating, and native restore acceptance. Do not close these based on source inspection alone.

## M. Final sidebar source review — 2026-11-09

**Pinned evidence:** `Local` commit `48484d8c32f19ad27a59dfcf83c2f8f758c5c77a`. Source inspection only.

- **Icon registry cross-check:** all 13 statically referenced `EditorChromeIcon` names in `UnifiedWorkspacePage.svelte` are implemented in the SVG registry. The registry also retains `chevron-left` and `folder-open` for other potential consumers; do not delete them merely because this page does not use them. This check does not validate conditional/dynamic names in other pages.
- **Status keyboard accessibility:** footer now exposes the observed timestamp to screen-reader users and Details has a larger target. These are authored source changes, not measured runtime accessibility.
- **Current remaining acceptance blockers:** native composition and restore, production-only Unified Editor route, viewport clipping under real window resizing, screen-reader/zoom checks, and executable tests. Source cleanup is not proof that these pass.
- **Preview readiness:** a source-grounded HTML review can be prepared **when explicitly requested**, with the native Blockbench center empty and fixture limitations stated. It must not be presented as an executable/native app.

## N. Model context action parity audit — 2026-11-09

- **Source gap found and corrected:** the main model row disabled focusing an active model when two or more status probes failed, but the same action in its context menu did not expose the same disabled state. The context action now uses the row's eligibility condition and an explanatory tooltip.
- **Generalized rule:** when the same action appears in a row, context menu, toolbar or shortcut, all entry points must share the same eligibility and truthful disabled reason. The Rust operation remains authoritative; UI parity is an additional guard, not a security boundary.
- **Unverified:** actual keyboard/pointer interactions and Windows native state are still `NOT_EXECUTED`.

## O. Production Unified Editor gate — 2026-11-09

**Context:** REMOTE_GITHUB; no native or executable tests run.

- `App.svelte` mounts `UnifiedWorkspacePage` only when `page === 'Editor' && import.meta.env.DEV`. The approved UI and HTML preview do not mean the production shell contains the new Editor.
- **Source hardening:** `navigate('Editor')` now returns early in production instead of allowing an unavailable Editor route to fall through to another page.
- **Native boundary inspected:** `NativeEditorStage.svelte` uses Rust `native_editor_surface` receipts for present/update/detach. Detach requires an explicit `DETACHED` receipt; failure marks placement `UNCERTAIN` and blocks the caller's navigation. The source also has an initial placement attempt and resize-driven updates.
- **Release blockers remain:** actual Windows native composition, detach/restore under rapid navigation, focus/keyboard ownership, resize/DPI and taskbar recovery, error-path behavior, executable tests, and an explicit product decision to expose the Editor in production. Do not remove `import.meta.env.DEV` until these gates have evidence.
- **Current verdict:** design approved, source improvements authored, **production Unified Editor NOT ENABLED / NATIVE UNVERIFIED / PACKAGE NOT READY**.
