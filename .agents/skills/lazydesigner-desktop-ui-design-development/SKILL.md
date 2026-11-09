---
name: lazydesigner-desktop-ui-design-development
description: LazyDesigner Desktop Svelte UI/UX specialist for real-app ChatGPT preview, layouts, design tokens, responsive states, accessibility and rendered visual acceptance. Do not use for Blockbench geometry/texture/animation authoring, native Windows/Blockbench truth, Gateway/runtime behavior, or unsolicited mockups.
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
- **PREVIEW**: requires a specific user request for a visual preview. Allow **F1_SOURCE_HTML** as the default ChatGPT-friendly preview when F2/F3 execution is unavailable: construct HTML/CSS from the pinned production Svelte components, actual design tokens, text, and documented fixture state. F1 is an approximate visual reconstruction, **not** a running Svelte screenshot, interaction proof, or native Blockbench capture. Explicitly label the tier and uncertain visual details; never promise near-100% pixel fidelity without comparison. If F1 cannot be grounded or displayed, report F0 / **NO PREVIEW RENDERED**.
- **DEVELOPMENT**: edit source only when development is requested/authorized. Authoring a preview facility is not permission to redesign the UI or capture screenshots spontaneously.
- **VALIDATION**: source assertions, real browser render, and target-Windows acceptance are distinct. Never promote one to another.

## UI design rules

Align the default Desktop companion theme to the pinned upstream Blockbench v5.2.1 `themes/dark.bbtheme` values and 40px panel tabs, but do not claim synchronization with a customized theme in the separately running native process. Use `ALIGN` when an existing visual language is present; `ESTABLISH` only when genuinely absent or specifically authorized. Work from task hierarchy and legitimate UI states before decoration. Keep original Desktop visual patterns, tokens, accessible focus/contrast, reduced motion, meaningful responsive composition and truthful disabled/error/pending states. Do not introduce speculative gradients, glass effects, generic AI dashboards, animations without purpose, a new UI framework or cloned components. For third-party inspiration distinguish OBSERVED, INFERRED and ADOPTED.

## Source-first ChatGPT preview

Read [the UI Preview Protocol](references/ui-preview-protocol.md) **only after explicit PREVIEW intent or when engineering the preview facility**. This is one procedure inside this specialist, not a second app/runtime, service or automatic ChatGPT installation.

1. **PIN** repository `OpenITStudios/M-LazyDesigner`, user-selected `Local` and its exact HEAD. Identify the actual page, imported UI/style/asset closure, scenario and viewport.
2. **CAPABILITY** distinguish `F0_SOURCE`, `F1_SOURCE_HTML`, `F2_BROWSER_COMPONENT`, and `F3_TARGET_WINDOWS`. GitHub-only access can support F1 source-grounded HTML but does not prove F2. Never fabricate app state or native editor imagery.
3. **REAL APPLICATION** For F2 use `apps/desktop/scripts/ui-preview/` to load the **production** `src/main.ts` → `App.svelte` in a real iframe. For F1 translate only the relevant production Svelte markup and CSS into a standalone, clearly labeled HTML/CSS visual review artifact using the actual tokens and typed fixture; no fake handlers, live status, or native content. The F1 artifact must not be committed as production UI.
4. **ISOLATION** maintain read-only, deterministic, synthetic-only fixture; no Tauri bridge or native Blockbench placement, update checks, file operations, real Gateway/MCP calls, personal data, external network, model inference or dependency installation. The previewed iframe is inert to user interaction.
5. **FAST PATH** default to Unified Editor ready, 1920×1080, one viewport (both side docks visible). Both docks must also remain present as compact rails at narrow widths; only explicit Focus Editor hides them. The right dock contains only **Diagnostic** (readiness/issues) and **Activity** (connection and observed data), with actual Gateway statistics owned by Analytics. In an authorized, already-available `LOCAL_CODE` checkout, `npm run preview:plan` reports the pinned current state; `npm run preview:quick` explicitly renders. The renderer is plan-only unless `--execute`; no GitHub Actions dispatch, user's-PC test, auto-install or branch switch.
6. **QA** confirm exact clean source, real `App.svelte` mount and fixture marker, iframe/viewport dimensions, correct page, synthetic badge, CSS, controls/viewport containment, absent Tauri host, no external HTTP/WebSocket or browser errors, source unchanged after capture. Record screenshot SHA-256 and an ephemeral receipt. Native Blockbench contents remain `NOT_EXECUTED`.
7. **DELIVERY** show F1 HTML visual review directly when source-grounded and feasible; offer a downloadable HTML file if generated. Only label an image F2 when the real browser render succeeded; F3 requires authorized installed-app capture. Keep all three evidence tiers separate and report missing higher-tier proof. Never invent a file path, visual result or PASS.

## Procedure and proof

Inspect only the UI source owners relevant to the request; align visuals to product contract and existing tokens; preserve callback/runtime ownership. For actual UI changes inspect responsive and focus/error states at real rendered dimensions when such evidence is available. Do not confuse a static code assertion with visual quality or functional acceptance.

Root `AGENTS.md` and `GITHUB_RULES.md` retain branch, permission, GitHub-only/Local/Windows ceilings and the current hold on Codex/local/native tests. This Skill does not lift that hold. Report source authored/reviewed, tests `NOT_EXECUTED`, browser `NOT_EXECUTED`, native `NOT_EXECUTED` separately when appropriate.
