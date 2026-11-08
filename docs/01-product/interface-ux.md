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
- **Workspace:** one strong action for the current state (open/continue model, set up, launch editor, or resolve an actual blocker); projects and recent models next; connection/update details lower in the hierarchy unless an action is needed.
- **Support:** version/alignment facts, diagnostics, previous-action errors and explicit recovery. Destructive or installation-changing operations require their existing guard, receipt and confirmation.
- **Blockbench panel:** current Runtime/project identity, then **Geometry checks** (review/locate without changing the model), then **Particle Studio** (optional native authoring). The full advanced particle controls must not bury the geometry entry points. Texture painting, UV and native animation remain in their existing Blockbench workspaces.
- When a user must move between surfaces, name the destination: **Open Blockbench**, **Go to Blockbench**, **Open Support**, **Show file in Explorer**, **Connect your AI client**. Do not substitute generic labels such as 'Continue' outside an unambiguous context.

## Task journeys and truthful UI states

| Starting state | User expectation / immediate action | Safeguard and language |
| --- | --- | --- |
| No active model, including first run | **Open Model…** opens an existing .bbmodel; optionally add a project folder | Explicitly state AI is optional for opening/editing; do not imply the Desktop edits model geometry |
| Saved recent model, editor not active | **Continue** the exact known model or browse another | Reject missing/ambiguous file paths; do not claim the native tab finished loading |
| Welcome / no managed installation | **Set up** when the verified local package is available | Project browsing remains visible; staged setup is not installed |
| Ready to start / editor closed | **Open Blockbench** | Foreground-window focus is best effort; do not infer model save/persistence |
| Plugin setup or trust approval pending | Show one next step: prepare editor, review matching versions, or explicitly approve the existing plugin | Never silently close an editor or replace a plugin in use |
| AI client absent / handshake unverified | Continue normal Blockbench editing; explain how the external AI session connects when needed | Process detection does not equal verified MCP handshake |
| Recently verified AI connection | Display **recently verified**, not permanently connected | Refresh/probe uncertainty can downgrade a status; never promise a live session from an old receipt |
| Unsupported/mismatched package | Show the actual constraint and a Support path | No forced repair, version bypass, or unverified update |
| Full-status probe becomes unverified | **Refresh** status; keep independently revalidated native model and Explorer navigation available | Block stale managed actions, preferences, deletion and current-session focus; do not claim requested model launch is confirmed without native acknowledgement |
| Particle draft / unsaved model | Preview without writing JSON; save only through explicit authorized action | The Save/Attach buttons must retain current path/Stage restrictions and never imply preview is persistence |

## Interaction and content rules

1. **One next action per state.** Use a visible active verb and name the effect. Give a precise reason if disabled; prefer a recoverable route to a dead-end button.
2. **Separate observation from completion.** Use 'checking', 'recently verified', 'needs approval', 'staged', 'completed' and 'failed' only when the corresponding existing receipt supports it. An action toast must not claim success for a request merely sent to Blockbench. The same AI status label must appear in Workspace and Support; a running editor is distinct from a verified AI session. An actionable 'Next step' persists until dismissed or superseded, while brief success/no-change notices may auto-expire.
3. **Search is a task.** Project/model search needs a visible label, matching-project count, explicit Clear search, and focus restoration; project matches may include models within them. Search must never mutate project preferences or filesystem state.
4. **No silent destruction.** 'Remove from Workspace' only removes the registered shortcut; 'Delete Project…' is a distinct destructive operation that preserves the existing explicit Recycle Bin review and cancellation gate.
5. **Status, failure and empty states:** distinguish no projects, zero search matches, missing folders, disconnected AI and unavailable runtime. Avoid developer acronyms on the primary path; keep diagnostic detail in Support.
6. **Accessibility:** visible focus, semantic labels, reachable controls, non-trapping navigation, keyboard-accessible disclosures, an announced search result status, meaningful progress and error feedback, responsive text overflow, 200% zoom review, reduced motion, and pointer/keyboard alternatives.
7. **Visual consistency:** Desktop uses its existing dark/green token source in apps/desktop/src/tokens.css and shared styles; native Blockbench panel uses host theme variables in mcp/ui/panel.css. Share usability principles, **not a forced common palette**. Do not add new token files, UI frameworks or install scripts for routine adjustments.

## Measurement and acceptance: do not substitute source review for UX proof

The baseline is source-observed, not a measured usability score. Compare the same representative task before/after on the same build, fixture, viewport and keyboard path. Record user success, actions/clicks, time-to-completion, error/recovery and any wrong target separately.

| Scenario | Source-level acceptance | Later executable/native evidence (currently NOT_EXECUTED) |
| --- | --- | --- |
| Fresh install and no project | Model-open remains available without AI or setup | Fixture keyboard + 780×560/980×680 screenshots; real model-open flow |
| Ready with 7+ projects | Search sees beyond the initial six, counts matching projects, Clear returns focus to search | Keyboard tab/screen-reader check and reset behavior |
| Connection uncertainty | Last-known AI state is visibly qualified on both pages; Rust-revalidated file navigation stays available but stale managed actions are blocked | Forced disconnected/failed probe, retry and recovery |
| Pending action (staged update, plugin approval, unverified model/editor launch) | The next step is distinct from success and remains visible until dismissed or replaced | Keyboard notice dismissal, real focus/handshake verification and no false completed claim |
| First geometry issue in native panel | Geometry actions precede the optional particle form; unsupported Bedrock format has an explanation | At least 100 Cubes, correct UUID locate, no edit/Undo mutation, measured task time |
| Particle Studio from a draft | Preview and persistence are distinct; stage/path/advanced-field guards are retained | Animation-stage draft, Save, Attach, reload, native visual playback |
| Recovery and deletion | Clear failure copy and safe recovery entry; no conflation of remove vs delete | Cancel/confirm, focus restoration, filesystem/Recycle Bin proof |

## Scope and proof boundary

**Do not add** a new Control Stage, Skill, MCP tool, process monitor, telemetric service, duplicate native editor, persistent UX state, or release workflow as a shortcut to better UX. UI UX Pro Max guides the interface review within the eight local Agent Rules methods, and the existing development/test owners remain unchanged.

GitHub source review and authored regressions establish intent and structural changes only. No claim of native accessibility, screen-reader behavior, runtime feature quality, executable PASS or production acceptance is made without matching actual execution evidence.
