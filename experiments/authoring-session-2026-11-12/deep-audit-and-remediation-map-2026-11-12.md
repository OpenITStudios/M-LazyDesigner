# M-LazyDesigner — Audit mendalam local test dan peta perbaikan
**Tanggal audit:** 12 November 2026  
**Repository/ref sumber:** OpenITStudios/M-LazyDesigner, `Local`, `6b5a7f3d63b7fcb891f871fb8f3e807cd94b6316`  
**Keputusan:** INSPECT + DOCUMENT. Tidak ada source/runtime/model mutation dalam audit ini.  
**Status bukti:** SOURCE_REVIEWED + HISTORICAL_TRANSCRIPT_ANALYZED; QUALITY_UNVERIFIED untuk bukti visual baru; REGRESSION_NOT_EXECUTED.

## 1. Scope, provenance, dan batas klaim

Dataset primer: [README](README.md), [messages.md](messages.md), [transcript.jsonl](transcript.jsonl), [provider-tools.jsonl](provider-tools.jsonl), [metrics.json](metrics.json), [analysis.md](analysis.md), [manifest.json](manifest.json), [runtime-version.md](runtime-version.md), [evidence.zip](evidence.zip).

- Semua **3.890** completed native public event pada `transcript.jsonl` diparsing untuk hitungan, urutan, dan argumen/receipt. Urutan 87 pesan pengguna ditinjau secara kronologis; rangkaian kritis dipetakan ke capability dan source owner. **1.196** provider supplement dicatat sebagai lapisan yang mungkin overlap, bukan ditambahkan menjadi call independen.
- `evidence.zip` menurut manifest memuat 99 lampiran referensi pengguna (0 missing), 1.857 media unik, 40 snapshot aset dan 79 intermediate. **Byte gambar dalam ZIP tidak dilakukan side-by-side pixel inspection baru oleh audit ini.** Pernyataan visual di sini berasal dari pengguna, agent response dan receipt yang direkam, bukan pengesahan tampilan final oleh auditor. Tidak mengklaim telah membaca seluruh 2.354 file blob repository baris demi baris.
- Authoring benar-benar mencatat native Runtime/MCP calls pada sesi historis, tetapi **sumber commit persis build terpasang belum terverifikasi**. Product `0.2.0`, build `sha256:7086721b70c6e47db0bde7473b2038318e28f590959b8b4db42f7557a01de6b5`; semantic revision `08389866680ad64b883dba0df7a8fa3579fd85602c251146888e2c0d87541e51`. Lihat `runtime-version.md`. Dua commit setelah sesi adalah pengarsipan/provenance, **bukan** bukti engine telah diperbaiki.
- Penilaian setiap temuan dibedakan: **OBSERVED** (transcript/tool receipt), **SOURCE_CONFIRMED** (implementasi/dokumen saat HEAD), **INFERENCE** (hipotesis penyebab), **NEEDS_NATIVE_PROOF** (butuh reproduction / accepted review). Jangan menyamakan script fixture PASS dengan artwork PASS.

## 2. Inventaris pengujian yang dihitung kembali

| Aktivitas | Jumlah | Interpretasi |
| --- | ---: | --- |
| Public events | 3.890 | 87 user, 213 agent, 645 command, 2.932 MCP calls, 6 extension, 4 file change, 3 image view |
| Native LazyDesigner MCP calls | 2.762 | Sisanya 170 node_repl.js; total 36 failed MCP events = 29 native + 7 node_repl |
| `invoke_capability` | 2.610 | Eksekusi, tidak sama dengan jumlah tindakan artistik terverifikasi |
| `paint_texture_transaction` | 1.400 | 13 gagal, termasuk uncertainty; 46.127 operasi piksel dalam transaksi |
| Operasi paint | 42.848 `fill_rect`; 3.173 `set_pixels`; 92 `copy_region`; 14 `erase_pixels` | Bukan indikator mutu hand-painting |
| `manage_animation_timeline` | 337 | Banyak edit key/timeline, bukan playback proof |
| `export_model` | 173 | Checkpoint/export; review duplikasi berdasarkan intent, jangan hapus secara membabi buta |
| `capture_model_views` | 146 | Hanya 30 capture menghasilkan inline image items dalam log (116 tanpa image item); bukan bukti bahwa penerima melihat/mengadili piksel |
| `switch_authoring_phase` | 99 | 65 pada surface yang sama; 34 mengganti surface |
| `status` / `search_capabilities` / `describe_capability` | 41 / 31 / 80 | Sebagian memang perlu pada katalog berubah |
| `list_textures` | 24 | Dua full diagnostic di bawah tetap `partial` |
| Event yang ditandai metrics | 72 | Campuran status degraded, tool failure, postcondition, bukan 72 bug produk |

| Segmen ordinal* | MCP calls | Paint | Phase switch | Masalah yang berulang |
| --- | ---: | ---: | ---: | --- |
| 17–3060 — banner berdiri + dinding | 844 | 278 | 62 | pedestal, panel, frame, logo/scanning, UV/animasi, style restore |
| 3061–5967 — CTF Golem | 1.403 | 935 | 20 | color grading, back/side armor, atlas size, animasi |
| 5968–7459 — Flag Minion | 448 | 108 | 9 | silhouette, style continuity, varian, contact death |
| 7460–8258 — CTF Merchant | 237 | 79 | 8 | panel shop, plate material, mirror UV, blue/red parity |

*Segmentasi ordinal untuk analitik, bukan label resmi project state. Durasi MCP yang dijumlahkan di `metrics.json` **bukan** total elapsed session, dan penurunan call count saja tidak berarti kualitas meningkat.

## 3. Index feedback pengguna → konsekuensi QA

| Area | Bukti ordinal user | Observasi konkret / acceptance failure |
| --- | --- | --- |
| Banner | 493, 884, 991, 1224, 1362 | Pedestal tampak kurang tepat, tidak center, detail material kurang, alpha/ukuran berubah; user terus mengoreksi target yang semestinya terkunci |
| Banner scan/UV | 2039, 2152, 2320, 2403, 2476, 2538 | Perintah restore tampilan, gradasi salah, z-fighting, UV berantakan, logo blink saat end idle, scanning harus di belakang logo |
| Golem geometry | 3156, 3193, 3232, 3260 | Perisai salah posisi, siluet proporsi, efisiensi cube, coplanar; perbaiki form sebelum detail |
| Golem texturing | 3447, 3538, 3865, 3954, 4051, 4315, 4390, 4482 | Palette salah, armor belakang dan samping kurang, shading metal/neon terlalu linear, revisi berulang meski agen menyebut sudah selesai |
| Golem UV/animation | 4500, 4544, 4771, 5196, 5532, 5679 | Pixel scale 32X vs 128x; revert 512 lalu repack 256 tanpa downsample; kaki idle kaku, posisi palu, shield harus composable dengan Walk/Attack |
| Minion | 6115, 6208, 6423, 6540, 6716, 6812, 6878 | Geometry stage harus dihormati; style Golem tidak tercermin di semua face; shading hitam dan pedang tidak konsisten |
| Minion animation | 7005, 7099, 7322, 7396 | Dua tekstur dalam **satu file**; dua attack perlu beda; death masih terlihat menggantung walau numeric ground bound sah |
| Merchant | 7547, 7739, 7829, 7896, 7911, 7983, 7997, 8096, 8229 | Wajib match style, back/side, blend, UV; user undo/reverse; blue master harus mengendalikan red variant |

**OBSERVED loop yang paling mahal:** antara permintaan koreksi shading Golem ordinal **3538** dan koreksi berikutnya **3865**, terdapat **292** MCP calls, **287** berupa transaksi paint, namun masalah material/back armor tetap dilaporkan. Itu bukan bukti semua edit salah, tetapi *bulk propagation* tidak menghasilkan acceptance yang bertahan.

## 4. Akar masalah dan batas kepastian

### P0-01 — Tidak ada Reference Package yang terikat dalam Control selama session

**OBSERVED:** 41/41 receipt `status` menunjukkan `control.reference.available=false` (mayoritas `REFERENCE_PATH_UNAVAILABLE`); `stage_context.original_user_intent` bernilai null pada 41/41 observasi; hanya 23/41 memiliki `current_user_delta`. `workspace.available=true` pada 8/41 observasi. User telah mengirim referensi: **bukan** berarti gambar referensi tidak pernah tersedia di chat, melainkan belum menjadi paket terstruktur/terikat yang dapat menjadi authority per tahap.

**SOURCE_CONFIRMED:** `mcp/gateway/handlers/registerCoreTools.ts` memiliki `reference_package_path`, `include_reference_images`, `workspace_path`, `current_user_delta`; `mcp/gateway/control/referencePackage.ts` mengembalikan unavailable saat path tidak ada; `contextProjection.ts` hanya memproyeksikan state yang tersedia. Kebijakan spesialis menempatkan current approved source dan latest explicit user correction di atas improvisasi AI.

**INFERENCE:** hilangnya *bound approved reference/style authority* meningkatkan peluang agen mengisi celah dengan styling sendiri, memindahkan master visual setelah compaction/asset berganti, dan menutup review dengan screenshot parsial.

**TARGET:** pada batas *meaningful* user approval, gunakan **Reference Package + Workspace yang sudah ada** untuk menautkan gambar benar, selected master asset/atlas/hash, identitas material, physical texel scale, allowed/forbidden accents, view identity, serta area perubahan. Reuse `known_context_ids` dan `current_user_delta`, tetapi jangan mengandalkan transkrip panjang/summary sebagai pengganti gambar. Ketika source package belum terikat atau gambar belum benar-benar di-review, hasilnya `UNVERIFIED`, bukan stylistic `PASS`. Tidak perlu sistem memori/router ketiga.

**ACCEPTANCE:** perubahan material pada Minion/Merchant terhadap approved Golem menunjuk sumber/revisi yang tepat; perubahan ke bagian A tidak mengubah area approved B; setelah reopen/compaction sumber masih dapat dirujuk dengan identitas fresh. Tidak mengklaim similarity otomatis dari metadata.

### P0-02 — Semantic paint cohorts tidak efektif; banyak PNG diretur ketika diminta CONTINUE

**OBSERVED (disaring di lapisan outer `invoke_capability`):** 1.197/1.400 operasi painting bertanda `cohort_boundary=CONTINUE`, **0/1.197** membawa `task_context_id`. Dari 1.197 itu, **1.183** tetap memiliki image item dalam respons; hanya **3/2.610** seluruh invoke memiliki `task_context_id`, semuanya `manage_cubes` awal. Banyak penerbitan PNG demikian menghabiskan konteks tanpa otomatis memperbaiki craft.

**SOURCE_CONFIRMED:** `mcp/gateway/handlers/registerCoreTools.ts` menyediakan kedua argumen tersebut di **outer call**, bukan di payload spesifik paint. `mcp/gateway/presentation/paintEvidenceDelivery.ts` mensyaratkan `CONTINUE` + task ID non-kosong + project UUID terverifikasi + image native matched untuk defer inline image; default/COMPLETE tetap harus memulangkan final image. `mcp/gateway/control/orchestration.ts` memiliki state/delta cohort, tetapi missing ID tidak dapat menjadi valid cohort.

**TARGET:** client wajib mempertahankan *same current task ID* dari Control, mengirimnya pada mutasi cohort `CONTINUE`, lalu `COMPLETE` di satu semantic/mapped-surface verification boundary. Tambahkan indikator/warning dengan pemilik yang sudah ada ketika caller mengirim CONTINUE tanpa task ID; fail-closed/explicit fallback, bukan status seolah cohort berhasil. Jangan defer PNG jika codec/inline digest/project identity tidak matched, jangan auto-retry unknown mutation, jangan menambahkan tool Gateway.

**ACCEPTANCE:** test 100 paint calls dalam satu cohort membuktikan intermediate PNG terdefer hanya saat syarat terpenuhi; completion menghasilkan PNG terbaru/merged evidence atau `follow_up_read` bila extent tidak lengkap; debt tetap terlihat; native image-render/encode time tidak diklaim dihemat hanya karena transport ditunda. Pengurangan token/call dilaporkan setelah kualitas diterima.

### P0-03 — Face coverage audit tidak menutup blindspot, dan `varied` bukan `STYLED`

**OBSERVED source/native diagnostic:**
- Golem `list_textures(diagnostics=true, diagnostic_scope=full)` **ordinal 3440**: 372 mapped Cube-face, **152 scanned**, **220 omitted akibat budget**, gate `partial`, `SCAN_BUDGET_EXHAUSTED`, `FLAT_FACE_REVIEW`, `TRANSPARENT_FACE_REVIEW`, `INTERMEDIATE_ALPHA_REVIEW`. Aturannya tidak membolehkan klaim telah memeriksa seluruh 372 face.
- Merchant full diagnostic **ordinal 7701**: 294 face, **290 scanned**, **4 budget omitted**, gate `partial`, 48 `solid_color`, termasuk 22 detail-capable flat candidates; scan ini belum mengadili kualitas shade per face.
- Hanya 24 `list_textures` sepanjang sesi dan 2 full diagnostic. Status `partial` tidak boleh dijadikan full-model texture PASS. `Omitted` tidak sama dengan tidak dicat; `varied` tidak sama dengan artistically styled.

**SOURCE_CONFIRMED:** `mcp/lib/texture/optimization.ts` menyusun directional face review + omitted counts, `mcp/lib/texture/diagnosticReadContext.ts` menetapkan bounded pixel read budget 65.536; `.agents/skills/lazydesigner-texturing/SKILL.md` sudah menyebut Face Coverage Ledger `UNPAINTED | BASE_ONLY | STYLED | INTENTIONAL_FLAT | INTENTIONAL_TRANSPARENT | SHARED`, dengan `partial/incomplete` tidak boleh dianggap completed. `mcp/lib/texture/treatmentPlan.ts` adalah internal planner, **bukan** public Gateway tool.

**TARGET:** di checkpoint stage Texturing (bukan tiap fill), *account* semua Cube-face dengan UUID/direction/material intent/UV owner; cek front/back/left/right/top/bottom serta hidden-but-possible views, mirrored/shared constraints dan seam. Kumpulkan missing-scanned evidence secara **bounded** sesuai budget; jika masih incomplete, tahan final claim `UNVERIFIED`. Flat sengaja karena material, area mikro, atau tidak terlihat boleh `INTENTIONAL_FLAT` dengan alasan; dilarang memaksa noise hanya untuk membuat `varied`.

**ACCEPTANCE:** REG-FACE-GOLEM372 dan REG-FACE-MERCHANT294 mempertahankan omitted secara jujur, expose back/sole candidates dan distinct source/mapped evidence. Kualitas diratifikasi dari representative image + current native views, bukan histogram saja.

### P0-04 — Kesepakatan style bukan immutable approved master untuk transfer/variant

**OBSERVED:** user meminta Golem→Minion style sama di ordinal 5968/6423/6540; Merchant membesarkan patch strip tipis ke plate sehingga muncul band gelap, lalu user reverse ordinal 8096; blue vs red berbeda ordinal 8229, dan final follow-up menurunkan red dari blue via recolor accent. Undo/reverse harus mengalahkan artifact lama.

**SOURCE_CONFIRMED:** `mcp/lib/texture/appearanceVariantContinuity.ts` memeriksa identity geometry/UV/rig/material dan bitmap dimensions/declared provenance, **bukan** piksel RGB/style parity setelah recolor. `mcp/lib/texture/variantPlan.ts` memulai dari source atlas, tetapi tidak membuktikan hasil downstream cocok. `mcp/lib/texture/materialRecipe.ts` menyediakan material recipe; generic noise/gradient bukan jaminan referensi profesional.

**TARGET:** style transfer sebagai *material grammar*, bukan paste/stretch swatch: material surface class, bevel shadow/highlight placement, wear density, palette/value hierarchy, physical pixel cluster size, silhouette-side balance dan protected identity markings; pertahankan geometry/aspect ownership. Pada color variant satu project: clone approved **blue** atlas/current UV/geometry sebagai base, ubah **hue** hanya di explicit accent mask, preserve non-accent RGBA, alpha, visual-cluster structure. Perubahan user pada mask mendefinisikan valid scope; tidak dipromosikan sebagai universal style global.

**ACCEPTANCE:** REG-STYLE-TRANSFER pada armor depan/belakang/samping dengan aspek berbeda menghasilkan reference-matched mapped 3D review; REG-VARIANT-BLUE-RED non-accent RGBA equality + alpha equality + UV/rig/shape equality; remaining visual comparison tetap wajib. Tidak membuat UI/engine style memory kedua.

### P0-05 — False-positive finish: native tool success dan self-reported review diperlakukan seperti visual PASS

**OBSERVED:** 146 `capture_model_views` invocations, **0** mengaktifkan `ai_ingestion_probe=true`. User terus menemukan area salah setelah status “sudah” (Golem ordinals 3538→3865→3954→4390; Minion 6423→6540). Bukan bukti AI pasti gagal menerima semua gambar, tetapi **visual ingestion belum dibuktikan dengan test yang tersedia**. Hanya sebagian capture memiliki inline image items dalam log; media zip dan transcript source tetap harus direkonsiliasi sebelum menyimpulkan pixel visibility.

**SOURCE_CONFIRMED:** `docs/03-authoring/validation/visual.md`: client baru/berubah perlu probe sekali, source/current images aktif di konteks perbandingan, match view identity, shading ON, difference-first verdict `PASS | FAIL | UNVERIFIED`. `capture_model_views` dan Geometry numeric counts sendiri bukan quality PASS. `mcp/lib/orchestration/README.md` mengakui `CorrectionLoopRegistry` belum otomatis melakukan Apply native di stable-four Gateway; Control reducer yang aktif hanya memberi next-action hints.

**TARGET:** sebelum propagasi satu texture grammar baru atau sebelum stage keluar, periksa representative patch + seam di current mapped model bersama actual reference, lalu audit affected front/back/side (top/bottom bila material) dan source revision. Klaim PASS hanya untuk view/material yang diperiksa; missing reference/image atau partial scan = UNVERIFIED. Perbaiki kewajiban melaporkan perbedaan yang masih terbuka; jangan mengandalkan pernyataan “semua selesai”.

**ACCEPTANCE:** one-shot client ingestion probe ketika client berubah; bandingkan image pasangan yang benar; reject false quality PASS pada back/side defect; correction native receipt harus dipisah dari receipt/verdict artistic. Mengikat registry otomatis ke runtime adalah **candidate P1**, bukan implementasi yang sudah berhasil.

### P1-06 — Geometry/cube efficiency sering dipisahkan dari silhouette dan pose-space QA

**OBSERVED:** Banner pedestal terlalu panjang/tidak center (991, 1362), shield tidak di depan tangan (3193); Minion 64→59 cubes dan laporan 0 overlap pada **354 face pose dasar** (sekitar ordinal 6198), tetapi user masih menemukan mismatch silhouette/reference pada 6208. Zero bounded coplanar candidates tidak mencakup hidden faces, pose lain atau semua blending/motion.

**SOURCE:** `.agents/skills/lazydesigner-modelling/SKILL.md` dan `docs/03-authoring/modelling/standard.md` sudah memprioritaskan primary mass/negative space/pivots, full reference triad serta UV-pass. `mcp/lib/geometry/surfaceEvidence.ts` memiliki bounded candidate world/axis tests yang tidak menjadi certifier seluruh animasi.

**TARGET:** Geometry harus menyelesaikan silhouette/proportion/attachment dan contact axes dulu, baru mengurangi Cube yang tidak menambah volume/part/motion/negative space. Audit paired front/side/back untuk model referensi multi-view, bukan hanya default pose. Preserve animation-affecting bone/pivot identity; UV mapping sesudah geometry stable, tidak repack styled atlas tanpa source-safe migration/Undo proof.

**ACCEPTANCE:** model matching approved views, shield/grip physical alignment dan no known Z-fighting untuk sampled static + motion-critical extremes. Target cube count boleh turun, **tidak** menjadi nilai kualitas utama.

### P1-07 — Animation semantic support/temporal distinction belum teruji baik

**OBSERVED:** Golem idle kaki kaku/palu tidak tergenggam (5532); shield harus coexist dengan Walk/Attack (5679); Minion Attack2 mirip Attack1 (7322); Death body melayang (7396) meski global min bound dapat menyentuh Y0 melalui pedang/armor. Revisi animation sudah terjadi, tetapi final playback/render Minecraft acceptance belum dapat diklaim dari audit ini.

**SOURCE:** `.agents/skills/lazydesigner-animation/SKILL.md`, `docs/03-authoring/animation/standard.md`, `mcp/lib/animation/contactEvidence.ts` (caller-supplied marker/constraint evidence, bukan native foot-lock guarantee), `mcp/lib/animation/motionDynamics.ts`.

**TARGET:** support marker semantik (torso/kepala saat death, planted-foot saat walk, palm/grip saat attack), sampled poses anticipation→impact→recovery, idle/walk loop two cycles, distinct attack silhouette/timing dan shield controller composition. Numeric bound minY0 bukan pengganti actual visual support; damage/clearance antar pose perlu diperiksa secara selektif.

**ACCEPTANCE:** REG-ANIM-DEATH marker torso grounded dan visual di extreme pose; REG-ANIM-ATTACK-PAIR dua clip berbeda nyata; REG-ANIM-SHIELD-WALK compatible, attachment/grip tetap valid; continuous motion masih NEEDS_NATIVE_PROOF sampai playback dinilai.

### P1-08 — Gateway capability/schema, postcondition alpha dan switch overhead

**OBSERVED:** Failure `CATALOG_STALE`/`RUNTIME_CLIENT_NOT_READY` pada `status`, guessed capability `CAPABILITY_NOT_FOUND` (mis. 766, 2324, 2632, 7563); paint alpha `postcondition mismatch` (mis. 648, 1483, 1908, 1918). Dari 99 `switch_authoring_phase`, 65 `surface_changed=false` dan 34 true; 99 memuat `gateway_catalog_invalidated=true` serta `requires_status_refresh=true`. Ini angka beban/peluang tuning, **bukan** bukti 65 invalidation tidak perlu, karena semantic stage juga bisa memengaruhi schema/authority. Beberapa postcondition failure adalah outcome unknown dan tidak boleh diulang buta.

**SOURCE:** `mcp/gateway/handlers/registerCoreTools.ts`, `mcp/gateway/control/orchestration.ts`, `mcp/gateway/presentation/paintEvidenceDelivery.ts`, `mcp/gateway/capabilities/graph.ts`, `mcp/lib/texture/paintTransaction.ts`.

**TARGET:** cache known *fresh* capability schema within the same catalog revision, invalidate saat revision benar-benar berubah, distinguish Gateway server/client/native readiness; alpha failure lakukan observe actual decoded RGBA + revision + Undo before retry, khususnya channel premultiplication/rounding hypotheses. Kerjakan Capability Graph exact-branch READY/UNKNOWN P0 sebagai **separate existing workstream**, jangan diam-diam gabungkan menjadi quality gate palsu.

**ACCEPTANCE:** error classifications deterministic (unknown outcome vs failed safely), user instruction correction tidak mengganti project/style authority, no unregistered capability guess; refresh/read only saat necessary.

### P2-09 — Correction enforcement gap dan efisiensi berbasis acceptance

**SOURCE_CONFIRMED:** `mcp/lib/orchestration/README.md`: internal `CorrectionLoopRegistry` tidak callable melalui normal 4 tools dan internal Gateway recovery registry punya `applyEvidenceSource=null`; synthetic correction-plan/receipt tests tidak membuktikan native correction behavior. Ini menjelaskan batas engine yang sudah ada, **bukan** bukti semua bad art disebabkan satu flag.

**TARGET:** prioritaskan terlebih dulu pemakaian Control reducer existing + explicit texture review; jika native binding diperlukan, modifikasi owner saat ini dengan matching project/revision/Undo/receipt dan fail closed. Tidak membuat public fifth tool, generic new agent router, persisten correction database atau arbitrary autopilot. Ukur `Cost to Accepted Result`: user correction turns, undo/reversions, material defects after claimed PASS, accepted checkpoint, valid cohort PNG deliveries, total calls/bytes dan elapsed wall time dengan provenance. Penurunan fill/call count saja adalah metric sekunder.

## 5. Implementation sequencing — perbaikan yang boleh dilakukan secara bertahap

| Urutan | Minimal owner | Unit pekerjaan / falsifier | Bukti yang diperlukan |
| --- | --- | --- | --- |
| **A. Baseline & source validity** | `experiments/authoring-session-2026-11-12/*`; existing Golden scripts | Freeze session ordinal + reference/checkpoint/source SHA + installed build identity gap. Bedakan user accepted/rejected per checkpoint. | Aset dan user feedback tidak otomatis menjadi visual PASS; source SHA installed masih UNVERIFIED |
| **B. Bind approved source/style** | `gateway/control/referencePackage.ts`, `contextProjection.ts`, existing Workspace/Skill | Reference available from real package, user delta scoped, latest undo/approval priority; no new memory. | REG-REF-01: reference loss/compaction/reopen; preserved unrelated approval |
| **C. Fix cohort semantics** | `gateway/handlers/registerCoreTools.ts`, `gateway/presentation/paintEvidenceDelivery.ts`, `gateway/control/orchestration.ts` | Task ID really reaches CONTINUE/COMPLETE, explicit invalid-context response and retained visual debt. | REG-COHORT-02/03: 100 transactions, PNG count and final review, unknown outcome no retry |
| **D. Per-face blindspot gate** | `lib/texture/optimization.ts`, `server/runtime/extensions/texture/authoring.ts`, Texturing Skill | Coverage state transition, bounded omitted follow-up, back/sole, explicit allowed flat/shared. | REG-FACE-04: 372/294 cases remain `partial` until evidence resolves; no false PASS |
| **E. Cross-asset material grammar + variants** | `lib/texture/treatmentPlan.ts`, `variantPlan.ts`, `appearanceVariantContinuity.ts`, Texturing Skill | Representative patch on different aspect/physical scale; approved-blue→red only accent mask. | REG-MATERIAL-05 and REG-VARIANT-06 plus paired visual review |
| **F. Geometry and animation craft** | Modelling/Animation Skills + `lib/geometry/surfaceEvidence.ts` + `lib/animation/contactEvidence.ts` | Primary mass and pose-supported contact/clip differences, no regressions to approved areas. | REG-GEOM-07, REG-ANIM-08/09 current model captures + sampled native playback |
| **G. Conditional correction-loop integration** | `lib/orchestration/correctionLoop.ts`, `gateway/session/orchestrationRecoveryState.ts` | Only after identifying a native enforcement failure; verified Apply receipt, freshness and same task. | REG-RECEIPT-10 fail closed and native state restoration |
| **H. Golden A/B benchmark** | existing `mcp/scripts/reporting/compare-golden-sessions.ts` and benchmark fixtures | Match user reference, versions, source hash, same tasks and independent artistic reviewers. | No regression in critical criteria; lower cost **after** accepted quality |

**STOP conditions:** missing approved view, missing stable project/asset identity, stale/unknown mutation outcome, changed source revision, user undo superseding older evidence, repeated same-direction attempt without new evidence. Indepedent low-risk work can continue; no invented PASS.

## 6. Minimal test/regression corpus (to be authored, NOT_EXECUTED)

| ID | Reproduction and target |
| --- | --- |
| REG-REF-01 | New Minion after Golem approval: current Golem style reference/asset revision survives model switching and compaction; only specified material scope may change |
| REG-COHORT-02 | 100 valid CONTINUE paint edits with current task ID: intermediate PNG suppression where matched, final PNG/follow-up read and visual debt preserved |
| REG-COHORT-03 | CONTINUE missing task ID: explicit invalid/degraded outcome; no fabricated deferred-success claim |
| REG-FACE-04 | Golem 372 face / Merchant 294 face, budget omitted: state `partial`; each omitted direction remains reviewable and not auto-styled |
| REG-MATERIAL-05 | Strip material vs tall armor plate: no blind stretch; similar painterly clusters at target physical pixel scale and view |
| REG-VARIANT-06 | Blue approved atlas → red: geometry/UV/rig/alpha unchanged, non-accent exact RGB match, accent mask only |
| REG-GEOM-07 | Shield grip, primary silhouette, world coplanar candidates and pose-critical pivots; no overfitted Cube-count target |
| REG-ANIM-08 | Death: body semantic support (not weapon minimum Y); contact frames and no floating in playback |
| REG-ANIM-09 | Walk+Shield+Attack composite, unique two slash silhouettes and timing; checked two cycles at relevant states |
| REG-RECEIPT-10 | Correction proposal cannot be accepted without matching native apply receipt, current project/revision/Undo identity |
| REG-PROBE-11 | Changed client: `ai_ingestion_probe` tested and independently hashed once before claiming image ingestion proof |
| REG-UNDO-12 | User reverses Merchant style; subsequent edit begins from fresh current state, never silently re-applies superseded strip |
| REG-RUNTIME-13 | Installed deployed build + exact repository source revision are independently confirmed before source-specific live PASS |

## 7. Non-goals, ownership, dan audit status

- Tidak mengurangi fitur/capability existing hanya agar tool/response lebih singkat. Jangan menambah satu Gateway tool, stage baru, autonomous agent, duplicate Reference store, generic visual score atau per-pixel permission checkpoint.
- Tidak mengejar `varied` atau atlas occupancy sebagai proxy artistik; kedua metrik tidak menyelesaikan matching shading/identity/back armor. Tidak menghapus authorized intentional solid faces.
- Tidak menjalankan Bun, Blockbench, Minecraft, CI, install, release, atau edit aset dalam audit ini. Proposal regression belum merupakan PASS. Native visual acceptance dan APK/Bedrock material alpha tetap perlu bukti sesuai scope; user tidak diminta mengulang manual test sebagai prasyarat laporan ini.
- Owner current continuation tetap `docs/05-operations/next-action.md`; laporan ini adalah historical evidence + remediation map dalam existing session archive, **bukan** tracker status paralel. Product-specific native Desktop P0 dan Capability Graph exact branch P0 tetap terpisah. Seluruh implementasi berikutnya memerlukan exact current Local HEAD, canonical source, coherent regression, proof ceiling yang benar.
- **Priority recommendation:** mulai dari B→C→D→E, lalu F/G berdasarkan bukti. Ini menyasar kesalahan berulang dengan perubahan paling kecil dan risiko paling rendah. Hasil **belum** dapat dinyatakan meningkatkan mutu sampai matched accepted/native run membuktikannya.
