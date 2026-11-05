# Evaluation Scripts

This directory owns deterministic evaluation and policy-analysis harnesses.

```text
evaluate-capability-intelligence.ts
evaluate-codex-session-policy.ts
evaluate-decision-efficiency.ts
evaluate-hybrid-promotion-policy.ts
evaluate-routed-tool-loading.ts
evaluate-tool-discovery.ts
validate-astra-usage.ts
evaluate-harness-candidate.ts (opt-in Harness²-style candidate evidence gate; read-only, no agent execution)
```

## Harness candidate evidence gate

`bun run eval:harness-candidate -- <probe.json> [<baseline-context-file> <candidate-context-file>]` reads a proposal ID,
domain, distinct declared context SHA-256 hashes, and two complete
`golden-session-final` reports. It does not run an agent, change Skills,
connect to Blockbench, or promote candidates.

Run the focused comparator source test in Codex when available:

```bash
bun test tests/benchmark/golden-session-comparison.test.ts
```

Optional selected context files (maximum 256 KiB each) are checked against
both declared SHA-256 values, without logging their contents. This verifies
file bytes, **not** which instructions were consumed by an agent. Without
files, the evaluator explicitly reports `NOT_CHECKED`.

The comparator requires the same source SHA, task, initial asset, approved
Reference, Runtime build and known model identity. A matched accepted pair
remains `REVIEW_REQUIRED` until separate native/visual evidence review.
Source-only tests and invented Golden JSON cannot demonstrate quality gain.
See `mcp/docs/QUALITY_BENCHMARK.md` for the controlled A/B protocol.

These are diagnostic/evaluation surfaces, not Runtime implementation owners. Invoke them through `eval:*` package commands.