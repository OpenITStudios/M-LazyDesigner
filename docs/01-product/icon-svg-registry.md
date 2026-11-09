# LazyDesigner Icon & SVG Registry — LOCKED

**Status:** DESIGN LOCK / baseline approved 2026-11-09.  
**Branch:** `Local`. **Owner:** `apps/desktop/src/EditorChromeIcon.svelte`.  
**Authority:** [UI Design Standard](ui-design-standard.md), [UI Engineering Standard](ui-engineering-standard.md), and [Human Interface Contract](interface-ux.md).

## 1. Non-negotiable baseline

The Unified Editor icon language is **one coherent outline family**. Keep the existing 24×24 viewBox, 16×16 rendered default, 1.85 stroke, round line caps/joins, `currentColor`, and `fill="none"`. Use a fill only for deliberate dots or tiny markers already defined by the registry.

All decorative SVGs use `aria-hidden="true"` and `focusable="false"`; the surrounding button/link owns the accessible action label. SVGs must not own pointer events or keyboard behavior. Keep original vector paths, no external sprite/font/CDN, no emoji replacing navigation icons, no raster substitutes and no `{@html}` injection.

**Visual lock:** do not silently alter icon shapes, stroke weights, sizes, meaning, or the baseline family during unrelated UI tasks. A change requires a scoped icon review and explicit product/design decision.

## 2. Canonical registry

These are the approved icon names in `EditorChromeIcon.svelte`:

| Name | Semantic use |
| --- | --- |
| `projects` | Projects tab or project collection |
| `diagnostic` | System diagnostics and status shortcut |
| `focus` | Focus Editor mode |
| `workspace` | Workspace navigation |
| `support` | Support/help navigation |
| `model` | Model file or model context |
| `add` | Add/create action |
| `chevron-left` | Backward/collapse direction |
| `chevron-right` | Forward/expand direction |
| `folder` | Directory/project folder |
| `folder-open` | Open directory |
| `activity` | AI activity/Status navigation |
| `search` | Search input |
| `refresh` | Refresh status |
| `more-horizontal` | Context actions |

An icon name is not permission to reuse the icon for an unrelated action. Do not remove a registered icon solely because one page does not currently use it; inspect all consumers first.

## 3. UI placement and alignment

- Icons sit inside existing `button`, link, tab, input decoration or status context; no decorative icon-only row without an accessible action.
- Standard icon size is **16px**. Maintain 7–9px text gap for labeled controls where layout permits. Do not mix arbitrary 14/18/20px variants within one component family.
- Align to the **optical center**, not by arbitrary margins. Keep consistent stroke density, negative space and silhouette at 100%/125%/150% Windows scaling.
- Use CSS semantic foreground colors. Selected, hovered, disabled and focused states derive from the parent control. Status color conveys state, not icon shape alone.
- Context menus use the existing horizontal-ellipsis glyph; do not substitute a kebab/vertical-ellipsis without an approved change.
- Keep `LazyDesigner` branding distinct from a generic model glyph; any future brand logo needs its own documented asset and licensing review.

## 4. Change gate (mandatory)

Before adding or modifying an icon:

1. State the missing user action and why no registered glyph fits.
2. Propose a lowercase kebab-case name, semantic meaning and target location.
3. Check for duplicates, ambiguity, misleading metaphors and third-party licensing.
4. Add it to the **typed union** and one conditional path in `EditorChromeIcon.svelte`, preserving the 24×24 outline family.
5. Add the registry entry here; update only actual consumers. Never paste the same SVG markup into multiple components.
6. Inspect icon-only accessible labels, focus-visible, disabled state, tooltip, contrast and 16px optical weight.
7. Record the exact commit, source-level check and native visual evidence separately. No source-only claim of pixel perfection.

**Breaking changes:** renaming/removing icons, switching icon families, changing default geometry, or changing action semantics requires explicit approval and a documented migration of all consumers. Until approved, keep the current registry stable.

## 5. Regression checklist

- [ ] Every static `<EditorChromeIcon name="..."/>` in the Desktop codebase resolves to a registered name.
- [ ] Dynamic icon names (if introduced) are typed and have a fallback.
- [ ] No raw duplicated icon SVG, icon font, remote icon request, raster substitute or emoji used as an action glyph.
- [ ] The same action uses the same icon in toolbar, sidebar and menus.
- [ ] Icon-only controls have a meaningful `aria-label`; decorative SVG is hidden from screen readers.
- [ ] Icon does not shrink or stretch within flex layouts; 16px optical alignment is maintained.
- [ ] Disabled/hover/selected/focus states are distinguishable without color alone.
- [ ] Reduced motion and forced-colors settings do not remove essential icon meaning.
- [ ] No missing/blank icons in ready, stale, empty, pending and error states.
- [ ] Preview fixture and native Windows results are reported separately.

## 6. Evidence boundary

This registry is **locked as a design contract**, not an assertion that all icons have passed native visual testing. The source registry currently defines the 15 named icons above. HTML preview is for visual review only; it does not verify Windows/Blockbench rendering. Keep native QA as an open release requirement.
