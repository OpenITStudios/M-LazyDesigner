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
- **Workspace:** one strong action for the current state (open/continue model, set up, launch editor, or resolve an actual blocker); projects and recent models next; connection/update details lower in the hierarchy unless an action is needed. With no active model, **Open Model…** is the primary entry. On first run, AI setup is a visually secondary action (not a second equally prominent CTA), with an optional **What happens during setup?** disclosure; do not imply setup is required for ordinary editing. An active model or registered projects stay ahead of setup when present; an empty project inventory remains accessible for adding a folder but does not display a nonproductive search field.
- **Support:** previous-action errors and **Troubleshooting** actions appear before read-only About/version/alignment facts. Buttons name their effect (Choose Blockbench…, Show plugin file, Export diagnostics), while rare technical/recovery details stay behind native disclosures with truthful Show/Hide state. Destructive or installation-changing operations require their existing guard, receipt and confirmation.
- **Blockbench panel:** current Runtime/project identity, then **Geometry checks** (review/locate without changing the model), then **Particle Studio** (optional native authoring). Show one specific empty-state explanation for no project versus a non-Bedrock project, never both at once. The native Runtime-failed state offers an explicit plugin reload and copy-details path without implying Blockbench editing is blocked. Particle Save/Reset labels reflect actual file persistence versus a memory-only draft. Particle Studio is collapsed by default using the host's native disclosure. Its closed summary distinguishes unsaved draft, edited saved file, preview playback, an unfinished operation, blocked Animation Stage and a failure that needs attention; a short error stays visible even when the disclosure is closed. Opening the Studio shows the specific error and file/preview status even when the Animation Stage is unavailable. Editing controls follow familiar Preview → Save → Attach groups; Attach is visibly disabled if the file is not saved or has unsaved edits, without relaxing the existing native authorization rules. The full advanced particle controls must not bury the geometry entry points. Texture painting, UV and native animation remain in their existing Blockbench workspaces.
- When a user must move between surfaces, name the destination: **Open Blockbench**, **Go to Blockbench**, **Open Support**, **Show file in Explorer**, **Connect your AI client**. Do not substitute generic labels such as 'Continue' outside an unambiguous context.

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
