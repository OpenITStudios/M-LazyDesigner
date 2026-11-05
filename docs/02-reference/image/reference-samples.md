# Four-Side Model Reference Samples — Approved and Rejected Historical

**Approval scope confirmed 2026-11-05:** **MD-REF-01 (Silver Luxury SUV)** remains the **sole approved** VISUAL GUIDELINE for clean four-panel layout and restrained Minecraft-stylized Blockbench presentation. Its SUV shape, wheel geometry, grille, colors and accessories must never transfer to another subject.

**Rejected-quality archive:** **MD-REF-02 (Roman Legionary)** was re-audited using the actual source and generated pixels and is now **REJECTED_VISUAL_QUALITY**, not a backup candidate. Source-identity drift, inadequate purposeful Minecraft/Blockbench craft and P1 sword/shield-continuity issues invalidate positive exemplar use even though the 2x2 layout and SHA hashes are correct. Its original bytes are preserved under the separate Library `Rejected/` folder as negative QA evidence only. No new model should load it as a STYLE_EXAMPLE or PRESENTATION_EXAMPLE.

This catalog follows [M-LazyBuilder's approved-reference storage discipline](https://github.com/OpenITStudios/M-LazyBuilder-MCP/blob/develop/docs/03-authoring/exterior/reference-samples.md): original full-resolution image **bytes stay in ChatGPT Library**, GitHub contains the durable catalog/rules/identifiers. GitHub Markdown, hashes and image-generation IDs do **not** supply the actual pixels to ChatGPT or local Codex. No new GitHub image-generation engine, auto-loader, Project installation, runtime schema, or persistent model state is introduced.

## Approved Library archive

**ChatGPT Library root:** `/M-LazyDesigner/Reference Samples/Model Four Sides/`

**Approved bundle:** `M_LazyDesigner_Approved_Four_Side_References_v1.zip` (one sample, MD-REF-01). ZIP SHA-256: `9c2dc84c550d4d7dc7079b530f2b49d46a8789f92bfbed1c10cff47208bae87b`. The root also holds `README.md` and `manifest.json`.

**Sample folder:** `MD-REF-01_silver-luxury-suv/`

| File | Purpose | Evidence |
| --- | --- | --- |
| `approved_four_sides.png` | Frozen original user-approved visual guideline; **do not edit this baseline in place** | PNG, **1448 × 1086**, **1,725,051** bytes; SHA-256 `59b782b580d6ae6c6c2bd9fe6cb6e728af2be6739f94aa11a5fc4eaa25bce782` |
| `input_source.png` | User-provided silver SUV photo; source identity for **this example only** | PNG, **1600 × 840**, **3,348,125** bytes; SHA-256 `5475a0dd470520a607460055209cbee1b8d2e310a1774f6841120b8eed7b93eb` |
| `REPRODUCE.md` | Reconstructed sample-specific reproduction constraints; not the hidden original prompt/seed | Text |
| `manifest.json` | Exact hashes, dimensions, approval scope, provenance and limitations | JSON |

- **Visual generation ID:** `f1d746b2-0eda-4359-8b23-83bdf2ecfb93`.
- **Current authoring contract:** `M-LD-REF / 1.3` in [master-templates.md](master-templates.md), including an isolated four-side-only image payload, explicit single-view opt-in and quality acceptance firewall. This is **current forward-looking guidance**, not proof that historical MD-REF-01/02 images were generated or tested with v1.3.
- **Approval:** for visual reference guidance only. **Not executed/verified:** native Blockbench import, part dimensions, UV/rig, Bedrock export, or calibrated orthographic camera consistency.
- **Source-hidden rear:** the source photograph provides only one three-quarter exterior angle; the image's BACK panel is **PROVISIONAL creative completion**, not observed original geometry. RIGHT/LEFT source-fidelity claims are similarly limited where occluded.
- **Visual caveats:** wheel segmentation, mirror/door/trim alignment and exact lamps/grille may differ from the source. Do not promote these details into universal model-construction rules.

## What can transfer to NEW assets

1. **Layout / presentation:** a clean balanced 2×2 arrangement `FRONT | RIGHT` above `BACK | LEFT`, large uncropped subject in each panel, thin separation, neutral/dark background and short labels. **Balanced does not mean equal panel pixel widths**: MD-REF-01 has narrower FRONT/BACK and wider RIGHT/LEFT panels for the elongated SUV. This keeps the same underlying model scale and visual evidence priorities without clipping the profile. No fifth HERO, palette, oversized title, generated metrics, on-image QA badges, or detail gallery.
2. **General render craft only:** readable Blockbench-like cuboid layers and meaningful silhouette; restrained painted face shading and intentional quiet areas. Keep material-specific shading; never create a separate raised Cube for each painted texel.
3. **View consistency targets:** one frozen object orientation, side-specific details, recurring components/contacts and proportions. Actual four-view images still need inspection; four labeled pictures do not prove a real 3D model.

**Never transfer from MD-REF-01:** its silver SUV identity, grille/headlamps, door layout, roof rails, wheel design, color, dimensions, brand cues or invented hidden rear into another subject just because the example depicts them. The user's **new subject** controls all those design decisions.

## Reuse in ChatGPT and downstream Codex

**A. New subject (default).** Inspect the actual `approved_four_sides.png` pixels if accessible as a **PRESENTATION_EXAMPLE**. If invoking its broader style, keep a separate **STYLE_EXAMPLE** decision restricted to general cuboid/face-painted treatment; never inherit its vehicle geometry or materials. Inspect the user's new source as `SUBJECT_SOURCE` and respect the [source–style–presentation authority firewall](prompt-contract.md#sourcestylepresentation-authority-firewall). Do **not** load this sample's `input_source.png` or `REPRODUCE.md` into new-subject generation; they are source-specific and invite SUV-identity leakage.

**B. Audit/reproduce MD-REF-01 (explicit request only).** Load `approved_four_sides.png` **and** its matching `input_source.png`, `REPRODUCE.md`, and `manifest.json`. Exact reuse means reusing preserved PNG bytes. The reconstructed text is not an original prompt/seed and cannot promise pixel-identical regeneration.

**C. Local Codex/Blockbench use.** Explicitly export/download the approved PNG from Library or the approved ZIP to the development workspace and verify actual bytes with the commands below. A repository path, Markdown catalog, or SHA by itself is not an image file. Preserve `MD-REF-01` provenance and approval scope on handoff; do not claim tested native geometry or approval of new models.

**Sample promotion policy:** saving is not visual acceptance. A new positive exemplar needs actual-image review for P1 source identity, Minecraft/Blockbench craft and part/grip continuity **before** layout or approval; explicit user approval remains separate. MD-REF-01 remains the sole approved sample. **MD-REF-02 is rejected, quarantined, and prohibited as a positive example even if explicitly selected as a generic backup.** A correction must become a new, separately reviewed artifact; never silently promote the old PNG.



## MD-REF-02 — Roman Legionary (REJECTED_VISUAL_QUALITY)

**Current status, audit 2026-11-05:** `REJECTED_VISUAL_QUALITY`. It was previously `BACKUP_CANDIDATE_NEEDS_USER_REVIEW` when first stored on explicit user request; that prior status has been superseded by actual-image QA. It is not an approved or eligible backup reference.

**Quarantined Library path:** `/M-LazyDesigner/Reference Samples/Rejected/MD-REF-02_roman-legionary/` (not the active `Model Four Sides` folder). The active Library root `manifest.json` v3 lists `approved_samples = [MD-REF-01]`, `backup_candidates = []`, and `rejected_samples = [MD-REF-02]`.

**Frozen historical ZIP:** `/M-LazyDesigner/Reference Samples/Rejected/M_LazyDesigner_Roman_Legionary_Backup_MD-REF-02_v1.zip`; ZIP SHA-256 `6f64d9ca6ed365ef34fe9dce62a757cfdc50efaa003a05d1c525204f247309bd`, size 1,261,415 bytes. The ZIP is **unchanged historical evidence** and contains **outdated candidate-status metadata**; do not use the ZIP's old manifest as current classification. Current truth is this GitHub catalog and the updated Library root/sample manifests.

**Preserved source/artifact bytes (unchanged):**
- `candidate_four_sides.png`: 1448 × 1086, 707,894 bytes, SHA-256 `8a886d4d004c077a62e9237e8201d2c206ecf3227c249ce86090dad18d48b853`.
- `input_source.png`: 415 × 739, 551,467 bytes, SHA-256 `4f024d5ba1be92490b3cae5870ef2ba6795b3a7ff8245f0e054640969cf421cf`.
- `REPRODUCE.md` and `manifest.json`: updated **QA/rejection metadata**; no new image, `.bbmodel`, native proof or retouched model was produced.

**Provenance:** source generation ID `242549b3-cfba-480a-a1a0-57fd2094a21e` contained a larger infographic. Following repeated poster-generation failures, the four directional images were cropped and deterministically reassembled into a 2x2 layout. This **presentation-only transform** changed no underlying anatomy, weapon grip, armor topology, painted material or original perspective. It **must not** be considered a successful Minecraft model correction.

**Reasons for rejection, based on inspected pixels:**
- **P1_SOURCE_IDENTITY:** visible age/face character, shield scale and original armor silhouette were simplified or changed into a generic ornamented soldier rather than source-grounded stylization.
- **P1_MINECRAFT_BLOCKBENCH_CRAFT:** excessive metallic/gold visual noise, generic repeats and ambiguous decoration-versus-geometry prevent confident, deliberate Blockbench cuboid/hand-painted interpretation. Minecraft HD style does not mean merely pixelated rendering.
- **P1_CROSS_VIEW_TOPOLOGY:** the soldier's right-hand sword is shown in FRONT/BACK but is not clearly carried through the RIGHT-side view; shield/left-arm connection and grip are unresolved. A displayed side label cannot make physical contacts consistent.
- **NOT_ASSESSABLE (different from failure):** rear armor and hidden joints are not visible in the source photo. Any illustrated BACK is provisional; exact UV, rig/pivots, camera calibration and native Bedrock export remain untested.

**Use restriction:** This image and its old backup ZIP may be opened **only for an explicit failed-example / negative QA audit**. **NEVER load MD-REF-02 as STYLE_EXAMPLE, PRESENTATION_EXAMPLE, or a positive authoring baseline.** Do not add it to a configured ChatGPT Project's positive visual examples, and do not let Codex infer geometry from it. Do not delete the preserved bytes. A newly corrected Roman-character candidate would need a new image/revision, P1 visual review and separate explicit user approval; updating a status label does not fix this saved image.

## Byte-verified local Codex handoff (Windows PowerShell)

Download the **frozen** `M_LazyDesigner_Approved_Four_Side_References_v1.zip` from the ChatGPT Library folder to a Windows folder **outside the Git checkout**. Set `$archive` to the actual downloaded path. The repository catalog cannot automatically fetch or install the PNG.

```powershell
$archive = "C:\path\to\M_LazyDesigner_Approved_Four_Side_References_v1.zip"
$zipSha = "9c2dc84c550d4d7dc7079b530f2b49d46a8789f92bfbed1c10cff47208bae87b"
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw "Missing approved archive" }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -ne $zipSha) { throw "ZIP checksum mismatch" }
$dest = Join-Path $env:TEMP "M-LazyDesigner-Reference-MD-REF-01"
Expand-Archive -LiteralPath $archive -DestinationPath $dest -Force
$folder = Join-Path $dest "MD-REF-01_silver-luxury-suv"
$approved = Join-Path $folder "approved_four_sides.png"
$source = Join-Path $folder "input_source.png"
$checks = @(
  @{ Path = $approved; Hash = "59b782b580d6ae6c6c2bd9fe6cb6e728af2be6739f94aa11a5fc4eaa25bce782" },
  @{ Path = $source; Hash = "5475a0dd470520a607460055209cbee1b8d2e310a1774f6841120b8eed7b93eb" }
)
foreach ($check in $checks) {
  if (-not (Test-Path -LiteralPath $check.Path -PathType Leaf)) { throw "Missing PNG file" }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $check.Path).Hash.ToLowerInvariant() -ne $check.Hash) { throw "PNG checksum mismatch" }
}
$manifest = Get-Content -LiteralPath (Join-Path $folder "manifest.json") -Raw | ConvertFrom-Json
if ($manifest.files.'approved_four_sides.png'.sha256 -ne $checks[0].Hash) { throw "Approved PNG manifest mismatch" }
if ($manifest.files.'input_source.png'.sha256 -ne $checks[1].Hash) { throw "Input source manifest mismatch" }
Write-Host "Verified PNG path for Codex: $approved"
```

Pass the **actual verified PNG path** to Codex as `PRESENTATION_EXAMPLE` and the NEW asset's own photo/brief as `SUBJECT_SOURCE`. Do not include the archived SUV source or its sample-specific reproduction rules when generating a different asset. The approved sample remains **VISUAL_GUIDELINE_ONLY**, with the BACK panel provisional and no native Blockbench validation.

**Proof boundary:** static GitHub/Bun tests can verify catalog structure, pinned hash *text* and these transfer instructions, but **cannot verify external ChatGPT Library image bytes** without an actual exported file. The real ZIP and PNG byte hashes must be checked after transfer. This step does not create a loader, new schema or alternate model-generation path.


**Ownership:** This file is a catalog only. [standard.md](standard.md) owns four-side layout and visual QA, [prompt-contract.md](prompt-contract.md) owns source/style/presentation roles, and [master-templates.md](master-templates.md) owns the versioned invocation.
