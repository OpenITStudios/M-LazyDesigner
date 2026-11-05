# Reporting Scripts

This directory owns benchmark-session reporting, comparison, and finalization.

```text
evaluate-golden-authoring-runs.ts
summarize-gateway-benchmark-trace.ts
project-research-archive.ts (explicit, integrity-checked L0 research snapshots)
project-research-index.ts (manifest-only search, JSON/CSV export)
read-project-research.ts (AI-first catalog/archive/project/sessions/session reader)
summarize-project-observation.ts (bounded L0 source reader and report)
render-project-observation.ts (static local view)
run-golden-benchmark-session.ts
finalize-golden-session.ts
compare-golden-sessions.ts
compare-geometry-knowledge.ts (opt-in R5 source-aligned pairing only)
```

The AI-first reader returns a bounded page or one allowlisted complete L0
snapshot with on-demand byte-checksum verification. Archive-level summaries
are also field-allowlisted and validated before use; build-key filters
select projects, not calls attributable to one build. No tool-payload text,
unrecognized JSON fields or prompt instructions enter this output. Read
the catalog first and follow `next_cursor` to access all retained data;
opaque cursors refuse stale collections. Source SHA and workspace identity
remain unknown until established independently.

The existing `summarize-project-observation.ts` or an explicit archived
`verify` operation may correlate an accepted
canonical Golden final report with same-session L0 artifact/build/task
evidence via optional `--golden-final=<path>`. It does not synthesize a
quality PASS or time-to-acceptance from L0 counters. Per-build metrics
include only calls with verified preflight evidence and state measured
session coverage and unknown-build counts.

The read-only Gateway trace report validates event kinds, timestamps and
result byte counts before computing diagnostics. Missing byte counts and
unsafe aggregate integer totals stay unknown, not zero or an efficiency
improvement. Invalid input fails closed rather than producing distorted
per-capability or total response-byte measurements. This is trace-source
integrity only; it does not verify the Runtime, accepted artistic quality,
or whether an AI processed the reported media.

Reporting consumes benchmark/evaluation evidence; it does not own Runtime behavior or acceptance truth.
The explicit Research archive is a selected copy of L0 cache evidence, not
a competing project history or authoring state owner. It never runs on the
Gateway hot path, reads private Codex transcripts, modifies the canonical
Workspace, or proves quality/source revision/AI usage. Source snapshots are
fingerprinted with SHA-256, but local checksums are not signatures. The
manifest-based index deliberately does not combine archived session totals
across experiments, because the same session may be archived more than once.