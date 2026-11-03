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
snapshot with on-demand byte-checksum verification. No tool-payload text,
unrecognized JSON fields or prompt instructions enter this output. Read
the catalog first and follow `next_cursor` to access all retained data;
opaque cursors refuse stale collections. Source SHA and workspace identity
remain unknown until established independently.

Reporting consumes benchmark/evaluation evidence; it does not own Runtime behavior or acceptance truth.
The explicit Research archive is a selected copy of L0 cache evidence, not
a competing project history or authoring state owner. It never runs on the
Gateway hot path, reads private Codex transcripts, modifies the canonical
Workspace, or proves quality/source revision/AI usage. Source snapshots are
fingerprinted with SHA-256, but local checksums are not signatures. The
manifest-based index deliberately does not combine archived session totals
across experiments, because the same session may be archived more than once.