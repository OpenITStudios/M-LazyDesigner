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

For a separately requested animation controller, use its actual native Blockbench export/save route; for a PNG use the native texture save/export route. Do not invent additional codec IDs, substitute `.bbmodel`, or bypass through generic UI/eval. If the required native step is unavailable, report that output as pending and keep its finalization blocked. Existing Bedrock geometry files require native overwrite/merge or a new path; `.bbmodel` replacement requires explicit overwrite consent. Animation content compilation does not constitute a native file save or Minecraft playback proof.

## Identifier / Reference Integrity

The native project is metadata authority. Set or repair identifiers through the native/project owner; do not patch compiled JSON merely to pretend native state changed.

Before `COMPLETE`, verify the requested output set agrees on every material identifier/reference:

- geometry/model identifier;
- animation identifiers when exported;
- texture/material references;
- packaged/client binding when requested.

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
