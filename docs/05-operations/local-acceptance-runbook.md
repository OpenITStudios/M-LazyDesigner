# Local Acceptance Runbook

Updated: 2026-10-16  
Owner: `LIVE_BLOCKBENCH` formal acceptance procedure  
Current state: native LazyDesigner authoring path only.

This procedure is now **ACTIVE** for the current Local handoff. `LIVE_BLOCKBENCH` is an execution capability; it does not by itself prove acceptance.

Use only for native residue; prepare source proof and deterministic fixtures first.

## 1. Acceptance Contract

```text
Goal
Success Metric
Forbidden Proxy / Non-Goal
First Evidence Required
GitHub-completed
Higher-context residue
Proof Required
STOP Condition
```

Source/CI is not visual proof. Static Footprint is a guardrail; Authoring Efficiency measures Cost to Accepted Result after the quality gate passes. User-stopped tests stay stopped.

## 2. Pin Current Local State

The historical verified baseline is documented in `current-validation.md`. It is not a
substitute for current `Local` source acceptance. Pin the exact checkout used
for this local test, rather than resetting the branch to an old SHA.

From the repository root:

```bash
git switch Local
git pull --ff-only
git status --short
git rev-parse HEAD
```

Record the 40-character HEAD, and require a clean source checkout *before*
creating any machine-only test configuration. Check this same SHA against
the GitHub Actions run and build provenance; a manual-only workflow not yet
executed on this SHA is `UNVERIFIED`, not PASS. An accepted CI result for
another SHA never transfers to this checkout.


## 3. Source Closure

Use the full source gate in `GITHUB_RULES.md`: successful `verify:full`, or successful `verify:repository` + `verify:mcp` on the same exact `Local` SHA. Reuse only for a clean matching HEAD with no source/package edits.

Install pinned local dependencies once:

```bash
cd mcp
bun install --frozen-lockfile
```

For a clean checkout matching an **accepted exact-SHA full source gate**, do not rerun `verify:full` merely to repeat that same proof. When current-SHA proof is missing, run the canonical gate once before deploying.

Run local source verification only when:
- local source/package inputs changed;
- local toolchain behavior itself is under investigation; or
- a later exact SHA lacks accepted source proof.

Then use:

```bash
bun run verify:full
```

## 3A. Choose the Codex MCP Gateway to Test

Codex uses a **stdio Gateway**, not the native Blockbench HTTPS endpoint.
Choose one launch authority and keep it fixed throughout a local acceptance run.
`codex mcp list` shows configured entries but is not evidence of a live
connection; invoke Gateway `status` in the same Codex session to prove it.

**A. Managed Desktop / packaged integration.** The managed installer owns the
`[mcp_servers.lazydesigner]` entry in the user's Codex `config.toml`. It launches
the immutable `versions/<source-sha>/lazydesigner.exe` with `args = ["mcp"]`.
Check the installed `source_sha` against `git rev-parse HEAD` and verify the
Blockbench plugin build identity. If the package predates HEAD, this run can
test the **installed package**, not prove the latest source. Do not deploy a
current plugin over an older managed Gateway and call that exact-head PASS.
Use the normal Desktop/managed installer for package activation, not manual
rewrites of its owned files. Do not alter the user's other MCP servers.

**B. Current source checkout / Codex developer localtest.** If no matching
managed package exists, use the same checked-out `mcp/gateway/index.ts` as the
stdio launch target and deploy the plugin built from that checkout. Codex may
load a *project-scoped* `.codex/config.toml` only when the repository is trusted.
For a temporary, uncommitted Windows developer configuration, use:

```toml
[mcp_servers.lazydesigner]
command = 'C:\ABSOLUTE\PATH\TO\bun.exe'
args = ['run', 'C:\ABSOLUTE\PATH\TO\M-LazyDesigner\mcp\gateway\index.ts']
startup_timeout_sec = 20
tool_timeout_sec = 180
```

Replace both paths with actual **absolute paths**. This is a local test
override, **not** a new managed installer or repository-owned configuration.
Keep `.codex/config.toml` out of Git and remove the override after source
testing. Preserve or back up pre-existing project-specific settings rather than
overwriting them. Do not separately run `bun run gateway` when Codex already
starts that Gateway. If Codex does not trust the project or the override is
not visible, stop and inspect its effective `lazydesigner` MCP entry; do not assume
Codex used the source process.

Codex's default `tool_timeout_sec` is 60 seconds. This is shorter than the
Gateway's normal 120-second Runtime call budget and can turn long native
mutations into uncertain outcomes. Managed entries without an explicit
timeout now default to **180 seconds**; explicitly set user timeouts are
preserved. Confirm the effective Codex timeout is appropriate for the actual
runtime budget before testing. If a call is interrupted or `OUTCOME_UNKNOWN`,
inspect Blockbench state before retrying it. A larger timeout is not itself
stability proof.

Whichever mode is selected: record the Codex Gateway `command`/`args`,
exact checkout/managed source SHA, installed native `build_identity`, active
Runtime URL/phase and Gateway tool surface. Only four public Gateway tools
are expected: `status`, `search_capabilities`, `describe_capability` and
`invoke_capability`. The expected default native Runtime endpoint is
`https://127.0.0.1:3000/bb-mcp`; direct HTTP is limited to isolated tests.

## 4. Deploy Exact Plugin

Before the first native load, run `bun run setup:tls` from `mcp/`. The native endpoint is `https://127.0.0.1:3000/bb-mcp`; Blockbench, Gateway and live scripts must share the machine-local TLS identity. Follow [TLS setup](../../mcp/README.md#normal-client-boundary). Do not disable certificate verification or import this certificate into the system trust store. An old Gateway process must be replaced once for this transport migration; normal Runtime reload recovery remains beneath the persistent new Gateway.

A successful `MCP Verify` may publish `lazydesigner-mcp-verified` containing `lazydesigner_mcp.js` and provenance. Prefer a matching exact-SHA artifact when available.

```bash
bun run deploy:verified -- /absolute/path/to/artifact-dir /absolute/path/to/lazydesigner_mcp.js
```

Fallback for intentionally unpushed local source:

```bash
bun run deploy:local -- /absolute/path/to/lazydesigner_mcp.js
```

Preserve unsaved projects/assets/settings/credentials/other plugins. Do not use `git clean -xfd`.

## 5. Local-code Smoke Gate

Before deploying into Blockbench, run only the environment-specific checks that CI cannot prove on this machine:

```bash
bun --version
bun run typecheck
bun run typecheck:gateway
```

Expected Bun version is owned by `.bun-version`. A local-only toolchain/environment failure must be fixed as an environment issue; do not redesign product architecture to make the machine pass.

If these commands pass on an unchanged checkout, continue to deployment.

## 6. Native Runtime Preflight

Geometry/Texturing/Animation/Persistence/quality-fixture live verifiers share one preflight: installed `build_identity`, stable instance/startup identity, phase, stateless transport, initialize contract, `tools/list`, required tools, and forbidden-tool absence.

`verify:stateless-local` is diagnostic only when that shared preflight fails or exact full-surface diagnosis is explicitly required. Do not run it automatically before every live verifier.

## 6A. Desktop Control Plane Acceptance

Before the authoring sequence, validate the Desktop controller itself from a clean checkout at the exact current `Local` SHA. This is separate from authoring-quality proof.

Use a disposable workstation/profile only for destructive fault injection. Do not modify production Blockbench plugins or active project assets.

### First-run lifecycle

```text
install Desktop
→ launch LazyDesigner
→ Set up
→ bundled managed install completes
→ Blockbench opens through ensure_ready
→ perform native Blockbench local-plugin approval if requested
→ Desktop reaches RUNTIME_READY or READY
```

Record whether approval was required. Approval may occur once; bypassing Blockbench trust is not acceptance.

### Repeat-launch lifecycle

```text
close Desktop normally
→ reopen Desktop
→ no repeated plugin approval

close Blockbench normally
→ choose Open in LazyDesigner
→ ensure_ready launches Blockbench
→ Runtime returns without manual Refresh

restart Desktop while Blockbench/Runtime are already healthy
→ state reconstructs correctly
```

### Explicit Open / native foreground focus

Run these on a disposable Windows Desktop installation built from the exact
current `Local` SHA. Do not infer foreground success from a spawned process,
the `ensure_ready` result, or a positive `SetForegroundWindow` return code.

```text
one visible Blockbench main window, currently behind LazyDesigner
→ choose Open (or Open model)
→ the explicit focus attempt targets only the Blockbench executable PID
→ FOCUSED only if GetForegroundWindow matches that same window

one minimized Blockbench main window
→ choose Open
→ restore is requested
→ report FOCUSED only when the foreground window really matches

Blockbench closed, then opened through ensure_ready
→ no background-only focus action is attempted
→ a window that is not yet discoverable returns a non-FOCUSED outcome
→ the UI does not claim foreground success

two eligible Blockbench windows (same or different profiles)
→ AMBIGUOUS; never choose the first window or guess a project/profile

another process with a window titled "Blockbench"
→ never use that window as a candidate without Blockbench.exe PID identity

no eligible Blockbench top-level window
→ NO_WINDOW or NOT_RUNNING
→ user can select Blockbench from the taskbar when it is actually running

Windows denies foreground activation
→ DENIED, not FOCUSED
→ no forced process termination or window stealing retries

opening a saved .bbmodel that is already open
→ existing Blockbench project/tab behavior is inspected separately
→ no duplicate tab and no unsaved change loss
→ a foreground match alone is not evidence the model finished opening
```

Record the focus status returned by `focus_blockbench_window` in each relevant
case, along with the foreground HWND/process identity where observable.
`UNKNOWN` or a Windows-rejected focus request is **not** a proof PASS.
The ordinary UI intentionally reports fallback guidance instead of pretending
that it has confirmed the model tab. Never enable background focus polling.

### Workspace interaction / accessibility

At both 980×680 and 780×560, test navigation and action disclosures using
keyboard-only input:

```text
search and expand a project → move to Support → return to Workspace
→ search text, expansion and Workspace scroll remain in the UI session

open the More actions disclosure with Enter/Space
→ Tab/Shift+Tab visit the available action buttons
→ Escape closes the disclosure and restores focus to its summary
→ a pointer click outside closes the disclosure

trigger Open model when its source file no longer exists
→ no false claim that the model opened
→ Blockbench project data is not changed by the Desktop

repeated connection probes fail
→ stale status is identified and unsafe-to-guess actions are disabled
→ Refresh remains available
```

### UI status and labeling checks before native sign-off

In Blockbench, open the LazyDesigner panel while the Runtime is starting,
then after a deliberate Runtime startup failure on a disposable test profile.
The status-bar button and a newly mounted panel must agree: **Starting** or
**Needs attention** until the Runtime actually reports ready. The panel must
not start at **Runtime ready** merely because it mounted after the status event.
Confirm the recovery action and copied error details remain available.

In Desktop, verify the About section displays the Desktop package version,
not a hard-coded version or the managed component build identity. The
Blockbench **Plugin file** action must directly reveal the plugin file and
must not appear as a menu disclosure. A failed status observation must
keep stale-state actions disabled while **Refresh** and diagnostic export
remain available. Treat a screenshot or source test as preparation, not a
substitute for user observation.

### Recovery matrix

Prove each applicable state independently:

```text
managed plugin missing + Blockbench closed
→ safe repair
→ Open/Prepare reaches Runtime

managed plugin modified
→ fail closed
→ no silent overwrite

managed plugin missing + Blockbench running
→ no forced repair
→ no forced Blockbench close

Runtime online + Gateway absent
→ client-wait / RUNTIME_READY
→ not an error

Gateway attaches
→ READY

custom absolute Blockbench --userData
→ plugin destination remains that profile

two simultaneous Blockbench processes with different userData profiles
→ setup refuses safely
```

For the two fault-injection cases involving plugin deletion/modification, use a disposable managed installation and restore it afterward through the canonical manager.

### Watcher / latency behavior

Keep LazyDesigner open and verify:

```text
Blockbench close/open
Runtime offline/online
Gateway attach/detach
```

The UI should update without manual Refresh. A transient Gateway fast-probe failure must preserve the last known full projection rather than falsely showing offline. The heartbeat must not spawn `lazydesigner.exe status` continuously; full status refresh is expected only when a known fast-probe value changes or an explicit action requests it.

Validate Runtime health authority separately:

```text
default Blockbench Runtime settings + default MCP client URL
→ Runtime reaches ready

matching custom Blockbench port/path + matching LAZYDESIGNER_RUNTIME_URL
→ Runtime reaches ready on the custom endpoint

Blockbench listener URL differs from the MCP client Runtime URL
→ fail closed
→ Desktop does not report ready
→ readiness identifies a local connection-settings mismatch

unrelated process occupies 127.0.0.1:3000 while LazyDesigner Runtime is absent
→ Desktop does not report Runtime ready

RuntimeHost fails to bind
→ no live Runtime session lease
→ Desktop remains not ready

Runtime crashes or Blockbench exits
→ Runtime session lease expires/disappears
→ maintenance never treats a live listener as idle
```

### Projects & Models synchronization

With one disposable Project containing at least two saved `.bbmodel` files, verify only the user-visible synchronization contract:

```text
open Model A
→ Active Project/Model matches Blockbench

open Model B in another Blockbench tab
→ Model B appears in the same Project
→ non-active open model offers Open; the native existing-tab guard must prevent a duplicate

switch A ↔ B in Blockbench
→ Desktop follows automatically without manual Refresh

modify active model without saving
→ Desktop shows Modified
→ save
→ Modified disappears

Save As to a new .bbmodel path
→ Desktop follows the new model identity/path-backed Project grouping

close one model
→ its open state clears
→ recent saved navigation remains available

click Open for an already-open model
→ Blockbench selects the existing tab
→ no duplicate project tab is created

pin an older Project, then close Blockbench after working in a newer saved model
→ Continue points to the newer last active model
→ Pin affects Recent ordering only

move/delete the exact last active model while Blockbench is closed
→ Continue is absent
→ Desktop does not guess another recent/pinned model

Runtime reconnect while Blockbench/plugin remain alive
→ Active/Open/Modified remain stable
→ no false project-session drop

stop/unload the Plugin while Blockbench remains open
→ project lease expires within the bounded TTL
→ Active/Open/Modified clear
→ Recent saved navigation remains

custom Blockbench --userData profile
→ Plugin writes a profile-scoped navigation snapshot
→ Desktop follows only the managed plugin profile

another Blockbench profile writes its own snapshot
→ managed profile navigation is not replaced or cross-contaminated
```

Do not add or validate viewport, selection, Undo, timeline, brush, panel, or other editor-session state in Desktop. Those remain Blockbench-owned and intentionally absent from the normal UI.

### Desktop evidence

Retain:

```text
exact git SHA
Desktop version
Blockbench version
managed source SHA
first-run approval required: yes/no
ensure_ready final outcome
plugin integrity state
Runtime state
Gateway state
custom userData case if tested
PASS / FAIL + first failing assertion
```

Desktop acceptance does not prove Geometry/Texturing/Animation quality. Continue with the native authoring sequence only after controller behavior is stable.

## 7. Prepared Native Sequence

Use the repository-owned disposable harness; do not redesign tests in Blockbench.

```text
shared AUTHORING
→ verify:geometry-live -- --confirm-disposable
→ UV readiness preflight
→ user Geometry APPROVED
→ UV Layout PASS
→ verify:texturing-live -- --confirm-disposable
→ Texturing → Texture APPROVED
→ Animation readiness preflight
→ AUTHORING→Animation handoff
→ verify:animation-live -- --confirm-disposable
→ verify:persistence-live -- --prepare --confirm-disposable
→ one native close/reopen
→ verify:persistence-live -- --verify --confirm-disposable
```

Geometry↔Texturing stays on the shared AUTHORING surface; no phase bounce. The readiness preflights are workflow checks, not new harness commands or approval states.

Synthetic readiness never proves user asset approval. Tool/export success, low call count, or a scalar score cannot override **QUALITY FAIL**.



### Recommended execution order for this handoff

Run from `mcp/` after the exact verified plugin is deployed and Blockbench is open.

The shared native verifier preflight already checks transport and build identity. Run `verify:stateless-local` **only if** that shared preflight fails or a focused transport diagnosis is required; do not run it again unconditionally.

First test project affinity before authoring mutations:

```bash
bun run verify:project-affinity-live -- --confirm-disposable
```

Keep the shared Geometry→Texturing→Animation fixture together:

```bash
bun run verify:geometry-live -- --confirm-disposable
bun run verify:texturing-live -- --confirm-disposable
```

Save a `.bbmodel` checkpoint whose basename is `lazydesigner_geometry_e2e_disposable` (native export updates the project name). Perform the documented Gateway AUTHORING→Animation handoff with actual disposable-test readiness evidence, not a fabricated user-approval claim. Continue without replacing that Gateway:

```bash
bun run verify:animation-live -- --confirm-disposable
bun run verify:particle-live -- --confirm-disposable
```

Persistence is two-stage:

```bash
bun run verify:persistence-live -- --prepare --confirm-disposable
```

Then close/reopen the prepared fixture exactly as instructed by the script and run:

```bash
bun run verify:persistence-live -- --verify --confirm-disposable
```

Run independent fixtures only after the shared-fixture persistence sequence. Save the active disposable fixture before a verifier that intentionally refuses unsaved work; do not relax that safety guard:

```bash
bun run verify:surface-gap-live -- --confirm-disposable
# Save the surface-gap disposable fixture to a new .bbmodel path.
bun run verify:template-live -- --confirm-disposable
bun run verify:uv-density-live -- --confirm-disposable
bun run verify:texture-runtime-live -- --confirm-disposable
```

For UV-density persistence, close/reopen its saved fixture and run:

```bash
bun run verify:uv-density-live -- --verify-reopen --confirm-disposable
```

### Focused Texture integration acceptance

The existing `verify:texture-runtime-live -- --confirm-disposable` command
now checks one continuous disposable project flow: revision-guarded bitmap
transaction, PNG readback, independent variant, Undo/Redo, exact one-pixel
brush on the base atlas, then exact painting on a newly created selected native
pixel layer. It also verifies that `paint_texture_transaction` refuses the
layered target, that both exact brush mutations produce new full-RGBA revisions
and changed focused PNG crops, and that each brush has independent Undo/Redo.

Before exact brushing, the verifier disables mirror painting, alpha locking
and color erase mode through the existing `paint_settings` capability.
Layer receipts must identify the actual selected layer UUID; composited
`get_texture` evidence is examined separately from the native edit-canvas
RGBA postcondition. Base and variant revision isolation is rechecked last.

This is a **prepared live verifier, not an executed result**. It does not
simulate a concurrent layer switch during `Texture.edit`, certify invisible
sibling-layer bytes, or prove animated-frame visuals. Those require distinct
native observation; keep any first failing assertion and the exact installed
build identity, and do not label source-test success as native acceptance.

### Lifecycle / recovery proof

Keep the same Gateway/client task active while exercising:

```text
Runtime/plugin reload
→ Gateway remains the client boundary
→ Runtime reconnects below it

Geometry → Texturing
→ shared AUTHORING surface remains semantically identical

AUTHORING → Animation → AUTHORING
→ catalog changes and returns correctly

Blockbench close → open
→ Gateway survives temporary Runtime loss
→ no silent project rebind
```

Do not restart the Gateway merely to make a failing recovery scenario pass.

### Evidence to record

For each command, retain:

```text
exact git SHA
installed build_identity
Gateway/runtime instance identity
command
PASS / FAIL
first failing assertion if any
project UUID
authoring phase
queue/operation timing from Gateway status when relevant
script-reported call metrics
saved fixture/checkpoint path when produced
```

Do not convert technical PASS into visual/reference approval.

### Safety boundary

Use only disposable fixtures for scripts that require `--confirm-disposable`.

Do not run destructive acceptance commands against:
- an unsaved production model;
- the rejected/approved source fixture itself;
- a project whose current state is not backed up.

If a mutation becomes `OUTCOME_UNKNOWN`, inspect the current Blockbench state before any retry.

## 8. Representative quality fixture

A committed sample asset is **only a representative test fixture** for LazyDesigner/MCP workflow quality. It is not a product target and **must not create fixture-specific tool behavior**, schema, thresholds, workflow law, or acceptance rules. Another suitable fixture may replace it without changing production Runtime semantics.

Never mutate the approved fixture source for system testing. Use a disposable copy.

Visual/reference `PASS` still requires the approved reference plus fresh comparable model evidence. Static metrics or automatic similarity scores cannot create visual PASS.

### 8A. Saved-model Golden Correction acceptance

For `golden-existing-model-correction`, use one immutable original
`.bbmodel` seed and one disposable saved working copy with byte-identical
starting content. Pin the exact `Local` source/build. Verify that the
**effective client MCP command** starts the benchmark-wrapped Gateway; an
independent Gateway process with an empty/irrelevant trace is not evidence.

After the benchmark session, inspect `golden-run-draft.json` and its trace:
`pipeline_provenance.input_asset_sha256` must match the unchanged seed;
`output_asset_sha256` must represent valid saved working-copy bytes and
differ from the input digest. Missing/empty/corrupt output, modified seed,
or an unchanged output must not be promoted to an accepted correction.
Machine-local paths remain outside the portable report.

Reopen the saved result in installed Blockbench. Confirm the same project,
relevant geometry/UV/texture/animation state and unaffected model parts.
Compare fresh model evidence against the approved reference and obtain
explicit human review. Keep `quality_verdict=UNVERIFIED` and
`accepted_result=null` until these independent gates pass. A hash difference,
synthetic fixture PASS or successful tool call is not visual approval.

On the exact-source checkout, the focused benchmark gate is:

```bash
cd mcp
bun test tests/benchmark/golden-benchmark-session-runner.test.ts tests/benchmark/golden-authoring-run-contract.test.ts tests/benchmark/golden-session-comparison.test.ts
bun run verify:full
```

These commands are instructions, **not** proof that the current HEAD was
executed. CI remains intentionally disabled; run them only in an authorized
`LOCAL_CODE` context or an independently authorized verification environment.

## 9. Gateway Stability

Only when lifecycle proof is requested: use one continuous client task and prove offline→online recovery, AUTHORING↔Animation catalog handoff, plugin reload recovery, and close/open recovery without a new chat. Geometry↔Texturing remains shared AUTHORING. After `OUTCOME_UNKNOWN`, inspect state before retry.

## 10. Authoring Efficiency

After the quality gate passes, compare calls, discovery, capability-search misses, redundant readbacks, correction attempts, same-cause retries, recovery, handoffs and available elapsed cost.

```text
NECESSARY | AVOIDABLE | CONTRACT_CAUSED | REASONING_CAUSED | RECOVERY
IMPROVED | UNCHANGED | REGRESSED
```

Quality must stay accepted while Cost to Accepted Result decreases. Do not invent token/latency numbers.


## 10A. Codex/Astra Usage Validation

Usage validation happens **after** the corresponding quality gate passes. Source/static byte benchmarks remain proxies and must not be converted into token claims.

Canonical fixtures:

```text
mcp/tests/fixtures/astra-live-golden-tasks.json
mcp/tests/fixtures/astra-usage-validation-template.json
```

Before any live usage run, validate the checked-in measurement contract once from `mcp/`:

```bash
bun run verify:astra-usage-ready
```

This proves preparation only; it never upgrades LIVE_BLOCKBENCH or token telemetry state.

For each Golden Task, run a comparable baseline and Zero-Waste variant on the same exact source/build state. Record only telemetry actually exposed by the client/harness. Leave unavailable values `null`; do not estimate them.

Normalize the captured result into a copy of the template, then run from `mcp/`:

```bash
bun run eval:astra-usage -- /absolute/path/to/astra-usage.json
```

A token-saving claim is available for one task only when both variants satisfy:

```text
quality_verdict = PASS
task_success = true
source-provided total_tokens is present
```

The validator deliberately does **not** derive `total_tokens` from input/output/reasoning/cached components because provider accounting semantics may differ. Component telemetry remains diagnostic only.

Record alongside usage:

```text
exact git SHA
installed build_identity
model/client identity as reported
telemetry source
Golden Task ID
baseline vs zero_waste
quality verdict
task success
user correction count
tool-call counts
available token components
source-provided total_tokens when available
```

If token telemetry is unavailable, report `token_claim_available=false` and retain the existing call/payload proxy evidence without upgrading it into a model-usage claim.

## 10B. Controlled native Desktop failures

Use the existing disposable profile and a separate debug executable. From
`apps/desktop/`, build with `cargo build --locked --manifest-path src-tauri/Cargo.toml --features native-acceptance`.
Default features exclude this harness; release builds explicitly refuse it.
No public IPC command or production runtime setting enables faults.

Set `LAZYDESIGNER_NATIVE_ACCEPTANCE_FILE` only in the test child's environment
to an absolute disposable text-file path. Start with an empty file and preserve
the healthy Desktop observation. Set the file to one exact value:

- `probe-error`: two native `connection_status` rejections must show unverified
  status and disable model actions. Clearing the file alone cannot unlock them;
  a successful full Refresh must recover.
- `full-error`: an explicit Refresh must show the native error and preserve the
  stale-status gate; clear the file and Refresh to recover.
- `focus-denied` or `focus-no-window`: explicit Open must retain the editor/model
  and offer the taskbar fallback without claiming confirmed focus.
- `focus-delayed-real`: wait twenty seconds on a worker, then call the unchanged
  real Windows focus owner and record `acceptance:real-focus`. This permits an
  OS menu or window-lifecycle precondition without substituting a result.

The injected modes prove native Tauri IPC/fallback handling, not physical
Windows outcomes. For `focus-delayed-real`, record the actual foreground/window
precondition and returned result. Use saved disposable models; clean any
windowless process fixture and reopen the models afterward. Do not substitute
an injected result for this proof. Avoid Alt+Space where a global app shortcut
owns it. The 59f0a6c2 eight-second build already produced both real outcomes;
the later twenty-second delay is operator convenience, not a necessary fix.

For disappearance diagnosis, the bounded metadata-only `desktop.log` now records
start/ready, main-window close/destroy, exit request/exit and panic with PID.
Normal close must have an exit trail. Terminating only the disposable test
Desktop should leave no normal exit trail; Runtime/model state must survive.
This verifies diagnosis readiness, not the cause of a historical disappearance.
Finish by closing the debug build and restoring the ordinary release build;
the same fault-file environment variable must have no effect on that release.

## 11. Failure / Completion

Targeted quality work uses disposable face/contact, adjoining texture and limb-cycle fixtures under the current specialist gates. Keep rejected assets frozen. Native and user visual proof remain separate from source tests.

Classify the first wrong owner before correction. If a live verifier exposes a source defect, return only that defect to the appropriate development context; do not restart the entire GitHub audit.

Update only changed owners:
- `docs/05-operations/current-validation.md` — proof interpretation;
- `docs/05-operations/next-action.md` — continuation;
- `docs/04-system/implementation-map.md` — source ownership.

When requested proof criteria are satisfied, **STOP**.
