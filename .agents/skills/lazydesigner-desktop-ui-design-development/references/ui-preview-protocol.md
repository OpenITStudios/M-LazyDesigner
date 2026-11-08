# ChatGPT UI Preview Protocol — LazyDesigner

Operating procedure for `lazydesigner-desktop-ui-design-development`. Not a new autonomous agent, plugin, ChatGPT host feature or alternate app. User intent, root `AGENTS.md`, `GITHUB_RULES.md` and current source prevail.

## Non-negotiable phase and image rules

**No AI image generation at any stage of LazyDesigner UI/UX work.** Never invoke `image_gen` or another generative-image tool for screenshots, UI images, wireframes, screenshot editing, alternate styling, Before/After comparisons or mockups. A user-supplied screenshot is evidence only.

**PLAN/DISCUSS is text-only** and cannot silently trigger a preview, HTML rendering, visual reconstruction or source mutation. UI feedback on a prior preview is discussion, not a new preview request. **PREVIEW needs an explicit visual request**. Preview is only a verified F2 application render or real F3 native capture. If not available, supply F0 source findings and state NO PREVIEW RENDERED. Unlike the source TranslateIT reference, **F1 reconstruction is deliberately unavailable as a LazyDesigner preview** under the user's stricter real-app-only rule. Do not substitute generated pictures or invented GUI controls after a failure.

## Fidelity and authority

| Tier | Evidence | Permitted conclusion |
| --- | --- | --- |
| `F0_SOURCE` | Reviewed pinned GitHub source only | Named UI components, handlers and CSS exist; NO PREVIEW RENDERED |
| `F1_RECONSTRUCTED` | Cloned/reimagined HTML/image | **Prohibited as LazyDesigner UI preview** |
| `F2_BROWSER_COMPONENT` | Pinned production `App.svelte` rendered by existing Vite in Chromium, synthetic deterministic state, iframe viewport, screenshot and QA receipt | Actual Svelte/Tailwind/CSS browser layout for that fixture; **not** native Windows, Blockbench content or live connection |
| `F3_TARGET_WINDOWS` | Actual installed Tauri/Blockbench screenshot with exact revision and tested state | Inspected native visual state only; does not prove unrelated AI/runtime actions |

Do not infer F2 from the mere presence of a renderer script. Do not infer F3 from an F2 screenshot. A genuine screenshot from the app is not a generatively produced image.

## Routes and defaults

- "Preview current UI" → latest pinned `Local`, Unified Editor ready, **1920×1080** (both side docks visible), one screenshot.
- Named Workspace/Support/Analytics or another fixture → same production `App.svelte` page with the minimal typed scenario.
- "Responsive" → 1280×760, 1600×940 and 1920×1080 with no rewritten page markup.
- "Before / after" → two named SHAs, identical fixture, browser, settings and viewport; do not invent prior pictures.
- "Full audit" → expand pages only when explicitly requested; normal fast path remains narrow.
- Missing exact checkout, browser, dependencies or native permissions → F0, NO PREVIEW RENDERED.

## Canonical F2 source and isolation

The existing app entry is `apps/desktop/index.html` → `src/main.ts` → `src/App.svelte`. Development-only query values `?fixture=<typed fixture>&view=<page>` are already interpreted by production `App.svelte` and `src/desktopFixtures.ts`. Its guarded fixture path returns before Tauri status polling, native commands, installer checks, project/asset file mutation and native Blockbench embedding. `NativeEditorStage.svelte` explicitly guards native placement/listen/detach on `fixture`. Review these guards whenever imported source changes.

The **separate** `apps/desktop/scripts/ui-preview/index.html` mounts only the small preview toolbar and an iframe whose `src` points at the *real application entry*, not a copied set of Svelte components. The iframe is actual viewport size; resizing a wrapper `div` without changing the iframe layout viewport is invalid. Use only fixed, typed scenario-to-fixture mappings; no arbitrary user text becomes a query argument. The iframe is read-only/inert; selectors outside it change only approved deterministic scenarios/viewports. The toolbar and outer synthetic label are **not** included in the source screenshot.

The same-origin `allow-scripts allow-same-origin` iframe is viewport isolation, **not a security boundary**. F2 safety instead depends on the production fixture guards, no Tauri host, no native operations, and the browser's denied outbound HTTP/WebSocket routes. If those invariants cannot be established, fail closed; never remove the guards to make a screenshot succeed. The middle of the actual application must remain an **empty native-window reservation** in F2: no placeholder, simulated editor, canvas, fake Blockbench toolbar, status footer or image. The original Blockbench window is supplied only by the guarded native Windows composition in F3. Never synthesize, embed a screenshot into, or claim native content for that region.

## Explicit LOCAL_CODE interface (not a user-PC instruction)

```sh
# From apps/desktop, only when authorized exact Local checkout + toolchain already exist
npm run preview:plan
npm run preview:typecheck
npm run preview:quick
npm run preview:quick -- --scenario editor-many-projects --viewport compact
npm run preview:render -- --expected-sha <exact-40-character-Local-SHA>
npm run preview:render -- --execute --expected-sha <exact-40-character-Local-SHA> --scenario editor-ready --viewport large
```

`preview:plan` is a non-rendering preflight; `preview:quick` is the explicit real render fast path. `--current-local` and `--expected-sha` cannot be combined, neither command checks out/fetches/updates Git. Render requires a clean exact-source `Local` checkout and already-installed Vite, Playwright and Chromium. The renderer launches no updater, app installer, CI or native Tauri. It never installs dependencies or downloads a browser; unavailable tools remain NOT_EXECUTED. Existing temporary browser evidence is not automatically accessible in ChatGPT.

## Render QA minimum

1. Confirm `Local` HEAD is the requested full SHA; verify preview dependency files clean before and after capture.
2. Serve existing Vite on **127.0.0.1** and render the real `App.svelte` in an iframe. Deny remote HTTP/WebSocket, service workers and downloads. Use `en-GB`, `Asia/Jakarta`, fixed fixture clock, dark scheme, reduced motion and `deviceScaleFactor=1`.
3. Inspect actual `.desktop-shell[data-qa-fixture]`, page-specific production landmarks, computed styling and horizontal overflow. Check frame `innerWidth/innerHeight` equals canvas dimensions; check visible important controls remain in viewport (not merely parent bounds). Unified Editor validates the real topbar, Project Explorer and LazyDesigner Assistant & Review as two permanently mounted side docks (full-width or shortcut rail), checks the pinned Blockbench Default Dark token fallback, and confirms the **native center is blank with no host controls, markup or images**. Support and Workspace validate their real page headings and body.
4. Verify native host unavailable and synthetic-only badge present. No browser errors, outside network requests or source changes after screenshot.
5. Screenshot only `[data-preview-canvas]` (real iframe render), compute SHA-256, write one ephemeral `receipt.json` outside repository. Any failed QA yields nonzero exit and a FAIL receipt, not a PASS picture.

Priority: P0 = false source/fixture/native truth, external/private leakage, unsupported fabricated preview, hidden critical action. P1 = clipped UI, overflow, missing state, wrong responsive layout. P2 = subtle contrast/spacing details. Static tests and text reviews never establish visual PASS.

## Ephemeral result identity

```yaml
repository: OpenITStudios/M-LazyDesigner
ref: Local
sha: <exact source SHA>
page: editor
scenario: editor-ready
viewport: 1920x1080
fidelity: F0_SOURCE | F2_BROWSER_COMPONENT | F3_TARGET_WINDOWS
rendered: NOT_EXECUTED | VERIFIED
synthetic: true
source_coverage: [App.svelte, UnifiedWorkspacePage.svelte, NativeEditorStage.svelte, desktopFixtures.ts, styles.css, tokens.css]
native_windows: NOT_EXECUTED
native_blockbench_content: NOT_EXECUTED
limitations: <precise unavailable evidence>
```

Keep synthetic fixture data out of user workspaces. A hash attests screenshot bytes only, not trustworthy installed-native behavior. Source updates invalidate receipts by SHA and dependency closure. This protocol does not authorize local/Codex/native work while the current repository hold remains active.
