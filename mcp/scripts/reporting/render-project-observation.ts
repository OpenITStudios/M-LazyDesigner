import type { summarizeProjectObservation } from "./summarize-project-observation";

type ProjectReport = ReturnType<typeof summarizeProjectObservation>;

function escapeHtml(value: string | number): string {
  const map: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return String(value).replace(/[&<>"']/g, character => map[character]!);
}

function value(text: number | string): string {
  return typeof text === "number" ? text.toLocaleString("en-US") : escapeHtml(text);
}

function metric(label: string, amount: number | string): string {
  return "<div class=\"metric\"><span>" + escapeHtml(label) +
    "</span><strong>" + value(amount) + "</strong></div>";
}

function histogram(
  rows: readonly { key: string; count: number }[],
  label: string
): string {
  if (!rows.length) return "<p class=\"muted\">No observations in this category.</p>";
  const max = Math.max(1, ...rows.map(row => row.count));
  return "<div class=\"bars\" aria-label=\"" + escapeHtml(label) + "\">" +
    rows.slice(0, 8).map(row =>
      "<div class=\"bar-row\"><code>" + escapeHtml(row.key) + "</code>" +
      "<div class=\"bar-track\"><span style=\"width:" +
      (100 * row.count / max).toFixed(1) + "%\"></span></div>" +
      "<strong>" + value(row.count) + "</strong></div>"
    ).join("") + "</div>";
}

/**
 * Static view of the bounded L0 aggregate. No network, scripts, hidden
 * telemetry collection, project content, provider token estimates, or native
 * acceptance inference. Large project lists are explicitly truncated.
 */
export function renderProjectObservationHtml(report: ProjectReport): string {
  const limited = report.projects.slice(0, 20);
  const css = [
    ":root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color-scheme:dark;background:#111923;color:#e5ecf6}",
    "*{box-sizing:border-box}body{max-width:1150px;margin:auto;padding:26px 20px 64px;line-height:1.45}",
    "h1{font-size:1.8rem;margin:0}h2{font-size:1.15rem;margin:0 0 12px}",
    "h3{font-size:1rem;margin:10px 0}p{margin:8px 0 14px}",
    ".muted{color:#b1c0d0;font-size:.9rem}.notice{color:#e7cd9b}",
    ".panel{border:1px solid #304354;border-radius:12px;background:#192632;padding:18px;margin:16px 0}",
    ".metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}",
    ".metric{background:#243544;padding:11px;border-radius:8px;display:flex;flex-direction:column;gap:7px}",
    ".metric span{color:#aebfd0;font-size:.81rem}.metric strong{font-size:1.15rem}",
    ".cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}",
    "table{width:100%;border-collapse:collapse;font-size:.88rem}td,th{padding:8px;border-bottom:1px solid #314554;text-align:left}",
    "th{color:#b9cfdd}code{overflow-wrap:anywhere}",
    ".bars{display:grid;gap:9px}.bar-row{display:grid;grid-template-columns:minmax(130px,1fr) 1fr 50px;gap:10px;align-items:center;font-size:.85rem}",
    ".bar-track{height:9px;background:#334756;border-radius:4px;overflow:hidden}",
    ".bar-track span{display:block;height:100%;background:#6cb5d4}",
    "@media(max-width:800px){.metrics{grid-template-columns:repeat(2,1fr)}.cols{grid-template-columns:1fr}}",
    "@media(max-width:440px){body{padding:16px 12px}.metrics{grid-template-columns:1fr}}",
  ].join("\n");

  const cards = limited.map((project, index) => {
    const stages = Object.entries(project.by_domain).map(([name, row]) => ({
      key: name, count: row.calls,
    })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const caps = Object.entries(project.capabilities).map(([name, count]) => ({
      key: name, count,
    })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const errors = Object.entries(project.error_codes).map(([name, count]) => ({
      key: name, count,
    })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    return "<section class=\"panel\"><h2>Project " + (index + 1) +
      " · <code>" + escapeHtml(project.project_key.slice(0, 16)) +
      "…</code></h2><p class=\"muted\">Native UUID-derived identity. Matching keys " +
      "can be aggregated; a changed native UUID cannot be assumed identical.</p>" +
      "<div class=\"metrics\">" +
      metric("Observed MCP calls",project.observed_calls) +
      metric("Observed sessions",project.session_count) +
      metric("Failed calls",project.failures) +
      metric("Visual/focused evidence obligations",project.verification_obligations_observed) +
      "</div><p class=\"muted\">Summed Gateway call duration: " +
      value(project.observed_call_duration_sum_ms) +
      " ms; not project wall time. Observed phase changes: " +
      value(project.phase_changes_observed) +
      ". Open/unclean sessions: " + value(project.open_sessions) +
      ". Acceptance gate invalidations: " + value(project.acceptance_gate_invalidations) +
      ". Downstream recheck obligations observed: " + value(project.downstream_recheck_requests) +
      ". Status calls carrying a user delta: " + value(project.user_delta_status_observations) +
      " (not classified corrections). Unique contexts counted per session, not deduplicated across sessions: " +
      value(project.task_context_count_per_session_sum) + ".</p>" +
      "<div class=\"cols\"><div><h3>Authoring-domain calls</h3>" +
      histogram(stages,"Observed authoring-domain calls") +
      "<h3>Errors</h3>" + histogram(errors,"Recorded machine errors") + "</div>" +
      "<div><h3>Capability hotspots by call count</h3>" +
      histogram(caps,"Observed MCP capabilities") + "</div></div></section>";
  }).join("\n");

  return [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">",
    "<title>LazyDesigner Project Observation</title><style>", css, "</style></head><body>",
    "<h1>LazyDesigner · Project Observation</h1>",
    "<p class=\"muted\">Bounded recent local Gateway sessions · L0 metadata only · no AI tracking calls</p>",
    "<div class=\"panel\"><h2>Capture coverage</h2><div class=\"metrics\">",
    metric("Retained sessions",report.coverage.retained_session_snapshots),
    metric("Observed calls",report.observed_calls),
    metric("Unbound calls",report.coverage.unbound_gateway_calls),
    metric("Open/unclean sessions",report.coverage.open_or_unclean_sessions),
    "</div><p class=\"notice\">Recent rolling cache only. Project wall time, " +
    "accepted result, visual quality and provider tokens remain UNVERIFIED. " +
    "Calls with no trusted project identity were not assigned to a project.</p>",
    "<p class=\"muted\">Overflow project observations: " +
    value(report.coverage.overflow_project_observations) +
    ". Capture failures: " + value(report.coverage.capture_failures) +
    ". Persist failures: " + value(report.coverage.persist_failures) +
    ". Detailed per-call timeline requires separately enabled L1 tracing.</p></div>",
    "<p class=\"muted\">Showing " + limited.length + " of " +
      report.projects.length + " distinct observed native identities.</p>",
    cards,
    "<footer class=\"panel\"><h2>Interpretation boundaries</h2><p class=\"muted\">" +
      "Call durations may overlap and are not active human work time. " +
      "Authoring-domain counts are classified tool observations, not accepted stage status. " +
      "Phase changes are observed boundaries, not exact transition times. " +
      "No complete project history is asserted when older cache files are pruned.</p></footer>",
    "</body></html>",
  ].join("\n");
}
