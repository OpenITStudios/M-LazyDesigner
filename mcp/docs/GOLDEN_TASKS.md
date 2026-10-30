# LazyDesigner Golden Task Benchmark

**One canonical Golden Task:** `golden-full-asset-authoring`, defined in
`tests/fixtures/golden-task-cases.json`. The dedicated fixture lives under
`tests/fixtures/golden/full-asset/` and is **never a user Active Workspace**.
It remains `UNMEASURED` until full native reference and human acceptance.

## What is a Golden Task?

One **complete new object** must go through the production path:

```text
new approved Reference Package
→ Control intake / selected Mechanical specialist
→ native Bedrock project from immutable blank seed
→ Geometry / pivots / hierarchy → geometry verification
→ Geometry-approved UV Layout → UV PASS
→ mapped pixel-art Texture → texture verification
→ AUTHORING→Animation handoff
→ native idle and signal clips → motion verification
→ finalization → native save / reopen / export
→ current visual/structural/animation PASS + human acceptance
→ record actual Cost to Accepted Result
```

This is **one end-to-end user job**, not six named Golden microtasks.
Geometry, Texture, Animation, UV, Particle and Gateway regressions continue
under their existing unit/integration/native test owners, selected by
`verify:affected` as needed. Do not use them as a substitute for an
accepted full-asset Golden run; do not run every test after each asset action.

## Original fixture: Beacon Courier Bot

- New mechanical Bedrock entity; dimensions **32 × 44 × 24** Blockbench units,
  2 × 2.75 × 1.5 Minecraft blocks, floor contact at Y=0, front = -Z.
- Brass plated torso/head, dark iron limbs and vents, amber face/chest crystal;
  separated arms and legs, negative space preserved.
- One **128×128** base-color atlas, no mandatory PBR or gameplay/particle scope.
- Two native clips: `animation.beacon_courier.idle` (2.4-second loop),
  `animation.beacon_courier.signal` (1.6-second one-shot right shoulder raise
  and return, grounded feet).
- Fresh reference: `tests/fixtures/golden/full-asset/reference/REFERENCE.json`;
  proposed four-view visual: `reference/turnaround.svg`.
- Immutable blank source: `tests/fixtures/golden/full-asset/seed.bbmodel`.
  It is a source-authored Blockbench 5.x Bedrock JSON candidate, not a native
  verified/imported or prebuilt finished model.

The visual proposal is **PENDING APPROVAL**, so `REFERENCE.json` stays
`BLOCKED`; runner preflight refuses native work until an explicitly
approved PNG, package readiness and stage authorization exist. Do not infer
approval from creating a visual or a successful source test. The SVG is the
original editable concept; the image recorded as `PENDING` is not a
Blockbench-ready PNG.

## Separate file and safety rules

- Golden reference/seed are canonical, committed and immutable during each run;
  only their explicitly reviewed future source revision may replace them.
- Never use `workspace/active/`, `workspace/saved/`, older approved user
  models, historic previews or earlier Golden outputs as seed or reference.
- Open a **byte-identical disposable copy** of the checked-in blank
  `.bbmodel` in the matching native Blockbench. The runner checks its hash
  against the canonical fixture seed before connecting, and refuses the
  production Workspace, modified seeds and wrong project/stage identity.
- Keep all working `.bbmodel`, PNG atlas, `.geo.json`, animation export,
  captures and reports in `mcp/.cache/golden-sessions/<session>/` (or another
  disposable external location). The runner rejects protected Workspace/fixture
  output paths and checks output-root symlink ancestry before creating a folder.
  Do not commit live outputs or change the `workspace/` authoring contract.
- Use the **same** immutable seed/reference and equivalent input conditions
  for baseline and candidate. Never start the candidate from baseline output.

## Acceptance

The canonical runner/evaluator/finalizer/comparator already exist. A Golden
result can be accepted only with matching source, Gateway and Runtime,
current approved reference and Control provenance, verified native mutation
trace and **final verification after last mutation**, Geometry/UV/Texture/
Animation evidence matching the current approved visual, Bedrock export and
save/reopen parity, no critical defect, and separate documented
`human_acceptance` PASS. Any missing or stale evidence leaves it UNVERIFIED.

The draft retains the approved Reference fingerprint only if an end-of-session
Control read still matches the initial approval/readiness preflight. When source
identity or readiness changes, its provenance remains `null` and the result
remains `UNVERIFIED`. This does not replace visual or human acceptance.

Only **after equal-or-better accepted quality** compare actual time, tool calls,
redundant readbacks, retries, correction rounds and real token telemetry when
available. No scalar visual quality score, no fabricated savings.

## Execution / verification

Existing entrypoint (from `mcp/`, in an authorized matching native environment):

```bash
bun run benchmark:golden-session -- golden-full-asset-authoring .cache/golden-sessions /ABSOLUTE/PATH/TO/mcp/tests/fixtures/golden/full-asset/seed.bbmodel
```

First approve the current reference and prepare a separate saved working copy.
The source path above is the **immutable seed**, never the file to edit.
Run only the focused source contract tests during development:

```bash
bun test tests/benchmark/golden-authoring-run-contract.test.ts tests/benchmark/golden-benchmark-session-runner.test.ts tests/benchmark/golden-session-comparison.test.ts tests/benchmark/golden-session-finalizer.test.ts tests/benchmark/quality-benchmark-corpus-contract.test.ts
```

Native success requires an actual current-HEAD `LIVE_BLOCKBENCH` session,
not the presence of a script or asset. CI remains disabled. Historical six
specialist-named and prior eight object-named Golden IDs are retired and cannot
be compared as the current Golden result. `astra-live-golden-tasks.json`
contains separate small Gateway/call-flow probes, not the product-level Golden.
