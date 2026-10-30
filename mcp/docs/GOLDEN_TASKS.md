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
- Approved source package: `tests/fixtures/golden/full-asset/reference/REFERENCE.json`;
  active four-view voxel visual: `reference/beacon-courier-approved.png`.
  Original `reference/turnaround.svg` is retained as unregistered concept provenance.
- Immutable blank source: `tests/fixtures/golden/full-asset/seed.bbmodel`.
  It is a source-authored Blockbench 5.x Bedrock JSON candidate, not a native
  verified/imported or prebuilt finished model.

The new voxel-style visual was **user-approved on 2026-10-31**
and committed as the exact 1536×1024 PNG in the dedicated fixture. Its
SHA-256 is `ad8ecd1e07aa858bdecff779dc7097e49bcf5410c864d1320d252c9134e56245`;
Git blob identity is `d6d58841a884498f9e9ce76ef5991e18b18d47c5`.
The original SVG remains in Git as an unregistered earlier concept.

`REFERENCE.json` declares the source-level input approval and the
Geometry/Texture/Animation reference readiness `READY`; it does **not**
establish any Runtime, geometry, UV, texture, animation or finished-model
PASS. Golden preflight still checks actual PNG media/bytes, Control
fingerprint, clean Git, matching Runtime and disposable paths, and the
final benchmark still requires native save/reopen/export and independent
human acceptance. Current execution and Cost to Accepted Result are
`UNVERIFIED` / `UNMEASURED`.

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

The runner also requires a **clean Git worktree**, including no staged,
unstaged or nonignored untracked source, before opening native MCP. It rechecks
the same Git HEAD and clean source after the session. A change or failed Git
inspection withholds the trusted Reference fingerprint from the draft.
The approved Reference fingerprint is retained only if the final Control read
still matches the initial approval/readiness preflight. Any missing provenance
leaves the result `UNVERIFIED`; none of these checks replaces native visual
or human acceptance.

Only **after equal-or-better accepted quality** compare actual time, tool calls,
redundant readbacks, retries, correction rounds and real token telemetry when
available. No scalar visual quality score, no fabricated savings.

## Execution / verification

Existing entrypoint (from `mcp/`, in an authorized matching native environment):

```bash
bun run benchmark:golden-session -- golden-full-asset-authoring .cache/golden-sessions /ABSOLUTE/PATH/TO/mcp/tests/fixtures/golden/full-asset/seed.bbmodel
```

Use the current approved source reference and prepare a separate saved working copy.
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
