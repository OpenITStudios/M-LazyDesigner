---
name: lazydesigner-desktop-ui-design-development
description: LazyDesigner Desktop Svelte UI/UX specialist for source-faithful HTML/CSS preview in ChatGPT, layouts, design tokens, responsive states and accessibility. Do not use for Blockbench geometry/texture/animation authoring, native Windows/Blockbench truth, Gateway/runtime behavior, or unsolicited mockups.
---

# LazyDesigner Desktop UI Design Development

## Activation Contract

```text
LANE: DEVELOPMENT
DOMAIN: PRODUCT_DEVELOPMENT
CLASS: SPECIALIST
OWNER: DESKTOP_VISUAL_UI_PREVIEW
```

Activate for LazyDesigner Desktop visual structure, hierarchy, typography, colors, spacing, resizing, visual states and source-backed UI review. This specialist does not own product navigation semantics, truthful readiness, project persistence, Tauri operations, Blockbench native UI, AI/Gateway implementation, installation or release. Changes to the native Blockbench plugin stay with `lazydesigner-blockbench-development`; Skill routing edits stay with `lazydesigner-skill-development`.

## Current UI authority

The actual stack is Svelte 5 + Vite 8 + CSS semantic tokens (with Tailwind CSS 4 available) in `apps/desktop/`, plus a separate Tauri 2 host. The production `src/App.svelte`, its imported pages and `src/styles.css`/`src/tokens.css` are implementation authority. `docs/01-product/interface-ux.md` owns intended product UX. The experimental Unified Editor reserves an **empty** middle region for native Windows Blockbench composition. A browser preview may render only the genuine Svelte host controls (Project Explorer, Diagnostic and the host toolbar) surrounding that blank reservation: **never draw a Blockbench placeholder, faux editor, screenshot or canvas in the center and never claim it rendered native Blockbench**.

## Absolute image prohibition and phase gate

**NEVER use generative-image tools, including `image_gen`, to generate, edit, restyle, synthesize, replace or approximate UI screenshots, previews, wireframes, mockups, prototypes, Before/After pictures or references.** An uploaded screenshot is read-only evidence, not permission to generate a derivative. No generative-image fallback exists, including on failure.

- **PLAN / DISCUSS**: written discussion/specification only. "Rancang dulu", "diskusikan", feedback, audit, and ordinary "lanjutkan" in this phase do **not** authorize rendering, HTML/CSS mockups, screenshots, implementation or a phase advance.
- **PREVIEW**: an explicit user request authorizes **HTML_SOURCE_PREVIEW** only. Reproduce the pinned production Svelte UI in standalone HTML/CSS using actual markup, styles, design tokens and typed fixture state; preserve page hierarchy and labels without inventing UI. This is the sole ChatGPT visual preview method; do not require or propose Svelte browser rendering, native Windows captures, local tests, Codex or PC steps. Be precise: HTML can closely match the UI but does not prove pixel-identical runtime layout or behavior. If source is insufficient, disclose the gap rather than improvise.
- **DEVELOPMENT**: edit source only when development is requested/authorized. Authoring a preview facility is not permission to redesign the UI or capture screenshots spontaneously.
- **VALIDATION**: source assertions, real browser render, and target-Windows acceptance are distinct. Never promote one to another.

## UI design rules

**MANDATORY design standard:** Read `docs/01-product/ui-design-standard.md` before any Desktop UI source change or source-grounded preview. The standard owns the approved one-right-sidebar hierarchy, visual tokens, component behavior, accessibility, and source-only release evidence. `docs/01-product/interface-ux.md` retains product semantics. When a legacy skill example conflicts with the adopted one-sidebar structure, the adopted product/UI contract wins; never reintroduce a second dock just to match an old preview example.


Align the default Desktop companion theme to the pinned upstream Blockbench v5.2.1 `themes/dark.bbtheme` values and 40px panel tabs, but do not claim synchronization with a customized theme in the separately running native process. Use `ALIGN` when an existing visual language is present; `ESTABLISH` only when genuinely absent or specifically authorized. Work from task hierarchy and legitimate UI states before decoration. Keep original Desktop visual patterns, tokens, accessible focus/contrast, reduced motion, meaningful responsive composition and truthful disabled/error/pending states. Do not introduce speculative gradients, glass effects, generic AI dashboards, animations without purpose, a new UI framework or cloned components. For third-party inspiration distinguish OBSERVED, INFERRED and ADOPTED.

## Source-first ChatGPT HTML preview

Read [the UI Preview Protocol](references/ui-preview-protocol.md) after explicit PREVIEW intent or when maintaining the preview method.

1. **PIN** selected `Local` HEAD and actual target UI source, imported components, CSS, tokens and relevant typed fixture.
2. **TRANSLATE** source Svelte markup and CSS into standalone HTML/CSS without redesign, fabricated controls, speculative content, or generated images. Use `HTML_SOURCE_PREVIEW` as the single preview tier.
3. **DEFAULT** Unified Editor ready, 1920×1080; use the approved **single right sidebar** with Projects and Status tabs, Active Project above Recent Models, and the native Blockbench center empty. Never reintroduce an old left Project Explorer dock or synthesize the native editor.
4. **DELIVER** the HTML preview directly in ChatGPT when supported, or as a standalone HTML file. Identify branch, SHA, page, fixture, viewport, source coverage and any approximations.
5. **BOUNDARY** this is visual review only. No local Svelte render, Windows capture, Codex, PC test, native operations or dependency installation for preview. Do not delete production application code or existing runtime/test infrastructure. Do not claim pixel identity or functional acceptance without evidence.

## Procedure and proof

Inspect only the UI source owners relevant to the request; align visuals to product contract and existing tokens; preserve callback/runtime ownership. For actual UI changes inspect responsive and focus/error states at real rendered dimensions when such evidence is available. Do not confuse a static code assertion with visual quality or functional acceptance.

Root `AGENTS.md` and `GITHUB_RULES.md` retain branch, permission, GitHub-only/Local/Windows ceilings and the current hold on Codex/local/native tests. This Skill does not lift that hold. Report source authored/reviewed, tests `NOT_EXECUTED`, browser `NOT_EXECUTED`, native `NOT_EXECUTED` separately when appropriate.
