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

The actual stack is Svelte 5 + Vite 8 + CSS semantic tokens (with Tailwind CSS 4 available) in `apps/desktop/`, plus a separate Tauri 2 host. The production `src/App.svelte`, its imported pages and `src/styles.css`/`src/tokens.css` are implementation authority. `docs/01-product/interface-ux.md` owns intended product UX. The experimental Unified Editor reserves an **empty** middle region for native Windows Blockbench composition. A browser preview may render only the genuine Svelte host controls (Project Explorer, Model Tools and the host toolbar) surrounding that blank reservation: **never draw a Blockbench placeholder, faux editor, screenshot or canvas in the center and never claim it rendered native Blockbench**.

## Absolute image prohibition and phase gate

**NEVER use generative-image tools, including `image_gen`, to generate, edit, restyle, synthesize, replace or approximate UI screenshots, previews, wireframes, mockups, prototypes, Before/After pictures or references.** An uploaded screenshot is read-only evidence, not permission to generate a derivative. No generative-image fallback exists, including on failure.

- **PLAN / DISCUSS**: written discussion/specification only. "Rancang dulu", "diskusikan", feedback, audit, and ordinary "lanjutkan" in this phase do **not** authorize rendering, HTML/CSS mockups, screenshots, implementation or a phase advance.
- **PREVIEW**: requires a specific user request for a visual preview. Only an actual app/browser render from the pinned production Svelte source (F2) or authorized native capture (F3) counts as a preview. If neither is available, report F0 and say **NO PREVIEW RENDERED**. LazyDesigner does **not** accept F1 reconstruction as a substitute; even a labeled HTML illustration is not a real-app preview.
- **DEVELOPMENT**: edit source only when development is requested/authorized. Authoring a preview facility is not permission to redesign the UI or capture screenshots spontaneously.
- **VALIDATION**: source assertions, real browser render, and target-Windows acceptance are distinct. Never promote one to another.

## UI design rules

Use `ALIGN` when an existing visual language is present; `ESTABLISH` only when genuinely absent or specifically authorized. Work from task hierarchy and legitimate UI states before decoration. Keep original Desktop visual patterns, tokens, accessible focus/contrast, reduced motion, meaningful responsive composition and truthful disabled/error/pending states. Do not introduce speculative gradients, glass effects, generic AI dashboards, animations without purpose, a new UI framework or cloned components. For third-party inspiration distinguish OBSERVED, INFERRED and ADOPTED.

## Source-first ChatGPT preview

Read [the UI Preview Protocol](references/ui-preview-protocol.md) **only after explicit PREVIEW intent or when engineering the preview facility**. This is one procedure inside this specialist, not a second app/runtime, service or automatic ChatGPT installation.

1. **PIN** repository `OpenITStudios/M-LazyDesigner`, user-selected `Local` and its exact HEAD. Identify the actual page, imported UI/style/asset closure, scenario and viewport.
2. **CAPABILITY** distinguish `F0_SOURCE`, forbidden-for-preview `F1_RECONSTRUCTED`, `F2_BROWSER_COMPONENT`, and `F3_TARGET_WINDOWS`. Github-only access proves F0, not F2. Never produce an image from assumptions.
3. **REAL APPLICATION** use `apps/desktop/scripts/ui-preview/` to load the **production** `src/main.ts` → `App.svelte` inside a real iframe viewport using existing development-only, typed `desktopFixtures.ts` data. No copied application markup. The preview toolbar is outside the captured canvas.
4. **ISOLATION** maintain read-only, deterministic, synthetic-only fixture; no Tauri bridge or native Blockbench placement, update checks, file operations, real Gateway/MCP calls, personal data, external network, model inference or dependency installation. The previewed iframe is inert to user interaction.
5. **FAST PATH** default to Unified Editor ready, 1920×1080, one viewport (both side docks visible). In an authorized, already-available `LOCAL_CODE` checkout, `npm run preview:plan` reports the pinned current state; `npm run preview:quick` explicitly renders. The renderer is plan-only unless `--execute`; no GitHub Actions dispatch, user's-PC test, auto-install or branch switch.
6. **QA** confirm exact clean source, real `App.svelte` mount and fixture marker, iframe/viewport dimensions, correct page, synthetic badge, CSS, controls/viewport containment, absent Tauri host, no external HTTP/WebSocket or browser errors, source unchanged after capture. Record screenshot SHA-256 and an ephemeral receipt. Native Blockbench contents remain `NOT_EXECUTED`.
7. **DELIVERY** show a genuine F2 screenshot only if the real browser render succeeded in this execution context; F3 only after an actual authorized installed-app capture. Otherwise report F0 source findings and precise missing evidence. Never invent a file path, visual result or PASS.

## Procedure and proof

Inspect only the UI source owners relevant to the request; align visuals to product contract and existing tokens; preserve callback/runtime ownership. For actual UI changes inspect responsive and focus/error states at real rendered dimensions when such evidence is available. Do not confuse a static code assertion with visual quality or functional acceptance.

Root `AGENTS.md` and `GITHUB_RULES.md` retain branch, permission, GitHub-only/Local/Windows ceilings and the current hold on Codex/local/native tests. This Skill does not lift that hold. Report source authored/reviewed, tests `NOT_EXECUTED`, browser `NOT_EXECUTED`, native `NOT_EXECUTED` separately when appropriate.
