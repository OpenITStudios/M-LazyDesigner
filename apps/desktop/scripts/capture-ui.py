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
from urllib.parse import urlencode, urlsplit

SCENARIOS = (
    ("fresh-install", "workspace"),
    ("ready", "workspace"),
    ("ready-no-active", "workspace"),
    ("status-unverified", "workspace"),
    ("ready", "support"),
    ("ready", "analytics"),
    ("approval-required", "workspace"),
    ("plugin-modified", "workspace"),
    ("runtime-offline", "workspace"),
    ("unsupported", "workspace"),
)
VIEWPORTS = ((780, 560), (980, 680))


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
            for width, height in VIEWPORTS:
                for fixture, view in SCENARIOS:
                    name = f"{fixture}-{view}-{width}x{height}"
                    page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1, reduced_motion="reduce")
                    page_errors = []
                    page.on("pageerror", lambda error, target=page_errors: target.append(str(error)))
                    url = args.base_url.rstrip("/") + "/?" + urlencode({"fixture": fixture, "view": view})
                    entry = {"fixture": fixture, "view": view, "requestedViewport": [width, height], "url": url}
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=20000)
                        page.locator(f'[data-qa-fixture="{fixture}"]').wait_for(timeout=15000)
                        if view == "analytics":
                            page.get_by_text("Gateway analytics", exact=True).wait_for(timeout=10000)
                        if fixture == "ready-no-active":
                            page.get_by_role("button", name="Open Blockbench").wait_for(timeout=10000)
                        if fixture == "status-unverified":
                            page.get_by_text("AI connection unverified", exact=True).wait_for(timeout=10000)
                        snapshot = inspect(page)
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
