# LazyDesigner Desktop

This directory owns the desktop **machine control plane** only. Cross-surface human navigation, labels and UX scenario acceptance are defined in the [Human Interface Contract](../../docs/01-product/interface-ux.md); this README remains the implementation-facing Desktop behavior owner.

## Responsibilities

Desktop 0.1.1 embeds its source SHA and compatibility contract. Support shows this build separately from the active managed build. Readiness requires a verified aligned installation and a supported manifest contract; an old manager lacking alignment evidence cannot make this Desktop ready. The manager retains authority for the inspection and update transaction. See [Managed Distribution](../../distribution/README.md#installation-alignment-and-desktop-compatibility).

Support's explicit legacy migration requests the manager's backed-up, session-safe path. Normal setup still refuses legacy conflicts until that action is selected. A migration waiting for old Codex processes remains staged; finish those MCP sessions and retry setup. Product/Runtime updates are refused before activation when they require a different Desktop contract; use the verified compatible Desktop installer. No unsigned self-updater is enabled.

- detect whether desktop Blockbench is running;
- discover the existing LazyDesigner managed installation;
- invoke the canonical managed `lazydesigner.exe status` contract;
- present Gateway/Runtime/update health;
- supervise bounded user-requested lifecycle actions and safe self-healing;
- keep lightweight Runtime/Blockbench connection readiness current while Desktop is active without spawning the managed CLI on every heartbeat.

## Analytics (read-only, in the main Desktop)

The main navigation provides **Workspace · Support**. Read-only Analytics remains available from **Support → Technical activity**, without occupying a primary tab.
`src/AnalyticsPage.svelte` is a small read-only view, not another
dashboard service. `src/App.svelte` makes two explicit Tauri IPC requests:
`analytics_overview` only on entering Analytics or selecting Refresh,
and `export_analytics` only after the user selects Export JSON.
Copy JSON copies the currently displayed summary to the clipboard.
Analytics remains available when Blockbench or the managed client is offline.

`src-tauri/src/analytics.rs` reads **only** matching, bounded Gateway L0
session snapshots from the existing per-user local Analytics cache. No Bun,
local repo checkout, Runtime health request, live model inspection, Codex
session file, database, background watcher, telemetry upload, or AI call is
needed. It validates L0 session identities, counts and scopes, rejects
symlinks/non-files and oversized snapshots, skips corrupt files with an
explicit invalid-file count, and never uses project names or paths inferred
from metadata. A native UUID SHA-256 is not a verified Workspace identity.

The view shows call/failure counts, coverage, authoring-domain call-duration
sums, capability counts, and bounded build attribution where measured.
It does **not** infer stage elapsed time, task wall time, visual approval,
provider tokens, or full project history. Unknown builds, prior unmeasured
sessions, open/unclean snapshots, and storage errors remain explicit.
Desktop output is a **display/AI-export projection** of the same L0 source
that the offline AI reader consumes; it is not a second data owner or
replacement for full Golden evidence/archival trace inspection.

Source tests in `analytics.rs` cover bounded aggregation, corrupt-file
handling, duplicated session refusal, native identity isolation and
unknown JSON field exclusion. Installed Desktop UI/UX behavior and native
acceptance require their own matching-build evidence; a source commit
alone is not such proof.

## Explicit non-ownership

Desktop does **not** own:

- Geometry, Texture, Animation, Particle authoring;
- Blockbench project state, Undo/Redo, viewport or export;
- MCP capability routing or Control context projection;
- release download, package verification, update staging, rollback journals, or Codex configuration rewriting.

Those remain owned by the existing Runtime/Gateway/Managed Distribution layers.

## Frontend module ownership

`src/App.svelte` composes views, explicit user actions and the existing Rust IPC contracts. `src/connectionMonitor.ts` owns passive probe scheduling, overlap prevention, stale authority and disposal; it reuses the pure comparison/cadence rules in `connectionWatch.ts` and never discovers updates or repairs installations. `src/managedProgress.ts` owns asynchronous progress subscription cleanup. `src/desktopFixtures.ts` owns development-only presentation fixtures; App enables them only in Vite development mode. IPC types remain in `desktopTypes.ts`; display mappings remain in `desktopPresentation.ts`.

These modules do not own project contents, Gateway lifecycle or managed-distribution transactions. Frontend refactoring proof is separate from native installed acceptance.

`src/editorOperations.ts` owns the shared native model-open acknowledgement and focus sequence for browsing/recent models, plus explicit editor launch. `src/maintenanceOperations.ts` owns one-shot update discovery, source-bound request planning and manager-receipt validation. `src/setupOperations.ts` owns bootstrap receipt validation and the install/refresh/readiness sequence, including the staged-install stop. These operation modules accept the existing Tauri invoke function; App retains action admission, UI state and user feedback. Setup hooks publish intermediate UI state before each refresh. Project bookmark/deletion review remains in App. Managed action labels and readiness error copy have one display-only owner in `desktopPresentation.ts`.

`src/WorkspacePage.svelte` and `src/SupportPage.svelte` own their page rendering and local styles; they receive current state and explicit callbacks without invoking native commands. Workspace binds project-view preferences and its scroll element back to App so the same session state survives navigation. `src/ProjectDeleteDialog.svelte` owns review rendering, initial Cancel focus, Escape admission and Tab wrapping; App retains native preview/confirm/cancel tokens and cleanup. The dialog never initiates deletion except through its explicit confirmation callback.

`src/styles.css` owns shared page/control/definition-row primitives for `.desktop-shell` and the sibling `.project-delete-overlay`, plus the shared `desktop-spin` keyframes. App retains shell, empty-state and notification styles. Busy-action/operation-record types stay in `desktopTypes.ts`, and progress labels stay in `desktopPresentation.ts`, without another state store.

Desktop does not poll releases in the background and never kills Blockbench/Gateway processes. Safe self-healing is limited to restoring owned managed files while Blockbench/Runtime/Gateway are idle.


## Startup-only managed update discovery

Managed-component update discovery follows a one-shot startup policy similar to mature desktop IDEs that support a startup-only update mode:

```text
Desktop opens
→ local system_status renders first
→ check_managed_update runs once, asynchronously
→ fetch published release metadata + digest-verified lazydesigner-package.json only
→ same source SHA: remain silent
→ newer source SHA: show Update
→ user chooses Update: canonical Managed Distribution update path runs
```

The startup check is read-only. It does not download the managed ZIP, stage files, restart processes, mutate configuration, or block normal Desktop startup. Network failure is advisory and silent: local LazyDesigner health remains usable.

The update check is deliberately absent from the lightweight connection watcher, focus/visibility handlers and MCP startup. There is no resident updater process, scheduled task, daemon, or background release polling loop. The full package is downloaded only after explicit user Update intent. A previously staged verified update is surfaced without another network lookup.



## Explicit maintenance actions

Desktop may invoke only bounded, named commands from the existing manager. The first mutating surface is:

```text
update
repair
recover
```

`Update` is an explicit user action and retains Managed Distribution staging, active-Gateway/Runtime guards, release verification and pending activation semantics.

`Recover` only invokes the existing interrupted-install recovery path. It is not presented as a generic repair operation.

`Repair` restores missing managed files from the currently active immutable package. It performs no release lookup and no version upgrade. Existing user-modified managed files remain fail-closed and are never silently overwritten.


## Blockbench compatibility projection

Desktop reads the canonical repository manifest at build time:

```text
mcp/compatibility/blockbench.json
```

It does not maintain a second version table. Runtime process detection and Windows executable metadata provide the installed Blockbench version; the Desktop projection then reports the same policy states used by the plugin compatibility boundary:

```text
validated
compatible-unverified
review-required
unsupported
invalid
```

A future Desktop change must update the canonical manifest rather than hard-code new Blockbench version ranges inside Rust or Svelte.


## Gateway lifecycle supervision

The managed Gateway is a persistent **stdio child owned by the MCP client/Codex session**. Desktop therefore does not launch, restart, terminate, or watchdog Gateway processes.

Desktop projects a bounded supervision state instead:

```text
healthy
waiting-runtime
client-disconnected
runtime-offline
idle
```

Recovery guidance follows ownership:

```text
Gateway active + Runtime offline
→ keep the Gateway session
→ restore/reload Blockbench Runtime

Runtime online + Gateway inactive
→ reconnect LazyDesigner MCP in the client

both inactive
→ start Blockbench
→ reconnect LazyDesigner MCP in the client
```

Do not add a Desktop `Start Gateway` or `Restart Gateway` command unless the MCP/client integration gains a real lifecycle-control contract. Starting `lazydesigner.exe mcp` without a stdio client owner would create the wrong process model.


## Blockbench discovery and launch

Windows Blockbench installation is not assumed to live at a fixed path. The official NSIS configuration allows the installation directory to be changed, so Desktop uses this bounded discovery order:

```text
running Blockbench process executable
→ Windows uninstall registry entries with DisplayName=Blockbench
→ validated standard installation paths (Program Files / per-user Programs)
```

Normal **Open** and **Open Model…** actions launch the editor without starting, repairing or waiting for the AI Runtime/Gateway. **Prepare Blockbench** remains the deliberate `ensure_ready` route for AI connectivity, plugin approval and safe managed repair. Both editor and model launches use the existing Blockbench executable discovery and an exact userData profile. A running editor's discovered profile takes precedence; an idle workstation reuses the managed profile if present, otherwise the deterministic standard Blockbench profile. Opaque saved-model actions require the profile to match their validated snapshot identity, or fail without launching another profile.

A running editor whose `userData` differs from the managed plugin profile is an explicit conflict, not an implicit profile switch. Running executables and registry candidates are deduplicated; competing installations are rejected instead of relying on enumeration order. A user may explicitly select a stable installed Blockbench.exe from Workspace or Support; the choice is validated against Windows product metadata and stored in Desktop-owned, atomically updated local metadata. This selects the executable only, not a different managed plugin/profile. The official versioned `Blockbench_X.Y.Z_portable.exe` self-extracting wrapper is deliberately rejected for now: it launches an extracted child with a different executable path, so the current strict identity contract cannot claim stable process affinity. A native handoff/child-process acceptance mechanism is required before enabling it. A stale selection produces an actionable prompt rather than silently falling back to another editor. Opening a model now returns `LAUNCHED` rather than claiming that Blockbench has loaded or selected its model tab. Native model-tab acknowledgment is separate future work.

The **Open Model…** button uses the already-installed native `rfd::FileDialog` to select a real `.bbmodel` file. The modal executes on a user-initiated blocking worker; it adds no background daemon, file registry, database, asset scanner or external dependency. Cancellation leaves files and application state untouched. A fresh/managerless Desktop may still browse and open an explicitly chosen file with Blockbench, while AI actions remain unavailable until verified.

Version and compatibility projection now also work when Blockbench is installed but closed, provided Windows exposes a valid uninstall entry.


## Typed managed status and action availability

Desktop does not consume arbitrary manager JSON. The Rust boundary deserializes the canonical `lazydesigner.exe status` schema into a typed projection and rejects unsupported schema values.

Maintenance availability is derived from that typed state:

```text
update
→ available whenever the managed installation is available
→ may stage while Gateway/Runtime is active

repair / recover
→ available only when Gateway and Runtime are inactive
→ UI disables the actions before invocation and shows the canonical safety reason
```

The manager remains the final authority and repeats its own safety checks; Desktop preflight is UX guidance, not a replacement security gate.


## Fresh-install bootstrap

Production Desktop bundles an exact-source managed package as a Tauri resource:

```text
resources/managed/
├── lazydesigner.exe
├── lazydesigner-package.json
├── lazydesigner_mcp.js
└── canonical managed workspace/Skill/license payload
```

The resource is generated by the existing `distribution/package.ts` pipeline immediately before the Desktop bundle is built. It is generated output and is not committed.

When no managed installation exists, Desktop may expose `Install LazyDesigner`. Rust resolves the bundled resource through Tauri's resource path API and invokes:

```text
bundled lazydesigner.exe install
→ --root <managed root>
→ --package <bundled managed package>
```

Desktop does not parse, reproduce, or weaken package verification/install/config semantics. The manager remains the only install engine.

The first native Blockbench plugin trust/load interaction remains a higher-context/native step when Blockbench requests it.


## Native Blockbench plugin handoff

Blockbench desktop stores plugin files under:

```text
app.getPath('userData')/plugins
```

and supports an advanced `--userData <path>` override. During first install Desktop resolves the active override when a running Blockbench command line exposes it; otherwise it uses the normal Windows Blockbench userData root.

Bootstrap therefore passes an explicit stable destination to the canonical manager:

```text
lazydesigner.exe install
→ --plugin-path <Blockbench userData>/plugins/lazydesigner_mcp.js
```

This does **not** edit Blockbench's `installed_plugins` state. Blockbench loads local-file plugins only after its native install/trust flow records them. Desktop exposes `Show plugin file` so the user can perform **Plugins → Load Plugin from File** once. After that, managed update/repair writes to the same remembered path.

Desktop must not edit Electron Local Storage/LevelDB to bypass Blockbench's native trust decision.


## Runtime security

Fresh managed installation provisions the machine-local HTTPS identity through the same compiled manager before activation. Desktop does not generate certificates itself.

Desktop projects:

```text
tls_ready
tls_error
```

and exposes **Setup Runtime Security** only when the manager reports that TLS is not ready and Gateway/Runtime are idle. The action delegates to `lazydesigner.exe setup-tls`.

Update and package repair do not rotate or overwrite the TLS identity.


## Unknown-state policy

Desktop does not translate unavailable managed status into fabricated offline/stable state. If the manager exists but `lazydesigner.exe status` fails, returns invalid JSON, or returns an unsupported schema:

```text
Gateway          → unknown
Runtime          → Unknown
Update state     → Unknown
Runtime Security → Unknown
maintenance      → disabled
```

The last known dashboard remains visible alongside the error so recovery context is not lost. The manager remains the final safety authority.

## Update naming

`lazydesigner.exe update` updates managed Gateway/Runtime-plugin/Skills/distribution components. It does **not** replace the LazyDesigner Desktop executable. The Desktop UI therefore calls this **Update managed components**. Desktop self-update remains a separate release/signing concern and must not be implied by this action.


## Desktop release/version contract

Desktop application versioning is independent from managed-component update state.

Canonical version sources must stay equal:

```text
apps/desktop/package.json
apps/desktop/src-tauri/Cargo.toml
apps/desktop/src-tauri/tauri.conf.json
```

Release naming:

```text
desktop-vMAJOR.MINOR.PATCH
```

The repository provides a manual **Desktop Draft Release** workflow. It runs only from `main`, requires an explicit version that exactly matches all three source version owners, builds the exact-SHA integrated installer, verifies that the bundled managed package uses the same source SHA, writes SHA-256/provenance files, rejects duplicate release versions, and creates a **draft** GitHub Release only.

The workflow does not publish automatically and does not implement Desktop self-update. `Update managed components` remains a separate Managed Distribution action. Any future Desktop self-update requires its own signed update-channel design and must not be inferred from the draft-release workflow.


## Desktop hardening contract

Desktop command failures cross the Tauri boundary as a stable structured error object:

```text
code
message
recoverable
```

The frontend uses structured error codes for control flow. It maps known technical failures (legacy plugin/client conflicts, profile ambiguity, timeout) to a short action-oriented message in Workspace; unrecognized errors are summarized without exposing raw paths or flags in the notification. The exact original command message is shown on request inside a collapsed **Support → Technical details** section and is not uploaded automatically. No sensitive paths should be copied into normal Workspace status text. The user can still export bounded diagnostics explicitly.

External inspection/manager subprocesses are bounded. Status/discovery probes use short timeouts; explicit install/update/repair/recover actions use longer bounded timeouts. A stalled child must be terminated rather than leaving the Desktop UI busy indefinitely.

Desktop may export an explicit local diagnostic snapshot. The snapshot contains only projected health/version/compatibility state and Desktop platform/version metadata. It does not copy TLS private keys, certificates, project content, environment variables, Codex configuration, or arbitrary logs. Diagnostic export is user-initiated and local-only.


## Canonical readiness and session operations

Readiness and the canonical Desktop `product_state` are projected in Rust and shipped as part of `SystemStatus`; Svelte maps that state to presentation instead of reconstructing machine-state policy independently. Each status snapshot carries an observation timestamp so exported diagnostics and UI state can be distinguished from stale screenshots.

Desktop keeps only a bounded in-memory list of recent explicit actions for the current UI session. It records action name, success/failure, canonical receipt/error code, and display time. This is intentionally not a persistent operation database and it does not replace Managed Distribution receipts or Git history.


## Managed rollback and progress projection

Desktop does not infer rollback from version folders. Managed Distribution status is the authority for whether the latest committed managed transition has a verified previous `installed.json` backup. Desktop exposes rollback only when that projection says it is available and the normal idle mutation gate is satisfied.

Long-running managed actions invoke the manager with `--progress-json`. Progress events are structured JSON lines emitted by the manager and relayed through a Tauri event. The UI never invents percentages or stages. Final success/failure still comes from the canonical manager receipt and exit status.


## Desktop release trust boundary

Development drafts and trusted release drafts are deliberately separate modes.

A **development draft** may be built without publisher credentials, but the release notes mark it as non-publishable. A **trusted draft** requires two independent trust layers:

```text
Windows Authenticode
→ identifies the Windows installer publisher

Tauri updater signature
→ signs the updater artifact with TAURI_SIGNING_PRIVATE_KEY
```

Trusted builds use `src-tauri/tauri.release.conf.json`. Tauri delegates Windows signing to the repository-owned `scripts/sign-windows.ps1`, which accepts only the certificate thumbprint imported for the current release job and a configured HTTPS timestamp URL. The release workflow verifies the final NSIS installer with `Get-AuthenticodeSignature` and refuses trusted output unless the status is `Valid`.

The Windows PFX bytes/password and Tauri updater private key/password are release secrets and never repository files. The imported Windows certificate is removed from the runner store during workflow cleanup.

Generating signed updater artifacts does **not** enable Desktop self-update. Runtime updater support remains disabled until an intentional change commits the trusted public updater key, HTTPS endpoint/channel policy, updater plugin dependency/lockfiles, and explicit user-facing update behavior.


## Static trusted update manifest

Trusted draft releases also produce `latest.json` using the canonical non-secret policy in `release-channel.json`. The manifest contains the exact Desktop SemVer plus the Windows x86_64 release asset URL and the contents of the Tauri `.sig` sidecar.

The stable manifest endpoint is reserved as:

```text
https://github.com/MIVUBI-STD/M-LazyDesigner/releases/latest/download/latest.json
```

This is release infrastructure only. `release-channel.json` keeps `selfUpdateRuntimeEnabled` false, and the Desktop contains no updater plugin or embedded updater public key yet. Enabling runtime update checks remains a separate change with its own lockfile/config/security review.

Development and trusted drafts also use separate tag namespaces:

```text
development draft → desktop-dev-vMAJOR.MINOR.PATCH-<source-sha-prefix>  (prerelease)
trusted draft     → desktop-vMAJOR.MINOR.PATCH
```

An unsigned development artifact therefore cannot reserve or masquerade as the final trusted release tag.


## Single-instance Desktop ownership

Desktop establishes one machine-local owner **before** the Tauri application, connection watcher, maintenance controller, or preferences writer is created.

On Windows, ownership uses a session-local named mutex: `Local\com.halokaryamedia.lazydesigner.desktop`. The mutex is created through Win32 directly from Rust, so no additional crate or lockfile mutation is required. A second launch receives `ERROR_ALREADY_EXISTS`, restores/focuses the canonical `LazyDesigner` main window, closes its temporary mutex handle, and exits before constructing another Tauri application.

The primary process holds the mutex for its lifetime and releases/closes the handle on shutdown. Windows releases kernel object ownership when the process terminates, so crash recovery does not depend on stale files, PID reuse, polling, or a cleanup database.

This mechanism adds no background service, dependency, project database, watcher, maintenance path, or preferences writer.

## Workstation automation and first-run policy

Normal operation is intent-driven rather than launch-driven:

```text
Desktop opens
→ health/readiness observation only
→ safe repair may restore a missing owned plugin while Blockbench is closed
→ Desktop does not launch Blockbench automatically

user chooses Open or Open Model…
→ resolve actual editor profile
→ launch/focus Blockbench or open selected .bbmodel
→ no AI setup, Gateway wait or plugin repair

user chooses Set up / Prepare Blockbench
→ backend ensure_ready owns AI-related orchestration
→ repair missing owned plugin when safe
→ launch Blockbench if needed
→ wait for Runtime
→ report READY / RUNTIME_READY / APPROVAL_REQUIRED / NEEDS_ATTENTION
```

The first native local-plugin trust decision remains Blockbench-owned. Desktop may conclude that one-time approval is likely only when Blockbench is running, the managed plugin file is integrity-valid, and Runtime remains unavailable after the bounded readiness grace period. Timeout alone is not treated as proof of approval state.

Frontend development builds support deterministic UI state fixtures through:

```text
?fixture=ready
?fixture=ready-aged
?fixture=ready-no-active
?fixture=many-projects
?fixture=status-unverified
?fixture=fresh-install
?fixture=approval-required
?fixture=plugin-missing
?fixture=plugin-modified
?fixture=runtime-offline
?fixture=client-wait
?fixture=unsupported
?fixture=repair-blocked
```

Fixtures are development-only and can render in the Vite browser **without Tauri, Bun, a running editor or a real local AI connection**. Their data comes from `src/desktopFixtures.ts`; no native status, managed-progress, update check, or Analytics IPC is requested when a fixture is selected. They do not change machine state or user files. Native commands (including opening models and setup) are intentionally not exercised in fixture mode; synthetic Analytics export also refuses to write.

For visual review, visit `http://127.0.0.1:1421/?fixture=<name>` with the existing Vite frontend server. An optional `&view=support` or `&view=analytics` parameter selects subpages in development fixture mode only; production ignores these parameters. The page adds `data-qa-fixture` only for a selected development fixture.

A bounded, optional screenshot helper uses Playwright already available in the QA environment; it does **not** introduce a production dependency or modify the frontend lockfile:

```text
# With the existing Vite server running from apps/desktop:
python scripts/capture-ui.py
# Optional: --browser <path-to-Chrome-or-Chromium> --out <temporary-qa-directory>
```

Fixed, development-only `?fixture=ready&feedback=pending|success|error|timeout|delete-uncertain` specimens show truthful feedback copy without native actions. The `&view=support` versions verify classified in-page errors instead of duplicate notifications. Timeout shows a **Refresh status** action that does not retry the original operation; uncertain deletion shows **no** direct retry or assumed file outcome. These query options do not work in production and never receive arbitrary message text.

The additional `?fixture=ready-aged` specimen contains a synthetic full status
observation older than 30 seconds; both Desktop pages should ask for Refresh
without saying that AI is disconnected. `?fixture=ready&activity=opening-model`
marks the synthetic Sofa row as Opening… for keyboard and visual QA. Neither
fixture requests an actual model launch, update, repair or status operation.

The script captures Workspace, Support and Analytics at **390×640** (narrow-layout proxy), **780×560** (minimum window baseline), and **980×680** (default comparison), plus relevant failure/setup states. It records horizontal overflow, offscreen controls, browser JS errors, and top/bottom screenshots when scrolling is needed. The `many-projects` synthetic fixture contains eight uniquely identified projects, with the `Needle asset` in the final project to check discovery beyond the initial six rows.

The same existing screenshot helper now records bounded `taskJourney` evidence for five synthetic UI paths: finding the native model-open action without AI setup, searching and clearing normal model results, finding an item in the hidden eighth project, discovering Refresh when status is stale, and navigating to the existing Repair control without activating it. Records include UI availability, browser interaction count, automation elapsed milliseconds, and explicit `native_action: NOT_ATTEMPTED` / `human_task_success: NOT_MEASURED`. The scripted timing is **not** a human completion-time or product-speed benchmark. The path checker does not click model-open, Refresh, Install, Delete, or Repair actions.

Output is temporary and never written back to the repository automatically. The tool remains manually triggered (not CI or telemetry) and restricts the origin to local HTTP. It needs an already-installed Playwright Python package and Chromium browser in an eligible execution environment.

Screenshot capture alone **does not** certify UX. Review the images for readability, disabled actions, controls, dialogs and keyboard focus. Native Windows focus/Recycle Bin operations, live Blockbench editor-panel behavior, MCP lifecycle, and actual user comprehension require separate matching-build acceptance.

## Blockbench profile ambiguity

A running Blockbench process without `--userData` resolves to the normal Windows Blockbench userData directory. A running process with an absolute `--userData` resolves to that profile.

When multiple Blockbench processes are running, Desktop accepts setup only when all observed processes resolve to the same userData directory. Different simultaneous profiles are fail-closed because there is no safe single plugin destination. Desktop asks the user to close the extra Blockbench profile instead of guessing.

## Lightweight connection watcher

The active-window heartbeat is deliberately cheaper than full `system_status`. It observes only rapidly changing local state:

```text
Blockbench process
managed plugin integrity
profile-bound Runtime session lease
active Gateway lease
project navigation generation/lease
```

The Runtime session lease is created only after RuntimeHost successfully binds its HTTPS listener and is removed by its owning Runtime generation during teardown. It contains a bounded profile identity, producer PID, Runtime instance identity, and canonical loopback Runtime URL. A short heartbeat makes a crashed or abandoned producer expire without relying on a hardcoded port probe.

Full `system_status` compares the live listener URL with the canonical Runtime URL projected by Managed Distribution from the MCP client configuration. Runtime is ready only when the profile-bound listener lease is live, the configured endpoint is reachable, and both URLs match. An unrelated process occupying port 3000 therefore cannot make Desktop report Runtime ready, and custom ports remain valid when Blockbench and the MCP client are configured consistently.

The watcher uses process/filesystem inspection directly in Rust, with `System::new()` and one process refresh instead of initializing every system data table for passive observations. It does not spawn `lazydesigner.exe status` on the heartbeat. Its single timer checks after 8 seconds while Blockbench is running or 20 seconds while idle, **pauses without a pending timer while the Desktop is hidden**, and performs an immediate check on return/focus. In-flight observations do not overlap; after two uncertain observations it stops passive checks and requires a successful explicit full Refresh before potentially mutating AI/system state. File open and safe path/folder actions remain available independently. This is an intended reduction in background work, not a measured CPU/RAM result. Gateway uncertainty preserves the last known full Rust projection instead of being classified as offline.

When a known fast-probe value changes, Desktop performs one full `system_status` refresh so compatibility, maintenance availability, Gateway supervision, readiness, Runtime endpoint agreement, and `product_state` are re-projected by their owning layers.

## Projects & Models navigation

Desktop provides a compact filesystem-navigation layer without becoming a second project database or file manager.

Blockbench remains the authority for the active model and recent saved models. The managed Blockbench Plugin writes a bounded local projection scoped to the Blockbench userData profile where that managed plugin is installed:

```text
%LOCALAPPDATA%\LazyDesigner\project-navigation\<profile-id>.json
```

The profile ID is a deterministic hash of the normalized Blockbench userData path. The raw profile path is not exposed in the normal Desktop projection. A Plugin running under another userData profile writes a different file and cannot replace the managed profile's navigation snapshot.

The projection contains bounded active/open/recent `.bbmodel` navigation state plus opaque producer/profile identity needed to determine freshness and ownership. It is a cache/projection, not authored project state. Desktop does not edit Blockbench local storage to obtain recents.

Desktop uses one **Projects & Models** navigation surface, not independent file/project managers:

```text
Current Model / Continue
→ focus the existing editor or open the last known saved model

Open Model…
→ native Windows .bbmodel picker, independent of Gateway/Runtime

Projects & Models
→ one search for project folders and model names
→ keyboard Escape clears the query and retains input focus
→ keyboard Enter opens only one uniquely matching, existing, non-active model by its resolved opaque ID
→ ambiguous names, project-only matches, missing models or unavailable folders require an explicit row action
→ Add Project Folder opens an explicit native folder chooser
→ expand a Project to access its .bbmodel files and familiar asset folders
→ Pin/Unpin/Remove shortcut affects only the Desktop preference list

Recent Models
→ up to five existing paths in Blockbench's native recent-file order
```

Projects registered through Add Project Folder are **actual user folders**, even when empty or without a Blockbench snapshot. The chooser records only their absolute folder paths in the existing `%LOCALAPPDATA%\LazyDesigner\project-preferences.json` file; no new database, authoring format or project folder is created. For each registered folder, a bounded, nonrecursive read checks the folder itself and its immediate `Models`/`Model` child (maximum 128 directory entries per directory, 64 shown models per project, 16 added folders). A displayed count says *models shown* for registered folders or *known models* for history-only projects—never an invented total count. Added folders remain visible when empty/unavailable and can be removed from the shortcut list without deleting or moving any file.

The search input displays the model-specific Enter shortcut only when
there is exactly one eligible matching model; otherwise the user chooses a
visible row action. It does not infer that a matching project title means
the user intends to open one of its models. Shortcut handling ignores IME
composition and modified keyboard commands, so it does not override native
text-entry semantics. Search still displays the project result count, offers
Clear search, and restores the keyboard input focus when cleared. The
resulting Open action reuses the existing native Rust path/ID verification;
the Desktop does not declare activation complete from the keyboard event.

The offline browser QA uses Escape to test reset/focus, but **never presses
Enter to launch a model**. Bun tests for unique, ambiguous, missing, active
and unavailable targets are authored source checks, not native acceptance.

Project grouping is deterministic and intentionally shallow:

```text
nearest .lazydesigner-project.json marker within the bounded parent search
→ otherwise parent of Models/Model
→ otherwise direct parent folder
```

Existing `.lazydesigner-project.json` manifests are read-only identity hints containing `schema`, stable `project_uuid`, and `display_name`. Model membership is not stored there. A valid unique manifest can retain Project identity after a folder move/rename. **Pin never creates, updates or upgrades a manifest**; it only stores an opaque ID in local Desktop preferences. Therefore a project without a pre-existing manifest may lose its Pin association after an external rename/move; users can re-add the folder if needed. Malformed/unsupported manifests are never overwritten. Duplicate UUIDs among currently known Projects fail closed to path-scoped identities, without crawling drives.

This supports one project such as `Furniture` containing multiple `.bbmodel` files without requiring a global project database. Paths stay hidden in the normal UI. Backend actions resolve opaque project/model IDs back through the current local projection before opening Explorer or Blockbench.

Normal UI actions are bounded to:

```text
Open Folder
Open model in Blockbench
Reveal model file
Copy path
```

`Show models` expands the same Project entry and offers existing working folders from a small allowlist:

```text
Models
References
Textures
Exports
```

These shortcuts appear only when the corresponding directory actually exists under the resolved Project root. Desktop does not recursively scan for similarly named folders and does not surface these shortcuts in the normal Overview row.

Opening a history-only saved model resolves its opaque ID through the profile-bound navigation snapshot and rechecks file existence and exact editor `userData` identity. Models from an explicitly registered folder are independently revalidated against a bounded folder scan, then opened via the existing editor profile resolution. Neither path calls `ensure_ready`, so disconnected AI does not prevent manual editing. Missing model files and ambiguous editor profiles fail closed, without guessing a replacement or starting another Runtime. The native `Open Model…` picker remains available for other files.

The active-window heartbeat watches the canonical navigation token emitted by the Blockbench plugin. The token is `<profile-id>:<producer-generation>:<revision>`, so profile changes and plugin module reloads cannot accidentally reuse the same apparent revision number. Desktop also watches a separate session-live projection derived from the Blockbench process plus a bounded plugin lease; Runtime reconnects do not invalidate project-session state by themselves.

The plugin refreshes that lease every 10 seconds by touching snapshot metadata rather than rewriting the JSON payload. Desktop treats the lease as stale after 30 seconds. A stale or absent lease clears ephemeral `Active`, `Open`, and `Modified` state, while recent saved navigation remains available. When either the navigation token or session-live state changes, Desktop performs one normal status refresh; it does not crawl project folders continuously.

The plugin projection also carries the bounded saved/open model inventory needed for navigation:

```text
active model
open saved models
dirty/clean state
recent saved models
```

Desktop uses that state only where it changes a user decision. Current Model offers `Go to Blockbench` instead of opening the active file again. Dirty models are marked `Modified`; saved models in recent files can be reopened through the ordinary native Blockbench file path. Other editor-session details stay hidden.

Open/dirty/active are ephemeral Blockbench-session state. Desktop discards those flags whenever the bounded Plugin session lease is not live, while recent saved models remain available for navigation. Runtime reconnects do not invalidate a still-live Blockbench Plugin session. A stale snapshot therefore cannot keep rendering `Switch` or `Modified` after Blockbench closes.

Pinned Projects are local Desktop bookmarks. Pinning writes only the existing `project-preferences.json` data, never a manifest or model file inside a user project. The same existing preferences file stores optional explicitly registered folder paths, capped and validated, with atomic compare-before-replace and recovery. Existing schema-1 preferences without registered folder paths remain valid. Unpin only changes the bookmark; Remove shortcut also unpins the selected added folder and removes its registration but does not delete the directory or erase Blockbench's own recent-file history.

`Continue` is deliberately independent from pinned/recent display ordering. The profile snapshot preserves one exact last active saved `.bbmodel` pointer across Plugin/Desktop restarts. Desktop exposes Continue only while that exact file still exists; it never guesses a replacement from pinned projects or favorite-reordered Blockbench recents.

## Delete Project — explicit Windows Recycle Bin only

Project deletion is distinct from **Remove from Workspace**. Remove only edits the existing Desktop shortcut/pin preferences and does not change disk files. A **Delete Project…** item is visible only for folders explicitly added through **Add Project Folder**, never for a parent inferred from recent .bbmodel files.

The frontend requests a native read-only review by opaque project ID. Rust resolves that ID against the current registered path list and returns a 90-second one-use token plus the exact folder name/path for a user-confirmed dialog. The user sees a clear statement that **all contents** (models, textures, references, exports, unrelated files) will be moved to Recycle Bin. Cancel/Escape consume the review, with no filesystem mutation. Only the token, not a frontend-supplied path, may authorize execution.

Preparation and final confirmation both fail closed when:

- any Blockbench process is still running (the simple conservative choice until native per-project unsaved-session proof is available);
- the folder is not exactly one registered Project ID, has changed since review, or overlaps a second registered project;
- the path is a disk root, system/application/home/common Windows folder, non-fixed/removable/network/UNC drive, or has symlinks, junctions or reparse/special entries;
- the bounded tree inspection cannot inspect every entry (max 10,000 entries and 32 levels); or
- the review expires, is cancelled, mismatches, or was already used.

The Windows operation uses the existing bounded PowerShell child strictly with **Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory** and the explicit **RecycleOption.SendToRecycleBin** overload, plus **UICancelOption.ThrowException**. It does not call permanent deletion, remove_dir_all or provide any fallback. PowerShell receives the resolved path through a process-local environment variable, not through interpolated script source. A failed/unknown Recycle Bin outcome does not clear the shortcut or claim success. Actual Windows shell behavior and failure modes remain subject to native acceptance.

Only after a reported successful recycle does Desktop remove the registered shortcut and Pin; if this local preference write fails, it reports that the folder was recycled but the shortcut remains. It records a bounded local marker to hide stale Blockbench recent-file references to the specifically recycled folder, without modifying Blockbench recents. A user who restores a folder from Recycle Bin can explicitly re-add it through Add Project Folder to clear that marker. No background purge, custom Trash database, automatic deletion, or restore engine is introduced.

**Proof boundary:** source and negative regression fixtures exist, but actual Windows Recycle Bin interaction, large/symlinked project handling, cancellation, focus and old-folder restoration have **NOT** been executed or accepted on a Windows native build at this commit.

## Bounded local operation log

Desktop writes a minimal best-effort machine log under its LocalAppData directory. Entries contain only:

```text
timestamp
bounded action token
bounded outcome token
```

The active file is capped at 512 KiB and rotates to one previous file. Readiness outcomes use bounded tokens such as `READY`, `RUNTIME_READY`, `APPROVAL_REQUIRED`, or a bounded reason token for `NEEDS_ATTENTION`; managed actions prefer the canonical receipt status. It does not record project content, file paths, environment values, command output, TLS material, Codex configuration, or arbitrary error prose. Diagnostic export does not automatically attach this log. Upon explicit
Export diagnostics, Desktop reads at most the bounded current and rotated
local log files, rejects non-regular files, and exports only counts of
well-formed recent entries, narrowly recognized error outcomes and the
latest recorded timestamp. No raw action/outcome tokens, full log text,
project identifiers, Gateway trace or provider token usage are copied.
The `desktop_activity.coverage` field reports `NO_LOG`, `UNAVAILABLE`,
`PARTIAL` or `RECENT_ROTATING_LOG_WINDOW`. The latter is explicitly a
limited recent window, not complete lifetime usage. The normal UI continues
to show its existing current-session activity list without extra polling.

This log is operational evidence only. Managed Distribution receipts remain authoritative for install/update/repair transitions.

## Uninstall and ownership contract

Desktop uninstall and LazyDesigner integration cleanup are separate ownership decisions.

Current safety contract:

- NSIS uninstall removes the Desktop application itself.
- It must not silently delete the user's BlockIT workspace or authored assets.
- Managed Distribution remains owner of managed Gateway/Runtime/Skill files and transaction state.
- The Blockbench plugin is managed content and must not be removed by blindly deleting the entire Blockbench plugin directory.
- Desktop must not edit Blockbench Local Storage/LevelDB to revoke plugin trust.
- A future explicit **Remove LazyDesigner integration** action may delete only files proven owned by the current managed installation, after Runtime/Gateway are idle, while preserving user workspace by default.
- Until that explicit cleanup contract exists, uninstall is conservative rather than destructive.

Do not add uninstall cleanup directly to NSIS before the manager exposes a bounded ownership-aware removal command.

## Workspace view continuity

The Desktop has two navigation destinations: **Workspace** (internally the
existing `Overview` route) and **Support**, displayed in a compact top bar
so the project list has more room at the 780×560 minimum window size.

Project search, expanded-project selection, show-all choice and Workspace
scroll position survive navigating to Support and back within the same
Desktop UI session. These are view preferences only, not persisted project
state or a replacement for the Blockbench-owned project projection.

On first run, the model-open action stays above optional AI setup, and the
setup panel has one direct action with a native disclosure for its steps.
If a model is active or registered projects exist, their navigator appears ahead of AI setup so
existing files remain the priority. With an empty project inventory, the
navigator follows setup, keeps **Add Project Folder** usable and hides the
empty search field. If a retained search query exists, keep its field and
Clear search visible so the user can recover rather than silently hiding
filtered results. Setup readiness/approval guards and machine-state
authority are unchanged.

Model actions are labeled **Open** rather than promising to switch or focus
a particular Blockbench window. The current native launch path does not
yet prove foreground-window activation; native Windows acceptance is
required before stronger copy or focus behavior is introduced.

### Connection probe uncertainty

After two failed lightweight connection probes **or one failed full**
`system_status` with a previous observation, Desktop preserves that last
observation for context but disables project preference changes, destructive
actions, current-session Blockbench focus, editor launch and managed operations
that depend on fresh machine state. Explicit Explorer-only folder/reveal
actions and Copy path remain available because Rust re-resolves their opaque
IDs. Direct `Open Model…` browsing and requested known-model launches remain
available through their existing native file/path checks; an unverified model
launch is never described as confirmed activation. An open
Recycle Bin confirmation keeps Cancel usable but blocks confirmation. A subsequent successful
lightweight probe cannot clear this gate; only the user's explicit `Refresh`
with successful full `system_status` restores the action affordances. The
initial state with no successful observation remains the unavailable screen.
The project revision comparison accepts null as the legitimate no-snapshot
baseline. These UI gates supplement the canonical Rust/manager permission
and safety checks; they do not change Gateway ownership or authorize repair.

### Workspace healthy connection summary

When there is an observed active or recent project and the canonical Desktop
state is `ready` or `client-wait`, Workspace compresses the healthy connection
panel into one status line ahead of model navigation. When there are registered
projects but no active model, the summary also offers `Open Blockbench` to
begin a new model without hiding existing project shortcuts. On first use with
no projects, the normal Blockbench launch card remains visible. Other
connection/setup states keep their existing detailed guidance. On probe
uncertainty, the line reports an unverified state and retains Refresh.
Managed-component update notices remain visible when reported, but healthy
technical details stay under Support. The development-only fixture capture
includes `ready-no-active` and `status-unverified` views; these are coverage
inputs, not a build, screenshot or native acceptance result.

### Explicit native Blockbench window focus

A direct user `Open` / model-open action first follows the canonical existing
`ensure_ready` and model file-open boundaries. It then asks the Desktop for a
single *best-effort* Windows foreground-window activation. It never runs from
startup, the connection heartbeat, a background repair, or update discovery.

The Win32 target must be a visible, unowned top-level window belonging to a
running process whose executable is actually named `Blockbench.exe`. If there
are zero or multiple matching windows (including multiple Blockbench profiles),
no window is chosen. Windows may also deny a foreground request; only an actual
`GetForegroundWindow` match is reported as `FOCUSED`. The UI tells the user
to select Blockbench on the taskbar otherwise. A spawned model-open request is
not evidence that the model tab has finished loading, and foreground activation
is not proof of model persistence or save.

This is a source implementation, not native acceptance. Windows/Tauri smoke
testing must exercise an already-running minimized editor, a newly-started
editor, two Blockbench windows, no matching top-level window, and Windows
foreground restrictions. Never relax candidate matching just to make a test
pass, and never kill/restart Blockbench to obtain focus.

### Support task-first recovery and disclosures

Support orders **Troubleshooting** above read-only About and managed-package
alignment details, keeping the most likely recovery action near the top of
the page. Its controls say **Choose Blockbench…**, **Show plugin file** and
**Export diagnostics** rather than relying on ambiguous short button names.
The five native disclosure surfaces use a visible Show/Hide state that follows
their real `open` property; keyboard operation remains the browser/host native
`<details><summary>` behavior. No recovery, installer or plugin file
operation runs when an informational disclosure opens. A missing plugin is
labelled **Missing**, never “Repairing” without evidence of a repair.
The existing maintenance availability flags, explicit click handlers,
permissions and receipts are not bypassed. The offline screenshot fixture
checks Support section order, visible labels and non-mutating disclosure
navigation without calling any maintenance action.

### Desktop action disclosures and keyboard

More-actions popovers use native `<details><summary>` disclosure semantics
and normal buttons, not the WAI-ARIA `menu` roles that require full arrow-key
menu navigation. `Tab` / `Shift+Tab` move through visible actions. `Escape`
closes open action disclosures and returns focus to the triggering summary
when focus is inside it. Pointer interaction outside a disclosure closes it.
Native dropdown and keyboard acceptance still require a Tauri/Windows run.

### Desktop presentation ownership

`src/desktopTypes.ts` holds the existing serialized Rust/Tauri data types.
`src/desktopPresentation.ts` holds pure user-facing labels and contextual
guidance derived from canonical Rust product state. Plugin approval is passed
as a presentation-only input, not re-derived as another readiness policy.
Neither module owns IPC calls, stored project state, Gateway lifecycle, or
managed maintenance. The original messages, Tauri commands and Workspace
interactions remain in place; only their source ownership changes.

### Contextual error recovery

The existing `desktopErrorNotice()` is the sole display-only classifier for
command errors. It prioritizes exact native/manager error codes, using bounded
message matching only for compatibility with plain-text errors. Each classified
failure carries a short title/message, a specific **Next step**, a
**Still to verify** statement, and an optional safe action. The raw error detail
is shown only inside Support's technical disclosure, never on the normal
Workspace path.

The only directly offered actions are **Refresh status** (a new full status
observation, never repetition of the original action) and **Open Support**.
A missing or uncertain native Recycle Bin confirmation cannot offer an
automatic retry. The user must inspect both the source folder and Windows
Recycle Bin before deciding whether to start a *new* explicit deletion
review. Other mutation, setup, migration and managed-maintenance actions
retain their separate user triggers, permissions and native receipts.
`readinessFailureNotice()` applies the same guidance contract to
nonthrowing `NEEDS_ATTENTION` results from the existing setup/connection
workflow, which are not completion evidence. Support shows the next step
and remaining uncertainty beside the classified error, while the global
in-flow notice only offers an action appropriate to that specific error.
An unavailable initial machine status continues to offer `Try again`
rather than a link to a page that cannot render.

All changes concern presentation state and existing handler selection; no
recovery retry queue, second status/router, new stored state, implicit
repair, or change to Rust/Gateway authority was introduced. Bun/source and
Playwright recovery specimens are authored but still `NOT_EXECUTED`.

### Native receipt versus refreshed Desktop status

A user-initiated native operation can return a valid result while the
following full `system_status` observation fails or times out. The Desktop
must not turn that acknowledgement into a "current state verified" claim.
`refresh()` is still the single read-only full status owner; it records
whether that *specific* observation succeeded. After user-triggered
project changes, model/editor launch, executable selection, Recycle Bin
operation or managed action, `refreshAfterAcknowledgment()` reports a
separate, user-visible **Action acknowledged; current status not verified**
state if status refresh failed. The next action is **Refresh status**, not
repeating the original operation.

For Recycle Bin actions, record the native `RECYCLED` or
`RECYCLED_SHORTCUT_RETAINED` acknowledgement **before** refreshing status;
a later read failure does not create a false "Delete failed" operation record
or trigger another filesystem action. Setup/connection flows retain their
existing `setupOperations` owner and only show readiness claims when their
subsequent full status observation succeeded. In addition, a native
`READY` result must agree with the refreshed `product_state: ready` and
`readiness.ready: true` before showing a confirmed AI-ready message;
`RUNTIME_READY` must agree with `runtime_ready: true`. A contradictory
snapshot is shown as a persistent *Next step*, not silently promoted to
readiness. For managed update actions, invalidate the previously shown update
check before refreshing so a stale package decision is never carried into
the unverified state.

This is presentation and status-observation ordering only: no new process
monitor, IPC, mutation retry, filesystem inspection, installer, Gateway
controller or native verification is introduced. The source regressions
are `AUTHORED_NOT_EXECUTED`; Windows/Tauri behavior remains
`NATIVE_UNVERIFIED`.

### Accurate status and action feedback

When a full status observation becomes unverified, Support explicitly marks
its data as last-known and provides a direct Refresh control. Workspace
also explains beside the project list why preference edits, deletion and
current-session editor focus are disabled; these actions reference the visible
explanation for assistive technology. Explicit native model-file, folder
reveal and Copy path actions remain usable through their existing Rust
revalidation even while status is unverified. The
utility action for displaying a plugin file does not claim that Blockbench
approval is universally required: approval is mentioned conditionally and
never marked complete merely because a file was highlighted. User-facing
managed-component update progress and activity labels deliberately distinguish
managed distribution updates from updates to the Desktop executable.

Desktop presents action feedback **in the layout, directly below the main toolbar**, not as a fixed bottom-right overlay that can obscure model controls. A pending next step persists until dismissal/replacement; success and unchanged notices retain their bounded automatic timeout. While Workspace already displays a task-progress strip, it does not also render a second 'Working' announcement. Support's classified error section is authoritative on that page, so the global strip suppresses duplicate error copy there. Reporting a new failed action clears outdated success/pending copy before showing the error. The dismiss button remains keyboard-accessible, and no native operation is triggered by its use.

The initial **Open Model…** CTA retains the primary visual treatment. Optional **Set up AI tools** uses the secondary treatment and its descriptive steps remain behind a native disclosure. Project list spacing/radii and more-actions hit targets reuse existing Desktop tokens; no new design system or palette was added.

The shared `aiStatusPresentation()` maps only canonical Desktop product
state, failed probe count and the age of the last **full** `system_status`
observation into Workspace/Support copy. Rust's existing MCP proof freshness
window is bounded to 30 seconds; the UI uses a conservative 30-second
**observation-age presentation** threshold without claiming the full observation
timestamp is the time of the actual MCP request. It shows **Verified at last
check** while the full observation is recent, **AI check out of date** when
older, and **Check time unavailable** for missing, future or invalid timestamps.
It does **not** claim an AI session is live just because a previous check
passed. Both pages expose Refresh for an old check, but stale age alone does not
block independently verified file or manager actions; existing native
readiness, active session checks and probe-failure guards retain authority.
The display clock advances using the existing connection watcher and
foreground/focus events; no additional timer, background monitor or Gateway
status owner was introduced. Synthetic fixtures use a fixed comparison clock
rather than depending on the developer workstation time.
Blockbench running state is labelled separately from AI readiness. `Next step` notices
for staged updates, unverified launches, trust approval or handshake checks
remain visible until dismissed or replaced by a later action; short success
and no-change notices still expire automatically. A native launch without
confirmed window focus is not reported as a completed foreground handoff.
During an explicit known-model open, Desktop retains the requested model's
opaque ID only in session-local presentation state and marks the appropriate
Project/Continue/Recent row **Opening…**, with a single announced status.
It clears the marker on success or failure and uses the existing
`CONFIRMED_ACTIVE` versus `LAUNCHED_UNVERIFIED` native acknowledgement
rather than guessing from window focus. A failed explicit Go to Blockbench
focus attempt now reports a classified error instead of an unhandled promise;
a denied foreground request remains a persistent next step.
Support displays the specific already-classified error title for failed
actions, with technical details behind its existing disclosure. Direct setup
and connection readiness failures receive matching plain-language titles;
when no machine status is available, the toast no longer sends users to a
Support page that cannot render, and the unavailable view keeps Try again
and Open Model available. The Workspace update section explicitly includes
an unverified staged package in its visible warning conditions.

At a narrow effective viewport, project/model action rows and search controls
wrap instead of clipping, while Support diagnostics and the top navigation
wrap long copy. The optional offline screenshot fixture includes a 390×640
small-effective-width proxy alongside 780×560 and 980×680; it is not evidence
that native 200% Windows zoom or screen-reader use was executed.
This is source-authored UI behavior, not executed Svelte/Windows acceptance.


## Native Blockbench workspace P0 (debug-only)

The development-only **Editor preview** routes through
`src/NativeEditorStage.svelte` to the single Rust
`src-tauri/src/blockbench_surface.rs` presentation owner.
This adopts LazyTester-style independent native composition without importing
Minecraft lifecycle, adding a WebView editor or changing Gateway/Runtime.
An explicit Present action positions a single uniquely verified existing
Blockbench top-level window within the Editor viewport. Update is
ResizeObserver/foreground-driven only while a lease is present. Detach
restores original window bounds before navigating away; normal app
exit also attempts restoration. It does not create/delete model files,
change native window styles, reparent, inject input, or assert that
the editor is interactive under all focus conditions.

Gate: `cfg(all(windows, debug_assertions))` on Rust actions and
`import.meta.env.DEV` in Svelte navigation. All other builds
return UNAVAILABLE, and production navigation stays unchanged.
See the `docs/01-product/interface-ux.md` experimental native
composition contract for negative cases and proof limits.
