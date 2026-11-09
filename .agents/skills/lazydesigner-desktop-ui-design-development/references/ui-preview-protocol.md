# ChatGPT HTML UI Preview Protocol — LazyDesigner

This procedure governs ChatGPT visual preview only. Production Svelte, Tauri, Blockbench and existing test infrastructure are outside its scope and remain unchanged.

## Single supported preview method

**HTML_SOURCE_PREVIEW** is the sole visual preview method in ChatGPT. Reconstruct the actual selected page using production Svelte markup and CSS, imported components, design tokens and a documented typed fixture. No F2 browser-component or F3 Windows-capture workflow is required, requested or offered for preview. Do not use generative-image tools or fabricate screenshots, controls, data, or native Blockbench content.

PLAN/DISCUSS remains text-only. Explicit PREVIEW intent authorizes HTML/CSS output, not production redesign or runtime execution. The output is an accurate-as-source-permits visual representation, **not** a claim of pixel-perfect equivalence or native/functional verification.

## Required source and delivery

1. Pin the exact user-selected `Local` SHA and read the minimal production source closure: `apps/desktop/src/App.svelte`, selected page and imported UI components, `apps/desktop/src/styles.css`, `apps/desktop/src/tokens.css`, and applicable `desktopFixtures.ts` state.
2. Preserve visible UI structure, hierarchy, typography, spacing, colors, control labels and conditional state. Translate Svelte-only syntax into static HTML/CSS, selecting one deterministic fixture. No speculative features or generic dashboards.
3. Default to Unified Editor ready at 1920×1080 unless user specifies a page or size. Preserve both docks; leave the native Blockbench center empty. Never insert a fake editor, placeholder illustration, image or native screenshot.
4. Deliver the preview directly in ChatGPT if supported; otherwise provide a standalone HTML file. Include `HTML_SOURCE_PREVIEW`, repository, branch, SHA, page, fixture, viewport and any known visual/behavioral approximations. HTML controls are not evidence of actual runtime actions.
5. Keep the preview read-only and self-contained: no Tauri calls, Gateway/MCP calls, native placement, filesystem mutation, updater, external requests, dependency installation or private data. Never modify production UI simply to create a preview.
6. Review source coverage, visible layout containment, text/label fidelity, source-derived CSS and native-area emptiness. Record unverified details as such. Do not claim a test or browser screenshot was executed unless separately and actually performed outside this preview workflow.

## Scope protection

This change removes F2/F3 **from the ChatGPT preview policy**, not the real application or its existing scripts, tests, release gates or native verification responsibilities. No local test or Codex handoff is a prerequisite for HTML preview. Do not introduce another preview tier, image generation fallback, or unsolicited UI redesign.
