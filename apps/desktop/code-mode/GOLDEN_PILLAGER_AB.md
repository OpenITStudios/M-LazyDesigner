# Pillager Tier 1–3 Golden A/B — real visual acceptance contract

**State:** SOURCE_AUTHORED, TEST_AUTHORED_NOT_RUN, LOCAL_TEST_DEFERRED.
**Purpose:** compare real baseline and candidate Bedrock Entity model quality without confusing SHA/PNG receipts with artistic acceptance. This is an evaluation handoff, not a new runner, approval database, or claim that a Rust/native trial occurred.

## Grounded source evidence

The Local branch's 2026-11-16 authoring-session analysis and public transcript describe repeated user rejections involving Pillager Tier 2–3 shading, helmet flatness, repeated noise/stripes, side ornaments, shield appearance versus Cube size, color drift of neutral hardware and accidental edits to approved Tier 1 regions. Its recorded late-session helmet correction was saved but not finally accepted by the user.

- Analysis: https://github.com/OpenITStudios/M-LazyDesigner/blob/Local/experiments/authoring-session-2026-11-12/continuation-2026-11-16/analysis.md
- Original feedback: https://github.com/OpenITStudios/M-LazyDesigner/blob/Local/experiments/authoring-session-2026-11-12/continuation-2026-11-16/messages.md

Do not infer that Rust reproduces those defects or has fixed their appearance. Do not copy private images from the Local archive to a public test fixture.

## Freeze a comparable A/B case

| Evidence | Required before evaluation | If unavailable |
| --- | --- | --- |
| Selected baseline / candidate source | Exact .bbmodel SHA, geometry/UV/material identity, saved texture revision | NOT_EVALUATED |
| User-approved style master | Actual Tier 1 approved material/reference PNG and original approval context, SHA | MASTER_UNVERIFIED |
| Current candidate | Real PNG capture and matching saved .bbmodel SHA, model/texture revision | CAPTURE_UNVERIFIED |
| Matching visual view | Camera, crop, illumination/shading, orientation, face visibility for BOTH sides | VIEW_MISMATCH |
| Independent reviewer | Actual person or authorized image-capable host receiving BOTH real images and giving a specific finding | REVIEW_NOT_OBSERVED |
| Mutation result | Saved sibling SHA, affected atlas pixels, protected-region comparison, new view | UNVERIFIED |

Baseline and candidate must use comparable model, viewer, reference and work scope. Do not compare a Blockbench-hosted Local runtime with Rust and assume an equivalent renderer or native feature surface.

## Frozen acceptance cases

| Case ID | Prior user feedback | Acceptance evidence to obtain |
| --- | --- | --- |
| PILL-01 | Approved Tier 1 shield was modified during requested higher-tier grading | Exact approved Tier 1 pixel/carrier unchanged in saved file and matched visual views |
| PILL-02 | Tier 2 shield artwork looked smaller despite equal Cube dimensions | Compare visible artwork bounds, not merely Cube dimensions |
| PILL-03 | Tier 2/3 helmet was a flat band rather than hand-painted metal | Human/visual-capable reviewer sees material hierarchy and highlights/shadows on a helmet close-up; numerical color count is insufficient |
| PILL-04 | Unwanted side/head ornaments or removed required helmet and face trace | Approved helmet remains, prohibited side ornament absent, red face trace retained in front and side views |
| PILL-05 | Blue/red variant shading recolored neutral iron and collapsed identity | Hardware remains neutral where requested; accents/shield red follow approved reference |
| PILL-06 | Rear, side and undersides were overlooked | Six Cube-local face coverage evidence plus relevant saved shaded model views; alpha statistics alone do not pass quality |
| PILL-07 | Same rejected stripes/noise/gradient plan repeated | Two unsuccessful same-causal-direction corrections require a different diagnosis and evidence before continuing; repeated user instructions count as failures, not proof |
| PILL-08 | Tier 2/3 progression unclear or generic/cluttered | Reviewer can distinguish progressive armor/detail/silhouette without altering approved Tier 1 language |
| PILL-09 | Finished/approved claims followed receipts without visual acceptance | Never mark PASS/APPROVED on a CLI success, image hash match, or callback declaration alone |
| PILL-10 | Separate file/export/live-state confusion | Required single asset structure checked on authoritative saved .bbmodel and verified opened state, not assumed from local file existence |

Geometry/UV and Animation remain their respective authoring owners; do not repair a geometry cause by repainting arbitrary atlas pixels.

## Exact correction loop

1. The authorized operator selects one source .bbmodel revision, actual approved image(s), and current model capture from the same viewed region. Bind their SHAs and view name in the existing Rust Code Mode host.
2. An actual independent reviewer inspects BOTH image buffers and returns ACCEPTED, REJECTED or UNVERIFIED. Rejections require stable issue ID, observed defect and bounded affected texture region; do not let the guest invent reviewer approval.
3. For one rejected defect, run a coherent scoped Paint transaction that changes only authorized pixels and preserves alpha if required. Rust validates the final saved state. An accepted or unverified snapshot must not be repainted.
4. Reopen/capture the saved new revision and bind an updated image pair. Never use an earlier capture or repeat a stale approved decision. Check the repaired region, corresponding protected parts and views not targeted.
5. Record actual accepted/rejected outcomes and diagnostic direction. If the same approach is rejected twice, stop that approach and require new causal visual evidence. The existing host has no cross-session retry-memory; the operator's recorded evaluation supplies continuity.

## Negative controls already represented in source

- A second review attempt cannot downgrade ACCEPTED to REJECTED for the identical model/image binding.
- Replacing either image after preflight prevents Paint before write approval/native mutation.
- A rejected review must not allow changes outside its rectangle or weakened alpha.
- A completed scoped correction cannot be repeated against the consumed source/capture.
- Equal PNG hashes, arbitrary color transitions, or full opaque backgrounds cannot establish professional texture quality or silhouette acceptance.

The authored Node cases use synthetic header-only PNGs to exercise host authority with a mocked CLI; they do not constitute an actual decoded PNG, image-rendering or artistic-quality test. Real Rust decoder and native interface tests remain on hold.

## Evidence and stop criteria

Record only actual observations: case ID, source SHA, camera/view, approved reference PNG SHA, candidate PNG SHA, reviewer/host/version, issue ID, observed defect, correction approach, permitted atlas rectangle, protected regions, final user decision, reason for rejection and native proof. When any observation is missing, write NOT_EXECUTED, UNVERIFIED or BLOCKED with the specific gap.

To claim measurable improvement, compare identical Golden cases for baseline/candidate: user accepted outcomes, repeated rejected causal treatments, protected-area regressions, human correction rounds, and elapsed time-to-acceptance with real timestamps. Do not invent percentages, faster performance or reduced tokens from source-file changes alone.

**Current ceiling:** source commits and authored tests; no actual Pillager A/B image comparison, user approval, model image ingestion or PC-local native execution has occurred in the ChatGPT/GitHub work surface.
