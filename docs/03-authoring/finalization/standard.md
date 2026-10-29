# Finalization Standard

Load this file only at `Current Stage: FINALIZATION`. It owns generic completion integrity, not Geometry/Texturing/Animation quality and not repair of historical assets.

## Entry Prerequisites

```text
Geometry: APPROVED
UV Layout: PASS
Texturing: APPROVED
Animation: APPROVED | NOT_REQUIRED
```

A Workspace `Animation Required` declaration that contradicts the
confirmed Reference Package requirement is unresolved, not evidence
that Animation is `NOT_REQUIRED`. Reconcile the existing sources before
Finalization; do not invent a new approval gate or reset unrelated accepted
Geometry/Texture work.

Do not use Finalization to launder an `INVALIDATED`, `BLOCKED`, or unapproved upstream stage.

## Current-revision Finalization checkpoint

After the last approved Geometry/UV/Texturing/Animation checkpoint and
native `.bbmodel` Save, record a single
`Finalization Checkpoint SHA256: sha256:<64 lowercase hex>` in the active
asset README. Obtain it from the **matching saved-file readback**
(`export_model(codec_id=project)` with the intended current path,
`file_integrity_state=READBACK_MATCHED` and `written_file_sha256`),
or from the current bound native file digest surfaced by Control status.
The digest is a checkpoint identity, **not user approval**: the required
Stage approvals and relevant visual evidence must already exist.

At `Current Stage: FINALIZATION` or `COMPLETE`, the existing Control
status compares this accepted digest to the **currently saved, uniquely
bound** Blockbench project's native `.bbmodel`. It also checks that the
native project reports `saved=true`, limits file inspection to 64 MiB,
and fails closed on missing/changed/unreadable native evidence.
`MATCHED` means only matching saved checkpoint bytes;
`STALE` means the saved source changed or the editor reports unsaved work;
`UNVERIFIED` means the accepted checkpoint/native binding cannot be proven.
Neither `STALE` nor `UNVERIFIED` can produce Finalization READY, and
`MATCHED` is not visual, Minecraft playback, or complete export proof.
Finalization READY also requires every applicable upstream Workspace gate
and Reference Package overall readiness to pass independently. Matching
file bytes cannot promote `IN_PROGRESS`, `INVALIDATED` or
`NEEDS_REVIEW` to approval.

Normal Geometry/Texturing/Animation status does **not** read or hash
`.bbmodel` bytes. The native digest is refreshed when Finalization status
is requested, even if the README cache did not change. A newer native
Save after the approval requires a new acceptance/review at that revision,
not editing the expected hash merely to make the comparison green.
This is an actual source revision gate, not a replacement for the domain
validators or manual acceptance already required by the workflow.

## Current-State Authority

After a project switch, native reopen, or material user edit, refresh the affected project/target once before finalization. Otherwise reuse fresh mutation/export receipts; do not broad-reread the project for reassurance.

Live/native current project state outranks stale exported PNG/JSON/`.bbmodel` copies. User edits or deletions are current authority and must not be reconstructed from an older snapshot unless the user explicitly requests restoration.

## Requested Deliverable Contract

Derive the required output set from the current user requirement plus the active workspace README. Do not export every available format by default.

For each promised deliverable distinguish:

```text
NATIVE_SAVED
EXPORTED
PARSE / REFERENCE VERIFIED
VISUAL PASS
MINECRAFT RUNTIME VERIFIED | UNVERIFIED
```

These labels do not imply one another. Save/compile/parse success, bounds, UV hygiene, file existence, or file size cannot create whole-asset completion or visual PASS.

A native model containing an animation does not satisfy a separately requested animation export. A successful export does not prove the native project metadata or Minecraft binding is correct.

### Current Export Routes

`export_model(codec_id=project)` saves editable `.bbmodel`; `codec_id=bedrock` exports geometry JSON. `codec_id=bedrock_animation` compiles all authored clips through native `AnimationCodec` and returns separate Bedrock animation JSON as content only. Omit `path` and compile options, verify `truncated=false`, then persist the returned JSON through the authorized filesystem owner. This route does not export animation controllers or PNGs.

For `bedrock_animation`, the existing export path also checks that the
native compiler output contains **exactly** the current authored Animation
clip identities. Missing, duplicate, unexpected, unnamed or empty clips
cannot silently count as a complete result. The response carries bounded
`animation_export_identity` evidence and `compiled_payload_sha256` for
the native codec bytes. That fingerprint is **not** a native asset-revision
counter, a verified saved-file digest, a visual PASS, or playback proof.
`bedrock_animation` with `max_content_length=0` is invalid because it
cannot deliver a file; `truncated=true` remains incomplete and requires
recovery of the full output without using a partial JSON as an export.
No additional diagnostic call is required when the successful receipt is
sufficient; verify current asset state again if edited after compilation.

For a separately requested animation controller, use its actual native Blockbench export/save route; for a PNG use the native texture save/export route. Do not invent additional codec IDs, substitute `.bbmodel`, or bypass through generic UI/eval. If the required native step is unavailable, report that output as pending and keep its finalization blocked. Existing Bedrock geometry files require native overwrite/merge or a new path; `.bbmodel` replacement requires explicit overwrite consent. Animation content compilation does not constitute a native file save or Minecraft playback proof.

## Identifier / Reference Integrity

The native project is metadata authority. Set or repair identifiers through the native/project owner; do not patch compiled JSON merely to pretend native state changed.

Before `COMPLETE`, verify the requested output set agrees on every material identifier/reference:

- geometry/model identifier;
- animation identifiers when exported;
- texture/material references;
- packaged/client binding when requested.

For the Bedrock geometry codec, the export owner now checks the compiled
`minecraft:geometry` collection and each exact geometry identifier before
delivering content or writing a file. Empty output, missing or unknown
identifiers, and duplicate identifiers fail before a new filesystem write.
The bounded `geometry_export_identity` result is structural evidence only:
it is not proof of atlas/UV completeness, visual acceptance or native
save/reopen. The `compiled_payload_sha256` identifies native compiled bytes,
not the current model revision. A successful path-backed export additionally
returns `file_integrity_state`: `READBACK_MATCHED` and
`written_file_sha256` only when a permission-scoped native file readback
matches the compiled bytes; otherwise `SIZE_ONLY` retains the existing
path/length/lifecycle evidence without claiming content identity.
`NOT_WRITTEN` means compile-only. A proven readback mismatch is
`EXPORT_WRITE_OUTCOME_UNKNOWN`, with no automatic retry or rollback.
Even matching hashes do not prove future asset-revision freshness or
Minecraft playback.

An unintended `unknown`, stale identifier, missing pair, or mismatched reference blocks Finalization for the affected deliverable. It does not erase already-valid Geometry/Texturing/Animation approvals.

## Output Completeness

Before `Finalization PASS`:

```text
current .bbmodel saved when required
every requested export exists for the current revision
requested files parse and cross-references resolve
no promised file is silently omitted because equivalent native state exists
unavailable live/Minecraft proof remains explicitly UNVERIFIED
```

Do not rebuild an accepted object merely to repair finalization metadata or emit a missing export.

## Continuity / README

The active asset README is a **current summary, not append-only history**. At Finalization update only current authority:

- current dimensions and material locator/handoff constraints;
- current stage/gate states;
- authoritative model file;
- actual requested outputs and their status;
- remaining proof/blocker;
- one next step if incomplete.

Remove or clearly supersede conflicting old current-state claims. Git history owns prior states; do not accumulate `final`, `latest`, `final-final` narratives.

## Completion Verdict

`Finalization PASS` requires the requested deliverable set to be present and internally consistent with proof labels that do not overclaim.

```text
missing requested output
identifier/reference mismatch
stale source used as current authority
contradictory current README
proof label stronger than evidence
→ FINALIZATION BLOCKED
```

A partial result may remain valid and reportable. `COMPLETE` means the requested deliverable contract is satisfied, not that every possible export or external runtime has been tested.
