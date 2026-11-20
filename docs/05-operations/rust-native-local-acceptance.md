# Rust-native local acceptance plan

**State:** PREPARED / NOT_EXECUTED. **Branch:** `Rust`, exact SHA must be pinned again on the real user-PC checkout. This document does not release the current hold on localtest, CI, Codex execution or native Blockbench acceptance.

## 1. Entry and source checks (only after explicit PC-local authorization)

Record exact checkout SHA, verified LOCAL_PC_AGENT host (Codex CLI/IDE or other approved client), Windows/WebView2 version, Node 24, Deno, Rust and the separate `lazydesigner-authoring` executable. Keep original models unchanged. From `apps/desktop`, use the existing `npm ci` and `npm run verify:source`. The latter now includes `npm run verify:code-mode`, Cargo check and Cargo test. A Deno isolation test without a verified `LAZYDESIGNER_DENO_BINARY` is **SKIPPED**, not passed. Do not use GitHub Actions or cloud checks as native evidence.

Build the independent first-party CLI using the existing `apps/desktop/src-tauri/Cargo.toml` owner: `cargo build --locked --manifest-path src-tauri/Cargo.toml --bin lazydesigner-authoring`. Start the Tauri desktop only with the existing dev/build scripts on the authorized PC. Confirm actual executable paths and versions, not merely compilation configuration.

**Codex is separate from the GUI.** Verify that the authenticated external agent has actually registered the single `lazydesigner_code_mode({code})` tool from `createCodeModeTool(host)`. `code-mode/run.mjs` is a manual operator CLI, not automatic Codex installation; for that CLI supply absolute `--rust`, `--deno`, `--code`, exactly one `--input` or `--output-dir`, and `--approve-interactive` with a real TTY for writes. Never run model-authored JavaScript with unrestricted Node access.

## 2. Rust desktop functionality

| Test | Required acceptance |
| --- | --- |
| New → Geometry Cube/Bone/pivot/UV → Save Copy → reopen | Supported data and transforms preserved; original never overwritten |
| Edit/Undo/Redo, dirty-state close and canceled picker | No lost edits or accidental data discard |
| Paint, alpha, existing face UV, texture import/export | Correct source RGBA/UV and unchanged unrelated pixels |
| Animation clip, keys, curve, playback | Native timing/pivots/loop and saved keys match the intended motion |
| Recovery checkpoint → restore | Unsaved recovery is recoverable; original path and model remain protected |
| Geometry JSON, PNG, Animation JSON, .bbmodel | Valid output and correct source identity, without overwrite |
| Open/edit/save/reopen the Rust .bbmodel in real Blockbench | Supported geometry/UV/texture/animation round-trip without silent loss |
| Six views and affected close-ups against approved reference | Independent human visual assessment, not a technical PASS label |

## 3. External Code Mode sequence

Use an **existing asset README** alongside the exact source model. For existing models, bind the true `Current model file` and `Workflow Model SHA256`; for a new model, declare GEOMETRY IN_PROGRESS without a saved source. Record Animation Required YES or NO explicitly and never invent approval.

Positive: `codemode.initial.workflow` shows SOURCE_BOUND only when the
selected file/SHA matches the README, otherwise BLOCKED with a bounded
reason. A missing README must not prevent read-only inspection. Neither
status attests artistic review or skips later write checks.
Each successful New/Apply/Import must return the actual `candidateFile`
and `sha256` for manual Open Model review. Stage transitions update the
same README and require a new host session.

Positive: Geometry plan/read/preflight and one independently approved new sibling; same-session revision continuation; after actual Geometry approval, rebind file/SHA for UV, then Texturing after UV PASS, and Animation only after Texture approval if required. Open the candidate using the **manual** GUI File → Open action. Negative: premature Texture/Animation, mixed operations, unknown operation, stale/missing/duplicate SHA field, changed README during approval, denied permission, invalid path/filename, crash/unknown write outcome. Every refusal must leave the original safe; do not blindly replay an uncertain write.

Before functional acceptance, include the source-parity regression: the host's closed operation inventory and 128-operation limit must match the current canonical Rust EditOperation enum. Unknown/mixed edit kinds refuse before host approval; this check is technical, not artistic approval.

Finalization requires a recorded upstream approval chain, no blockers, and a real saved Animation when requested. An explicit static asset can skip Animation only if Animation Required is NO; absence of clips alone is not an approval. The user types prompts only in external Codex/Agent App.

## 4. Report and stop

Record exact SHA, PC/agent host, tool versions, test command, source/input/output hashes, actual observation, and PASS/FAIL/BLOCKED/NOT_EXECUTED per case. A source check is not an installed/native PASS. Stop at the first material blocker and repair the first correct source owner; do not switch to cloud CI, introduce an AI UI inside LazyDesigner, or expand modelling intelligence to conceal a failure.
