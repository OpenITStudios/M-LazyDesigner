# Versi MCP yang dipakai untuk authoring

**Versi produk yang benar-benar dilaporkan runtime: LazyDesigner MCP0.2.0. Status build terbaru: UNVERIFIED.**

| Identitas | Nilai / arti |
| --- | --- |
| product_id | lazydesigner-bedrock-entity-mcp |
| product_version | 0.2.0 |
| profile | bedrock_entity |
| build_identity | sha256:7086721b70c6e47db0bde7473b2038318e28f590959b8b4db42f7557a01de6b5 |
| semantic catalog revision | 08389866680ad64b883dba0df7a8fa3579fd85602c251146888e2c0d87541e51 |
| Commit sumber build terpasang | Tidak diproyeksikan oleh identitas runtime yang tercatat; belum dapat dipastikan |
| Surface chat | stable_four: status, search_capabilities, describe_capability, invoke_capability |
| Native capability count | 47 pada AUTHORING dan18 pada ANIMATION; perubahan stage, bukan upgrade versi |

## Bukti historis
[transcript.jsonl](transcript.jsonl) menyimpan41 hasil status dengan identitas runtime;39 memiliki identitas non-null dan2 offline tanpa identitas. Seluruh39 identitas non-null memiliki versi0.2.0 dan build hash yang sama. Sampel: ordinal323 menunjukkan ready pada05:31:55UTC; ordinal631 merekam instance baru setelah restart; ordinal7502 merekam hash yang sama saat Merchant dikerjakan pada12:44:59UTC. WaktuWIB adalahUTC+7.

Dua instance yang teramati:
- c6548223-5520-4f9e-9959-469ac4ba7cd4, startup2026-11-12T05:09:34.732Z.
- a1d2e1ca-bef7-470c-a209-988b6c300744, startup2026-11-12T05:41:43.781Z.

Ganti instance dengan hash tetap adalah restart, bukan bukti pembaruan. Transisi stage dan katalog stale/offline tidak membuktikan pergantian build.

## Apakah ini versi terbaru?
Belum bisa dinyatakan sebagai build terbaru. Paket pada remote Local commit03c01ee28e82e4d1d26668a45ce5e10022da39eb juga bernomor0.2.0, tetapi semver yang sama dapat mencakup banyak perubahan source/build. Checkout lokal masih HEAD44b03b524541001447013353bad154d54f158b23 dengan perubahan kerja yang belum dikomit dan nama paket lama blockit-bedrock-entity-mcp. Tidak ada dasar untuk menganggap HEAD checkout, HEAD remote, hash artefak dan versi produk sebagai identitas yang sama.

Klaim yang aman: pekerjaan memakai **runtime0.2.0 build7086721b…**, bukan klaim bahwa seluruh hasil diperoleh dari build exact-HEAD Local terbaru. Untuk membuktikan latest-build di masa depan diperlukan provenance build→source commit yang authoritative, verifikasi hash artefak terpasang, dan handshake identitas runtime setelah aktivasi; pemeriksaan ini tidak dijalankan atau dipaksakan dalam pencatatan ini.

Lihat [runtime-provenance.json](runtime-provenance.json) untuk semua sampel dan status koneksinya. Tidak ada upgrade, instalasi ulang, perubahan source produk, atau penggantian runtime pada pekerjaan dokumentasi ini.
