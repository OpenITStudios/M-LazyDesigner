# LazyDesigner Golden Task Benchmark

**Current source:** `tests/fixtures/golden-task-cases.json`. Source updated 2026-10-30; all cases still UNMEASURED. This reuses the existing benchmark runner, evaluator and comparator.

## Rule

Golden Tasks now test **six current authoring decisions**, not old projects. Each live run requires a **new approved Reference Package** and **new disposable Bedrock `.bbmodel` seed**. Historical `workspace/active/` or `workspace/saved/` models, previous production exports and legacy Golden reports may not be reused as inputs/baselines. Do not change or delete that historical user data.

| Task | New starting state | Authoring decision |
| --- | --- | --- |
| `golden-rigid-authoring` | Empty disposable scene | Geometry → UV → Texture → Finalization |
| `golden-organic-authoring` | Empty disposable scene | Organic Geometry → UV → Texture → Finalization |
| `golden-articulated-authoring` | Empty disposable scene | Rig → UV → Texture → Animation and playback |
| `golden-geometry-correction` | Newly staged model | Fix structural defect; focused dependent UV/Texture recheck |
| `golden-texture-correction` | Newly staged Geometry + atlas | Repair mapped palette/seam; keep Geometry unchanged |
| `golden-animation-correction` | Newly staged rig + clip | Repair contact/action order; preserve unrelated motion |

Every case requires save/reopen/export evidence. UV Layout belongs to Geometry, Geometry and Texturing share AUTHORING, and only AUTHORING↔Animation changes Runtime surface. PBR, particle and other narrow behaviors retain existing domain tests; they do not automatically need a Golden Task. `astra-live-golden-tasks.json` is a separate call-flow probe, not a source of accepted assets.

## Fresh input admission

1. Prepare a new reference with approved views, dimensions, requirements and SHA-based Reference Package fingerprint; no old asset/reference as a shortcut.
2. Prepare a saved disposable Bedrock seed **outside the repository Workspace**. New-authoring seeds must be blank; new correction seeds need geometry, plus a texture atlas for Texturing and a pre-existing animation clip for Animation. Benchmark-only blank seeds do not change ordinary production checkpoint policy.
3. Keep immutable seed bytes and open a separate saved working copy with identical initial SHA. Live preflight checks matching stage, project UUID, native Runtime build and model bytes. The runner rejects direct Workspace paths, including symlink-resolved aliases.
4. Filesystem/hash checks cannot authenticate the creative origin of a copied model. Reviewer must independently verify the seed and reference were created for this run. A historical model copied to a temp path is still **not allowed**.
5. Baseline and candidate start from the **same independently revalidated seed and Reference Package**, never from the previous arm's edited output.

## Accepted-result proof guard

Keep the existing `benchmark:golden-session` → `finalize:golden-session` → `compare:golden-sessions`. Acceptance requires exact-source LIVE_BLOCKBENCH provenance, new approved reference and Control context, live project UUID, different valid input/output saved-model hashes, contiguous trace with a successful native mutation and **successful final verification after the last mutation**, PASS for every criterion, no contradictory FAIL, actual current visual/native save-reopen/export evidence and **separate documented human acceptance**. Tool receipts, synthetic benchmarks and static tests never prove visual acceptance.

## First baseline — fresh scoped correction

Select **only one relevant task** for the changed source owner, not all six automatically. Example with a newly created correction seed (never a historical project):

```bash
cd mcp
bun run benchmark:golden-session -- golden-geometry-correction .cache/golden-sessions /absolute/path/to/fresh-disposable-seed.bbmodel
```

A session begins UNVERIFIED. Record the approved reference, stage gates, model evidence, human review, time, tool calls and actual usage before finalizing. The current focused **source-only** Golden tests are:

```bash
bun test tests/benchmark/golden-authoring-run-contract.test.ts tests/benchmark/golden-benchmark-session-runner.test.ts tests/benchmark/golden-session-comparison.test.ts tests/benchmark/golden-session-finalizer.test.ts tests/benchmark/quality-benchmark-corpus-contract.test.ts
```

## Required Run Record

Retain task ID, source SHA, installed build/environment, approved reference fingerprint, seed/output SHA, live project identity, stage evidence and verdicts, human review, mutation/inspection/verification calls, corrections, timing, token telemetry when actually observed.

## Comparison Rule

Compare only current task IDs with **the same fresh approved reference and immutable starting model**, equivalent acceptance and compatible environment. Quality PASS comes before cost reduction. No aggregate quality score or automatic winner. Geometry Knowledge A/B draws eligible tasks from the canonical corpus phases; do not duplicate the task list.

## Corpus Intent

The six cases cover fresh rigid, organic and articulated authoring, and bounded Geometry, Texture and Animation correction. Retired object-named task IDs and their historical results are **noncomparable**. Add a case only if a real failure mode is missing from existing tests.
