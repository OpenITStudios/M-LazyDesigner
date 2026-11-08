#!/usr/bin/env python3
"""Capture development-only LazyDesigner Desktop fixture views for manual UI review.

Requires a running Vite frontend and an optional local Playwright installation.
Does not contact Tauri, Blockbench, MCP, or production systems.
"""

import argparse
import json
import sys
from pathlib import Path
from tempfile import gettempdir
from time import perf_counter
from urllib.parse import urlencode, urlsplit

SCENARIOS = (
    ("fresh-install", "workspace"),
    ("ready", "workspace"),
    ("ready", "editor"),
    ("many-projects", "editor"),
    ("fresh-install", "editor"),
    ("ready-aged", "workspace"),
    ("ready-aged", "support"),
    ("many-projects", "workspace"),
    ("ready-no-active", "workspace"),
    ("status-unverified", "workspace"),
    ("status-unverified", "support"),
    ("ready", "support"),
    ("ready", "analytics"),
    ("approval-required", "workspace"),
    ("plugin-modified", "workspace"),
    ("runtime-offline", "workspace"),
    ("unsupported", "workspace"),
)
# Development-only fixed feedback specimens: no native actions or user files.
FEEDBACK_SCENARIOS = (
    ("ready", "workspace", "pending"),
    ("ready", "workspace", "success"),
    ("ready", "workspace", "error"),
    ("ready", "support", "error"),
    ("ready", "workspace", "timeout"),
    ("ready", "support", "timeout"),
    ("ready", "workspace", "delete-uncertain"),
    ("ready", "support", "delete-uncertain"),
)
# One fixed busy-row specimen. Opening a model is never invoked by this script.
OPENING_SCENARIOS = (("ready", "workspace", "opening-model"),)
# The narrow layout is a source-level proxy for high-zoom/small effective width, not native proof.
VIEWPORTS = ((390, 640), (780, 560), (980, 680))


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:1421/")
    parser.add_argument("--out", default=str(Path(gettempdir()) / "lazydesigner-ui-qa"))
    parser.add_argument("--browser", help="Optional installed Chromium/Chrome executable path")
    return parser.parse_args()


def inspect(page):
    return page.evaluate("""() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' &&
          rect.width > 0 && rect.height > 0;
      };
      const offscreenControls = [...document.querySelectorAll('button, input, select, summary')]
        .filter(visible)
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.left < -2 || rect.right > innerWidth + 2;
        })
        .slice(0, 8)
        .map(element => element.getAttribute('aria-label') || element.textContent.trim().slice(0, 60));
      const region = document.querySelector('.page-content');
      return {
        title: document.title,
        heading: document.querySelector('.page-toolbar h1')?.textContent?.trim() || null,
        viewport: {width: innerWidth, height: innerHeight},
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
        offscreenControls,
        contentScrollable: !!region && region.scrollHeight > region.clientHeight + 2,
      };
    }""")


def inspect_action_states(page, fixture, view):
    """Check only decisions introduced by the current UI refinement."""
    expected = {
        ("fresh-install", "workspace"): {
            "Open Model…": True,
            "Set up AI tools": True,
            "Add Project Folder": True,
        },
        ("many-projects", "workspace"): {
            "Open Model…": True,
            "Show all projects": True,
        },
        ("ready-aged", "workspace"): {
            "Open Model…": True,
            "Refresh": True,
        },
        ("ready-aged", "support"): {
            "Refresh": True,
        },
        ("ready", "workspace"): {
            "Open Model…": True,
            "Go to Blockbench for Modern Chair": True,
            "Hide models for project Furniture": True,
        },
        ("ready-no-active", "workspace"): {
            "Open Model…": True,
            "Open Blockbench": True,
        },
        ("ready", "support"): {
            "Refresh": True,
            "Choose Blockbench…": True,
            "Show plugin file": True,
            "Export diagnostics": True,
        },
        ("status-unverified", "workspace"): {
            "Open Model…": True,
            "Go to Blockbench for Modern Chair": False,
            "Open folder for project Furniture": True,
            "Open model Sofa": True,
            "Add Project Folder": False,
            "Refresh": True,
        },
        ("status-unverified", "support"): {
            "Choose Blockbench…": False,
            "Refresh": True,
            "Export diagnostics": True,
        },
    }.get((fixture, view), {})
    issues = []
    for name, should_be_enabled in expected.items():
        button = page.get_by_role("button", name=name, exact=True)
        count = button.count()
        if count != 1:
            issues.append(f"expected one '{name}' button, found {count}")
        elif button.is_enabled() != should_be_enabled:
            issues.append(f"'{name}' enabled={not should_be_enabled}, expected {should_be_enabled}")
    return {"checked": len(expected), "issues": issues}


def inspect_project_expansion(page, fixture, view):
    """Check default expansion, explicit collapse and tab-state continuity."""
    if (fixture, view) != ("ready", "workspace"):
        return []
    errors = []
    collapse = page.get_by_role("button", name="Hide models for project Furniture", exact=True)
    if collapse.count() != 1:
        return ["active project should start expanded"]
    collapse.click()
    if page.get_by_role("button", name="Show models for project Furniture", exact=True).count() != 1:
        errors.append("active project did not collapse")
    page.get_by_role("button", name="Support", exact=True).click()
    page.get_by_role("button", name="Workspace", exact=True).click()
    if page.get_by_role("button", name="Show models for project Furniture", exact=True).count() != 1:
        errors.append("explicit project collapse was lost after navigation")
    return errors


def inspect_stale_file_navigation(page, fixture, view):
    """Read-only shortcuts work when AI is unverified; project mutations remain blocked."""
    if (fixture, view) != ("status-unverified", "workspace"):
        return []
    issues = []
    def check_control(name, enabled):
        button = page.get_by_role("button", name=name, exact=True)
        if button.count() != 1 or button.is_enabled() != enabled:
            issues.append(f"'{name}' expected enabled={enabled}")
    note = page.locator("#ld-project-action-note")
    if note.count() != 1 or not note.is_visible() or "Refresh required" not in note.inner_text():
        issues.append("stale project actions need a visible recovery explanation")
    for name in ("Go to Blockbench for Modern Chair", "Add Project Folder"):
        disabled = page.get_by_role("button", name=name, exact=True)
        if disabled.count() != 1 or disabled.get_attribute("aria-describedby") != "ld-project-action-note":
            issues.append(f"'{name}' must reference the visible recovery explanation")
    check_control("Open References folder for project Furniture", True)
    page.locator('summary[aria-label="Actions for project Furniture"]').click()
    check_control("Unpin project", False)
    check_control("Remove from Workspace", False)
    check_control("Delete Project…", False)
    page.locator('summary[aria-label="Actions for model Sofa"]').click()
    check_control("Show model Sofa in Explorer", True)
    check_control("Copy path for model Sofa", True)
    return issues


def inspect_support_disclosures(page, fixture, view):
    """Check Support's task-first layout and native, non-mutating disclosures."""
    if view != "support" or fixture not in {"ready", "status-unverified"}:
        return []
    issues = []
    headings = page.locator(".settings-content h2").all_text_contents()
    if "Troubleshooting" not in headings or "About" not in headings:
        issues.append("Support must expose Troubleshooting and About sections")
    elif headings.index("Troubleshooting") >= headings.index("About"):
        issues.append("Troubleshooting should precede read-only version details")

    advanced = page.locator("details.advanced-recovery").filter(has_text="Advanced recovery")
    if advanced.count() != 1:
        issues.append("Advanced recovery must remain available as one disclosure")
    else:
        if advanced.evaluate("(node) => node.open"):
            issues.append("Advanced recovery should start collapsed")
        if advanced.locator(".disclosure-state .when-closed").count() != 1:
            issues.append("Advanced recovery must show a closed-state label")
        advanced.locator("summary").click()
        if not advanced.evaluate("(node) => node.open"):
            issues.append("Advanced recovery cannot be expanded using native summary")
        if advanced.locator(".disclosure-state .when-open").count() != 1 or not advanced.locator(".disclosure-state .when-open").is_visible():
            issues.append("Expanded recovery should say Hide, not Show")
        # No click on Restore, Repair or Recover; this is a visual-only fixture.
    return issues


def inspect_first_run(page, fixture, view):
    """First-run actions are discoverable without expanding technical setup."""
    if (fixture, view) != ("fresh-install", "workspace"):
        return []
    issues = []
    if page.get_by_role("heading", name="Open a model", exact=True).count() != 1:
        issues.append("model opening must remain the first-run primary task")
    if page.get_by_role("heading", name="Set up AI tools", exact=True).count() != 1:
        issues.append("optional AI setup heading missing")
    if page.locator("#ld-project-search").count() != 0:
        issues.append("empty project inventory must not show an unused search field")
    disclosure = page.locator("details.setup-steps")
    if disclosure.count() != 1:
        issues.append("setup steps must be available as one disclosure")
    else:
        if disclosure.evaluate("(node) => node.open"):
            issues.append("setup steps should start collapsed")
        disclosure.locator("summary").click()
        if not disclosure.evaluate("(node) => node.open"):
            issues.append("setup disclosure must expand through native interaction")
    return issues


def inspect_task_journey(page, fixture, view):
    """Exercise only browser navigation; never invoke model, repair or install actions.

    Interaction counts and elapsed time describe an automated fixture,
    not human task completion or an installed/native LazyDesigner session.
    """
    if view != "workspace" or fixture not in {"fresh-install", "ready", "many-projects", "status-unverified", "plugin-modified"}:
        return None

    started = perf_counter()
    issues = []
    interactions = 0
    task = {
        "fresh-install": "discover_model_without_ai",
        "ready": "find_model_and_recover_empty_search",
        "many-projects": "find_model_beyond_first_six_projects",
        "status-unverified": "locate_stale_status_recovery",
        "plugin-modified": "navigate_to_safe_repair",
    }[fixture]

    if fixture == "fresh-install":
        model = page.get_by_role("button", name="Open Model…", exact=True)
        if model.count() != 1 or not model.is_enabled():
            issues.append("the native model picker must be discoverable without AI setup")
        disclosure = page.locator("details.setup-steps")
        if disclosure.count() != 1:
            issues.append("the optional setup explanation must exist")
        else:
            summary = disclosure.locator("summary")
            summary.focus()
            # The earlier first-run check left the disclosure open.
            summary.press("Enter")
            interactions += 1
            if disclosure.evaluate("(node) => node.open"):
                issues.append("Enter did not collapse the optional setup instructions")
            summary.press("Enter")
            interactions += 1
            if not disclosure.evaluate("(node) => node.open"):
                issues.append("Enter did not reopen the optional setup instructions")

    elif fixture == "ready":
        search = page.locator("#ld-project-search")
        if search.count() != 1:
            issues.append("project/model search is not discoverable")
        else:
            search.fill("Sofa")
            interactions += 1
            result = page.locator("#ld-project-search-results")
            if result.count() != 1 or "1 project matches" not in result.inner_text():
                issues.append("matching project count was not shown for a model name")
            model = page.get_by_role("button", name="Open model Sofa", exact=True)
            if model.count() != 1 or not model.is_enabled():
                issues.append("matching model does not expose a usable Open action")
            hint = page.locator("#ld-project-search-help")
            if hint.count() != 1 or "Press Enter to open Sofa" not in hint.inner_text():
                issues.append("unique model shortcut is not explained")
            clear = page.get_by_role("button", name="Clear search", exact=True)
            if clear.count() != 1:
                issues.append("search has no explicit reset action")
            else:
                clear.click()
                interactions += 1
                if search.input_value():
                    issues.append("clearing search did not empty the query")
                if not search.evaluate("(node) => document.activeElement === node"):
                    issues.append("Clear search did not restore keyboard focus")
            search.fill("zzz_no_such_model_zzz")
            interactions += 1
            if page.get_by_text("No matching projects or models.", exact=True).count() != 1:
                issues.append("empty search needs an explicit empty result")
            clear = page.get_by_role("button", name="Clear search", exact=True)
            if clear.count() == 1:
                search.press("Escape")
                interactions += 1
                if search.input_value() or not search.evaluate("(node) => document.activeElement === node"):
                    issues.append("Escape must clear search and retain keyboard focus")
                # Existing user collapse state remains authoritative: browsing is
                # restored even when the model rows intentionally stay collapsed.
                expand = page.get_by_role("button", name="Show models for project Furniture", exact=True)
                open_model = page.get_by_role("button", name="Open model Sofa", exact=True)
                if expand.count() != 1 and open_model.count() != 1:
                    issues.append("clearing the empty result did not restore project browsing")
            else:
                issues.append("empty search cannot be cleared")

    elif fixture == "many-projects":
        show_all = page.get_by_role("button", name="Show all projects", exact=True)
        if show_all.count() != 1:
            issues.append("more than six projects need a discoverable Show all action")
        search = page.locator("#ld-project-search")
        if search.count() != 1:
            issues.append("project search is missing for a large inventory")
        else:
            search.fill("Needle asset")
            interactions += 1
            result = page.locator("#ld-project-search-results")
            if result.count() != 1 or "1 project matches" not in result.inner_text():
                issues.append("a hidden model match must be included in the project count")
            model = page.get_by_role("button", name="Open model Needle asset", exact=True)
            if model.count() != 1 or not model.is_enabled():
                issues.append("search did not expose the model beyond the first six projects")
            hint = page.locator("#ld-project-search-help")
            if hint.count() != 1 or "Press Enter to open Needle asset" not in hint.inner_text():
                issues.append("unique model shortcut is unavailable beyond the first six projects")
            clear = page.get_by_role("button", name="Clear search", exact=True)
            if clear.count() != 1:
                issues.append("search cannot be reset after finding a hidden model")
            else:
                search.press("Escape")
                interactions += 1
                if search.input_value() or not search.evaluate("(node) => document.activeElement === node"):
                    issues.append("Escape must clear the query and retain keyboard focus")
                if page.get_by_role("button", name="Show all projects", exact=True).count() != 1:
                    issues.append("clearing search must restore the six-project list boundary")

    elif fixture == "status-unverified":
        note = page.locator("#ld-project-action-note")
        if note.count() != 1 or "Refresh required for project changes" not in note.inner_text():
            issues.append("the stale-action guidance must explain blocked project actions")
        direct_refresh = note.get_by_role("button", name="Refresh status", exact=True)
        if direct_refresh.count() != 1 or not direct_refresh.is_enabled():
            issues.append("stale actions need a nearby keyboard-reachable status Refresh")
        else:
            direct_refresh.focus()
            if not direct_refresh.evaluate("(node) => document.activeElement === node"):
                issues.append("the nearby Refresh action must accept keyboard focus")
        refresh = page.get_by_role("button", name="Refresh", exact=True)
        if refresh.count() != 1 or not refresh.is_enabled():
            issues.append("Refresh must be visible and enabled for stale status")
        change = page.get_by_role("button", name="Add Project Folder", exact=True)
        if change.count() != 1 or change.is_enabled():
            issues.append("stale project preference edits must remain blocked")
        model = page.get_by_role("button", name="Open model Sofa", exact=True)
        if model.count() != 1 or not model.is_enabled():
            issues.append("independently validated model navigation must remain available")
        # Do not select Refresh: fixtures cannot verify an actual machine-state recovery.

    elif fixture == "plugin-modified":
        support = page.get_by_role("button", name="Open Support", exact=True)
        if support.count() != 1 or not support.is_enabled():
            issues.append("the incompatible plugin state needs a direct Support entry")
        else:
            support.click()
            interactions += 1
            if page.get_by_role("heading", name="Troubleshooting", exact=True).count() != 1:
                issues.append("Support did not expose its troubleshooting section")
            recovery = page.locator("details.advanced-recovery").filter(has_text="Advanced recovery")
            if recovery.count() != 1:
                issues.append("advanced recovery is not discoverable")
            else:
                recovery.locator("summary").click()
                interactions += 1
                repair = page.get_by_role("button", name="Repair", exact=True)
                if repair.count() != 1:
                    issues.append("Support does not expose the existing Repair action")
            # Never click Repair: this browser fixture cannot authorize or test a native repair.

    return {
        "task": task,
        "scope": "OFFLINE_BROWSER_FIXTURE_ONLY",
        "interactions": interactions,
        "automation_elapsed_ms": round((perf_counter() - started) * 1000),
        "ui_path_available": len(issues) == 0,
        "native_action": "NOT_ATTEMPTED",
        "human_task_success": "NOT_MEASURED",
        "issues": issues,
    }


def inspect_feedback_presentation(page, feedback, view):
    """Check source-driven status placement and keyboard dismissal without native actions."""
    if feedback is None:
        return []
    issues = []
    notice = page.locator(".operation-attention")
    if feedback in {"error", "timeout", "delete-uncertain"} and view == "support":
        if notice.count() != 0:
            issues.append("Support must not repeat its inline error in a second notification")
        section = page.locator('section[aria-label="Last unsuccessful action"]')
        if section.count() != 1:
            issues.append("Support must provide its own classified error section")
        else:
            recovery = section.locator(".error-recovery")
            if recovery.count() != 1 or "Still to verify" not in recovery.inner_text():
                issues.append("Support must show a concrete next step and remaining uncertainty")
            if feedback == "timeout" and recovery.get_by_role("button", name="Refresh status").count() != 1:
                issues.append("timeout should expose one read-only status Refresh")
            if feedback == "delete-uncertain":
                if recovery.get_by_role("button").count() != 0:
                    issues.append("uncertain deletion must not expose an automatic retry")
                if "remains unknown" not in recovery.inner_text():
                    issues.append("uncertain deletion must not claim the folder is preserved or gone")
        return issues

    if notice.count() != 1:
        return ["one in-flow feedback notice is required"]
    expected_role = "alert" if feedback in {"error", "timeout", "delete-uncertain"} else "status"
    if notice.get_attribute("role") != expected_role:
        issues.append(f"feedback must have role={expected_role}")
    if notice.evaluate("(node) => getComputedStyle(node).position") == "fixed":
        issues.append("feedback must not float over model/project controls")
    content = page.locator(".page-content")
    if content.count() == 1:
        bottom = notice.bounding_box()
        top = content.bounding_box()
        if bottom and top and bottom["y"] + bottom["height"] > top["y"] + 2:
            issues.append("feedback is overlapping the scrollable work area")

    if feedback in {"error", "timeout", "delete-uncertain"}:
        next_step = notice.locator(".attention-next-step")
        if next_step.count() != 1 or "Next:" not in next_step.inner_text():
            issues.append("error needs one explicit next step")
        expected_action = {"error": "Open Support", "timeout": "Refresh status", "delete-uncertain": None}[feedback]
        if expected_action is None:
            if notice.get_by_role("button", name="Refresh status").count() or notice.get_by_role("button", name="Open Support").count():
                issues.append("uncertain deletion must never offer automatic retry or false recovery")
        elif notice.get_by_role("button", name=expected_action, exact=True).count() != 1:
            issues.append(f"error should offer the safe '{expected_action}' action")
    dismiss = notice.get_by_role("button", name="Dismiss notification", exact=True)
    if dismiss.count() != 1:
        issues.append("feedback must expose an accessible dismiss action")
    else:
        dismiss.focus()
        dismiss.press("Enter")
        if notice.count() != 0:
            issues.append("Enter did not dismiss the feedback notice")
    return issues


def inspect_old_ai_observation(page, fixture, view):
    """An aged full status check is neither a live AI success nor a disconnect."""
    if fixture != "ready-aged" or view not in {"workspace", "support"}:
        return []
    issues = []
    if page.get_by_text("Check AI status again", exact=True).count() != 1:
        issues.append("outdated verification should ask for a new AI status check")
    if page.get_by_text("AI check out of date", exact=True).count() > 1:
        issues.append("outdated status should not be repeated")
    if page.get_by_role("button", name="Refresh", exact=True).count() != 1:
        issues.append("one Refresh action must be available for an old full status check")
    if page.get_by_text("AI verified at last check", exact=True).count():
        issues.append("old status should not retain the fresh verification headline")
    return issues


def inspect_opening_model_row(page, activity, view):
    """Observe the one model-specific busy row; never invoke Blockbench."""
    if activity != "opening-model" or view != "workspace":
        return []
    issues = []
    announcement = page.locator(".model-opening-notice")
    if announcement.count() != 1 or "Opening Sofa in Blockbench" not in announcement.inner_text():
        issues.append("model identity must be visible in one announced progress notice")
    button = page.get_by_role("button", name="Opening model Sofa", exact=True)
    if button.count() != 1:
        issues.append("the requested model must show its own Opening state")
    elif button.is_enabled() or button.get_attribute("aria-busy") != "true":
        issues.append("the pending model action must be disabled and marked busy")
    if page.get_by_role("button", name="Open model Sofa", exact=True).count():
        issues.append("a pending model must not simultaneously offer an Open control")
    return issues


def inspect_unified_editor(page, fixture, view):
    """Offline browser-only P1 visual checks; never invoke native commands."""
    if view != "editor":
        return []

    issues = []
    workspace = page.locator('main[aria-label="LazyDesigner unified editor workspace"]')
    if workspace.count() != 1:
        return ["unified editor view was not rendered"]

    # The source UI has one app header, not the old global nav + page toolbar.
    if page.locator(".navigation:visible").count() or page.locator(".page-toolbar:visible").count():
        issues.append("Editor duplicates the global navigation/toolbar")
    if page.locator(".editor-header:visible").count() != 1:
        issues.append("the unified Editor must have exactly one app header")
    if workspace.locator(".editor-header h1").count() != 1:
        issues.append("the editor heading must identify the last-observed model")

    native_area = page.get_by_role("region", name="Blockbench native editor area")
    if native_area.count() != 1:
        issues.append("native editor area missing")
    native_action = page.get_by_role("button", name="Show Blockbench here", exact=True)
    if native_action.count() != 1 or native_action.is_enabled():
        issues.append("fixture must never be able to place a native Blockbench window")

    project_toggle = page.get_by_role("button", name="Toggle Project Explorer", exact=True)
    qa_toggle = page.get_by_role("button", name="Toggle AI and QA", exact=True)
    if project_toggle.count() != 1 or qa_toggle.count() != 1:
        return issues + ["Project Explorer and AI/QA toggles must both be available"]

    width = page.viewport_size["width"]
    explorer = page.get_by_role("complementary", name="Project Explorer")
    inspector = page.get_by_role("complementary", name="AI and QA")
    compact = width < 920
    if compact and explorer.count():
        issues.append("compact Editor must start with Project Explorer collapsed")
    if compact and inspector.count():
        issues.append("compact Editor must start with AI/QA collapsed")
    if not compact and explorer.count() != 1:
        issues.append("standard Editor must start with Project Explorer")
    if inspector.count() != 0:
        issues.append("standard-width Editor should leave AI/QA closed for native viewport space")

    # Toggle only Svelte-local presentation controls. Native actions stay disabled.
    opened_for_check = compact
    if opened_for_check:
        project_toggle.click()
        if explorer.count() != 1:
            issues.append("Project Explorer cannot be opened from the compact toolbar")
    if fixture in {"ready", "many-projects"}:
        search = page.locator("#ld-unified-model-search")
        if search.count() != 1:
            issues.append("project/model search is missing in Editor view")
        else:
            target = "Needle asset" if fixture == "many-projects" else "Sofa"
            search.fill(target)
            model = page.get_by_role("button", name="Open model " + target, exact=True)
            if model.count() != 1 or model.is_enabled():
                issues.append("fixture must locate target but never open a native model")
            search.press("Escape")
            if search.input_value() != "":
                issues.append("Escape did not clear Editor project search")
    if opened_for_check:
        project_toggle.click()
        if explorer.count() != 0:
            issues.append("Project Explorer did not collapse cleanly")
    return issues

def main():
    args = parse_args()
    target = urlsplit(args.base_url)
    if target.scheme != "http" or target.hostname not in {"127.0.0.1", "localhost"}:
        print("Visual fixture capture is restricted to a local HTTP development server.", file=sys.stderr)
        return 2
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright is not installed in this QA environment; no screenshots captured.", file=sys.stderr)
        return 2

    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    records = []
    failures = []
    with sync_playwright() as playwright:
        opts = {"headless": True}
        if args.browser:
            opts["executable_path"] = args.browser
        browser = playwright.chromium.launch(**opts)
        try:
            scenarios = ([(fixture, view, None, None) for fixture, view in SCENARIOS]
                         + [(fixture, view, feedback, None) for fixture, view, feedback in FEEDBACK_SCENARIOS]
                         + [(fixture, view, None, activity) for fixture, view, activity in OPENING_SCENARIOS])
            for width, height in VIEWPORTS:
                for fixture, view, feedback, activity in scenarios:
                    suffix = f"-feedback-{feedback}" if feedback else f"-activity-{activity}" if activity else ""
                    name = f"{fixture}-{view}{suffix}-{width}x{height}"
                    page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1, reduced_motion="reduce")
                    page_errors = []
                    page.on("pageerror", lambda error, target=page_errors: target.append(str(error)))
                    query = {"fixture": fixture, "view": view}
                    if feedback:
                        query["feedback"] = feedback
                    if activity:
                        query["activity"] = activity
                    url = args.base_url.rstrip("/") + "/?" + urlencode(query)
                    entry = {"fixture": fixture, "view": view, "feedback": feedback, "activity": activity, "requestedViewport": [width, height], "url": url}
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=20000)
                        page.locator(f'[data-qa-fixture="{fixture}"]').wait_for(timeout=15000)
                        if view == "analytics":
                            page.get_by_text("Gateway analytics", exact=True).wait_for(timeout=10000)
                        if fixture == "ready-no-active":
                            page.get_by_role("button", name="Open Blockbench").wait_for(timeout=10000)
                        if fixture == "status-unverified" and view == "workspace":
                            page.get_by_text("AI status needs verification", exact=True).wait_for(timeout=10000)
                        if fixture == "status-unverified" and view == "support":
                            page.get_by_text("AI status needs verification", exact=True).wait_for(timeout=10000)
                        if feedback:
                            target = 'section[aria-label="Last unsuccessful action"]' if feedback in {"error", "timeout", "delete-uncertain"} and view == "support" else ".operation-attention"
                            page.locator(target).wait_for(timeout=10000)
                        if activity:
                            page.locator(".model-opening-notice").wait_for(timeout=10000)
                        if view == "editor":
                            page.locator(".native-editor-aperture").wait_for(timeout=10000)
                        editor_issues = inspect_unified_editor(page, fixture, view)
                        if view == "editor":
                            entry["unifiedEditorChecks"] = {"issues": editor_issues}
                        for issue in editor_issues:
                            failures.append(name + ": " + issue)
                        snapshot = inspect(page)
                        action_checks = inspect_action_states(page, fixture, view) if activity is None and feedback is None else {"checked": 0, "issues": []}
                        entry["actionChecks"] = action_checks
                        for issue in action_checks["issues"]:
                            failures.append(name + ": " + issue)
                        top_name = name + "-top.png"
                        page.screenshot(path=str(out / top_name), animations="disabled")
                        entry.update({"inspection": snapshot, "screenshot": top_name})
                        if snapshot["contentScrollable"]:
                            page.locator(".page-content").evaluate("(node) => {node.scrollTop = node.scrollHeight;}")
                            bottom_name = name + "-bottom.png"
                            page.screenshot(path=str(out / bottom_name), animations="disabled")
                            entry["bottomScreenshot"] = bottom_name
                        if snapshot["viewport"]["width"] != width or snapshot["viewport"]["height"] != height:
                            failures.append(name + ": viewport size mismatch")
                        if snapshot["horizontalOverflow"] or snapshot["offscreenControls"]:
                            failures.append(name + ": horizontal overflow or clipped controls")
                        aged_issues = inspect_old_ai_observation(page, fixture, view)
                        if fixture == "ready-aged":
                            entry["observationAgeChecks"] = {"issues": aged_issues}
                        for issue in aged_issues:
                            failures.append(name + ": " + issue)
                        opening_issues = inspect_opening_model_row(page, activity, view)
                        if activity:
                            entry["openingModelChecks"] = {"issues": opening_issues}
                        for issue in opening_issues:
                            failures.append(name + ": " + issue)
                        feedback_issues = inspect_feedback_presentation(page, feedback, view)
                        if feedback:
                            entry["feedbackChecks"] = {"issues": feedback_issues}
                        for issue in feedback_issues:
                            failures.append(name + ": " + issue)
                        support_issues = inspect_support_disclosures(page, fixture, view) if feedback is None else []
                        if view == "support" and fixture in {"ready", "status-unverified"} and feedback is None:
                            entry["supportNavigationChecks"] = {"issues": support_issues}
                        for issue in support_issues:
                            failures.append(name + ": " + issue)
                        navigation_issues = inspect_project_expansion(page, fixture, view) if feedback is None and activity is None else []
                        if fixture == "ready" and view == "workspace" and feedback is None and activity is None:
                            entry["navigationChecks"] = {"checked": 3, "issues": navigation_issues}
                        for issue in navigation_issues:
                            failures.append(name + ": " + issue)
                        stale_action_issues = inspect_stale_file_navigation(page, fixture, view)
                        if fixture == "status-unverified" and view == "workspace":
                            entry["staleFileNavigationChecks"] = {"checked": 9, "issues": stale_action_issues}
                        for issue in stale_action_issues:
                            failures.append(name + ": " + issue)
                        first_run_issues = inspect_first_run(page, fixture, view)
                        if fixture == "fresh-install" and view == "workspace":
                            entry["firstRunChecks"] = {"checked": 5, "issues": first_run_issues}
                        for issue in first_run_issues:
                            failures.append(name + ": " + issue)
                        journey = inspect_task_journey(page, fixture, view) if feedback is None and activity is None else None
                        if journey is not None:
                            entry["taskJourney"] = journey
                            for issue in journey["issues"]:
                                failures.append(name + ": " + journey["task"] + ": " + issue)
                        if page_errors:
                            failures.append(name + ": JS errors: " + "; ".join(page_errors[:3]))
                            entry["pageErrors"] = page_errors
                    except Exception as error:
                        failures.append(name + ": " + str(error).splitlines()[0])
                        entry["captureError"] = str(error).splitlines()[0]
                    finally:
                        page.close()
                    records.append(entry)
        finally:
            browser.close()

    manifest = {
        "purpose": "development fixture layout inspection",
        "nativeOrVisualApproval": "NOT_VERIFIED",
        "taskEvidence": "OFFLINE_BROWSER_FIXTURE_ONLY",
        "feedbackEvidence": "SOURCE_FIXED_DEV_FIXTURES_ONLY",
        "ageAndModelProgressEvidence": "DETERMINISTIC_UI_FIXTURE_ONLY",
        "humanTaskSuccess": "NOT_MEASURED",
        "timingInterpretation": "Playwright automation elapsed time, not user completion time",
        "scenarios": records,
        "issues": failures,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Captured {len(records)} requested scenarios at {out}. Issues: {len(failures)}.")
    for issue in failures:
        print(" - " + issue, file=sys.stderr)
    print("Screenshots require manual visual review; no native or UX PASS is implied.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
