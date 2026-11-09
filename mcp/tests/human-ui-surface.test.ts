import { describe, expect, test } from "bun:test";

const source = (relative: string) =>
  Bun.file(new URL(`../${relative}`, import.meta.url)).text();

describe("human-facing Blockbench UI", () => {

  test("stale project actions explain their disabled state without blocking safe file access", async () => {
    const [workspace, navigator, app, support] = await Promise.all([
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/SupportPage.svelte"),
    ]);
    expect(workspace).toContain("statusUnverified={statusProbeFailures >= 2}");
    expect(navigator).toContain('id="ld-project-action-note"');
    expect(navigator).toContain("Refresh required for project changes.");
    expect(navigator).toContain("You can still open models and folders.");
    expect(navigator).toContain("aria-describedby={statusUnverified ? 'ld-project-action-note' : undefined}");
    expect(navigator).toContain("disabled={busy || !canEditProjectPrefs}>Add Project Folder</button>");
    expect(navigator).toContain("disabled={!project.available || busy}>Open Folder</button>");
    expect(navigator).toContain("disabled={!model.exists || busy || !canOpenModel}>{openingModelId === model.id ? 'Opening…' : 'Open'}</button>");
    expect(app).toContain("statusProbeFailures >= 2 && !isSafeFileNavigationAction(action)");
    expect(workspace).toContain("updateCheck?.status === 'UPDATE_STAGED_UNVERIFIED'");
    expect(workspace).toContain("Staged package unverified");
    expect(support).toContain('aria-label="Last unsuccessful action"');
    expect(support).toContain("<h2>{errorTitle}</h2>");
    expect(app).toContain("{errorTitle} {errorDetail} {errorRecovery} {operations}");
    expect(app).toContain("reportReadinessFailure(result, 'connect')");
    expect(app).toContain("reportReadinessFailure(ready, 'install')");
    expect(app).toContain("attentionError && status && errorRecovery?.action === 'open-support'");
  });

  test("stale project actions expose a nearby keyboard-reachable read-only recovery", async () => {
    const [workspace, navigator, fixture] = await Promise.all([
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/scripts/capture-ui.py"),
    ]);
    expect(navigator).toContain("export let onRefreshStatus: () => void | Promise<void>;");
    expect(workspace).toContain("onRefreshStatus={refresh}");
    expect(navigator).toContain('id="ld-project-action-note" class="project-state-note" role="group"');
    expect(navigator).toContain('aria-label="Project actions need updated status"');
    expect(navigator).toContain('onclick={onRefreshStatus} disabled={busy}>Refresh status</button>');
    expect(navigator).toContain("You can still open models and folders.");
    expect(navigator).toContain("aria-describedby={statusUnverified ? 'ld-project-action-note' : undefined}");
    expect(navigator).toContain("disabled={busy || !canEditProjectPrefs}");
    expect(navigator).toContain(".project-state-note button{flex:0 0 auto}");
    expect(fixture).toContain('direct_refresh = note.get_by_role("button", name="Refresh status", exact=True)');
    expect(fixture).toContain("direct_refresh.focus()");
    expect(fixture).not.toContain("direct_refresh.click()");
  });

  test("Delete Project dialog announces the exact folder and restores focus after the source row disappears", async () => {
    const [dialog, app] = await Promise.all([
      source("../apps/desktop/src/ProjectDeleteDialog.svelte"),
      source("../apps/desktop/src/App.svelte"),
    ]);
    expect(dialog).toContain('role="alertdialog" aria-modal="true"');
    expect(dialog).toContain("project-delete-explanation project-delete-location project-delete-blocked");
    expect(dialog).toContain('id="project-delete-location">{review.folder_path}</code>');
    expect(dialog).toContain('id="project-delete-blocked" role="status"');
    expect(dialog).toContain('aria-label={`Move project ${review.project_name} to Recycle Bin`}');
    expect(dialog).toContain('aria-describedby="project-delete-location"');
    expect(dialog).toContain("onclick={onConfirm} disabled={busy || confirmBlocked}");
    expect(dialog).toContain("onclick={onCancel} disabled={busy}");
    expect(dialog).toContain("if (event.defaultPrevented || event.isComposing) return;");
    expect(dialog).toContain("if (returnFocus?.isConnected && returnFocus !== document.body) returnFocus.focus();");
    expect(dialog).toContain("else document.querySelector<HTMLElement>('.page-toolbar h1')?.focus();");
    const confirm = app.slice(app.indexOf("async function confirmDeleteProject()"), app.indexOf("async function openModel("));
    expect(confirm).toContain("invoke<ProjectDeleteResult>('confirm_delete_project'");
    expect(confirm).toContain("const verifiedStatus = await refreshAfterAcknowledgment('Recycle Bin operation');");
    expect(confirm).toContain("if (!verifiedStatus) return;");
    expect(confirm).toContain("await tick();");
    expect(confirm).toContain("document.querySelector<HTMLElement>('.page-toolbar h1')?.focus();");
    expect(confirm).toContain("result.status === 'RECYCLED' ? 'success' : 'pending'");
    expect(dialog).not.toContain("invoke<");
  });

  test("disabled Particle Studio controls reference task-specific visible explanations", async () => {
    const panel = await source("ui/panel.html");
    expect(panel).toContain('id="ld-studio-save-model-hint"');
    expect(panel).toContain("!project.hasFolder ? 'ld-studio-save-model-hint' : null");
    expect(panel).toContain("project.hasFolder && !studioHasChanges()");
    expect(panel).toContain('id="ld-studio-no-changes"');
    expect(panel).not.toContain("Save the .bbmodel first to enable particle file Save.");
    const locked = ["emission", "size", "speed", "lifetime", "color",
      "opacity", "radius", "vertical_acceleration"];
    for (const field of locked) {
      expect(panel).toContain(`!studioLoaded.editable.${field} ? 'ld-studio-locked-values' : null`);
    }
    expect(panel).toContain('id="ld-studio-locked-values"');
    expect(panel.match(/id="ld-studio-locked-values"/g)).toHaveLength(1);
    expect(panel).toContain("Those values are preserved.");
    for (const id of ["ld-studio-attach-save-first", "ld-studio-attach-save-changes", "ld-studio-attach-ready"]) {
      expect(panel).toContain(`id="${id}"`);
      expect(panel).toContain(`'${id}'`);
    }
    expect(panel).toContain(':disabled="studioBusy || !studioLoaded.path || studioHasChanges()"');
    expect(panel).toContain(':disabled="studioBusy || !project.hasFolder || !studioHasChanges()"');
    expect(panel).toContain('@click="studioAttach"');
    expect(panel).toContain('@click="studioSave"');
  });

  test("small-window layouts wrap controls while retaining semantic focus and recovery", async () => {
    const [navigator, workspace, app, support, shared, capture] = await Promise.all([
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/SupportPage.svelte"),
      source("../apps/desktop/src/styles.css"),
      source("../apps/desktop/scripts/capture-ui.py"),
    ]);
    expect(navigator).toContain("@media(max-width:680px)");
    expect(navigator).toContain(".project-actions,.model-actions{flex:1 1 100%");
    expect(navigator).toContain(".project-search-controls{flex-wrap:wrap}");
    expect(workspace).toContain("@media(max-width:680px)");
    expect(workspace).toContain(".definition-row{flex-wrap:wrap");
    expect(support).toContain("@media(max-width:680px)");
    expect(support).toContain(".recovery-list code{display:block;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}");
    expect(app).toContain("@media(max-width:520px)");
    expect(app).toContain(".page-toolbar{min-height:48px;flex-wrap:wrap");
    expect(shared).toContain("prefers-reduced-motion: reduce");
    expect(shared).toContain("button:focus-visible");
    expect(capture).toContain("VIEWPORTS = ((390, 640), (780, 560), (980, 680))");
    expect(capture).toContain("ld-project-action-note");
  });

  test("Desktop feedback is in flow, contextual and never overlaps model actions", async () => {
    const [app, workspace, navigator, fixture] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/scripts/capture-ui.py"),
    ]);
    const header = app.indexOf('<header class="page-toolbar">');
    const notice = app.indexOf('class="operation-attention"');
    const content = app.indexOf("{#if page === 'Analytics'}", header);
    expect(header).toBeGreaterThan(0);
    expect(notice).toBeGreaterThan(header);
    expect(notice).toBeLessThan(content);
    expect(app).not.toContain("position:fixed;z-index:220");
    expect(app).toContain("$: attentionError = page === 'Support' && status ? '' : error;");
    expect(app).toContain("page !== 'Overview'");
    expect(app).toContain("clearActionToast();\n    const notice = desktopErrorNotice(cause);");
    expect(app).toContain("role={attentionError ? 'alert' : 'status'}");
    expect(app).toContain('aria-label="Dismiss notification" onclick={clearActionFeedback}');
    expect(app).toContain(".operation-attention{flex:none;min-width:0;display:grid");
    expect(app).toContain(".attention-copy span{min-width:0");
    expect(app).toContain(".attention-actions{grid-column:2;justify-content:flex-end}");
    expect(app).toContain("if (kind === 'pending') return;");

    // One dominant action on first run; optional AI setup uses the secondary style.
    expect(workspace).toContain('<button class="primary-button" onclick={() => openModel()}');
    expect(workspace).toContain('<button class="secondary-button" onclick={installLazyDesigner}');
    expect(workspace).toContain(".setup-panel{max-width:760px;margin:8px 0 18px");
    expect(navigator).toContain(".content-section{margin-bottom:24px}");
    expect(navigator).toContain(".project-list{border:1px solid var(--border-soft);border-radius:var(--radius-sm)");

    expect(app).toContain("if (preview === 'pending')");
    expect(app).toContain("else if (preview === 'error')");
    expect(fixture).toContain("FEEDBACK_SCENARIOS = (");
    expect(fixture).toContain("def inspect_feedback_presentation(page, feedback, view):");
    expect(fixture).toContain('dismiss.press("Enter")');
    expect(fixture).toContain('"feedbackEvidence": "SOURCE_FIXED_DEV_FIXTURES_ONLY"');
    expect(fixture).not.toContain("repair.click()");
  });

  test("native receipts do not become false successes when the following full status check fails", async () => {
    const app = await source("../apps/desktop/src/App.svelte");
    expect(app).toContain("let lastFullStatusRefreshSucceeded = false;");
    const refresh = app.slice(app.indexOf("async function refresh()"), app.indexOf("async function runProjectAction("));
    expect(refresh).toContain("lastFullStatusRefreshSucceeded = false;");
    expect(refresh).toContain("lastFullStatusRefreshSucceeded = true;");
    expect(refresh).toContain("connectionMonitor.fullStatusFailed();");
    expect(refresh).toContain("async function refreshAfterAcknowledgment(action: string): Promise<boolean>");
    expect(refresh).toContain("if (lastFullStatusRefreshSucceeded) return true;");
    expect(refresh).toContain("reportStatusAfterAcknowledgment(action);");
    expect(refresh).toContain("action: 'refresh-status'");
    expect(refresh).toContain("Do not repeat the action just because verification failed.");
    expect(refresh).toContain("confirmationNeeded: 'Current Desktop/Blockbench state after the native acknowledgement.'");

    const pref = app.slice(app.indexOf("async function runProjectAction("), app.indexOf("async function addProjectFolder("));
    const folder = app.slice(app.indexOf("async function addProjectFolder("), app.indexOf("async function beginDeleteProject("));
    const deletion = app.slice(app.indexOf("async function confirmDeleteProject("), app.indexOf("async function openModel("));
    const model = app.slice(app.indexOf("async function openModel("), app.indexOf("async function focusCurrentEditor("));
    const select = app.slice(app.indexOf("async function chooseBlockbenchExecutable("), app.indexOf("async function openBlockbenchEditor("));
    const editor = app.slice(app.indexOf("async function openBlockbenchEditor("), app.indexOf("async function copyNavigationPath("));
    for (const section of [pref, folder, deletion, model, select, editor]) {
      expect(section).toContain("await refreshAfterAcknowledgment(");
    }
    expect(deletion.indexOf("recordOperation('Move Project to Recycle Bin'"))
      .toBeLessThan(deletion.indexOf("const verifiedStatus = await refreshAfterAcknowledgment("));
    expect(deletion).toContain("result.status === 'RECYCLED' ? 'success' : 'pending'");
    expect(deletion).toContain("if (!verifiedStatus) return;");
    expect(deletion).not.toContain("if (!verifiedStatus) throw");
    expect(deletion).toContain("await tick();");

    const connect = app.slice(app.indexOf("async function connectBlockbench("), app.indexOf("async function showRetiredPluginFile("));
    const install = app.slice(app.indexOf("async function performInstall("), app.indexOf("async function showPluginFile("));
    expect(connect).toContain("if (!lastFullStatusRefreshSucceeded)");
    expect(connect).toContain("reportStatusAfterAcknowledgment('Blockbench connection')");
    expect(connect).toContain("status?.product_state !== 'ready' || status.readiness.ready !== true");
    expect(connect).toContain("result.status === 'RUNTIME_READY' && status?.runtime_ready !== true");
    expect(connect).toContain("Connection returned a ready result, but the latest Desktop status did not confirm");
    expect(connect.indexOf("reportStatusAfterAcknowledgment('Blockbench connection')"))
      .toBeLessThan(connect.indexOf("showActionToast(focused"));
    expect(connect.indexOf("status?.product_state !== 'ready' || status.readiness.ready !== true"))
      .toBeLessThan(connect.indexOf("showActionToast(focused"));
    expect(install).toContain("reportStatusAfterAcknowledgment('LazyDesigner setup')");
    expect(install).toContain("ready.status === 'READY' && (status?.product_state !== 'ready' || status.readiness.ready !== true)");
    expect(install).toContain("ready.status === 'RUNTIME_READY' && status?.runtime_ready !== true");
    expect(install).toContain("Setup returned a ready result, but Desktop has not confirmed");
    expect(install.indexOf("reportStatusAfterAcknowledgment('LazyDesigner setup')"))
      .toBeLessThan(install.indexOf("if (ready.status === 'READY' &&"));
    expect(install.indexOf("if (ready.status === 'READY' &&"))
      .toBeLessThan(install.indexOf("else if (ready.status === 'READY') showActionToast("));

    const managed = app.slice(app.indexOf("async function runManagedAction("), app.indexOf("onMount(() => {"));
    expect(managed).toContain("recordOperation(actionLabel, feedback.kind, feedback.status)");
    expect(managed).toContain("if (action === 'update') updateCheck = null;");
    expect(managed).toContain("if (!(await refreshAfterAcknowledgment(actionLabel))) return;");
    expect(managed.indexOf("if (!(await refreshAfterAcknowledgment(actionLabel))) return;"))
      .toBeLessThan(managed.indexOf("showActionToast(feedback.message, feedback.kind)"));
    // Full status is still read-only; neither this helper nor errors retry the
    // acknowledged model launch, deletion, installation or managed action.
    expect(refresh).not.toContain("confirm_delete_project");
    expect(refresh).not.toContain("managed_action");
    expect(refresh).not.toContain("ensure_ready");
  });

  test("recovery notices separate action, next step and unverified result without unsafe retries", async () => {
    const { desktopErrorNotice, readinessFailureNotice } =
      await import("../../apps/desktop/src/desktopPresentation");

    const timeout = desktopErrorNotice(new Error("Status request timed out. Refresh to retry."));
    expect(timeout.title).toBe("Connection check timed out");
    expect(timeout.recovery.action).toBe("refresh-status");
    expect(timeout.recovery.nextStep).toContain("does not repeat the original action");
    expect(timeout.recovery.confirmationNeeded).toContain("outcome of the original action");

    const unknownDeletion = desktopErrorNotice({
      code: "PROJECT_RECYCLE_FAILED", message: "Native recycle status uncertain",
    });
    expect(unknownDeletion.title).toBe("Project deletion not confirmed");
    expect(unknownDeletion.recovery.action).toBeNull();
    expect(unknownDeletion.recovery.nextStep).toContain("Windows Recycle Bin");
    expect(unknownDeletion.recovery.confirmationNeeded).toContain("remains unknown");
    expect(unknownDeletion.message).toContain("No permanent-delete fallback was attempted");
    const deletionWithMisleadingDetail = desktopErrorNotice({
      code: "PROJECT_RECYCLE_FAILED",
      message: "DESKTOP_UPDATE_REQUIRED INSTALLATION_MISMATCH Native recycle status uncertain",
    });
    expect(deletionWithMisleadingDetail.title).toBe("Project deletion not confirmed");
    expect(deletionWithMisleadingDetail.recovery.action).toBeNull();

    const blocked = desktopErrorNotice({
      code: "PROJECT_DELETE_REVIEW_FAILED", message: "System folder protected",
    });
    expect(blocked.recovery.action).toBeNull();
    expect(blocked.recovery.nextStep).toContain("do not repeat Delete Project");
    const openEditor = desktopErrorNotice({
      code: "PROJECT_DELETE_REVIEW_FAILED", message: "Save and close all Blockbench windows",
    });
    expect(openEditor.recovery.action).toBeNull();
    expect(openEditor.recovery.nextStep).toContain("start a new deletion review only if");

    const oldPlugin = desktopErrorNotice({ code: "LEGACY_PLUGIN_MIGRATION_REQUIRED", message: "legacy plugin" });
    expect(oldPlugin.recovery.action).toBe("open-support");
    expect(oldPlugin.recovery.nextStep).toContain("backed-up migration path");

    const update = desktopErrorNotice({
      code: "UPDATE_CHECK_FAILED", message: "status timed out at C:/private/directory",
    });
    expect(update.title).toBe("Update check unavailable"); // Typed error wins over timeout text.
    expect(update.recovery.action).toBeNull();
    expect(update.message).not.toContain("C:/private");
    expect(update.recovery.nextStep).not.toContain("C:/private");
    expect(update.detail).toContain("C:/private");
    const updateWithMisleadingDetail = desktopErrorNotice({
      code: "UPDATE_CHECK_FAILED",
      message: "INSTALLATION_MISMATCH Multiple Blockbench installations were detected",
    });
    expect(updateWithMisleadingDetail.title).toBe("Update check unavailable");
    expect(updateWithMisleadingDetail.recovery.action).toBeNull();

    const unknown = desktopErrorNotice({ code: "UNEXPECTED", message: "opaque-machine-path" });
    expect(unknown.recovery.action).toBe("open-support");
    expect(unknown.recovery.nextStep).not.toContain("opaque-machine-path");
    expect(unknown.recovery.confirmationNeeded).toContain("operation completed");

    const failure = (reason: string) => ({
      status: "NEEDS_ATTENTION" as const,
      reason, runtime_online: false, gateway_active: false,
      blockbench_running: true, plugin_integrity: "ready" as const,
      manual_plugin_approval_recommended: false,
    });
    const probe = readinessFailureNotice(failure("CONNECTION_PROBE_UNKNOWN"), "connect");
    expect(probe.title).toBe("Blockbench connection needs attention");
    expect(probe.recovery.action).toBe("refresh-status");
    expect(probe.recovery.nextStep).toContain("does not repeat setup");
    const setup = readinessFailureNotice(failure("PLUGIN_INTEGRITY"), "install");
    expect(setup.title).toBe("Setup needs attention");
    expect(setup.recovery.action).toBe("open-support");
    expect(setup.recovery.confirmationNeeded).toContain("does not confirm");
    expect(readinessFailureNotice(failure("BLOCKBENCH_EXITED"), "connect").recovery.action).toBeNull();
  });

  test("recovery controls are safe, contextual and visible without exposing raw paths", async () => {
    const [app, support, fixture, presentation] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/SupportPage.svelte"),
      source("../apps/desktop/scripts/capture-ui.py"),
      source("../apps/desktop/src/desktopPresentation.ts"),
    ]);
    expect(app).toContain("errorRecovery = notice.recovery");
    expect(app).toContain("function reportReadinessFailure(");
    expect(app).toContain("errorRecovery?.action === 'refresh-status'");
    expect(app).toContain("errorRecovery?.action === 'open-support'");
    expect(app).toContain("Next: {errorRecovery.nextStep}");
    expect(app).toContain("onclick={refresh} disabled={loading || busyAction !== null}>Refresh status</button>");
    expect(app).toContain("{errorRecovery} {operations}");
    const notice = app.slice(app.indexOf("{#if attentionError || actionMessage"), app.indexOf("{#if page === 'Analytics'}", app.indexOf("{#if attentionError || actionMessage")));
    expect(notice).not.toContain("runManagedAction(");
    expect(notice).not.toContain("confirmDeleteProject(");
    expect(notice).not.toContain("performInstall(");
    expect(support).toContain("Still to verify: {errorRecovery.confirmationNeeded}");
    expect(support).toContain("{errorRecovery.nextStep}");
    expect(support).toContain("errorRecovery.action === 'refresh-status' && !aiStatus.needsRefresh");
    expect(support).toContain("<code>{errorDetail}</code>");
    expect(presentation).toContain("type DesktopRecoveryAction");
    expect(fixture).toContain('"delete-uncertain"');
    expect(fixture).toContain("def inspect_feedback_presentation(page, feedback, view):");
    expect(fixture).toContain("uncertain deletion must not expose an automatic retry");
    expect(fixture).not.toContain("delete.click()");
    expect(fixture).not.toContain("repair.click()");
  });

  test("AI status labels distinguish full-check age from a live MCP session", async () => {
    const { aiStatusPresentation, fullStatusObservationAgeMs, FULL_STATUS_RECENT_MS } =
      await import("../../apps/desktop/src/desktopPresentation");
    const { createDevFixtureStatus, FIXTURE_NOW_MS } =
      await import("../../apps/desktop/src/desktopFixtures");
    const readyStatus = createDevFixtureStatus("ready");
    const fresh = aiStatusPresentation(readyStatus, 0, FIXTURE_NOW_MS);
    expect(fresh.label).toBe("Verified at last check");
    expect(fresh.headline).toBe("AI verified at last check");
    expect(fresh.detail).toContain("full status check");
    expect(fresh.detail).toContain("does not guarantee");
    expect(fresh.recentlyVerified).toBe(true);
    expect(fresh.needsRefresh).toBe(false);

    expect(fullStatusObservationAgeMs(FIXTURE_NOW_MS, FIXTURE_NOW_MS)).toBe(0);
    expect(fullStatusObservationAgeMs(0, FIXTURE_NOW_MS)).toBeNull();
    expect(fullStatusObservationAgeMs(FIXTURE_NOW_MS + 1, FIXTURE_NOW_MS)).toBeNull();
    expect(FULL_STATUS_RECENT_MS).toBe(30_000);
    const atBoundary = aiStatusPresentation(readyStatus, 0, FIXTURE_NOW_MS + FULL_STATUS_RECENT_MS);
    expect(atBoundary.needsRefresh).toBe(false);
    const old = aiStatusPresentation(readyStatus, 0, FIXTURE_NOW_MS + FULL_STATUS_RECENT_MS + 1);
    expect(old.label).toBe("AI check out of date");
    expect(old.recentlyVerified).toBe(false);
    expect(old.needsRefresh).toBe(true);
    expect(old.detail).toContain("This does not mean AI is disconnected");

    const aged = aiStatusPresentation(createDevFixtureStatus("ready-aged"), 0, FIXTURE_NOW_MS);
    expect(aged.label).toBe("AI check out of date");
    expect(aged.detail).toContain("1 minute ago");
    const unknown = createDevFixtureStatus("ready");
    unknown.observed_at_unix_ms = 0;
    expect(aiStatusPresentation(unknown, 0, FIXTURE_NOW_MS).label).toBe("Check time unavailable");
    const future = createDevFixtureStatus("ready");
    future.observed_at_unix_ms = FIXTURE_NOW_MS + 1;
    expect(aiStatusPresentation(future, 0, FIXTURE_NOW_MS).needsRefresh).toBe(true);

    const staleProbe = aiStatusPresentation(readyStatus, 2, FIXTURE_NOW_MS);
    expect(staleProbe.label).toBe("Verification required");
    expect(staleProbe.recentlyVerified).toBe(false);
    expect(staleProbe.needsRefresh).toBe(true);
    expect(staleProbe.detail).toContain("Models and folders remain accessible");

    const waiting = createDevFixtureStatus("client-wait");
    expect(aiStatusPresentation(waiting, 0, FIXTURE_NOW_MS).label).toBe("AI client not connected");
    waiting.gateway.state = "gateway-detected";
    const handshake = aiStatusPresentation(waiting, 0, FIXTURE_NOW_MS);
    expect(handshake.label).toBe("AI handshake unverified");
    expect(handshake.detail).toContain("not verified");
    expect(aiStatusPresentation(createDevFixtureStatus("fresh-install"), 0, FIXTURE_NOW_MS).label).toBe("Setup needed");

    const [workspace, support, app] = await Promise.all([
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/SupportPage.svelte"),
      source("../apps/desktop/src/App.svelte"),
    ]);
    expect(workspace).toContain("aiStatusPresentation(status, statusProbeFailures, statusPresentationNowMs)");
    expect(workspace).toContain("{aiStatus.headline}");
    expect(workspace).toContain("{aiStatus.label}");
    expect(workspace).toContain("{#if aiStatus.needsRefresh}");
    expect(workspace).not.toContain("productMode(status) === 'ready' ? 'Connected'");
    expect(support).toContain("aiStatusPresentation(status, statusProbeFailures, statusPresentationNowMs)");
    expect(support).toContain("{aiStatus.label}");
    expect(support).toContain("{#if aiStatus.needsRefresh}");
    expect(app).toContain("statusPresentationNowMs = Date.now();");
    expect(app).toContain("if (!devFixture) statusPresentationNowMs = Date.now();");
    expect(app).toContain("statusPresentationNowMs = FIXTURE_NOW_MS");
  });

  test("model opening and editor focus expose a bounded visible progress path", async () => {
    const [navigator, workspace, app, fixture] = await Promise.all([
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/desktopFixtures.ts"),
    ]);
    expect(navigator).toContain("export let openingModelId: string | null = null");
    expect(navigator).toContain('class="model-opening-notice" role="status" aria-live="polite"');
    expect(navigator).toContain("Opening {openingModelName} in Blockbench…");
    expect(navigator.match(/aria-busy={openingModelId === /g)).toHaveLength(3);
    expect(navigator).toContain("openingModelId === model.id ? 'Opening…' : 'Open'");
    expect(navigator).toContain("disabled={!model.exists || busy || !canOpenModel}");
    expect(workspace).toContain("{openingModelId}");
    expect(app).toContain("openingModelId = id ?? null;");
    expect(app).toContain("openingModelId = null;\n      busyAction = null;");
    expect(app).toContain("editorOperations.openModel(id)");
    expect(app).toContain("feedback.verification === 'confirmed-active' ? 'success' : 'pending'");
    expect(app).toContain("busyAction = 'open-editor';\n    clearActionFeedback();");
    expect(app).toContain("Windows could not confirm Blockbench focus.");
    expect(app).toContain("if (devFixture === 'ready' && new URLSearchParams(window.location.search).get('activity') === 'opening-model')");
    expect(fixture).toContain("'ready-aged'");
  });

  test("next-step notifications persist; optional launch focus is not a success claim", async () => {
    const [app, editor] = await Promise.all([
      source("../apps/desktop/src/App.svelte"), source("../apps/desktop/src/editorOperations.ts"),
    ]);
    expect(app).toContain("if (kind === 'pending') return;");
    expect(app).toContain("actionToastTimer = window.setTimeout");
    expect(app).toContain("onclick={clearActionFeedback}");
    expect(app).toContain("role={attentionError ? 'alert' : 'status'}");
    expect(app).toContain("feedback.verification === 'focused' ? 'success' : 'pending'");
    expect(app).toContain("approvalPending ? 'pending' : 'success'");
    expect(app).toContain("result.reason !== 'MCP_SESSION_UNVERIFIED' ? 'success' : 'pending'");
    expect(editor).toContain("verification: focused ? 'focused' : 'launched-unverified'");
  });

  test("Desktop model search has an explicit clear action and live result count", async () => {
    const [navigator, workspace] = await Promise.all([
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/WorkspacePage.svelte"),
    ]);
    expect(navigator).toContain('for="ld-project-search"');
    expect(navigator).toContain('bind:this={searchInput}');
    expect(navigator).toContain('function clearProjectSearch()');
    expect(navigator).toContain("searchInput?.focus()");
    expect(navigator).toContain("Clear search</button>");
    expect(navigator).toContain('id="ld-project-search-results"');
    expect(navigator).toContain('role="status" aria-live="polite"');
    expect(navigator).toContain("matchingProjects.length");
    expect(workspace).toContain("You can edit models even when AI is not connected.");
  });

  test("keyboard quick-open resolves only one available nonactive model by name", async () => {
    const { uniqueModelSearchTarget } = await import("../../apps/desktop/src/desktopPresentation");
    const { createDevFixtureStatus } = await import("../../apps/desktop/src/desktopFixtures");
    const ready = createDevFixtureStatus("ready").project_navigation;
    expect(uniqueModelSearchTarget(ready, " SOFA ")?.model.id).toBe("model-fixture-2");
    expect(uniqueModelSearchTarget(ready, "")).toBeNull();
    expect(uniqueModelSearchTarget(ready, "no_such_model")).toBeNull();
    expect(uniqueModelSearchTarget(ready, "Modern Chair")).toBeNull(); // Active model is not opened again.
    expect(uniqueModelSearchTarget(ready, "Furniture")).toBeNull(); // Project-name match is not a model shortcut.

    const large = createDevFixtureStatus("many-projects").project_navigation;
    expect(uniqueModelSearchTarget(large, "needle")?.model.id).toBe("fixture-model-8");
    large.projects[0].models[0].name = "Needle duplicate";
    expect(uniqueModelSearchTarget(large, "needle")).toBeNull(); // Ambiguous; explicit selection required.
    large.projects[0].available = false;
    expect(uniqueModelSearchTarget(large, "needle")?.model.id).toBe("fixture-model-8");

    const missing = createDevFixtureStatus("ready").project_navigation;
    missing.projects[0].models[1].exists = false;
    expect(uniqueModelSearchTarget(missing, "sofa")).toBeNull();
    const unavailable = createDevFixtureStatus("ready").project_navigation;
    unavailable.projects[0].available = false;
    expect(uniqueModelSearchTarget(unavailable, "sofa")).toBeNull();
  });

  test("search keyboard affordances are explained, bounded and do not open ambiguous results", async () => {
    const [navigator, presentation, fixture] = await Promise.all([
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/desktopPresentation.ts"),
      source("../apps/desktop/scripts/capture-ui.py"),
    ]);
    expect(navigator).toContain('onkeydown={handleProjectSearchKeydown}');
    expect(navigator).toContain('id="ld-project-search-help"');
    expect(navigator).toContain('aria-describedby="ld-project-search-results ld-project-search-help"');
    expect(navigator).toContain("if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;");
    expect(navigator).toContain("event.key === 'Escape' && projectSearch");
    expect(navigator).toContain("event.stopPropagation()");
    expect(navigator).toContain("event.key === 'Enter' && uniqueSearchModel && canOpenModel && !busy");
    expect(navigator).toContain("void onOpenModel(uniqueSearchModel.model.id)");
    expect(navigator).toContain('Press Enter to open');
    expect(navigator).toContain('Escape clears search.');
    expect(presentation).toContain("if (target !== null) return null;");
    expect(fixture).toContain('search.press("Escape")');
    expect(fixture).not.toContain('model.click()');
    expect(fixture).not.toContain('search.press("Enter")'); // Preserve native safety in browser QA.
  });

  test("one primary Workspace model task survives current, continue, missing and empty states", async () => {
    const { createDevFixtureStatus, devFixtureFromLocation } = await import("../../apps/desktop/src/desktopFixtures");
    const { continueTarget } = await import("../../apps/desktop/src/desktopPresentation");
    const current = createDevFixtureStatus("ready").project_navigation;
    const resume = createDevFixtureStatus("ready-continue").project_navigation;
    const empty = createDevFixtureStatus("ready-no-active").project_navigation;
    expect(current.active?.model_name).toBe("Modern Chair");
    expect(continueTarget(current)).toBeNull();
    expect(resume.active).toBeNull();
    expect(continueTarget(resume)?.model.name).toBe("Modern Chair");
    expect(empty.active).toBeNull();
    expect(continueTarget(empty)).toBeNull();
    const missingProject = structuredClone(resume);
    missingProject.projects[0].available = false;
    expect(continueTarget(missingProject)).toBeNull();
    const missingModel = structuredClone(resume);
    missingModel.projects[0].models[0].exists = false;
    expect(continueTarget(missingModel)).toBeNull();
    expect(devFixtureFromLocation(true, "?fixture=ready-continue")).toBe("ready-continue");
    const [workspace, navigator, capture] = await Promise.all([
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/scripts/capture-ui.py"),
    ]);
    expect(workspace).toContain("resumableModel = continueTarget(status.project_navigation)");
    expect(workspace).toContain("{#if !status.project_navigation.active && !resumableModel}");
    expect(navigator).toContain("Continue model ${target.model.name} in Blockbench");
    expect(navigator).toContain('class="primary-button small-button continue-action"');
    expect(navigator).toContain('class="secondary-button small-button" onclick={() => onOpenModel()}');
    expect(capture).toContain('("ready-continue", "workspace")');
    expect(capture).toContain("def inspect_model_task_priority(page, fixture, view):");
    expect(capture).toContain('entry["modelTaskPriorityChecks"]');
  });

  test("first-run Workspace makes model opening primary and AI setup an explicit optional action", async () => {
    const [workspace, navigator] = await Promise.all([
      source("../apps/desktop/src/WorkspacePage.svelte"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
    ]);
    expect(workspace).toContain("Opening and editing models in Blockbench does not require an AI connection.");
    expect(workspace).toContain('aria-label="Optional AI setup"');
    expect(workspace).toContain('<h2>Set up AI tools</h2>');
    expect(workspace).toContain("What happens during setup?");
    expect(workspace).not.toContain("Prepare workstation");
    expect(workspace).toContain("setupStaged ? 'Finish setup'");
    expect(workspace).toContain("migrationConflict ? 'Check again'");
    expect(workspace).toContain("disabled={!status.bootstrap_available || busyAction !== null || statusProbeFailures >= 2}");
    expect(workspace).toContain("{#if status.project_navigation.projects.length > 0}");
    expect(workspace).toContain("{#if status.project_navigation.projects.length > 0 || status.project_navigation.active}");
    expect(workspace).toContain("{#if !status.project_navigation.active && status.project_navigation.projects.length === 0}");
    expect(workspace).toContain("{@render projectNavigator(status)}");
    const welcome = workspace.indexOf("{#if productMode(status) === 'welcome'}");
    const setup = workspace.indexOf('<section class="setup-panel"', welcome);
    const firstModel = workspace.indexOf('<h2>Open a model</h2>');
    expect(firstModel).toBeLessThan(setup);
    expect(setup).toBeGreaterThan(welcome);

    // Empty inventory does not show a nonproductive search, but folder add
    // remains accessible and an existing query can still be cleared.
    expect(navigator).toContain("navigation.projects.length > 0 || projectSearch.trim().length > 0");
    expect(navigator).toContain("onAddProjectFolder");
    expect(navigator).toContain("Clear search</button>");

    const fixture = await source("../apps/desktop/scripts/capture-ui.py");
    expect(fixture).toContain("def inspect_first_run(page, fixture, view):");
    expect(fixture).toContain('("fresh-install", "workspace"): {');
    expect(fixture).toContain('page.get_by_text("AI status needs verification", exact=True)');
    expect(fixture).toContain('entry["firstRunChecks"]');
  });

  test("Particle Studio is an optional disclosure without losing native authoring commands", async () => {
    const [panel, css, ui] = await Promise.all([
      source("ui/panel.html"), source("ui/panel.css"), source("ui/index.ts"),
    ]);
    const geometry = panel.indexOf('aria-label="Geometry tools"');
    const particle = panel.indexOf('aria-label="Particle Studio"');
    const disclosure = panel.indexOf('<details class="ld-studio-disclosure">', particle);
    expect(geometry).toBeGreaterThan(0);
    expect(geometry).toBeLessThan(particle);
    expect(disclosure).toBeGreaterThan(particle);
    expect(panel.indexOf('<summary class="ld-studio-toggle">', disclosure)).toBeGreaterThan(disclosure);
    expect(panel).not.toContain('<details class="ld-studio-disclosure" open');
    expect(ui).toContain("Draft not saved");
    expect(ui).toContain("Changes not saved");
    expect(ui).toContain("Saved effect ready");
    expect(ui).toContain("Animation stage required");
    expect(panel).toContain("{{studioSummaryLabel()}}");
    expect(panel).toContain("Open a Bedrock Model");
    expect(panel).toContain('v-else-if="!studioStageReady()"');
    for (const method of ["studioRefresh", "studioReset", "studioOpen", "studioCreate",
      "studioSave", "studioRevert", "studioPlay", "studioStop", "studioCheck", "studioAttach"]) {
      expect(panel.indexOf(`@click="${method}"`, disclosure)).toBeGreaterThan(disclosure);
    }
    expect(panel).toContain(':disabled="studioBusy || !project.hasFolder || !studioHasChanges()"');
    expect(panel).toContain(':disabled="studioBusy || !studioLoaded.path || studioHasChanges()"');
    expect(css).toContain('.ld-studio-disclosure > summary:focus-visible');
    expect(css).toContain('.ld-studio-disclosure[open] > summary::before');
    expect(ui).toContain("stopStudioPreview");
    expect(ui).toContain("studioStageReady(this: HumanPanelContext): boolean {");
  });

  test("collapsed Particle Studio exposes errors and unsaved work without changing native lifecycle", async () => {
    const [panel, css, ui] = await Promise.all([
      source("ui/panel.html"), source("ui/panel.css"), source("ui/index.ts"),
    ]);
    const particle = panel.slice(panel.indexOf('aria-label="Particle Studio"'));
    expect(particle).toContain('<details class="ld-studio-disclosure">');
    expect(particle).not.toContain('<details class="ld-studio-disclosure" open');
    expect(particle).toContain("{{studioSummaryLabel()}}");
    expect(particle).toContain("ld-studio-has-error");
    expect(particle).toContain("ld-studio-has-changes");
    expect(particle).toContain('v-if="studioError" class="ld-studio-error-closed" role="alert"');
    expect(particle).toContain("Open it to read the error.");
    const closedError = particle.indexOf('class="ld-studio-error-closed"');
    const detailsEnd = particle.lastIndexOf("</details>", closedError);
    expect(detailsEnd).toBeGreaterThan(0);
    expect(closedError).toBeGreaterThan(detailsEnd);
    expect(particle.match(/{{studioError}}/g)).toHaveLength(1);
    expect(particle).toContain('<p v-if="studioError" class="ld-error" role="alert">{{studioError}}</p>');
    expect(particle).toContain('<p v-if="studioNote" class="ld-studio-note" role="status" aria-live="polite">{{studioNote}}</p>');
    expect(css).toContain(".ld-studio-disclosure[open] + .ld-studio-error-closed { display: none; }");
    expect(css).toContain(".ld-studio-toggle-hint.ld-studio-has-error");
    expect(css).toContain(".ld-studio-disclosure > summary:focus-visible");

    expect(ui).toContain("studioSummaryLabel(this: HumanPanelContext): string {");
    const summary = ui.slice(ui.indexOf("studioSummaryLabel(this: HumanPanelContext): string {"),
      ui.indexOf("studioHasChanges(this: HumanPanelContext): boolean {"));
    expect(summary).toContain('if (this.studioError) return "Needs attention · Open for details";');
    expect(summary).toContain('if (this.studioBusy) return "Working on particle…";');
    expect(summary).toContain('if (!this.project.isBedrock) return "Open a Bedrock Model";');
    expect(summary).toContain('"Animation stage required · Draft not saved"');
    expect(summary).toContain('"Animation stage required · Changes not saved"');
    expect(summary).toContain('"Preview playing · Draft not saved"');
    expect(summary).toContain('"Preview playing · Changes not saved"');
    expect(summary).toContain('"Saved effect ready"');
    expect(summary).not.toContain("await ");
    expect(summary).not.toContain("writeFile");
    expect(ui).toContain('vm.studioNote = "Preview stopped when Blockbench mode changed.');
    expect(ui).toContain("stopStudioPreview()");
    expect(ui).toContain('this.studioError = "Preview unavailable: " +');
    expect(ui).toContain('this.studioError = "Particle file saved, but preview unavailable: " +');
    expect(ui).toContain('this.studioNote = "Particle file saved." + animationWarning;');
    expect(ui).not.toContain('this.studioNote += " Standalone preview: "');
  });

  test("Particle Studio protects unsaved drafts when starting or opening another effect", async () => {
    const [ui, panel, css] = await Promise.all([
      source("ui/index.ts"), source("ui/panel.html"), source("ui/panel.css"),
    ]);
    const context = ui.slice(ui.indexOf("type HumanPanelContext = {"), ui.indexOf("function readHumanProjectState():"));
    expect(context).toContain("studioHasChanges(): boolean;");
    expect(context).toContain("studioStageReady(): boolean;");

    const prompt = ui.slice(ui.indexOf("function confirmStudioReplacement("), ui.indexOf("function readHumanProjectState():"));
    expect(prompt).toContain("if (!vm.studioHasChanges()) return true;");
    expect(prompt).toContain('const draft = !vm.studioLoaded?.path;');
    expect(prompt).toContain('action === "new"');
    expect(prompt).toContain("will discard those changes.");
    expect(prompt).toContain("Saved particle files will not be modified.");
    expect(prompt).toContain("return window.confirm(");
    for (const forbidden of ["stopStudioPreview(", "cancelStudioLivePreview(", "studioLoaded = null",
      "studioBusy = true", "writeFile", "runRuntimeOperationExclusive("]) {
      expect(prompt).not.toContain(forbidden);
    }

    const newEffect = ui.slice(ui.indexOf("studioReset(this: HumanPanelContext): void {"),
      ui.indexOf("async studioCreate(this: HumanPanelContext): Promise<void> {"));
    const openEffect = ui.slice(ui.indexOf("async studioOpen(this: HumanPanelContext): Promise<void> {"),
      ui.indexOf("async studioSave(this: HumanPanelContext): Promise<void> {"));
    expect(newEffect).toContain('if (this.studioBusy || !confirmStudioReplacement(this, "new")) return;');
    expect(openEffect).toContain('!confirmStudioReplacement(this, "open")) return;');
    expect(newEffect.indexOf('confirmStudioReplacement(this, "new")'))
      .toBeLessThan(newEffect.indexOf("cancelStudioLivePreview();"));
    expect(openEffect.indexOf('confirmStudioReplacement(this, "open")'))
      .toBeLessThan(openEffect.indexOf("cancelStudioLivePreview();"));
    expect(newEffect.indexOf('confirmStudioReplacement(this, "new")'))
      .toBeLessThan(newEffect.indexOf("stopStudioPreview();"));
    expect(openEffect.indexOf('confirmStudioReplacement(this, "open")'))
      .toBeLessThan(openEffect.indexOf("this.studioBusy = true;"));

    expect(panel).toContain('v-if="studioLoaded && studioHasChanges()" class="ld-studio-unsaved-note"');
    expect(panel).toContain("New Effect or Open will ask before replacing them.");
    expect(panel).toContain("Switching projects discards these unsaved changes, not saved particle files.");
    expect(css).toContain(".mcp-panel .ld-studio-unsaved-note");
    expect(css).toContain("var(--color-accent)");
    // No change to the authoritative file and Animation permission boundaries.
    expect(ui).toContain('await saveStudioParticle(project, loaded, changes)');
    expect(ui).toContain('await attachStudioParticle(project, this.studioLoaded, this.studioLocator)');
  });

  test("Particle Studio orders Preview, Save and Attach and blocks unsafe attachment early", async () => {
    const [panel, ui, css] = await Promise.all([
      source("ui/panel.html"), source("ui/index.ts"), source("ui/panel.css"),
    ]);
    const preview = panel.indexOf('class="ld-studio-subheading">Preview');
    const save = panel.indexOf('class="ld-studio-subheading">Save');
    const attach = panel.indexOf('class="ld-studio-subheading">Attach to animation');
    expect(preview).toBeGreaterThan(panel.indexOf('v-if="studioLoaded" class="ld-studio-edit"'));
    expect(save).toBeGreaterThan(preview);
    expect(attach).toBeGreaterThan(save);
    expect(panel).toContain("Location in model");
    expect(panel).toContain("Preview uses this location without saving a particle file.");
    expect(panel).toContain("Some controls are read-only because the particle uses authored expressions.");
    expect(panel).toContain("Those values are preserved.");
    expect(panel).toContain('v-if="project.hasFolder && !studioHasChanges()" id="ld-studio-no-changes" class="section-hint">No unsaved changes to save.');
    expect(panel).toContain('v-if="!studioLoaded.path" id="ld-studio-attach-save-first" class="section-hint">Save this particle file before attaching it.');
    expect(panel).toContain('v-else-if="studioHasChanges()" id="ld-studio-attach-save-changes" class="section-hint">Save your latest changes before attaching.');
    expect(panel).toContain(':disabled="studioBusy || !studioLoaded.path || studioHasChanges()"');
    expect(panel).toContain(':disabled="studioBusy || !project.hasFolder || !studioHasChanges()"');
    expect(panel).toContain('@click="studioAttach"');
    expect(ui).toContain('if (!this.studioLoaded.path) {');
    expect(ui).toContain('if (studioChangeOperations(this.studioLoaded, this.studioSettings).length) {');
    expect(ui).toContain("attachStudioParticle(project, this.studioLoaded, this.studioLocator)");
    expect(css).toContain(".ld-studio-subheading");
  });

  test("native authoring panel prioritizes the actionable Geometry section", async () => {
    const [panel, css] = await Promise.all([source("ui/panel.html"), source("ui/panel.css")]);
    expect(panel.indexOf('aria-label="Geometry tools"')).toBeGreaterThan(0);
    expect(panel.indexOf('aria-label="Geometry tools"')).toBeLessThan(panel.indexOf('aria-label="Particle Studio"'));
    expect(panel).toContain('Open a Bedrock Model project to use these checks.');
    expect(panel).toContain('studioStageReady()');
    expect(panel).toContain('@click="studioSave"');
    expect(css).toContain('.ld-workspace + .ld-workspace');
  });

  test("project-list selectors retain search, first-match, continue and recent order semantics", async () => {
    const { visibleProjects, visibleProjectModels, recentModelTargets, continueTarget } =
      await import("../../apps/desktop/src/desktopPresentation");
    const makeModel = (id: string, name: string, exists = true, active = false) =>
      ({ id, name, exists, active, open: false, dirty: false });
    const makeProject = (id: string, name: string, models: ReturnType<typeof makeModel>[]) =>
      ({ id, name, models, active: false, pinned: false, registered: true,
        available: true, model_count: models.length, folders: [] });
    const alpha = makeProject("alpha", "Alpha", [
      makeModel("shared", "Old copy", false),
      makeModel("draft", "Draft", true, true),
      makeModel("continue", "Continue"),
      makeModel("stay", "Stone"),
    ]);
    const studio = makeProject("studio", "Studio", [
      makeModel("shared", "Shared"),
      makeModel("needle", "Needle model"),
    ]);
    const state = {
      revision: null, session_live: false, continue_model_id: "continue",
      recent_model_ids: ["shared", "draft", "continue", "needle", "stay", "missing"],
      preferences_issue: null, active: null, projects: [alpha, studio],
    } satisfies import("../../apps/desktop/src/projectNavigationTypes").ProjectNavigation;

    expect(visibleProjects(state, "STUDIO", false).map(p => p.id)).toEqual(["studio"]);
    expect(visibleProjects(state, "NEEDLE", false).map(p => p.id)).toEqual(["studio"]);
    expect(visibleProjectModels(studio, "studio").map(m => m.id)).toEqual(["shared", "needle"]);
    expect(visibleProjectModels(studio, "needle").map(m => m.id)).toEqual(["needle"]);
    expect(visibleProjectModels(studio, "missing")).toEqual([]);

    const seven = Array.from({ length: 7 }, (_, n) => makeProject(String(n), `Item ${n}`, []));
    expect(visibleProjects({ ...state, projects: seven }, "", false)).toHaveLength(6);
    expect(visibleProjects({ ...state, projects: seven }, "", true)).toHaveLength(7);
    expect(visibleProjects({ ...state, projects: seven }, "ITEM 6", false).map(p => p.id)).toEqual(["6"]);

    expect(recentModelTargets(state).map(t => [t.project.id, t.model.id])).toEqual([
      ["studio", "shared"], ["studio", "needle"], ["alpha", "stay"],
    ]);
    expect(recentModelTargets({ ...state, recent_model_ids: [] })).toEqual([]);
    expect(continueTarget(state)?.model.id).toBe("continue");
    expect(continueTarget({ ...state, active: {
      project_id: "alpha", project_name: "Alpha", model_id: "continue",
      model_name: "Continue", saved: true, dirty: false,
    } })).toBeNull();
  });

  test("large project fixture exposes a model beyond the six initially visible rows", async () => {
    const { createDevFixtureStatus, devFixtureFromLocation } =
      await import("../../apps/desktop/src/desktopFixtures");
    const { visibleProjects, visibleProjectModels } =
      await import("../../apps/desktop/src/desktopPresentation");
    const fixture = createDevFixtureStatus("many-projects");
    const state = fixture.project_navigation;
    expect(fixture.product_state).toBe("ready");
    expect(state.active).toBeNull();
    expect(state.projects).toHaveLength(8);
    expect(new Set(state.projects.map(p => p.id)).size).toBe(8);
    expect(new Set(state.projects.flatMap(p => p.models.map(m => m.id))).size).toBe(8);
    expect(visibleProjects(state, "", false)).toHaveLength(6);
    expect(visibleProjects(state, "Needle asset", false).map(p => p.id))
      .toEqual(["fixture-project-8"]);
    expect(visibleProjectModels(state.projects[7], "Needle asset").map(m => m.name))
      .toEqual(["Needle asset"]);
    expect(visibleProjects(state, "", true)).toHaveLength(8);
    expect(devFixtureFromLocation(false, "?fixture=many-projects")).toBeNull();
    expect(devFixtureFromLocation(true, "?fixture=many-projects")).toBe("many-projects");
  });

  test("offline UX task probes record presentation paths without claiming real user completion", async () => {
    const script = await source("../apps/desktop/scripts/capture-ui.py");
    for (const task of [
      "discover_model_without_ai",
      "find_model_and_recover_empty_search",
      "find_model_beyond_first_six_projects",
      "locate_stale_status_recovery",
      "navigate_to_safe_repair",
    ]) expect(script).toContain(task);
    expect(script).toContain('("many-projects", "workspace")');
    expect(script).toContain("def inspect_task_journey(page, fixture, view):");
    expect(script).toContain('"taskJourney"');
    expect(script).toContain('"humanTaskSuccess": "NOT_MEASURED"');
    expect(script).toContain('"native_action": "NOT_ATTEMPTED"');
    expect(script).toContain('"automation_elapsed_ms"');
    const start = script.indexOf("def inspect_task_journey(");
    const end = script.indexOf("\ndef main():", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const probe = script.slice(start, end);
    for (const forbidden of ["model.click()", "repair.click()", "refresh.click()", "invoke(",
      "launch_model", "confirm_delete_project", "runManagedAction("]) {
      expect(probe).not.toContain(forbidden);
    }
  });

  test("managed update notice distinguishes staged, applied, missing, and invalid receipts", async () => {
    const { managedActionPresentation } = await import("../../apps/desktop/src/desktopPresentation");
    const staged = managedActionPresentation("update", { status: "STAGED" });
    expect(staged.kind).toBe("pending");
    expect(staged.message).toContain("not installed");
    expect(staged.message).toContain("Close Blockbench");

    const installed = managedActionPresentation("update", { status: "INSTALLED" });
    expect(installed.kind).toBe("success");
    const noChange = managedActionPresentation("update", { status: "NO_PENDING_UPDATE" });
    expect(noChange.kind).toBe("unchanged");
    expect(managedActionPresentation("repair", { status: "REPAIRED" }).kind).toBe("success");
    expect(managedActionPresentation("setup-tls", { status: "TLS_READY" }).kind).toBe("success");
    expect(() => managedActionPresentation("update", { status: "UNKNOWN" })).toThrow("Unexpected managed");
    expect(() => managedActionPresentation("update", {})).toThrow("no verified status");

    const app = await Bun.file(new URL("../../apps/desktop/src/App.svelte", import.meta.url)).text();
    const operations = await Bun.file(new URL("../../apps/desktop/src/maintenanceOperations.ts", import.meta.url)).text();
    expect(operations).toContain("managedActionPresentation(request.action, result.receipt)");
    expect(app).toContain("maintenanceOperations.execute(request)");
    expect(app).toContain("actionMessageKind === 'pending' ? 'Next step'");
    const support = await Bun.file(new URL("../../apps/desktop/src/SupportPage.svelte", import.meta.url)).text();
    expect(support).toContain("operation.outcome === 'unchanged' ? 'No change'");
  });

  test("Desktop visual fixtures render offline and separate Analytics from native commands", async () => {
    const { createDevFixtureStatus, createDevAnalyticsFixture, devFixtureFromLocation } =
      await import("../../apps/desktop/src/desktopFixtures");

    expect(createDevFixtureStatus("fresh-install").product_state).toBe("welcome");
    expect(createDevFixtureStatus("fresh-install").project_navigation.projects).toHaveLength(0);
    expect(createDevFixtureStatus("ready").product_state).toBe("ready");
    expect(createDevFixtureStatus("ready").project_navigation.projects).toHaveLength(1);
    const noActive = createDevFixtureStatus("ready-no-active");
    expect(noActive.product_state).toBe("ready");
    expect(noActive.project_navigation.active).toBeNull();
    expect(noActive.project_navigation.continue_model_id).toBeNull();
    const resumable = createDevFixtureStatus("ready-continue");
    expect(resumable.project_navigation.active).toBeNull();
    expect(resumable.project_navigation.continue_model_id).toBe("model-fixture");
    expect(resumable.project_navigation.projects[0].models.every(model => !model.active)).toBe(true);
    expect(noActive.project_navigation.projects).toHaveLength(1);
    expect(noActive.project_navigation.projects[0].models.every(model => !model.active)).toBe(true);
    expect(createDevFixtureStatus("status-unverified").product_state).toBe("ready");
    expect(createDevFixtureStatus("plugin-modified").plugin_integrity).toBe("modified");
    expect(createDevFixtureStatus("unsupported").blockbench.compatibility?.status).toBe("unsupported");
    expect(createDevAnalyticsFixture().state).toBe("PARTIAL");
    expect(createDevAnalyticsFixture().projects).toHaveLength(1);
    expect(devFixtureFromLocation(false, "?fixture=ready")).toBeNull();
    expect(devFixtureFromLocation(true, "?fixture=ready")).toBe("ready");
    expect(devFixtureFromLocation(true, "?fixture=ready-no-active")).toBe("ready-no-active");
    expect(devFixtureFromLocation(true, "?fixture=ready-continue")).toBe("ready-continue");
    expect(devFixtureFromLocation(true, "?fixture=status-unverified")).toBe("status-unverified");

    const [app, support, analytics] = await Promise.all([
      Bun.file(new URL("../../apps/desktop/src/App.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/SupportPage.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/AnalyticsPage.svelte", import.meta.url)).text(),
    ]);
    expect(app).toContain("status = createDevFixtureStatus(devFixture)");
    expect(app).toContain("devFixture ? createDevAnalyticsFixture()");
    expect(app).toContain("const stopProgressListener = devFixture ? () => {} : subscribeManagedProgress(");
    expect(app).not.toContain("applyDevFixture(status, devFixture)");
    expect(app).toContain("migrateLegacySetup={() => performInstall(true)}");
    expect(support).toContain("{#if error}");
    expect(support).toContain("{#if errorDetail}");
    expect(analytics).toContain("Back to Support");
    expect(app).toContain("backToSupport={() => navigate('Support')}");
    expect(app).toContain('data-qa-fixture={devFixture ?? undefined}');
    expect(app).toContain("if (view === 'support') page = 'Support'");
    expect(app).toContain("else if (view === 'analytics')");
    expect(app).toContain("document.querySelector<HTMLElement>('.page-toolbar h1')?.focus()");
    expect(app).toContain('<h1 tabindex="-1">');
    const capture = await Bun.file(new URL("../../apps/desktop/scripts/capture-ui.py", import.meta.url)).text();
    expect(capture).toContain('nativeOrVisualApproval');
    expect(capture).toContain('("fresh-install", "workspace")');
    expect(capture).toContain('("ready", "analytics")');
    expect(capture).toContain('("ready-no-active", "workspace")');
    expect(capture).toContain('("status-unverified", "workspace")');
    expect(capture).toContain('("status-unverified", "support")');
    expect(capture).toContain("def inspect_action_states(page, fixture, view):");
    expect(capture).toContain('"Go to Blockbench for Modern Chair": False');
    expect(capture).toContain('"Open Model…": True');
    expect(capture).toContain('"Choose Blockbench…": False');
    expect(capture).toContain('VIEWPORTS = ((390, 640), (780, 560), (980, 680))');
  });


  test("Workspace blocks stale project decisions without blocking direct model browsing", async () => {
    const [app, workspace, navigator, deleteDialog, pluginDoc, support] = await Promise.all([
      Bun.file(new URL("../../apps/desktop/src/App.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/WorkspacePage.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/ProjectNavigator.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/ProjectDeleteDialog.svelte", import.meta.url)).text(),
      Bun.file(new URL("../../docs/05-operations/blockbench-plugin-ui.md", import.meta.url)).text(),
      Bun.file(new URL("../../apps/desktop/src/SupportPage.svelte", import.meta.url)).text(),
    ]);
    expect(workspace).toContain("canOpenModel={true}");
    expect(workspace).toContain("canFocusCurrentEditor={statusProbeFailures < 2}");
    expect(workspace).toContain("canEditProjectPrefs={statusProbeFailures < 2}");
    expect(workspace).toContain("busy={busyAction !== null}");
    expect(workspace).toContain("{#if !status.project_navigation.active && !resumableModel}");
    expect(workspace).toContain("Open Blockbench</button>");
    expect(workspace).toContain('onclick={() => openModel()} disabled={busyAction !== null}');
    expect(app).toContain("async function openModel(id?: string) {\n    if (devFixture || busyAction) return;");
    expect(app).toContain("statusProbeFailures >= 2 && !isSafeFileNavigationAction(action)");
    expect(app).toContain("async function confirmDeleteProject() {\n    if (devFixture || busyAction || !deleteReview || statusProbeFailures >= 2) return;");
    expect(app).toContain("confirmBlocked={statusProbeFailures >= 2}");
    expect(app).toContain("if (devFixture === 'status-unverified') statusProbeFailures = 2;");
    expect(deleteDialog).toContain("disabled={busy || confirmBlocked}");
    expect(deleteDialog).toContain("onclick={onCancel} disabled={busy}");
    expect(support).toContain("onclick={migrateLegacySetup} disabled={busyAction !== null || status.manager_available || statusProbeFailures >= 2}");
    expect(support).toContain("onclick={chooseBlockbenchExecutable} disabled={busyAction !== null || statusProbeFailures >= 2}");
    expect(support).toContain("onclick={exportDiagnostics} disabled={busyAction !== null}");
    expect(navigator).toContain('aria-label={`Open model ${model.name}`}');
    expect(navigator).toContain('aria-label={`Open folder for project ${project.name}`}');
    expect(pluginDoc).toContain("No empty Texture or Animation tabs");
    expect(pluginDoc).not.toContain("Keep exactly three navigation categories");
  });

  test("late-mounted plugin panels never default to false Runtime-ready status", async () => {
    const [ui, bar] = await Promise.all([source("ui/index.ts"), source("ui/statusBar.ts")]);
    expect(bar).toContain("export function getStatusBarState()");
    expect(bar).toContain("state: currentStatus.state");
    expect(bar).toContain('detail: currentStatus.detail ?? ""');
    expect(ui).toContain("runtime: getStatusBarState()");
    expect(ui).toContain("const current = getStatusBarState()");
    expect(ui).toContain("vm.runtime.state = current.state");
    expect(ui).not.toContain('state: "running" as McpServerStatus');
  });

  test("Desktop UI labels versions and actions without presenting a fake menu", async () => {
    const app = await Bun.file(new URL("../../apps/desktop/src/App.svelte", import.meta.url)).text();
    const support = await Bun.file(new URL("../../apps/desktop/src/SupportPage.svelte", import.meta.url)).text();
    expect(app).toContain("<SupportPage");
    expect(support).toContain("import { version as desktopVersion } from '../package.json'");
    expect(support).toContain("<strong>{desktopVersion}</strong>");
    expect(support).toContain("LazyDesigner Desktop version");
    expect(support).not.toContain("<strong>0.1.0</strong>");
    expect(app).toContain("async function showPluginFile()");
    expect(app).toContain("'show_plugin_file'");
    const workspace = await Bun.file(new URL("../../apps/desktop/src/WorkspacePage.svelte", import.meta.url)).text();
    expect(workspace).toContain("onclick={showPluginFile}");
    expect(workspace).toContain("Show approval file");
    expect(app).not.toContain('aria-label="Blockbench actions"');
  });

  test("human panel exposes actionable Geometry tools without empty tabs and preserves review on save", async () => {
    const [panel, ui] = await Promise.all([source("ui/panel.html"), source("ui/index.ts")]);

    expect(panel).toContain('aria-label="Geometry tools"');
    expect(panel).toContain("Review Latest Edit");
    expect(panel).toContain("Find Geometry Issues");
    expect(panel).toContain("Safe Cube Cleanup");
    expect(panel).toContain("Locate in Outliner");
    expect(panel).toContain('v-else-if="!project.isBedrock"');
    expect(panel).not.toContain('role="tablist"');
    expect(panel).not.toContain("Coming soon");
    expect(panel).not.toContain("Tool catalog");
    expect(ui).toContain('isBedrock: Project.format?.id === "bedrock"');
    expect(ui).toContain('event === "save_project" ||');
    expect(ui).toContain("runRuntimeOperationExclusive(generation");
    expect(ui).not.toContain("activeCategory");
    expect(ui).not.toContain("setActiveMcpAuthoringStage(");
  });

  test("Blockbench guidance distinguishes no project, wrong format and unsaved particle drafts", async () => {
    const [panel, css, ui] = await Promise.all([
      source("ui/panel.html"), source("ui/panel.css"), source("ui/index.ts"),
    ]);
    expect(panel).toContain('v-if="!project.open" class="ld-empty-state"');
    expect(panel).toContain('v-else-if="!project.isBedrock" class="ld-empty-state"');
    expect(panel.match(/Open a Bedrock Model project to use these checks\./g)).toHaveLength(1);
    expect(panel).toContain("Switch to a Bedrock Model project to use Geometry checks.");
    expect(panel).toContain("<summary>Advanced: Cube cleanup</summary>");
    expect(panel).toContain("Preview proposed Cube rounding and UV risks before confirming any change.");
    expect(panel).toContain("Reload LazyDesigner</button>");
    expect(panel).toContain("You can still edit in Blockbench");
    expect(panel).toContain("Switch to the Animation stage to use particle tools.");
    expect(panel).toContain("Save the .bbmodel to enable Find Particles and Save Particle.");
    expect(ui).toContain("Preview playing");
    expect(panel).toContain("{{studioLoaded.path ? 'Save Changes' : 'Save Particle'}}");
    expect(panel).toContain("{{studioLoaded.path ? 'Revert Changes' : 'Reset Draft'}}");
    expect(panel).toContain(':disabled="studioBusy || !project.hasFolder || !studioHasChanges()"');
    expect(panel).toContain(':disabled="studioBusy || !studioLoaded.path || studioHasChanges()"');
    expect(panel).toContain('v-else-if="!studioStageReady()"');
    expect(ui).toContain("this.studioLoaded.path");
    expect(ui).toContain("Draft settings reset to the starting preview. No file was changed.");
    expect(ui).toContain("scheduleStudioLivePreview(this)");
    expect(css).toContain(".mcp-panel summary:focus-visible");
    expect(css).toContain(".mcp-panel .ld-review-rows dd");
    expect(css).toContain("overflow-wrap: anywhere;");
    expect(css).not.toContain("text-overflow: ellipsis;\n}");
    for (const method of ["studioSave", "studioRevert", "studioPlay", "studioAttach", "studioCheck", "studioRefresh"]) {
      expect(panel).toContain(`@click="${method}"`);
    }
  });

  test("Support puts troubleshooting first and native disclosures tell Show from Hide", async () => {
    const [support, fixture] = await Promise.all([
      source("../apps/desktop/src/SupportPage.svelte"),
      source("../apps/desktop/scripts/capture-ui.py"),
    ]);
    expect(support.indexOf('<h2>Troubleshooting</h2>')).toBeGreaterThan(0);
    expect(support.indexOf('<h2>Troubleshooting</h2>')).toBeLessThan(support.indexOf('<h2>About</h2>'));
    expect(support).toContain("'Choose Blockbench…'");
    expect(support).toContain(">Show plugin file</button>");
    expect(support).toContain("'Export diagnostics'");
    expect(support).toContain("status.plugin_integrity === 'missing' ? 'Missing'");
    expect(support).not.toContain("Repairing / missing");
    expect(support.match(/class="disclosure-state"/g)).toHaveLength(5);
    expect(support).toContain(".advanced-recovery[open] .disclosure-state .when-open");
    expect(support).toContain(".recent-activity[open] .disclosure-state .when-closed");
    expect(support).toContain('onclick={() => runManagedAction(\'repair\')}');
    expect(support).toContain("disabled={!status.maintenance.repair || busyAction !== null || statusProbeFailures >= 2}");
    expect(fixture).toContain("def inspect_support_disclosures(page, fixture, view):");
    expect(fixture).toContain('entry["supportNavigationChecks"]');
    expect(fixture).toContain('"Choose Blockbench…": False');
    expect(fixture).toContain('"Export diagnostics": True');
    expect(fixture).not.toContain('"Choose…": False');
    expect(fixture).not.toContain("repair.click()");
  });

  test("status wording stays simple and actionable", async () => {
    const [ui, statusBar] = await Promise.all([
      source("ui/index.ts"),
      source("ui/statusBar.ts"),
    ]);

    expect(ui).toContain('return "Runtime ready"');
    expect(ui).toContain('return "Starting"');
    expect(ui).toContain('return "Needs attention"');
    expect(ui).toContain('return "Local Runtime is ready. AI client connection is managed separately."');
    expect(ui).toContain('return "AI authoring is not available right now."');

    expect(statusBar).toContain('return "LazyDesigner Runtime Ready"');
    expect(statusBar).toContain('return "LazyDesigner Needs Attention"');
    expect(statusBar).not.toContain("runtimeAddress");
    expect(statusBar).not.toContain("127.0.0.1");
  });

  test("project display is event-driven and folder access reuses Blockbench native action", async () => {
    const ui = await source("ui/index.ts");

    for (const event of [
      "select_project",
      "new_project",
      "setup_project",
      "load_project",
      "save_project",
      "close_project",
    ]) {
      expect(ui).toContain(`"${event}"`);
    }
    expect(ui).toContain("Blockbench.on(event, listener)");
    expect(ui).toContain("Blockbench.removeListener(event, listener)");
    expect(ui).toContain('event === "update_selection"');
    expect(ui).toContain("open_model_folder");
    expect(ui).not.toContain("setInterval(");
  });

  test("recovery actions are contextual and copied support details avoid local paths", async () => {
    const [panel, ui, reload] = await Promise.all([
      source("ui/panel.html"),
      source("ui/index.ts"),
      source("plugin/reload.ts"),
    ]);

    expect(panel).toContain("runtime.state === 'failed'");
    expect(panel).toContain('@click="reloadLazyDesigner"');
    expect(panel).toContain("Copy Error Details");
    expect(ui).toContain("reloadLazyDesignerPlugin()");
    expect(ui).toContain("LazyDesigner support details");
    expect(ui).not.toContain("Project.save_path}");
    expect(ui).not.toContain("Project.export_path}");
    expect(reload).toContain("canReloadLazyDesignerPlugin");
    expect(reload).toContain("reloadLazyDesignerPlugin");
  });

  test("dev auto-reload and human reload share one native plugin owner", async () => {
    const [devSync, reload] = await Promise.all([
      source("plugin/devSync.ts"),
      source("plugin/reload.ts"),
    ]);

    expect(devSync).toContain("getReloadableLazyDesignerPlugin");
    expect(devSync).not.toContain("function getReloadableBlockItPlugin");
    expect(reload).toContain("plugin.reload()");
  });

  test("normal plugin metadata keeps creator credentials anonymous", async () => {
    const plugin = await source("index.ts");

    expect(plugin).toContain('title: "LazyDesigner"');
    expect(plugin).toContain('author: "Anonymous"');
    expect(plugin).toContain('repository: ""');
    expect(plugin).toContain('bug_tracker: ""');

    expect(plugin).not.toContain("@author");
    expect(plugin).not.toContain("@discord");
    expect(plugin).not.toContain("@github");
    expect(plugin).not.toContain("compatibility surface switched");
    expect(plugin).not.toContain("MCP phase switched");
  });

  test("rare manual settings are clearly marked advanced or developer-only", async () => {
    const settings = await source("ui/settings.ts");

    expect(settings).toContain("Connection Port (Advanced)");
    expect(settings).toContain("Connection Path (Advanced)");
    expect(settings).toContain("Startup Focus (Advanced)");
    expect(settings).toContain("Legacy Compatibility (Developer)");
    expect(settings).toContain("Leave this at the default for normal use.");
    expect(settings).toContain("Leave this off for normal use.");
  });

  test("panel mounts before the network permission gate", async () => {
    const [entry, status, css, panel] = await Promise.all([
      source("index.ts"), source("ui/statusBar.ts"), source("ui/panel.css"), source("ui/index.ts"),
    ]);
    expect(entry).toContain("blockbenchIntegration.setupUi(registrationProfile, authoringStage)");
    expect(entry.indexOf("blockbenchIntegration.setupUi(registrationProfile, authoringStage)"))
      .toBeLessThan(entry.indexOf("runtimeHost.acquireNativeNetwork(generation)"));
    expect(entry).toContain('setStatusBarState("failed"');
    expect(status).toContain('document.createElement("button")');
    expect(status).toContain('state: "starting"');
    expect(css).not.toContain("nth-last-child");
    expect(panel).not.toContain("pluginBrowserSetup");
  });
});
