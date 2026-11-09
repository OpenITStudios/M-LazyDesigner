# Human Interface Contract — LazyDesigner

**Owner:** durable product UX across Desktop and the native Blockbench plugin. **Authority:** the existing Desktop and Blockbench source owns implemented behavior; this document specifies intended human experience, not a second status/router or a claim of tested screenshots. **Scope:** Bedrock visual asset workflows.

## Product mental model

A user should understand three distinct surfaces without learning Gateway terminology:

| Surface | User's purpose | What it must not pretend to do |
| --- | --- | --- |
| **LazyDesigner Desktop** | Open or resume a model, locate project folders, prepare the local installation, inspect connection/update health, recover safely | Become a second modelling editor, own asset state, silently repair/uninstall, infer AI success from process presence |
| **Blockbench + LazyDesigner panel** | Create and edit the asset in native Blockbench; review recent Cube changes and geometry issues; preview/save opt-in particle effects | Duplicate Texture/Animation native tools, create a competing editor or a second AI Gateway, label technical checks visual approval |
| **Connected AI client** | Request AI-assisted authoring through the existing Gateway/Control/Runtime path | Become a mandatory requirement for directly opening, viewing or editing a local model |

The primary user outcome is **continue asset work**. Connection and installation are supporting tasks, not the home screen's purpose. The model file, project revision and native Blockbench state remain authoritative; Desktop statuses are observations and can become stale.

## Navigation and action hierarchy

- Desktop top-level navigation stays **Workspace** and **Support**. **Technical activity (Analytics)** remains an explicit read-only destination under Support, not a third primary section. Avoid extra dashboards, settings panels and capability-list pages unless an observed user task requires them.
- **Workspace:** one strong action for the current state (open/continue model, set up, launch editor, or resolve an actual blocker); projects and recent models next; connection/update details lower in the hierarchy unless an action is needed. With no active model and no valid continuation, **Open Model…** is primary. If a valid model can be resumed, show **Continue [model name]** as the primary action and **Open Model…** as one secondary direct-file alternative. A current model retains **Go to Blockbench** as its primary action. Missing model files or unavailable project folders never displace the safe file picker. On first run, AI setup is a visually secondary action (not a second equally prominent CTA), with an optional **What happens during setup?** disclosure; do not imply setup is required for ordinary editing. An active model or registered projects stay ahead of setup when present; an empty project inventory remains accessible for adding a folder but does not display a nonproductive search field.
- **Support:** previous-action errors and **Troubleshooting** actions appear before read-only About/version/alignment facts. Buttons name their effect (Choose Blockbench…, Show plugin file, Export diagnostics), while rare technical/recovery details stay behind native disclosures with truthful Show/Hide state. Destructive or installation-changing operations require their existing guard, receipt and confirmation. When the first full Desktop status read fails entirely, Support remains navigable: present one explicit unverified-state banner, classified error and next step, one Refresh status control, the independently available diagnostics export, and the Desktop version. Do not invent Blockbench/AI readiness, reveal previous machine details as fresh, enable executable selection, or render migration/repair/update controls without an authoritative status snapshot. The main Workspace may still show its generic safe file-browsing fallback, but that fallback must not replace Support.
- **Blockbench panel:** current Runtime/project identity, then **Geometry checks** (review/locate without changing the model), then **Particle Studio** (optional native authoring). Show one specific empty-state explanation for no project versus a non-Bedrock project, never both at once. The native Runtime-failed state offers an explicit plugin reload and copy-details path without implying Blockbench editing is blocked. Particle Save/Reset labels reflect actual file persistence versus a memory-only draft. Particle Studio is collapsed by default using the host's native disclosure. Its closed summary distinguishes unsaved draft, edited saved file, preview playback, an unfinished operation, blocked Animation Stage and a failure that needs attention; a short error stays visible even when the disclosure is closed. Opening the Studio shows the specific error and file/preview status even when the Animation Stage is unavailable. Editing controls follow familiar Preview → Save → Attach groups; Attach is visibly disabled if the file is not saved or has unsaved edits, without relaxing the existing native authorization rules. The full advanced particle controls must not bury the geometry entry points. Texture painting, UV and native animation remain in their existing Blockbench workspaces.
- When a user must move between surfaces, name the destination: **Open Blockbench**, **Go to Blockbench**, **Open Support**, **Show file in Explorer**, **Connect your AI client**. Do not substitute generic labels such as 'Continue' outside an unambiguous context.

## Unified Editor — Blockbench-native companion layout

The Editor has one real Blockbench native-window reservation between **two permanently present LazyDesigner side docks**: **Project Explorer** (left) and **Diagnostic** (right). Both are mounted during ordinary editing, even on narrow windows. Only the explicitly selected **Focus Editor** action hides both. This is not a WebView clone or substitute Blockbench workspace. The middle DOM reservation is completely empty; the original Blockbench Windows window alone provides its viewport, menus, Outliner, UV, Paint, Animation, Undo and Save when native placement succeeds.

### Single native Blockbench surface — P0 source contract

The central source is exactly one independently running, verified Blockbench
top-level HWND, following the selected-game window approach in
[M-Minecraft-Emulator Local](https://github.com/OpenITStudios/M-Minecraft-Emulator/blob/f24a1aad133ad80eb15d779545805769eca492f4/Development/apps/desktop/src-tauri/src/engine/workspace_surface/native.rs).
Do not import the Emulator's 5-session/parking/preview tiles, DWM
thumbnails, FPS/input virtualization or managed game lifecycle. The Desktop
does not own Blockbench model data, process termination, or app input.

A manually initiated Windows debug-only Place captures exact process/window
identity, native geometry and original frame flags. It temporarily removes
only caption/thickframe/maximized frame bits; it does not modify taskbar/
extended styles, parent ownership or user input. It positions the existing
real HWND into the screen-space native reservation, maintains the exact GDI
manager cutout, verifies actual bounds and checks that a center mouse hit
belongs to the original HWND. Z-order correction is bounded to the
foreground LazyDesigner/Blockbench pair and any temporary topmost pulse
must be undone. Only an explicit user Place may request keyboard focus;
neither that request nor a center hit confirms full native keyboard, modal,
save/Undo, DPI or crash behavior.

Detach attempts independent window/frame restoration and aperture removal
even if the other fails, with forced manager/WebView child invalidation.
Unknown recovery retains its original lease; it never promotes a new HWND,
restarts an action automatically, or terminates Blockbench. The single-window development source now also includes a separate,
same-executable recovery helper with bounded parent-image/process-birth/HWND
validation and a READY checkpoint **before** first native mutation. A clean
Detach disarms the helper after verified frame/geometry/aperture recovery;
an unexpected parent-pipe EOF asks the helper to restore only that original
Blockbench HWND. A missing old HWND is considered retired only if the exact
original process lifetime is verified exited; a live process with a replaced
HWND stays unverified. This is source-level crash recovery design, **not
proof that the helper launches, survives a crash or restores Windows state**.
F3 Windows/native acceptance is required before enabling release. Until
then all executable/native behavior remains UNVERIFIED; GitHub source
checks are not a runtime PASS.

### Blockbench visual authority

For an uncustomized Blockbench installation, align the desktop host with the **actual Blockbench v5.2.1 Default (Dark)** source:
`https://github.com/JannisX11/blockbench/blob/v5.2.1/themes/dark.bbtheme`. The relevant native tokens include `--color-ui: #1e2127`, `--color-back: #181b1f`, `--color-dark: #101316`, `--color-selected: #3b3e49`, `--color-elevated: #272a31`, `--color-button: #33383f`, `--color-accent: #3e90ff`, `--color-text: #cacad4`, and `--color-subtle_text: #848891`. The Blockbench v5.2.1 panel tab bar is 40px tall, and the selected Outliner row is 28px (`css/panels.css`). Use the same 40px tab strips, 28px tree rows, quiet selection background, compact typography and neutral toolbar controls rather than an alternate app-dashboard appearance. The unoccupied native reservation uses Blockbench's `--color-dark` baseline with **no** synthetic editor content.

These tokens are a **default-theme fallback**, **not proof of an automatic read of the user's currently selected Blockbench theme**. A separately running native process may have a different user-custom theme or fonts. Do not claim exact runtime theme sync without a verified read-only contract. Never override the native Blockbench theme or copy/replace its own editing controls.

| Editor width | Left companion | Center, native Blockbench | Right companion |
| --- | --- | --- | --- |
| 1810px or wider | Project Explorer full, default 220px | Remaining space (about 1448px at 1920px) | Diagnostic full, default 240px |
| 1320–1809px | Project Explorer full | Remaining space (about 1128px at 1600px) | Diagnostic full |
| 920–1319px | Project Explorer shortcut rail (48px) | Dominant remaining space | Diagnostic shortcut rail (48px) |
| Under 920px | Left rail (~44px) | Dominant remaining space | Right rail (~44px) |

On narrower windows the user may explicitly expand one side while its counterpart remains present as a rail, never disappearing or overlaying Blockbench. Expansion is admitted only when the reserved native center retains at least **320 CSS px**; if insufficient, the Project Explorer rail offers a clearly labeled route to Workspace and the Diagnostic rail offers Support/technical activity instead of making Blockbench unusably narrow. Both rails retain discoverable, keyboard-operable controls. The side widths are bounded to 160–260px for Project Explorer and 220–300px for Diagnostic, resized with in-flow pointer/keyboard dividers. User changes and explicit Focus Editor are session-only layout preferences; navigating to Support/Workspace and back preserves them where the width band is unchanged. Changing responsive bands selects rail/full defaults, not removal of a side.

### Left: Project Explorer

A compact, accessible, searchable native-style project/model tree: the search field uses one inline icon row with its label preserved for screen readers; project count becomes visually visible only when filtering. Filtered project matches expand automatically with the non-operative disclosure control disabled and clearly labelled, so a button does not pretend it can collapse search results. Use the same Svelte-owned folder, chevron, search and ellipsis SVG system throughout the tree, preserving model-name room. Show the last-observed model with Blockbench's `--color-selected` fill (no custom accent stripe) and independent Current/Modified/Missing markers, never fabricated live save state. The **Show in Explorer** button is a direct file-reveal action with a folder-open icon, not an ellipsis pretending to be a menu. To give names the full row width at rest, the reveal control occupies the right edge on hover or keyboard focus; in non-hover/touch environments it stays visible with reserved space. Disabled controls stay visibly disabled and non-interactive. The explicit title and accessible name preserve discoverability; do not introduce a second model-action popup. Each project has one compact actions disclosure with Pin/Unpin and Open Folder in the normal document flow, preserving project-name width and avoiding any popup over the native cutout. When opening or collapsing a dock, keyboard focus returns to an available search/heading/toolbar control instead of being lost on removed content. A project exposes safe opaque-ID folder navigation for Models/References/Textures/Exports, Pin/Unpin, Reveal/Open in Explorer, and a compact Recent Models section. Keep destructive operations in their guarded Workspace flow, not a one-click side-row action. Empty states point to Add Project Folder or Open Model. Native file pickers and model navigation retain the original window Detach/Restore safety gate. Project Explorer never duplicates Blockbench's Cube Outliner.

### Right: Diagnostic

The permanent right dock is simply **Diagnostic** with only two Blockbench-style tabs: **Diagnostic** and **Activity**. There is no Assistant chat, Model Review, duplicated modelling functionality, fabricated QA result, or new background service.

- **Diagnostic:** show the existing Rust-owned readiness summary and status at last observation, Blockbench running state, plugin integrity, and genuine diagnostic messages only when present. Keep optional technical details behind one native disclosure. Apply the same 30-second full-status observation freshness boundary already used by the Desktop AI-status presentation: an outdated, missing-timestamp or repeatedly failed observation is **not** displayed as newly verified ready. Preserve the last-known summary as explicitly historical. Refresh uses the existing Desktop status action; troubleshooting opens Support. Never infer that a stale check means Blockbench or the connection is disconnected.
- **Activity:** show the existing observed AI/Gateway connection status and a minimal **last-observed project/model count** from Desktop project-navigation data. Explicitly label these as project inventory, not as live AI-operation statistics. The **View Gateway statistics** action opens the existing read-only Analytics page, which owns actual Gateway metrics; do not fake or duplicate them in the dock.

The **selected tab is the only visible title**: Diagnostic and Activity share exactly one native-style **40px tab strip**, with a small collapse button beside (not inside) the accessible tablist. Do not stack a second Diagnostic heading above the tabs. Arrow Left/Right/Home/End navigate the tabs; after expanding the right rail, keyboard focus moves to the currently selected tab. The host toolbar does not repeat the AI connection status: that belongs only to Activity, reducing duplicate controls and protecting model-title space. On a narrow right rail there are only two top-level shortcuts: expand Diagnostic (or open Support when expansion would crush the native center) and open technical Activity. The two tabpanels stay structurally available but only the selected panel is visible. On narrow viewports the right dock becomes an icon rail with access to Diagnostic/Support and technical statistics; it must never disappear automatically or obstruct the original native Blockbench window.

The host header stays a restrained ~32px utility strip on wide windows, not a copy of Blockbench's own 28px menu bar or 30px toolbars. At 1030 CSS px and below, this becomes a **single ~38px non-wrapping line**, with the actions in an explicitly bounded horizontal scroll region rather than creating a second header row or widening the whole page. All buttons remain discoverable and keyboard-reachable by Tab; scrolling a utility toolbar never moves/crops the reserved Blockbench editor. This preserves Workspace, model context, panel rail/full toggles, Focus Editor, Open Model, guarded native Place/Detach and Support without building an overflow popover or duplicating native controls. The Blockbench native reservation never contains any LazyDesigner header, footer, label, screenshot, simulated icon or generated model.

### Acceptance limits

An F2 screenshot must show the **real Svelte application** with both side docks (either full or rail), official default-dark fallback colors, an empty center with sufficient area, no unintended horizontal overflow, and real navigation/keyboard focus. It must not represent a native Blockbench capture. F3 requires matching installed Windows debug Tauri + actual original Blockbench, including DPI, focus, resize, input, window restoration and checking any customized theme independently. In the current GitHub-only source context these executable/native visual claims remain unverified. No generative image or reconstructed screenshot is acceptable as a source-app proof.

## Task journeys and truthful UI states

| Starting state | User expectation / immediate action | Safeguard and language |
| --- | --- | --- |
| No active model, including first run | **Open Model…** opens an existing .bbmodel; optionally add a project folder | AI setup is separate; setup steps are collapsed until requested. Empty project search is hidden, but Add Project Folder stays available |
| Saved recent model, editor not active | **Continue** the exact known model or browse another | Reject missing/ambiguous file paths; do not claim the native tab finished loading |
| Welcome / no managed installation | **Set up** when the verified local package is available | Project browsing remains visible; staged setup is not installed |
| Ready to start / editor closed | **Open Blockbench** | Foreground-window focus is best effort; do not infer model save/persistence |
| Plugin setup or trust approval pending | Show one next step: prepare editor, review matching versions, or explicitly approve the existing plugin | Never silently close an editor or replace a plugin in use |
| AI client absent / handshake unverified | Continue normal Blockbench editing; explain how the external AI session connects when needed | Process detection does not equal verified MCP handshake |
| AI verified at the last full check | Display **Verified at last check** with its observation age; never imply a permanently connected client | A 30-second UI presentation boundary marks an old *full status observation* as out of date, even without a failed probe; this is not an independent Gateway handshake or native permission decision |
| Unsupported/mismatched package | Show the actual constraint and a Support path | No forced repair, version bypass, or unverified update |
| Full-status probe becomes unverified | **Refresh** status; keep independently revalidated native model and Explorer navigation available | Block stale managed actions, preferences, deletion and current-session focus; do not claim requested model launch is confirmed without native acknowledgement |
| Particle draft / unsaved model | Preview without writing JSON; save only through explicit authorized action | The Save/Attach buttons must retain current path/Stage restrictions and never imply preview is persistence |

## Interaction and content rules

1. **One next action per state.** Use a visible active verb and name the effect. Give a precise reason if disabled; prefer a recoverable route to a dead-end button. When a stale machine observation prevents project preference changes, destructive operations or editor focus, show one visible explanation near affected controls and associate disabled actions with that explanation without changing the existing Rust permission checks. Safe file navigation stays available.
2. **Separate observation from completion.** Use 'checking', 'verified at last check', 'check out of date', 'needs approval', 'staged', 'completed' and 'failed' only when the corresponding existing receipt supports it. A native acknowledgement and a subsequent full Desktop status refresh are **independent results**: if refresh fails, retain the original receipt and show a status-unverified next step, never an unqualified success. Do not mark a Recycle Bin operation failed merely because a later status check failed, and never offer an automatic destructive retry. Action feedback must not claim success for a request merely sent to Blockbench. Keep one non-obstructing, in-flow feedback strip immediately below the Desktop toolbar; do not cover Workspace or project action buttons with a floating overlay. The same AI status label must appear in Workspace and Support; a running editor is distinct from a verified AI session. Support shows an unsuccessful action in its own detailed section rather than duplicating a toast. The existing Workspace progress strip is not repeated as a second 'Working' notification. A later failure replaces stale prior feedback; a 'Next step' remains until dismissed or superseded, while short success/no-change notices may auto-expire.
3. **Search is a task.** Project/model search needs a visible label, matching-project count, explicit Clear search, and focus restoration; project matches may include models within them. A named, existing, non-active model with **exactly one** match may be opened by an explicitly described Enter shortcut; ambiguous/unavailable/model-active results must require ordinary visible controls. Escape clears a populated search while retaining focus, and IME/modified-key sequences do not trigger Open. Search never changes project preferences or filesystem state, and the existing native verification path remains mandatory for model-open actions.
4. **No silent destruction.** 'Remove from Workspace' only removes the registered shortcut; 'Delete Project…' is a distinct destructive operation that preserves the existing explicit Recycle Bin review and cancellation gate. In Blockbench Particle Studio, New Effect or Open must ask before discarding an unsaved in-memory draft or unsaved changes to a previously saved effect. Cancel preserves current draft settings and preview without initiating a file or host operation; opening an unchanged saved effect requires no warning. Project switching still follows Blockbench's native lifecycle, so the panel must warn that unsaved particle edits will be lost when changing projects.
5. **Status, failure and empty states:** distinguish no projects, zero search matches, missing folders, disconnected AI and unavailable runtime. Avoid developer acronyms on the primary path; keep diagnostic detail in Support. An unsuccessful action must distinguish **what failed**, **one safe next step**, and **what remains unverified**. Choose safe status Refresh only for a status-observation problem, Open Support for troubleshooting, or no direct action when the user must inspect the filesystem first. Never offer a one-click retry of Delete Project after an uncertain Recycle Bin result. Keep native/manager authorization and receipts authoritative; do not send a user to a Support view that cannot render when initial machine status is unavailable. An unverified staged update must not disappear behind a healthy AI state.
6. **Accessibility:** visible focus, semantic labels, reachable controls, non-trapping navigation, keyboard-accessible disclosures, an announced search result status, meaningful progress and error feedback, responsive text overflow, 200% zoom review, reduced motion, and pointer/keyboard alternatives. When status blocks project preference changes or deletion, provide a keyboard-reachable **Refresh status** action beside the explanation, not only `aria-describedby` on disabled controls. The Delete Project dialog must expose the exact folder path and current blocking reason to assistive technology. On completed recycling, move focus to a persistent Workspace heading if the initiating project action has disappeared. In native Particle Studio, locked controls reference the visible reason (save the model, save changed effect, or preserve authored expressions) without changing native authorization. Responsive rules must retain project actions, accessible notices and diagnostics when space is tight; the 390px development fixture is only a visual proxy, not native zoom acceptance.
7. **Visual consistency:** Desktop uses its existing dark/green token source in apps/desktop/src/tokens.css and shared styles; native Blockbench panel uses host theme variables in mcp/ui/panel.css. Share usability principles, **not a forced common palette**. Keep the same section rhythm, card radius and action-menu hit areas across Desktop views; use existing spacing/radius tokens rather than new colors. Do not add new token files, UI frameworks or install scripts for routine adjustments.

## Measurement and acceptance: do not substitute source review for UX proof

The baseline is source-observed, not a measured usability score. The existing offline Desktop fixture now defines **five browser-only task paths**, including a hidden-eighth-project search and a non-mutating path to Support recovery. Its `taskJourney` records availability, browser interaction count, issues and automation elapsed time; these are **synthetic navigation diagnostics**, not real human completion, native action, task success, or a measured efficiency gain.

Compare identical user tasks and constraints before/after only when an executable/native context is authorized. A later genuine usability session must separately record human success, actions/clicks, time-to-completion, misunderstanding, wrong-target attempts, recoveries and perceived clarity. Do not combine synthetic elapsed time with user timing or infer a quality score from fewer clicks alone.

| Scenario | Source-level acceptance | Later executable/native evidence (currently NOT_EXECUTED) |
| --- | --- | --- |
| Fresh install and no project | Model-open remains available without AI or setup | Fixture keyboard + 780×560/980×680 screenshots; real model-open flow |
| Ready with 7+ projects | Eight-project offline fixture includes a uniquely identified Needle asset in the eighth project; search finds it across all projects, explains unique-model Enter and Escape reset, while ambiguous or unavailable names cannot auto-open | Keyboard Enter/IME/Escape behavior, focus retention, native model activation truth and real discovery time |
| Connection uncertainty | Last-known AI state is visibly qualified on both pages; Rust-revalidated file navigation stays available but stale managed actions are blocked | Forced disconnected/failed probe, retry and recovery |
| Full AI status observation aged, without a failed probe | Workspace and Support both label the last check out of date, offer Refresh, and do not infer disconnect; invalid/future timestamps are not treated as recent | Fixed 30-second boundary tests, synthetic aged-status fixture, foreground/monitor update and actual freshness observation |
| Pending action (staged update, plugin approval, unverified model/editor launch) | The requested model row shows Opening… and a single announced model-specific progress state; the verified/unverified native receipt controls the eventual message | Fixed offline model-opening and success/pending/error fixtures; real Blockbench focus, model-tab activation and failure recovery remain separately unverified |
| First geometry issue in native panel | Geometry actions precede the optional collapsed Particle Studio; unsupported Bedrock format has an explanation | At least 100 Cubes, correct UUID locate, no edit/Undo mutation, measured task time |
| Particle Studio collapsed and expanded | Summary exposes error/unsaved draft/unsaved edits/preview Stage state without losing the current effect; the closed error is concise and the expanded error is specific | Keyboard disclosure, one visible error alert at a time, same draft across collapse/reopen, native Save/Attach/preview restrictions |
| Particle Studio from a draft | Preview comes before Save and Attach; Save Changes writes the file, Reset Draft only resets in-memory settings, unsaved edits disable Attach, and New/Open require confirmation before replacing work | Cancel preserves the current draft/preview; unchanged saved effects open without a prompt; verify native focus, locked expressions, saved-file/failed-preview separation and rejected Save |
| Blockbench project not eligible | One Geometry empty state distinguishes no project from wrong format; Particle identifies the needed Animation stage; failed Runtime offers bounded recovery | Native keyboard, collapsed summary state and no false-ready status |
| Support recovery | Troubleshooting precedes About; actions name their effect; native Show/Hide state agrees with disclosure expansion. Classified errors show **Next step** and **Still to verify** separately from advanced raw details | Offline fixture keyboard disclosure, error recovery action mapping and matching installed Desktop behavior |
| Recovery and deletion | Error cause, one safe next step and still-unverified outcome are separate; the status-timeout action only rechecks status; uncertain deletion has **no** direct retry. The modal announces its exact folder target and blocked state, and focus returns to a persistent heading after recycling | Synthetic timeout/delete-unknown fixtures plus later native Cancel/confirm, keyboard focus, full status, filesystem/Recycle Bin proof |
| Native action acknowledged but full status refresh failed | Show the acknowledged operation and an explicit **status not verified** message, rather than falsely completing, undoing or repeating the native operation; keep native receipt distinct from machine readiness | Synthetic source fixtures and regression for model launch, project changes, recycle, setup/connection and managed updates; real native receipt and full-status failure still need independent execution proof |
| Stale project decisions | Disabled preference/deletion/focus actions reference one nearby recovery instruction that points to visible Refresh when available; read-only/native file navigation stays enabled | Keyboard reading order, accessible description, full Refresh and safe navigation |
| Narrow effective viewport | Rows, toolbar and Support diagnostic text wrap without losing actions; the 390px fixture is a narrow-layout proxy only | 390×640/780×560/980×680 fixture review plus separate native 200% zoom and screen-reader acceptance |

## Scope and proof boundary

**Do not add** a new Control Stage, Skill, MCP tool, process monitor, telemetric service, duplicate native editor, persistent UX state, or release workflow as a shortcut to better UX. UI UX Pro Max guides the interface review within the eight local Agent Rules methods, and the existing development/test owners remain unchanged.

GitHub source review and authored regressions establish intent and structural changes only. No claim of native accessibility, screen-reader behavior, runtime feature quality, executable PASS or production acceptance is made without matching actual execution evidence.


## Experimental native composition — source-only P0 (2026-11-08)

The user selected the LazyTester native-window-composition principle: an independent
installed Blockbench.exe remains the only editor and model-state owner, while
LazyDesigner may visually position its existing Windows top-level window inside
a bounded Desktop Editor area. This is **not** a WebView port, a DWM thumbnail,
cross-process SetParent child hosting, or a second Geometry/UV/Animation editor.

The initial owner is `apps/desktop/src-tauri/src/blockbench_surface.rs`, with
the existing `blockbench.rs` process selection and a development-only
`NativeEditorStage.svelte` caller. P0 exposes the route only in Windows debug
builds and a dev-only Editor preview page. Normal Workspace/Support and
production packages stay unchanged. User explicitly selects Show/Detach;
no app startup, background probe, model-open receipt or AI operation can
implicitly reposition Blockbench. No process is closed or relaunched by
native presentation. Only rectangle/z-order placement is attempted; native
window frame, owner/parent, taskbar style, executable, userData profile,
model files, plugin and all rendering/input remain unchanged.

Admit exactly one verified running Blockbench executable and one visible
unowned editor HWND, plus the verified LazyDesigner window. Pin PID,
process birth, native thread and class for each accepted lease; refuse
ambiguity, minimized/maximized editor, Always on Top and stale identity.
Check finite CSS viewport, client bounds and DPI before placement; re-read
the physical window geometry. On uncertainty, never repeat a native
mutation automatically. Detach restores original geometry before changing
pages, and Rust attempts the same on normal app exit. Since no window
style/parent is changed, even an unexpected app crash leaves Blockbench
as a normal independent, movable Windows application; position after
crash is not guaranteed.

**Proof boundary:** SOURCE_AUTHORED and viewport regression AUTHORED_NOT_EXECUTED.
Windows HWND/z-order, Electron dialogs, multi-monitor DPI, focus,
minimize/maximize, editor saving/Undo, crash behavior and one-shell usability
are NOT_EXECUTED/UNVERIFIED. Do not call it a native embedded editor or
mark production READY before matching Windows acceptance.


### Native aperture follow-up — source change, not live acceptance

The P0 Windows-debug composition now proposes a region cutout on the *manager*
HWND using GDI `CombineRgn(RGN_DIFF)`, physical viewport positions, and
window-relative (not client-relative) region coordinates. All GDI region
handles follow OS transfer ownership after successful `SetWindowRgn`.
It refuses to replace unknown/external clipping or an unverified original
Blockbench HWND. Detach attempts both restoration of original Blockbench
geometry and removal of the manager cutout even if one step fails, retaining
uncertain state rather than automatically retrying. Minimize requests a
bounded restore; moving/resizing/focusing the manager may request a coalesced
layout refresh. Foreign foreground produces DEFERRED without a window change.
These are source-authored behaviors; Tauri/WebView2 native clipping, native
Blockbench input/dialogs, focus, DPI and reliable restoration remain untested.


## Unified Editor P1 — source-authored development preview (2026-11-08)

The user selected a unified LazyTester-style workspace around the **original**
Blockbench native window. The development-only `Editor` route now composes
one `UnifiedWorkspacePage.svelte` with a compact Project Explorer at left,
existing `NativeEditorStage` at center and a collapsible AI/QA information
panel at right. This does not modify the production Workspace/Support routes
or become a new authoring engine. No additional navigation layers, fake
rendered Blockbench frame, AI chat provider, QC score or new MCP/Runtime tool.

The Project Explorer consumes canonical `project_navigation` opaque IDs and
existing `desktopPresentation` search/continue/recent projections. A chosen
model invokes the existing `openModel` owner, project-folder actions invoke
the existing `runProjectAction` owner, and selected folder registration
retains existing Rust authorization. Before a file picker/Explorer/model-open
action can change native focus, the view awaits **the same P0 Detach** receipt;
an uncertain or busy native lease blocks the action without triggering
another placement. Ordinary direct model browsing remains possible without
AI readiness. Search Enter cannot guess an ambiguous/missing model, and
Escape only resets the query. No paths are accepted from frontend input.

The right pane labels AI status using the same `aiStatusPresentation`
and full-observation freshness rules as existing Workspace/Support. It
identifies Geometry/Particle controls as Blockbench-plugin owned and
Texture/Animation as native Blockbench owned; it does not claim they have
run or duplicate controls and authoring state. Status refresh and Support
routing are existing actions. Panels reflow without overlaying the native
aperture. At narrow effective widths, their content stacks rather than
floating above Blockbench. Native 200% zoom, focus, screen-reader, model
persistence, and real editor composition remain NOT_EXECUTED/UNVERIFIED.

Deterministic browser fixtures may now render `?fixture=ready&view=editor`,
`?fixture=many-projects&view=editor` and
`?fixture=fresh-install&view=editor` with **all native/file actions disabled**.
Any Playwright screenshot of those fixtures is authentic frontend render
evidence only, not an interactive native Blockbench screenshot or a usability
score. No renderer replacement, SetParent or release promotion.


## Blockbench-aligned native workspace visual contract — 2026-11-08

User approval: the existing Windows-native Blockbench composition is the
centerpiece. The editor must feel like one cohesive work environment,
without recreating the native Blockbench menus, Outliner, UV, painting,
animation or status bar in LazyDesigner.

- **One host toolbar:** In development Editor only, omit the ordinary
  LazyDesigner global navigation and page toolbar. The Editor page owns
  a compact approximately 52 px header with brand, Workspace return,
  last-observed model/project, an explicitly qualified AI status,
  Project Explorer and AI/QA toggles, Open Model and Support. The native
  Blockbench menu/title chrome remains unmodified. The small native
  placement/Detach rail is operational chrome, not a second navigation
  bar. Navigating away awaits P0 Detach; uncertain restore stays visible.
- **Scoped palette:** Graphite/blue-gray surfaces #1b1f27, #252b35,
  #232833 and muted blue selection/focus #85a9df are confined to
  UnifiedWorkspacePage / its native-stage presentation. Never rewrite
  Blockbench theme/preferences or the global LazyDesigner green
  product tokens. Contrast/keyboard focus remain independently testable.
- **Viewport priority:** At 1320 px and wider, Project Explorer (216 px)
  and AI/QA (264 px) may both be open. From 920 to 1319 px, only the
  Project Explorer opens by default; choosing AI closes Projects. Below
  920 px, both docks start collapsed. A manually opened compact dock
  occupies a bounded row in the grid, never a native-window overlay.
  Resizing across a width band selects a safe default, whereas
  within-band manual choices remain temporary view state.
- **Single authority:** Project Explorer resolves opaque model/folder
  identifiers through the pre-existing native bridge; keyboard search
  cannot infer an ambiguous file. AI/QA continues displaying honest
  age-qualified connection status and Blockbench/plugin ownership,
  not copied editors, generated QA claims or new MCP actions. File
  pickers, model-open and Explorer actions await native Detach first.
- **Truthful visual proof:** Browser fixture URLs
  \`?fixture=ready&view=editor\`,
  \`?fixture=many-projects&view=editor\` and
  \`?fixture=fresh-install&view=editor\` can capture the actual Svelte
  shell at 390×640, 780×560, 980×680 with Blockbench actions disabled.
  The capture harness checks missing duplicate app chrome, responsive
  dock defaults, keyboard search and disabled native placement.
  These screenshots are **not** Blockbench native proof.

Only source/fixture contract tests are authored. Typecheck, screenshots,
keyboard/screen-reader usability, high-DPI native cropping, focus and
installed Blockbench behavior are NOT_EXECUTED / UNVERIFIED.
