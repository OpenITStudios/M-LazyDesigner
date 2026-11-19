# Deep Research — Procedural Reasoning, Reference Fidelity, dan Efisiensi Authoring LazyDesigner

**Tanggal riset:** 2026-11-20 (Asia/Jakarta)  
**Status:** RESEARCH_ONLY / DESIGN_OPTIONS_NOT_APPROVED_FOR_IMPLEMENTATION / NOT_EXECUTED  
**Sasaran:** M-LazyDesigner, branch `Rust` (standalone Rust/Tauri/Svelte editor, Three.js tetap).  
**Snapshot source yang diinspeksi:** `OpenITStudios/M-LazyDesigner@2d93f154d6c89b9d0419a48e4760e6de691a5839` dan `Noniv/abyssal-garden@a596354eff400d458bc2aeb9bdf5e0a9734b2bcf`. Branch Rust aktif dapat terus berubah; periksa HEAD terbaru dan perubahan relevan sebelum keputusan berikutnya.  
**Otoritas:** dokumen di `experiments/` ini **hanya penelitian dan opsi desain**, bukan policy, runtime owner, status produk, task queue, implementation instruction, atau izin pengembangan. Source runtime, `.agent-standard/profile.json`, `.agent-standard/project-policy.md`, `docs/04-system/rust-native-editor-plan.md`, `docs/04-system/implementation-map.md`, `docs/05-operations/`, dan source current HEAD tetap otoritatif.

> **Pembatasan tegas:** tidak mengubah source aplikasi, renderer, CLI, Deno host, Skills, format, API, preset, pengujian, behavior, atau data pengguna. Tidak mengaktifkan CI, menjalankan local tests, mendorong rollout, atau mengklaim native QA/visual acceptance. Penelitian dan dokumentasi tidak memberi izin implementasi.

## 0. Keputusan ringkas dan hal yang harus dibuktikan

**Hipotesis utama:** peningkatan terbesar LazyDesigner kemungkinan berasal dari **mengurangi keputusan koordinat dan koreksi berulang oleh AI** melalui komposisi bentuk yang bermakna, constraint eksplisit, generator Rust deterministik, diagnosis visual, dan perubahan lokal, **bukan** dengan meniru engine WebGPU Abyssal Garden.

- **P0 untuk diteliti lebih jauh, bukan diterapkan:** (a) semantic part/constraint graph; (b) memilih operasi yang sudah dimiliki Rust; (c) locate–diagnose–edit pada bagian yang gagal; (d) verifikasi visual dan source secara terpisah.
- **P1:** perencanaan tekstur berbasis bentuk yang menghasilkan **RGBA8 tertulis** pada atlas asli, dan motion planning yang di-*bake* menjadi keyframe editable.
- **P2:** macro learning dari library model yang cukup besar dan terkurasi, eksperimen SDF→Cube khusus objek yang memerlukannya, optimasi viewport/runtime berdasarkan pengukuran.
- **Tidak direkomendasikan:** mengganti Three.js, memindahkan otoritas model ke GPU/JavaScript, menyalin repo Abyssal Garden utuh, membangun node editor/engine/agent-router kedua, training LLM/CAD baru sebelum baseline, atau menjadikan 90 KB sebagai ukuran keberhasilan.
- **Ukuran keberhasilan utama:** **waktu/biaya hingga satu aset berkualitas diterima**, dengan kualitas referensi, editability, data asli, dan keamanan sebagai syarat mutlak. Lebih sedikit Cube/tool call tidak otomatis lebih baik.
- **Bukti hari ini:** inspeksi repository dan sumber primer (paper, docs) saja. Tidak ada run, kompilasi, benchmark, review artist, Blockbench reopen, atau pengukuran RAM/GPU.

## 1. Rumusan masalah: visual 90-an KB bukan model Minecraft 90-an KB

Abyssal Garden mendistribusikan dunia 3D melalui satu `index.html` minified. Pada snapshot yang diinspeksi, GitHub metadata menyebut **99.514 byte** (~97,2 KiB), mendekati deskripsi developer “96 KB”; seluruh sumber development tetap terdiri dari beberapa modul. Minifikasi dilakukan pada JavaScript, WGSL, dan CSS menggunakan `source/build.mjs`/esbuild.

**Tiga ukuran yang tidak boleh dicampur:**
1. *Distribution size* = byte file HTML yang diunduh. Ini dapat sangat kecil karena file menyimpan fungsi/aturan.
2. *Generation resources* = data volume, mesh, buffer GPU, data sementara saat dunia dibangun. Dapat ratusan MB atau lebih.
3. *Runtime performance* = CPU/JS/GPU frame time, draw calls, RAM/VRAM, loading, jank, dan crash.

Abyssal Garden bukan sistem inverse-graphics yang secara otomatis memahami segala objek dari gambar: source-nya berisi **parameter dan komposisi yang dirancang**, termasuk posisi formasi, jarak pandang, area bebas, camera path, dan set pieces. Rendering yang bagus berasal dari **aturan yang tepat + kurasi + shader**, bukan dari “AI reasoning” mandiri yang dibuktikan dapat mentransfer ke setiap objek.

Bagi LazyDesigner, hasil harus **Cube/Bone/UV/PNG/Animation editable dalam `.bbmodel`**. Sebagian besar geometry shader/SDF/mesh halus pada Abyssal tidak otomatis dapat diekspor sebagai model Bedrock.

### 1.1 Source walkthrough Abyssal Garden

| Pemilik upstream (pinned) | Mekanisme teramati | Insight yang dapat diambil | Yang **tidak** dapat diklaim |
| --- | --- | --- | --- |
| `source/src/world.js` (MESAS/ARCHES/HOLES/CLEARS) | Volume besar, lengkung, rongga dan area bebas dideklarasikan eksplisit. | Susun constraint ruang kosong/visual terlebih dahulu, baru detail. | Bukan algoritma pengenalan referensi otomatis. |
| `source/src/shaders.js` (`dens`) | FBM/domain warp + operasi smooth min/max untuk field volume; lubang/arch dan detail permukaan. | SDF sebagai prototipe volume/negatif, bukan otoritas model akhir. | Tidak langsung menjadi Cube/UV editable. |
| `source/src/math.js` (`surfaceNets`) | Menghasilkan mesh triangle dari scalar field pada grid. | Representasi antara volume dan mesh dapat memandu silhouette check. | Triangle mesh ≠ komposisi Cube Bedrock, topology preservation perlu bukti. |
| `source/src/math.js` (`Mesh.sweep`, `Mesh.tube`) | Profil sepanjang polyline, tangent/frame, lebar/radius berubah. | Rumus sederhana bisa menciptakan shape besar berstruktur. | Tidak perlu menyalin, Rust sudah punya sweep/profile. |
| `source/src/world.js` (`meshShip`) | Profil lambung, keel, ribs, papan, lubang rusak, deck, mast. | Generator yang memahami **komponen dan fungsinya**, bukan koordinat bebas. | Kualitas kapal belum berarti generator cocok untuk semua kategori. |
| `source/src/world.js` (`meshCoral`) | Cabang rekursif radius/arah/panjang dengan seed terkontrol. | Branch grammar dan parameter saling terkait. | Noise/branch bukan solusi untuk model mekanis presisi. |
| `source/src/math.js` (`rseed`) | Aliran pseudorandom terpisah antarsistem. | Variasi deterministik dan eksperimen terulang; perubahan satu komponen jangan menggoyang seluruh bentuk. | Seed saja tidak menjamin stabilitas UUID ketika indeks output berubah. |
| `source/src/world.js` (`nearFly`/`nearPose`) | Penempatan flora memperhatikan jalur kamera dan viewpoint. | Perhatian pada tampilan dan ruang kosong sesuai tugas, bukan taburan global. | Optimasi kamera tidak boleh membentuk sisi tersembunyi dengan salah. |
| `source/src/shaders.js` (material/foliage) | Warna dan gerak parametrik di GPU saat render. | Normal/curvature/form memandu material dan gerakan. | Efek shader tidak sama dengan pixel RGBA8 atau keyframe tersimpan. |
| `source/src/main.js`/`quality.js` | GPU timer, dynamic resolution, geometry/detail thinning, preallocation, spatial cells. | Profiling, bounded workloads, quality tiers untuk **view**, bukan data. | Tidak membuktikan rendah RAM/VRAM semua perangkat. |
| `source/src/dev.js` | Jalur 60 detik fly-through dan statistik avg/p99/max. | Benchmark yang repeatable lebih kuat daripada klaim FPS tunggal. | Adanya script bukan bukti pernah dijalankan/passed. |
| `prompt.txt` | Prioritas visual > stable frame > file size; meminta critic terpisah yang melihat render, bukan source. | Independent visual review mengurangi bias “source terlihat benar”. | Request critic dalam prompt bukan bukti critic sungguh berjalan. |

Sumber primer: [Abyssal Garden repo](https://github.com/Noniv/abyssal-garden/tree/a596354eff400d458bc2aeb9bdf5e0a9734b2bcf); [brief asli](https://github.com/Noniv/abyssal-garden/blob/a596354eff400d458bc2aeb9bdf5e0a9734b2bcf/prompt.txt); [build](https://github.com/Noniv/abyssal-garden/blob/a596354eff400d458bc2aeb9bdf5e0a9734b2bcf/source/build.mjs). Lisensi repo: MIT; **belum ada kode upstream yang disalin**.

### 1.2 Lima prinsip yang layak diadopsi sebagai konsep

1. **Form follows purpose:** bagian dibuat karena fungsi dan hubungannya dengan bagian lain (lambung, rusuk, tiang), bukan semata panjang daftar primitive.
2. **Composition over per-pixel/per-cube guessing:** AI mendefinisikan tipe operasi dan constraint; Rust menyelesaikan geometri detail.
3. **Stable independent randomness:** variasi punya seed stabil dan budget; preserve shape identity.
4. **Context-aware placement:** posisi permukaan, parent frame, ruang bebas, dan pose dipertimbangkan.
5. **Visual feedback berlapis:** validasi format/constraint berbeda dari keterbacaan artwork dari multi-view.

## 2. Riset lintas metode: source asli, validitas, transfer, dan keterbatasan

**Tingkat bukti di tabel:** “paper peer-reviewed” adalah klaim riset dalam domain aslinya, **bukan** bukti hasil pada M-LazyDesigner. “preprint” belum otomatis peer-reviewed; “official docs” mendeskripsikan API/format, bukan performa lokal.

| Sumber | Temuan primer | Relevansi paling kuat | Biaya/kontra-bukti/keputusan |
| --- | --- | --- | --- |
| **ShapeAssembly** (ACM TOG 2020) | Bahasa program berbasis cuboid parts, hierarki, attachment dan symmetry. | Part graph Cube/Bone, constraint, editable form. | Memerlukan semantik bentuk dan dapat menghasilkan geometry implausible; **P0 konsep, tidak port ML**. |
| **ShapeMOD** (ACM TOG 2021) | Macro discovery dari koleksi program geometri; menekan free parameters. | Reuse recipe armor/rail/leg assemblies. | Perlu library program representatif; **P2**. |
| **ShapeCoder** (ACM TOG 2023) | Abstraksi ditemukan dari primitive tidak terstruktur memakai recognition + e-graphs. | Menemukan motif procedural dari model kurasi. | Dataset/engineering kompleks; **bukan P0**. |
| **VPI-Edit** (NeurIPS 2024) | Network memilih local program edit berdasar target visual; keuntungan dari edit vs one-shot pada domain evaluasi. | Diagnose dan repair part gagal tanpa rebuild keseluruhan. | Code dan pretrained model khusus layout/CSG; **adopsi prinsip edit, bukan training**. |
| **CAD-Editor** (ICML 2025) | Locate-then-infill untuk edit script CAD. | Fokus pada subbagian/preserving unchanged. | Repo Microsoft telah diarsipkan Sep 2026; domain sketch/extrude berbeda; **pelajari prosedur**. |
| **CADFusion** (ICML 2025) | Training sequential + visual-feedback untuk CAD sequence. | Source valid saja tidak cukup; visual return menentukan kandidat. | Butuh training dan dataset, metrik VLM tidak ekuivalen artist approval; **P1 konsep**. |
| **CADMorph** (NeurIPS 2025) | Plan–Generate–Verify untuk local parametric CAD edits memakai P2S/MPP pretrained models. | Tiga tahap dengan structure preservation dan semantic validity. | Backbone latents/training mahal; **jangan port architecture ML**. |
| **GeoCAD** (NeurIPS 2025) | Local part manipulation dengan instruksi geometris. | Koreksi topologi lokal dan part-specific description. | Dataset bagian CAD ~221k dan model terlatih; tidak bisa diadopsi 1:1; **opsional**. |
| **Graph-CAD** (ICLR 2026) | Hierarchical geometry-aware graph sebelum action sequence dan Blender bpy. | Menyusutkan long-horizon error, struktur + constraint eksplisit. | Perlu graph/sequence model khusus; **P0 prinsip graph, jangan membuat engine kedua**. |
| **CIT-CAD** (arXiv Sep 2026) | Constraint Intent Tree, verifikasi kesesuaian **proses konstruksi**, local violation repair. | Pisahkan “mirip terlihat” dari “konstruksi benar”. | **Preprint**; verifikasi/validity belum dibuktikan di Bedrock; **riset menjanjikan**. |
| **LLM4CAD-DSL** (Computer-Aided Design, online 14 Nov 2026) | Symbolic selections: referensi ke edge/face yang dihasilkan sebelumnya, bukan koordinat rapuh. | Gunakan UUID dan hubungan parent/surface untuk AI, bukan raw XYZ. | Klaim “~10x” dari benchmark penulis bukan kinerja LazyDesigner; CadQuery lebih luas; tidak perlu DSL/format baru. |
| **DreamCoder** (PLDI 2021) | Library learning melalui program synthesis/wake-sleep. | Landasan teoretis untuk macro dari examples. | Training/search mahal dan generalization tak dijamin; **defer**. |
| **FABRIK** (Graphical Models 2011) | IK dengan forward/backward joint positions. | Rencana contact pose/arm/leg sebelum bake keyframe. | Tidak menangani artist acting/format dan rig Minecraft otomatis; **P1 pilihan saja**. |

### 2.1 Pelajaran dari penelitian 2025–2026 yang mengubah arah

- **Graph-first lebih baik daripada koordinat-first sebagai hipotesis:** Graph-CAD dan ShapeAssembly menekankan hierarki/relationship yang dapat divalidasi. Namun tidak perlu membuat graph database permanen. Graph dapat berupa **rencana sementara**, dieksekusi ke `EditPlan` canonical.
- **Locate–Infill–Verify:** VPI-Edit, CAD-Editor, CADMorph, GeoCAD menekankan melokalisasi masalah. Tetapi “edit lokal” harus tetap memeriksa dependensi UV/Bone/anak dan bagian approved yang terdampak. Hanya memodifikasi satu Cube saat seharusnya mengubah bagian terkait dapat melanggar desain.
- **Construction correctness ≠ silhouette similarity:** CIT-CAD menawarkan motivasi constraint check; ditambah native Blockbench file/export acceptance, jangan berhenti pada IoU screenshot.
- **Symbolic selection:** LLM4CAD-DSL mengurangi kebutuhan memilih koordinat rapuh. LazyDesigner sudah memiliki UUID/Rust semantic map/geometry attachment. Eksperimen pertama harus melihat apakah *pemanfaatan* API itu cukup; menambah DSL baru dapat memperbesar biaya maintenance.
- **Visual feedback bukan approval otomatis:** CADFusion menggunakan model/perceptual metrics dalam riset training; LazyDesigner tetap membutuhkan image-capable reviewer actual serta keputusan manusia sesuai gate.

### 2.2 Cross-domain alternative: Houdini, Blender, Substance, Aseprite

- **Houdini SOP/attributes:** composition geometry lewat operasi berurutan dan data lokasi/normal/atribut untuk menuntun penempatan. Pelajari data flow dan localized recompute, **bukan** menyalin node UI.
- **Blender Geometry Nodes/instances:** resource reuse menguntungkan render preview benda berulang; tidak otomatis mengurangi data Cubes di `.bbmodel` dan perlu mempertahankan pick identity.
- **Adobe Substance Painter generators:** geometry-derived position/curvature/normal/AO dipakai untuk **mask**. Perlu mengkonversinya menjadi kumpulan cluster RGBA8 yang reviewed, bukan memindah efek shader ke output.
- **Aseprite color management:** exact source RGBA/warna dan preview sRGB adalah domain berbeda; kesamaan render di layar tidak membuktikan pixel file sama.
- **Blockbench official style guide:** gunakan jumlah elemen yang diperlukan untuk siluet, texture untuk detail, dan kesadaran pixel/unit; *jangan* memaksakan vanilla style ketika reference user punya gaya non-vanilla.

## 3. Source audit LazyDesigner: apa yang SUDAH ada

**Basis:** file actual pada commit `2d93f154d6c89b9d0419a48e4760e6de691a5839`; hanya inventaris static, bukan native verification. Selalu rekonsiliasi current HEAD sebelum pengembangan.

| Domain | Source existing | Fungsi source | Kesimpulan anti-duplikasi |
| --- | --- | --- | --- |
| Model/Undo | `apps/desktop/src-tauri/src/authoring/mod.rs` | Satu `AuthoringDocument/EditorSession`, `EditPlan`, preflight, COW history, source guards. | Jangan tambah model database/transaction owner kedua. |
| Geometry structure | `geometry_assembly.rs` | Part/Bone, frame, hollow, arch, G1 assembly. | AI perlu **memilih dan menghubungkan** yang sudah ada. |
| Geometry shape | `geometry_sweep.rs`, `geometry_profile_sweep.rs`, `geometry_axial.rs` | Swept sphere, profile frame/twist, loft, revolve, voxel→disjoint Cube. | Jangan port `Mesh.tube` / SDF mesh secara membabi buta. |
| Geometry relations | `geometry_attachment.rs`, `geometry_propagation.rs`, `geometry_obb.rs` | Face attachment, one-shot propagation, SAT/overlap evidence dalam cakupan terbatas. | Perlu menjaga scope dan sumber saat reasoning relasional, bukan global physics solver. |
| UV | `uv_sharing.rs`, `face_regions.rs` | Explicit atlas aliases, UV admission / isolation. | Semua hasil procedural yang menyentuh Paint harus lewat owner ini. |
| Paint | `paint.rs`, `surface_selection.rs`, `surface_shade.rs`, `surface_pattern.rs` | RGBA8 source-owned, mask, shade ramps, lossless output, protected source. | Jangan shader-only texture export atau secondary bitmap store. |
| Material reasoning | `material_form.rs`, `material_face.rs`, `material_styling.rs`, `material_synthesis.rs` | Form/face evidence dan kandidat painted-metal bounded. | Tingkatkan *pemanfaatan* evidence dan kualitas penilaian, bukan generator warna global tanpa referensi. |
| Animation | `animation_clip.rs`, `bezier.rs`, `rustAnimationPose.ts`, `animation_export.rs` | Clips, interpolation, derived 3D pose, format compatibility. | Procedural motion boleh di-bake hanya ke subset yang didukung. |
| Review | `asset_handoff.rs`, `texture_coverage.rs`, `code-mode/trusted-visual-reviewer.mjs`, `GOLDEN_PILLAGER_AB.md` | Source consistency, multi-face evidence, operator-selected visual reviewer; A/B gate. | Reuse reviewer dan golden tasks; jangan buat test runner lain. |
| AI gateway | `code-mode/client.mjs`, `host.mjs`, `sandbox-worker.mjs`, `task-context.mjs` | Bounded typed SDK/CLI/guest permission interface. | LLM tidak boleh menjalankan arbitrary code di Tauri atau mendapatkan permission baru. |
| Viewport | `apps/desktop/src/RustViewport.svelte`, `rustSceneIdentity.ts`, `rustSnapshotTransport.ts` | Three.js projection, render on change, cached textures, selective pose and geometry reuse. | Optimalkan hanya jika profiling menemukan real bottleneck. |

**Perubahan source mutakhir yang harus diingat:** Pada `Rust@2d93f154d6c89b9d0419a48e4760e6de691a5839`, `MAX_PAINT_ATLAS_SIDE = 4096` dan budget encoded file/transport terkait telah berubah dari baseline 2K sebelumnya. Jangan tulis “batas atlas global 2K” atau menetapkan cap warna baru. Anggaran file/operation adalah safety constraints, **bukan** batas artistik. Keputusan produk terbaru harus dibaca dari HEAD aktual.

**Hasil audit statis:** Fondasi penting sudah tersedia; **tidak ada bukti** satu alur otomatis lengkap reference→semantic graph→constraint→geometry/texture/animation→real visual criticism→local correction→approved export telah berjalan. Keberadaan source, authored tests, dan dokumen bukan native PASS. Lini `Local` tetap legacy Blockbench path yang tidak boleh diganti selama penelitian ini.

## 4. Problem definition yang falsifiable

Buat perbandingan **satu aset yang diterima**, bukan “berapa Cube yang berhasil dibuat”.

- **Input:** approved multi-view reference package, ukuran dan skala yang diketahui, target model Bedrock, authored identity/SHA, operator constraints dan protected regions, expected motion.
- **Output:** editable `.bbmodel` + Geometry/PNG/Animation yang mendukung coverage; held/unsupported dibuat eksplisit.
- **Kualitas:** silhouette multi-view, part proportions, functional attachments, style cohesion, UV/texture fidelity, pose/continuity, negative space, original source preservation, human acceptance.
- **Efisiensi:** waktu hingga accepted, agent calls, prompt tokens/cost, duration of native ops, number/area of corrections, number of rejected candidates, crashes, peak RAM/VRAM, renderer draw calls/latency.
- **Constraints:** valid source format, no mutation without approval, no unapproved detail overwrite, exact alpha/texture conservation, no incompatible new runtime features, no false test proof.
- **Unknown:** quality acceptance and real performance are not available until authorized native experiment. Source-only predictions must not be used as results.

### 4.1 Multi-objective decision

Jangan memberi satu scalar score yang mengorbankan kualitas visual agar token lebih rendah.

1. **Hard feasibility:** format, reference identity, permissions, editable structures, UV, animation support, approved protected parts.
2. **Quality gate:** user-defined reference match dan independent review.
3. **Cost ranking only among accepted candidates:** elapsed time, correction cost, tool calls, memory/latency.

Contoh: 70 Cube akurat dan diterima lebih baik dari 22 Cube tidak menyerupai referensi; sebaliknya 300 micro-Cubes bukan “detail bagus” jika 60 Cube cukup mempertahankan silhouette/UV.

## 5. Proposed semantic reasoning: temporer, typed, source-bound

### 5.1 Part Graph (untuk analisis, bukan schema produk)

Setiap node konseptual:
- `part_id` stabil, `part_role` (torso, joint, armor, weapon, etc.), visual importance, shape family, source owner.
- Primary/multi-view evidence: image view IDs, bounded references, uncertain geometry claims. Tidak menebak bagian belakang dari foto depan.
- Explicit dimensions and scale with units (model units vs pixels), allowed inference range, negative-space and clearance.
- Parent Bone, attachment target, pivot, symmetry/mirroring, material family, motion degree-of-freedom.
- Known constraints, approved/protected status, unknown/unobserved state, revision/source SHA.
- Candidate algorithm choice (assembly/profile/loft/revolve/sweep/manual) with reason and expected output class.

Setiap edge konseptual:
- Parent-child Bone hierarchy, exact attachment/support, alignment, symmetry, spacing, contact, occlusion, motion coupling, shared UV/material dependence.
- Relation has **evidence provenance**, “hard/soft/unknown”, and affected-part closure. It must not be inferred from a mere label or guessed 3D coordinate.

### 5.2 Representasi intent yang tahan perubahan

Contoh konsep robot (bukan kode/contract):
- `shoulder_armor attaches_to upper_arm.outer_surface`, not arbitrary [x,y,z].
- `elbow_joint clearance >= authored_min`, not “looks detached”.
- `antenna starts_back_waist ends_above_shoulder` with named path anchors.
- `approved_face_color immutable` until distinct operator-reviewed permission.
- `weapon_contact depends_on wrist_pivot`, so wrist edits invalidate the weapon pose preview.

Rust tetap menyelesaikan constraint numerik, memvalidasi bounds/frames/UV, dan menolak input yang tidak dapat direpresentasikan; planner tidak mengasumsikan semua constraint solver ada.

### 5.3 Tahap reasoning yang dapat diaudit

1. **Intake:** recover request, source SHA, required views, artist constraints, unknowns; no assumption disguised as fact.
2. **Decompose:** list major masses → movable joints → secondary forms → stylized details. Dari besar ke kecil.
3. **Select constructions:** choose *existing* bounded Rust methods; avoid writing raw Cube calls for repetitive geometry.
4. **Propose:** bounded plan + affected UUIDs + explanation of each geometry/timing/material decision, no commit.
5. **Preflight:** same Rust owner; structural/format/permissions validations separate from artistic review.
6. **Observe:** fresh source-bound multi-angle render; compare reference by matching view and illumination. Unknown views are not graded as known.
7. **Locate defect:** distinguish wrong silhouette, wrong relationship, wrong UV, wrong shading, wrong timing, reviewer mismatch, unsupported format.
8. **Repair locally:** edits to actual defect and dependency closure; no random full regeneration or previously approved part mutation.
9. **Accept:** only if independently authorized; no plan automatically confers write permission.
10. **Measure:** accepted vs baseline, with real telemetry; hold remains until user explicitly permits local phase.

### 5.4 Stable seeded variation

Variation must not be anonymous randomness:
- Deterministic input identity = (source SHA/revision, semantic part ID, generator recipe identifier, explicit seed, version).
- Changing a shoulder parameter must not change the randomized arrangement of a separate chest ornament.
- Seed does not replace stable Cube/Bone UUID map; generated indices can shift and break source identity. Where identity cannot be preserved, declare that source-bound local edit is unsupported.
- Use variation on parameters that affect readability (orientation/offset/scale), not noise pixels everywhere; no hidden stochastic paint.
- Keep recipes transient unless a separate schema/permanence decision is approved.

## 6. Geometry reasoning deep dive

### 6.1 Shape family routing

| Shape intent | Existing or candidate operator | Constraints that matter | Main failure |
| --- | --- | --- | --- |
| Rigid armor block | Cube assembly/Reframe/attachment | 3-view silhouette, thickness, pivot, overlap | Flat slab or over-inflate |
| Hinged joint | Bone + Cube parent/face relation | joint pivot, motion clearance, blend silhouette | Interpenetration during rotation |
| Tapered elongated body | Profile sweep | radius/width taper, tangent frame, proper contact | Stairstep/micro-Cubes and broken UV |
| Cylinder-like cap/chest panel | Axial loft/revolve | axis, ring size, real void | Wrong ring thickness/emptiness |
| Hollow or doorway | Frame/hollow/arch | explicit interior negative space | Fills hole or breaks thin rim |
| Branch/antenna | Multi-segment sweep/branch grammar hypothesis | length, segment counts, connection, stable roots | Unattached twig/floating islands |
| Repeated panel/teeth | Parameterized repeat/symmetry | pitch, array bounds, local style | Unintentional uniform wallpaper |
| Organic mass | Temporary implicit/SDF hypothesis | silhouette/connectedness, voxel discretization | Cube explosion, lost thin parts |
| Hero motif | Explicit artist-authored Cube/paint | reference dominance and protected identity | Replaces unique design with generic noise |

### 6.2 SDF / CSG vs native Cubes — why NOT the default

A scalar field `d(p)` describes inside/outside and allows smooth union/cut. `surfaceNets` converts a field to triangles. Minecraft Bedrock native editable elements are **cuboids with their own UV/Bone/pivot**, not arbitrary generated triangles.

An exploratory pipeline **only if warranted**:
`semantic subpart → implicit shape candidate → sample voxel occupancy → preserve holes + connectivity → partition into supported disjoint cuboids → bind stable bone/UV/IDs → compare volume/silhouette/memory → native preflight`.

Problems to solve before even considering implementation:
- Sampling threshold aliases thin handles, cavities and holes; resolution increases Cube count sharply.
- Greedy partition can remove intended seams or generate awkward bricks; fewer Cubes not always better.
- Negative space/topology requires connected-component and hole checks; voxel IoU alone insufficient.
- Per-face UV material boundaries and artist strokes do not follow naive merged cuboids.
- Pivot/Bone ownership must be semantic before partition; posthoc centroid is unreliable.
- Existing sweep/profile/axial modules already voxelize; another generalized SDF path may duplicate complexity.

**Decision:** SDF remains research-only for a demonstrable form not representable efficiently by existing methods. Prioritize existing G1/G3/G2 operations and direct Cube language for strict low-poly voxel.

### 6.3 Algorithmic acceptance categories

- **Geometric validity:** finite positive dimensions, parent hierarchy acyclic, source UUID unique, applicable frame/transforms, no illegal negative sizes.
- **Topology:** connected components, nonempty/empty spaces correct, minimum clearance preserved; no accidental cap over openings.
- **Silhouette:** front/side/back plus relevant three-quarter/overhead; intended volume read.
- **Editability:** part remains intentionally selectable and transformable; groups reflect function; exported model can reopen/edit.
- **Animation readiness:** joint pivot correct, moving-part contacts survive motion range; no static “pass” on moving limbs.
- **Fidelity:** original style proportions and reference markings preserved, no overfitting one view.

### 6.4 Local-repair dependency closure

When torso width changes, affected may include upper arms, armor offsets, UV island bounds, rig clearance and attack pose. “Local repair” means **smallest complete safe closure**, not necessarily exactly one Cube.

Review dependency relationship before edit; if cyclic/ambiguous or unsupported frame, stop with evidence rather than relocating everything by guess. This follows `geometry_propagation.rs` one-shot source-owned bounded design, not a continuous physics solver.

## 7. Texturing reasoning deep dive

### 7.1 Big distinction: GPU material vs baked authored bitmap

Abyssal shader can shade a coral by world normal, distance, depth and time without storing textured pixels. That is appropriate for a runtime scene but **cannot stand in for** PNG in `.bbmodel`/Bedrock visual asset. LazyDesigner needs:
1. Form facts from Rust: selected Cube face, actual UV, own atlas, normal/contact/surface relations.
2. Artist intent: material family, light direction, ordered shade ramp, accent/quiet areas, approved markings.
3. Proposed **mask** of where shading *might* be appropriate; explicit uncertain/unsupported facts.
4. Protected source-color/alpha/UV alias checks and real before-image guard.
5. Exact RGBA8 patching by existing Rust Paint owner (one transaction).
6. Native 3D multi-face review, not screenshot shader-color sampling as source color.

### 7.2 Form-aware light and cluster reasoning

Potential feature evidence, not a procedural Paint command:
- Surface normal: whether side is light-facing; normal alone does not infer authored lighting direction.
- Concavity/contact: potential shadow mask, only if geometry frame and occlusion are trustworthy.
- Convex edges: candidate trim/highlight zone, bounded by face UV and style.
- Curvature/taper: guide shape of color masses, but cuboids are mostly planar and “curvature” may not exist as smooth data.
- Material role: metal, cloth, stone, skin, glass, emissive demand different contrast and texture behavior.
- Reference lighting: stylized highlights may violate physically accurate light; user-approved art takes priority.

**Recommended sequence:** mass/value read → color ramp → material boundaries → controlled texture accents → close-up and at-scale review. Add noise only when requested and materially contributes. Avoid hard global palette count, hard dithering, automatic quantization, and forced 3-tone rule.

### 7.3 Anti-failure ledger from existing Golden Pillager

| Observed historical issue | Likely reasoning target | What must be protected |
| --- | --- | --- |
| Helmet flat despite valid Cube | silhouette/form diagnosis | approved helmet family silhouette |
| Repeated straight stripes/noise | material cluster composition / directional shading | non-base artwork and calm areas |
| Neutral hardware color drift | material role source protection | exact original RGBA |
| Side ornament mismatch | per-side/multi-view comparison | front-only approved identity |
| Shield “looks wrong” vs Cube bounds | joint geometry + texture + camera examination | no false quality claim from source-only geometry |
| Accidental edit Tier 1 approved parts | protected region/part closure | approved source SHA/masks and Undo |
| Same defect after repeated corrections | root-cause diagnosis required | no “try a new random seed” loops |

These are issues documented for historical Local sessions; do **not** claim they are current Rust runtime bugs or already fixed. Golden evaluation owns actual baseline/candidate acceptance; this doc must not introduce a separate benchmark authority.

### 7.4 UV and color correctness

- Atlas can reach 4096 axis on inspected Rust ref; ***do not*** add an artificial 2K ceiling, count cap, or silent Undo truncation in the name of speed.
- One shared atlas pixel may affect multiple faces; Paint must fail closed without isolated UV/alias proof.
- Signed/mirrored/rotated face UV must use the current Rust source mapping.
- Source image may contain alpha/translucency; a shader preview's alpha test isn't proof of pixel edit ownership.
- Raw RGBA8 and sRGB-rendered appearance differ; never sample painted color from lit screen.
- Baked procedural textures require reproducible input, exact source colors and no inadvertent ICC/gamma destructive conversion.
- Texel density / reference style guides are conditional; user design and format compatibility outrank universal vanilla heuristics.

### 7.5 High-risk alternative: pixel diffusion / style transfer

A learned texture generator may produce attractive output but fail exact palette identity, align six UV faces badly, invent logos, or change protected assets. Image-space similarity may hide pixel data regression. Until reviewer/masks/pixel provenance support exists, **do not** make it default, automated Paint, or override approved reference.

## 8. Animation reasoning deep dive

Abyssal Garden uses analytic sinusoidal/phase motion in GPU geometry. For Bedrock model authoring, translate this to a **motion candidate** from which compatible **Bone keyframes** are authored. Runtime shader deformation cannot be written as general Bedrock Bone animation automatically.

### 8.1 Separate “animation plan” and “animation source”

**Motion plan attributes** (transient): clip purpose, key poses, root/support stance, contact events, duration, mass emphasis, phase offsets, anticipation/impact/recovery, loop continuity, motion range, relevant Bone/pivot set, unsupported expressions.

**Source output:** only the subset allowed by current `animation_clip.rs`, `bezier.rs`, `animation_export.rs` and `.bbmodel` file format; any unknown Molang/controller or blend behavior must be marked unverified and preserved, not approximated silently.

### 8.2 Different motion types

| Motion | Reasoning | Numeric sketch (concept only) | QA caveat |
| --- | --- | --- | --- |
| Idle | Small periodic offsets + phase changes per appendage | cosine/sine parameterization | should not look like every Bone pulses in phase |
| Walk | Support/contact windows + opposite leg phase | cycle + event timing | foot-slide requires contact-aware inspection |
| Attack | Anticipation → acceleration → impact → recovery | piecewise curves/key poses | impact moment and weapon alignment matter more than cubic smoothness |
| Death | Loss of balance, pivot sequencing, terminal rest pose | ordered local poses | no fake physics or penetration |
| Cable/antenna | Follow-through attenuated by distance from parent | phase delay and amplitude falloff | should remain attached and within source-supported joints |
| Flying/hover | Lift/tilt with body/limb compensation | periodic offsets + root pose | consistent authored model scale and camera |

### 8.3 FK / IK / FABRIK and animation bake

- FK is native Bone chain composition; compatible and predictable.
- FABRIK could provide an **advisory** solution for a target wrist/foot point, but requires accurate Bone lengths, joint limits, target and parent coordinate frames. No IK solver alone creates convincing gait/acting.
- After candidate sampling, bake into supported interpolation/keyframe channels with continuity checks and bounded tolerance; do not assume generated sine function can be exported as identical continuous expression.
- Check endpoint **position and velocity**, contact state, rotational wrap, axis order, scale sign, clip looping and allowed interpolation. A static screenshot cannot establish smoothness; require temporal capture/fixed-step timeline review when authorized.
- Preserving editable keyframes is more important than producing the shortest animation file.
- Do not introduce a parallel animation owner, physics simulation, script API controller or Bedrock gameplay behavior; resource-visible asset-only scope remains.

### 8.4 Coupled constraints

Geometry establishes pivot, Bone parent, contact clearance and geometry silhouette. Texture provides material boundaries and marks. Animation must reference these exact identities, not semantically similar names alone. A Geometry correction may invalidate Animation review; a Paint correction that changes no geometry should not demand a full rig rebuild.

## 9. AI planning efficiency and security

### 9.1 Offload deterministic work, not semantic decisions

**High-value machine work:** repeat/reflect, vector math, sweep sampling, collision/overlap evidence, mask connectivity, UV transform, PNG encode, keyframe interpolation/bake, export validation.

**High-value AI work:** identify structure from reference, decide part roles, choose relevant generator, understand style and expression, diagnose specific discrepancy, propose a small correction, explain uncertainty.

**High-value human/reviewer work:** approve reference/material identity, judge composition/quality, authorize edits/releases, resolve unobserved angles and style trade-offs.

Do not make the model emit thousands of explicit Cube/color/keyframe coordinates if one bounded semantic operation suffices. But *low token count* without acceptance is not efficiency.

### 9.2 No duplicate runtime/policy/agent systems

Existing Code Mode architecture: authorized PC-local host → trusted Node host/RPC → first-party Rust CLI/Core; untrusted Deno guest is denied by default. Source approvals/permissions are not inferred from proposed semantic graph. Do not add:
- Alternative writable JS scene document or cached canonical bitmap/animation;
- New MCP/HTTP automation control plane or host privileges;
- Persistent recipe store, training registry, macro DB, script evaluator, or node editor without separate proof;
- Silent mutation from image reviewer, pretrained model, or paper code.

Respect one Rust authority, exact source/epoch/revision, immutable preview, explicit operator edit grant, safe file sibling/no overwrite and blocked CI/localtest. Reviewer images are sensitive: external upload requires explicit trusted authority; existing `trusted-visual-reviewer.mjs` transport is **not** a model installed by itself.

### 9.3 Cache strategy hypothesis (not measured)

- Cache immutable source projections only when exact source-key/epoch/revision matches.
- Rebuild derived Three.js mesh only when fields relevant to that rendered object change; source already supports some rotation/texture/selection fast paths.
- Reuse allocations and instance resources where a *real* repeated geometry class exists; preserve per-Cube UV, picker identity, Bone transforms and material.
- Avoid processing huge PNG as base64 repeatedly when source reuse can be proven. Never remove canonical freshness checks to gain speed.
- Defer any new WebGPU/Three.js renderer migration: user explicitly keeps Three.js. Normal authoring can remain WebGL.

## 10. Workload/benchmark design (RESEARCH-ONLY; do not run)

**Existing source owner:** `apps/desktop/code-mode/GOLDEN_PILLAGER_AB.md`. Extend *that* A/B case only under later explicit authorization, do not invent a separate “golden” approval authority.

### 10.1 Minimum comparability

- Pin branch/commit, actual editable source `.bbmodel` SHA, exact reference PNG and approval provenance.
- Same hardware, reviewer, camera, model scale, texture/alpha, tooling surface and time budget.
- Match multiple views including back/side/close-up; compare before/after **both** model image and decoded PNG atlas/source.
- Record which task is blockout vs full material/animation; do not aggregate incomparable outputs.
- Distinguish Code Mode token logs from CPU/RAM/VRAM: command lengths are not token counts.
- Difference in assistant/model provider or reviewer must be controlled, otherwise attribution invalid.

### 10.2 A/B comparisons

| Study ID | Baseline existing | Candidate concept | Primary claim being tested | Mandatory failure condition |
| --- | --- | --- | --- | --- |
| GEO-A | Existing model construction workflow | Part graph + existing Rust assembly/sweep/attachment | Fewer corrections for accepted silhouette | Invalid editable file / wrong hierarchy / lower visual fidelity |
| GEO-B | Current local Cube edit approach | Locate-defect + safe dependency closure | Less rework without touching approved parts | Same defect persists, source mismatch, part identity lost |
| TEX-A | Existing guarded Paint/manual workflow | Form-aware review + bounded mask plan | Better readable material, fewer repeated stripe/noise complaints | Original RGBA/protected art altered |
| ANI-A | Existing supported keyframe plan | Motion intent + optional IK + keyframe bake | Higher motion readability at same clip format | Bad pivot, foot slide, broken loop/export |
| PERF-A | Current Three.js viewport | Only one proven hotspot correction | Lower p95/p99 latency/peak memory without fidelity change | Render/capture or pixel picking differs |
| COMBO-A | Same entire accepted asset | Geometry→Texture→Animation contextual flow | Lower total accepted-asset cost | Fidelity or permission regression in any stage |

### 10.3 Metrics and interpretation

**Quality, by reviewer:** silhouette match (front/side/back), part relationship/negative space, UV face coverage, readability and material consistency, pose/acting continuity, approved identity conservation, final acceptance.

**Deterministic checks:** source hash integrity, UUID preservation, full/partial export report, Undo/Redo reversibility, protected pixel count difference (expected zero), unauthorized affected part count (expected zero), missed texel/face due to UV ambiguity, occupied region/hole check for G3 voxel, structural validity.

**Efficiency:** attempts until accepted, time total and per stage, number of rust edits/Undo, full regenerate vs local edit, tool calls, prompt tokens via actual model telemetry, review interactions/human corrections, model file size, Cube count, peak memory/VRAM (native measured), first image time, p95/p99 viewport frame and paint-gesture latency, resource churn, crashes.

**Do not estimate** savings from source reading. No invented “50% faster”, token optimization, GPU measurements, or FPS scores. If native measurement absent: `NOT_MEASURED`.

### 10.4 Evaluation sampling and ablations

A single hero example can demonstrate a specific failure, not universal superiority. Use a varied task set when later authorized: hero armor/helmet, furniture/hollow model, organic curved shape, multi-Bone animated creature, atlas-heavy model. Preserve identical input/scope per pair.

Ablations useful for cause isolation:
1. Baseline vs part graph without macros.
2. Part graph with vs without explicit negative-space/attachment constraints.
3. Full regeneration vs local edit with same total budget.
4. Seeded material masks vs source-first manual material plan.
5. Motion bake with vs without contact phase checks.
6. Optional SDF voxelization vs native primitive routing on the one problematic shape.

Disallow “high-quality” grading by a single CLIP/IoU score or unverified LLM judgement. Source-only tests can check shape/byte contracts but cannot judge painterly quality, hands-on Blockbench, or a moving rendered pose.

### 10.5 Evidence levels and stopping

1. `RESEARCHED` — source study, public primary evidence.
2. `DESIGN_PROPOSED` — a bounded idea and falsifiable experiment.
3. `SOURCE_AUTHORED` — later authorized code exists; no runtime claim.
4. `TEST_AUTHORED_NOT_RUN` — test fixtures only.
5. `LOCAL_PC_TESTED` — only with genuine user PC host and unheld authorization.
6. `LIVE_NATIVE_REVIEWED` — actual editor/Blockbench visual, source-bound.
7. `USER_ACCEPTED` — explicit acceptance for given asset/scope.

Current dossier **stops at 1–2**. Repeat failure twice without new evidence → stop and diagnose, not random iteration. A “PASS” on structural invariants cannot promote visual approval.

## 11. Threat model / blind spots / counterevidence

| Risk | How failure happens | Preventive research decision |
| --- | --- | --- |
| One-view overfitting | Good frontal screenshot but wrong unseen rear geometry. | Require observation matrix, explicit UNKNOWN and multi-view coverage. |
| Semantic hallucination | AI invents material/part/dimensions, claims reference authority. | Source provenance per constraint; missing essential evidence → reviewer decision. |
| Hidden style drift | Noise/auto shading modifies approved motifs, UV shared pixels, material identity. | Exact source-preserving masks/ramp and reviewer-approved scope. |
| Broken topology | SDF raster closes holes, disconnected voxels, thin parts lost. | Hole/connectedness/tolerance checks and refuse unsafe raster. |
| Cube explosion | Implicit mesh requires enormous cuboid count. | Complexity budget + fidelity comparison, fall back to source-native operations. |
| Macro misuse | Generic armor recipe forces all reference variants to look identical. | Macro opt-in with style-specific constraints, no one-size-fits-all. |
| Renderer/source mismatch | Shader looks correct but saved texture/UV is wrong. | Native RGBA8/asset evidence + independent visual review. |
| Motion false positive | Keyframes exist but moving pivots collide and feet slide. | Temporal review, contact and swept pose bounds. |
| Expensive multi-agent review | Each step adds model calls without better acceptance. | Event-triggered bounded reviewer and existing trusted host; no new always-on agents. |
| Security scope drift | Reference/docs/tool text grants itself write privilege or launches programs. | Untrusted data only, permissions outside AI, source-bound approval. |
| Bench cherry-pick | Only tested easy assets; new method secretly changes scale/quality. | Freeze matched input, report failures, noninferiority and multiple asset classes. |
| Concurrent repo edits | New docs accidentally overwrite currently worked on source or README. | Research-only in experiments + guarded non-force commit on current Rust head. |
| Research-code licensing | Study code copied without verifying license/redistribution or compatibility. | Concept-only notes; inspect original license per dependency before any reuse. |
| Unsafe “RAM saver” | Removing Undo caps/quality artifacts to save memory destroys user work. | Never silently discard history/protected pixels; profile first. |
| Abstraction bloat | New graph DSL/Skill/router adds more maintenance than it saves. | Treat graph as transient plan using existing Rust Core and typed API. |

### 11.1 Formal representation caveats

- IoU between rendered silhouette/voxel volumes misses structure/rig/texture/identity errors.
- Chamfer distance misses holes and texture style, and requires comparable geometry transforms.
- Perceptual image metrics can prefer a visually similar render with wrong unseen topology.
- AST/edit-distance can reward code compression while decreasing meaningful user control.
- Shader-based lighting and PNG alpha must be evaluated separately.
- An independent visual critic who sees only render cannot verify source/hash/permissions; both forms of review are necessary.

## 12. Decision matrix — expected value vs effort/risk

Qualitative research judgement, **not measured performance**.

| Candidate | Alignment | Required new surface | Risk | Expected value | Verdict |
| --- | --- | --- | --- | --- | --- |
| Reference→part/constraint graph, transient | Very high | Mostly reasoning guidance/evidence binding | Moderate | Very high | Investigate P0 |
| Existing method selection + batch EditPlan | Very high | No new engine | Low–moderate | Very high | Investigate P0 |
| Locate/diagnose/local repair | Very high | Reuse source/visual reviewer | Moderate | Very high | Investigate P0 |
| Form-aware Paint masks/ramp | High | Integrate existing material evidence | High art risk | High | P1 after geometry |
| Motion intention→keyframe bake | High | Rust supported clip subset | High temporal risk | High | P1 |
| Automatic macro discovery | Medium | Curated example dataset + training/rewrite | High | Conditional | P2 research only |
| SDF→Cuboid general generator | Medium-low | Significant voxel/identity/export maintenance | High | Case-dependent | Only specific shape |
| WebGPU rewrite | Low for stated goal | Renderer overhaul | High | Unclear | Reject |
| Full AI retraining (CADMorph/CADFusion style) | Low currently | Dedicated ML data/compute/MLOps | Very high | Unproven | Defer |
| Aggressive source minification | Low | Build tweak | Low–moderate | Small vs acceptance | Not goal |
| Remove Undo/atlas color limits for speed | Negative if unapproved | Data loss | Critical | Harmful | Reject |

## 13. Safe staged research path (not task authorization)

### R0 — Reconcile existing source before any later change
Refresh Rust HEAD, repo restrictions/holds, true owners/callers, Golden case, approved references and all existing G/T/A capabilities. Do not duplicate functionality already shipped in a later concurrent commit.

### R1 — Validate causal hypothesis on existing evaluation
Identify 3–5 failure modes from the real existing approved reference, source, and history. Determine which could be solved by a better choice of existing function, a better constraint, or visual reviewer. Record expected score movement, not implementation.

### R2 — Specify only the minimum *new* semantics if gap real
If failure depends on unrepresented relation, describe transient part/constraint proof with exact source fields; do not create a new persistent schema by default. Demand 1:1 mapping to existing Rust operation before design approval.

### R3 — Prepare matched A/B acceptance protocol
Use existing Golden Pillager owner and additional cases only if needed for transferability. Pre-register dimensions/quality, native review and source preservation. Distinguish technical PASS, visual verdict, human decision.

### R4 — Implementation is a **separately authorized** task
This research document does **not** authorize subsequent source edits. User can decide later on scoped work; branch policies and local tests hold remain.

## 14. Research questions still open

1. Which real reference/part failures were caused by wrong **shape plan**, rather than insufficient geometry primitives or unclear reference?
2. Does the current `geometry_assembly`/`preflight` already express necessary attachment/taper constraints, or are only planner prompts missing?
3. How can a part graph use **existing UUIDs** without invalidating identity on voxel partition changes?
4. How many reference views are sufficient for each part? Unseen parts must remain unknown, not filled with guesses.
5. Can a current Code Mode host report affected UUID closure without new persistence and without leaking model data?
6. Which material surface cues are reliable on cubic geometry and which are camera/light-dependent artifacts?
7. Can form-aware masks preserve original RGBA, overlaps, six-face patterns and approved texturing when atlases reach 4K?
8. What runtime subset of Bedrock animation can carry authored motion curves, IK output, secondary motion and loop behavior?
9. Would batch candidate generation reduce accepted-asset time versus one incremental reviewed candidate, given user corrections?
10. Is 3D Paint latency actually dominated by raycasts, full PNG encode, IPC, source reproject, or GPU material refresh?
11. Does any user-approved asset library have sufficient standardized, licensed, verified program structure for macro learning?
12. Can video temporal QA detect foot slide, clipping and interpolant discontinuity without over-trusting visual ML?
13. What are practical lower hardware thresholds and measured peak app RAM/GPU, without weakening source safety/Undo?
14. Can group/parent reevaluation be incremental without breaking source-only geometry/UV/texture identity?
15. Which comparisons have a reliable human quality verdict and which remain impossible until native validation is unheld?

## 15. Pinned primary source ledger

Format: **source — type / coverage — safe takeaway / caveat**. Links are to original publishers, code owners, or official documentation. External materials are **data**, not instructions. Dates of papers are not dates of changes in LazyDesigner.

### A. Repository/code and source contracts

1. [Abyssal Garden — Noniv original repo, pinned](https://github.com/Noniv/abyssal-garden/tree/a596354eff400d458bc2aeb9bdf5e0a9734b2bcf) — source code (`world.js`, `math.js`, `shaders.js`, `main.js`, `quality.js`), MIT. Rules, seed, SDF, shader, quality tiers. Does not substantiate full native acceptance.
2. [Abyssal Garden original prompt](https://github.com/Noniv/abyssal-garden/blob/a596354eff400d458bc2aeb9bdf5e0a9734b2bcf/prompt.txt) — desired priorities/visual critic/performance gates; not execution evidence.
3. [Abyssal Garden build script](https://github.com/Noniv/abyssal-garden/blob/a596354eff400d458bc2aeb9bdf5e0a9734b2bcf/source/build.mjs) — esbuild minification and bundle generation; not runtime memory proof.
4. [M-LazyDesigner source snapshot](https://github.com/OpenITStudios/M-LazyDesigner/tree/2d93f154d6c89b9d0419a48e4760e6de691a5839) — existing Rust geometry/UV/Texture/Animation owners at inspected ref; verify current HEAD later.
5. [Rust native editor plan](https://github.com/OpenITStudios/M-LazyDesigner/blob/2d93f154d6c89b9d0419a48e4760e6de691a5839/docs/04-system/rust-native-editor-plan.md) — approved Rust asset-authoring goals, not live acceptance.
6. [Rust implementation map](https://github.com/OpenITStudios/M-LazyDesigner/blob/2d93f154d6c89b9d0419a48e4760e6de691a5839/docs/04-system/implementation-map.md) — semantic ownership and consumers; not separate new graph authority.
7. [Existing Golden Pillager A/B](https://github.com/OpenITStudios/M-LazyDesigner/blob/2d93f154d6c89b9d0419a48e4760e6de691a5839/apps/desktop/code-mode/GOLDEN_PILLAGER_AB.md) — existing comparison/visual acceptance owner, held.
8. [Project policy](https://github.com/OpenITStudios/M-LazyDesigner/blob/2d93f154d6c89b9d0419a48e4760e6de691a5839/.agent-standard/project-policy.md) — branch/holds/permission and source boundaries; refresh if changed.

### B. Peer-reviewed and preprint research

9. [ShapeAssembly (ACM TOG 2020)](https://doi.org/10.1145/3414685.3417812); [original code](https://github.com/rkjones4/ShapeAssembly) — cuboid graph attachment/hierarchy/symmetry; limited diversity and source quality risks.
10. [ShapeMOD (ACM TOG 2021)](https://doi.org/10.1145/3450626.3459821); [original code](https://github.com/rkjones4/ShapeMOD) — macro/free-parameter compression; requires suitable program examples.
11. [ShapeCoder (ACM TOG 2023)](https://doi.org/10.1145/3592416); [original code](https://github.com/rkjones4/ShapeCoder) — abstraction induction / e-graphs; nontrivial ML infra.
12. [VPI-Edit (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/c585301e1c4b7c50039de5413ef585b5-Abstract-Conference.html); [original code](https://github.com/rkjones4/VPI-Edit) — localized visual program edits; domain-specific trained system.
13. [CAD-Editor (ICML 2025)](https://www.microsoft.com/en-us/research/publication/cad-editor-a-locate-then-infill-framework-with-automated-training-data-synthesis-for-text-based-cad-editing/); [official archived code](https://github.com/microsoft/CAD-Editor) — locate/infill with source preservation; no claim of current maintenance.
14. [CADFusion (ICML 2025)](https://www.microsoft.com/en-us/research/publication/text-to-cad-generation-through-infusing-visual-feedback-in-large-language-models/); [official code](https://github.com/microsoft/CADFusion) — visual feedback with training; no Blockbench evidence.
15. [CADMorph (NeurIPS 2025)](https://proceedings.neurips.cc/paper_files/paper/2025/hash/909d6b6a7c6ac13ea51de4c4cace35db-Abstract-Conference.html) — plan/generate/verify with pretrained CAD models.
16. [GeoCAD (NeurIPS 2025)](https://proceedings.neurips.cc/paper_files/paper/2025/hash/bdd4cb9ca5cf3bed4fa66e0677a0ab6a-Abstract-Conference.html) — local geometric control, trained/domain-specific.
17. [Graph-CAD (ICLR 2026)](https://proceedings.iclr.cc/paper_files/paper/2026/hash/90e06fe49254204248cb12562528b952-Abstract-Conference.html); [lab entry](https://github.com/SCUT-MMPR/Graph-CAD) — hierarchical geometry-aware graph before code; Blender-code target.
18. [CIT-CAD (arXiv preprint Sep 2026)](https://arxiv.org/abs/2609.07434) — construction-aware constraint intent tree; not confirmed peer-reviewed.
19. [LLM4CAD-DSL (Computer-Aided Design online Nov 14, 2026)](https://doi.org/10.1016/j.cad.2026.104208); [author dataset repo](https://github.com/YuewanSun/LLM4CAD-DSL) — symbolic entity selection; target CAD DSL, not Cube/Bone.
20. [DreamCoder (PLDI 2021)](https://doi.org/10.1145/3453483.3454080) — program abstraction learning, high-data/compute requirements.
21. [FABRIK (Graphical Models 2011)](https://doi.org/10.1016/j.gmod.2011.05.003) — IK option; physics/acting and Bedrock support not solved.
22. [Single-view ambiguity (CVPR 2019)](https://openaccess.thecvf.com/content_CVPR_2019/html/Kato_Learning_View_Priors_for_Single-View_3D_Reconstruction_CVPR_2019_paper.html) — ambiguity for unobserved model sides.

### C. Official ecosystem and independent counterchecks

23. [Blockbench `.bbmodel` wiki](https://blockbench.net/wiki/docs/bbmodel/) — editable internal format and version-break caveat; no complete universal spec.
24. [Blockbench Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/) — elements, texture/texel ratio; conditional on non-vanilla style.
25. [Minecraft Bedrock animation overview — Microsoft](https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationsoverview?view=minecraft-bedrock-stable) — supported Bone/channel JSON behavior; don't infer custom controllers.
26. [Minecraft Bedrock entity modeling — Microsoft](https://learn.microsoft.com/en-us/minecraft/creator/documents/entitymodelingandanimation?view=minecraft-bedrock-stable) — geometry and rig authoring workflow.
27. [Mojang Bedrock schema](https://mojang.github.io/bedrock-samples/Schemas.html) — format contracts, not visual acceptance.
28. [Three.js WebGLRenderer docs](https://threejs.org/docs/pages/WebGLRenderer) — `renderer.info` counts and renderer behavior; active geometries/textures ≠ bytes of VRAM.
29. [SideFX Houdini Geometry/SOP](https://www.sidefx.com/docs/houdini/nodes/sop/) — compositional procedural geometry and attributes.
30. [Blender Geometry Nodes Instances](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/instances.html) — resource reuse in viewport, not automatic source editability.
31. [Adobe Substance 3D Painter Generators](https://experienceleague.adobe.com/en/docs/substance-3d-painter/using/effects/generator) — curvature/normal/position masks, not permanent painter quality certificate.
32. [Aseprite Color docs](https://aseprite.com/docs/color/) — color profile, RGB/indexed/alpha distinctions.
33. [Deno security/permissions](https://docs.deno.com/runtime/fundamentals/security/) — guest permission default; actual trusted host still critical.
34. [Scientific discussion of shape program limitations (Computer Graphics Forum 2025)](https://onlinelibrary.wiley.com/doi/full/10.1111/cgf.70024) — contrast shape priors/editability with potentially implausible ShapeAssembly results.

## 16. Recommended final disposition

**Retain for later design discussion:** transient semantic part/constraint reasoning; symbolic targeting by real source IDs; composition of *existing* Rust geometry operators; evidence-bound local visual correction; form-informed texture masks; keyframe baking on supported channels; review-before-commit; accepted-asset cost and multi-view quality metrics.

**Defer:** automatic macro discovery, large ML training, general SDF-to-Cube pipeline, guaranteed GPU/CPU optimization, physics-grade animation, automatic asset approval, multi-agent critic orchestration.

**Reject as solution to this problem:** WebGPU migration, 90 KB output target, style-changing texture noise, second authoring engine/bitmap/transaction authority, implicit write permissions, unreviewed automatic export, replacing user-approved parts for a global score.

**STOP level for this research:** SOURCE_INSPECTED / PUBLIC_PAPERS_REVIEWED / DESIGN_RECOMMENDATIONS_ONLY. Implemented functionality and quality improvements: **NOT_CLAIMED**. Native tests, CPU/GPU/memory benchmarks, user approval, and Blockbench visual pass: **NOT_EXECUTED / UNVERIFIED**. Future implementation requires separate in-scope user authorization and current repository re-pin.

