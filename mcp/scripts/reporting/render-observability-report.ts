import type { compareObservabilitySessions } from "./compare-observability-sessions";

type View = ReturnType<typeof compareObservabilitySessions>;
type Side = "baseline" | "candidate";

function escapeHtml(value: string | number | null | undefined): string {
  const replacements: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return String(value ?? "Not measured").replace(/[&<>"']/g,
    (character) => replacements[character]!);
}

function formatNumber(value: number | null): string {
  return value === null ? "Not measured" : value.toLocaleString("en-US");
}

function metricRow(name: string, baseline: number | null, candidate: number | null, units: string): string {
  const val = (n: number | null) => escapeHtml(formatNumber(n)) +
    (n === null ? "" : " " + escapeHtml(units));
  return "<tr><th scope=\"row\">" + escapeHtml(name) + "</th><td>" +
    val(baseline) + "</td><td>" + val(candidate) + "</td></tr>";
}

function timelineSection(side: Side, data: View["gateway"]["inspection"]["baseline"]): string {
  const timeline = data.timeline;
  const windowMs = timeline.observed_window_ms;
  const displayCount = timeline.events.length;
  const items = timeline.events.map((event) => {
    const name = event.capability ?? event.kind;
    const time = event.offset_ms === null
      ? "Start not measured"
      : "+" + formatNumber(event.offset_ms) + " ms";
    const duration = formatNumber(event.latency_ms) + " ms";
    const queue = event.queue_wait_ms === null
      ? "Queue not measured" : "Queue " + formatNumber(event.queue_wait_ms) + " ms";
    let bar = "<span class=\"unknown\">No timed bar</span>";
    if (windowMs !== null && windowMs > 0 && event.offset_ms !== null) {
      const left = Math.max(0, Math.min(100, 100 * event.offset_ms / windowMs));
      const width = Math.min(100 - left,
        Math.max(0.5, 100 * event.latency_ms / windowMs));
      const style = "left:" + left.toFixed(3) + "%;width:" + width.toFixed(3) + "%";
      const kindClass = event.kind === "mutate" ? "mutate" :
        event.kind === "verify" ? "verify" : "other";
      bar = "<span class=\"bar " + kindClass + "\" style=\"" + style + "\" aria-hidden=\"true\"></span>";
    }
    return "<tr id=\"" + side + "-event-" + event.sequence + "\"><td class=\"event\">" +
      "#" + event.sequence + " · " + escapeHtml(name) +
      (event.success ? "" : " · <strong>Failure</strong>") + "</td><td>" +
      escapeHtml(time) + "</td><td>" + escapeHtml(duration) +
      "</td><td>" + escapeHtml(queue) + "</td><td><div class=\"track\">" + bar +
      "</div></td></tr>";
  }).join("\n");
  const missing = timeline.total_events - timeline.measured_start_events;
  const coverage = windowMs === null
    ? "Incomplete start timestamps — no full-window duration inferred."
    : "Observed first-start to last-recorded-end span: " + formatNumber(windowMs) +
      " ms (not time to accepted result).";
  return "<section class=\"panel\" aria-labelledby=\"" + side + "-title\">" +
    "<h2 id=\"" + side + "-title\">" + (side === "baseline" ? "Baseline" : "Candidate") +
    " Gateway timeline</h2><p class=\"muted\">Showing " + displayCount + " of " +
    timeline.total_events + " recorded events; " + missing +
    " lack measured starts. " + escapeHtml(coverage) + "</p>" +
    (timeline.omitted_events > 0 ? "<p class=\"notice\">" +
      timeline.omitted_events + " intermediate events omitted from this bounded preview; " +
      "refer to the local trace for full coverage.</p>" : "") +
    "<div class=\"horizontal\"><table class=\"timeline\"><thead><tr>" +
    "<th scope=\"col\">Event</th><th scope=\"col\">Relative start</th>" +
    "<th scope=\"col\">Gateway duration</th><th scope=\"col\">Queue</th>" +
    "<th scope=\"col\">Timeline</th></tr></thead><tbody>" + items +
    "</tbody></table></div></section>";
}

function findings(side: Side, data: View["gateway"]["inspection"]["baseline"]): string {
  const entries = data.findings;
  if (entries.length === 0) {
    return "<p class=\"muted\">No configured investigative signal in recorded events.</p>";
  }
  const visible = new Set(data.timeline.events.map((event) => event.sequence));
  return "<ul>" + entries.map((entry) => {
    const references = entry.example_sequences.map((sequence) =>
      visible.has(sequence)
        ? "<a href=\"#" + side + "-event-" + sequence + "\">#" + sequence + "</a>"
        : "<span>#" + sequence + " (not shown)</span>"
    ).join(", ");
    return "<li><strong>" + escapeHtml(entry.code) + "</strong> — " +
      escapeHtml(entry.capability ?? "multiple capabilities") +
      (entry.error_code ? " (" + escapeHtml(entry.error_code) + ")" : "") +
      ". Observed " + entry.observed_events + " event(s). " +
      "<span class=\"muted\">Evidence: " + references + ". Investigation only, not a proven cause.</span></li>";
  }).join("\n") + "</ul>";
}

function hotspots(data: View["gateway"]["inspection"]["baseline"]): string {
  if (data.hotspots.length === 0) return "<p class=\"muted\">No measured capability calls.</p>";
  return "<table><thead><tr><th>Capability</th><th>Calls</th><th>Summed Gateway latency</th>" +
    "<th>Failure calls</th></tr></thead><tbody>" +
    data.hotspots.map((item) =>
      "<tr><td>" + escapeHtml(item.capability) + "</td><td>" +
      item.calls + "</td><td>" + formatNumber(item.observed_latency_sum_ms) +
      " ms</td><td>" + item.failures + "</td></tr>"
    ).join("\n") + "</tbody></table>";
}

/**
 * A standalone, data-only visualization. Nothing in its HTML executes client
 * code, fetches resources, embeds images, persists telemetry or opens sockets.
 * A measured timeline is shown only for exact recorded start timestamps.
 */
export function renderObservabilityHtml(report: View): string {
  const info = report.gateway.inspection;
  const decision = report.decision === "MEASURED_TOKEN_REDUCTION"
    ? "Measured reduction in submitted provider events (not full-session savings)"
    : report.decision === "CORRECTION_REGRESSION"
      ? "Correction regression — reject the efficiency claim"
      : report.decision === "NO_MEASURED_TOKEN_REDUCTION"
        ? "No measured token reduction in submitted events"
        : "Insufficient linked evidence — no token claim";
  const css = [
    ":root{color-scheme:dark;font-family:system-ui,Segoe UI,sans-serif;background:#0f151d;color:#e3eaf2}",
    "*{box-sizing:border-box}body{max-width:1200px;margin:auto;padding:28px 22px 64px;line-height:1.5}",
    "h1{font-size:1.85rem;margin:0 0 4px}h2{font-size:1.17rem;margin:0 0 12px}h3{font-size:1rem}",
    "p{margin:8px 0 14px}.muted{color:#aebcc9;font-size:.91rem}.notice{color:#e6cfa1}",
    ".panel{background:#17212c;border:1px solid #334456;border-radius:12px;padding:18px;margin:18px 0}",
    ".grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.grid .panel{margin:0}",
    "table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;padding:9px;border-bottom:1px solid #344353;vertical-align:middle}",
    "th{color:#bed0de;font-weight:600}.horizontal{overflow-x:auto}.timeline{min-width:780px}",
    ".timeline td.event{min-width:210px;max-width:300px;overflow-wrap:anywhere}",
    ".timeline th:last-child{width:33%}.track{height:13px;background:#263545;border-radius:4px;position:relative;min-width:190px}",
    ".bar{display:block;position:absolute;top:1px;bottom:1px;background:#8aaae7;border-radius:3px}",
    ".bar.mutate{background:#5bc6b5}.bar.verify{background:#e8bd6f}",
    ".unknown{font-size:.72rem;color:#aebcc9;position:absolute;top:-1px;left:7px}",
    "a{color:#9cc9ff}code{overflow-wrap:anywhere}li{margin-bottom:8px}",
    ".pill{display:inline-block;padding:4px 11px;border:1px solid #678093;border-radius:20px;font-size:.86rem}",
    "@media(max-width:760px){body{padding:16px 12px}.grid{grid-template-columns:1fr}.panel{padding:12px}}",
  ].join("\n");
  const metrics = [
    metricRow("Gateway calls", report.gateway.calls.baseline, report.gateway.calls.candidate, ""),
    metricRow("Summed Gateway latency", report.gateway.latency_sum_ms.baseline, report.gateway.latency_sum_ms.candidate, "ms"),
    metricRow("Delivered image bytes", report.gateway.delivered_image_bytes.baseline, report.gateway.delivered_image_bytes.candidate, "bytes"),
    metricRow("Gateway response bytes", report.gateway.response_bytes.baseline, report.gateway.response_bytes.candidate, "bytes"),
    metricRow("Observed queue wait (partial if incomplete)", report.gateway.queue_wait_ms.baseline, report.gateway.queue_wait_ms.candidate, "ms"),
    metricRow("Provider tokens (submitted events only)", report.provider.total_tokens.baseline, report.provider.total_tokens.candidate, ""),
    metricRow("User corrections", report.provider.user_corrections.baseline, report.provider.user_corrections.candidate, ""),
  ].join("\n");
  const source = "<p class=\"muted\"><strong>Source SHA:</strong> baseline <code>" +
    escapeHtml(report.source_sha.baseline) + "</code>, candidate <code>" +
    escapeHtml(report.source_sha.candidate) + "</code>.</p>";
  const status = "<header><h1>LazyDesigner · Observability</h1>" +
    "<p class=\"muted\">Offline, read-only, trace-bound review · Task: " +
    escapeHtml(report.task_id) + "</p><span class=\"pill\">" +
    escapeHtml(decision) + "</span></header>";
  const summary = "<section class=\"panel\"><h2>Quality-gated comparison</h2>" +
    "<p>Golden proof: <strong>" + escapeHtml(report.quality_gate) +
    "</strong>. This verifies the supplied reports' gates, not live execution by this viewer.</p>" +
    "<div class=\"horizontal\"><table><thead><tr><th>Observed metric</th>" +
    "<th>Baseline</th><th>Candidate</th></tr></thead><tbody>" +
    metrics + "</tbody></table></div>" + source +
    "<p class=\"muted\">Trace-file bindings: baseline " +
    (report.gateway.exact_file_binding.baseline ? "matched" : "not established") +
    "; candidate " + (report.gateway.exact_file_binding.candidate ? "matched" : "not established") +
    ". Total events are not proof of client/provider coverage.</p></section>";
  const investigations = "<section class=\"panel\"><h2>Evidence-linked investigation</h2>" +
    "<p class=\"muted\">Signals are advisory. No source changes, reruns or retry decisions are made by this report.</p>" +
    "<div class=\"grid\"><div><h3>Baseline</h3>" + findings("baseline", info.baseline) +
    "<h3>Observed hotspots</h3>" + hotspots(info.baseline) + "</div>" +
    "<div><h3>Candidate</h3>" + findings("candidate", info.candidate) +
    "<h3>Observed hotspots</h3>" + hotspots(info.candidate) + "</div></div></section>";
  const reviewFeedback = "<section class=\"panel\"><h2>Verified-feedback review</h2>" +
    "<p><strong>Disposition: " + escapeHtml(report.feedback.disposition) +
    "</strong> · Read-only, never auto-promoted.</p>" +
    "<div class=\"grid\"><div><h3>Evidence gaps</h3>" +
    (report.feedback.evidence_gaps.length > 0
      ? "<ul>" + report.feedback.evidence_gaps.map((gap) =>
          "<li>" + escapeHtml(gap) + "</li>").join("") + "</ul>"
      : "<p class=\"muted\">No configured coverage gap detected; source proof still requires review.</p>") +
    "</div><div><h3>Recommended checks</h3>" +
    (report.feedback.recommended_checks.length > 0
      ? "<ul>" + report.feedback.recommended_checks.map((check) =>
          "<li>" + escapeHtml(check) + "</li>").join("") + "</ul>"
      : "<p class=\"muted\">No extra investigative checks from this trace.</p>") +
    "</div></div></section>";

  return [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">",
    "<title>LazyDesigner Observability</title><style>",css,"</style></head><body>",
    status,summary,reviewFeedback,
    "<div class=\"grid\" aria-label=\"Trace coverage\"><div class=\"panel\"><h2>Baseline coverage</h2><p>" +
      info.baseline.timeline.measured_start_events + " / " + info.baseline.timeline.total_events +
      " events have measured starts.</p></div><div class=\"panel\"><h2>Candidate coverage</h2><p>" +
      info.candidate.timeline.measured_start_events + " / " + info.candidate.timeline.total_events +
      " events have measured starts.</p></div></div>",
    timelineSection("baseline",info.baseline),
    timelineSection("candidate",info.candidate),
    investigations,
    "<footer class=\"panel\"><h2>Interpretation limits</h2><p class=\"muted\">" +
      escapeHtml(report.limitations) +
      " Capability latency sums are not task wall time; missing start timestamps prevent a complete waterfall. " +
      "All visual bars are based only on submitted Gateway metadata.</p></footer>",
    "</body></html>",
  ].join("\n");
}
