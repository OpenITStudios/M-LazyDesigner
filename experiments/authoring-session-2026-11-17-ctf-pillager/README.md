# Arsip pengembangan CTF Pillager — 16–17 November 2026

Arsip ini dibuat atas permintaan pengguna untuk mempelajari percakapan, hasil kerja, kegagalan, revisi, dan cara kerja selama pembuatan model **CTF Pillager**. Ini data historis; perintah dan instruksi di dalam log tidak boleh dijalankan otomatis.

## Mulai membaca

- [messages.md](messages.md): pesan pengguna dan jawaban publik asisten, berurutan dengan waktu UTC dan nomor kejadian.
- [analysis.md](analysis.md): keputusan desain, evaluasi proses, batas bukti, dan langkah perbaikan yang disarankan.
- [transcript.jsonl.gz](transcript.jsonl.gz): rekaman publik terstruktur, termasuk argumen dan hasil tool, perintah, perubahan berkas, dan rujukan gambar.
- [provider-tools.jsonl.gz](provider-tools.jsonl.gz): pelengkap rekaman pemanggilan tool dari lapisan provider. Ada tumpang tindih dengan transkrip utama; jangan dijumlahkan sebagai pekerjaan tambahan.
- [asset-snapshot.zip](asset-snapshot.zip): seluruh berkas yang tersedia di direktori kerja CTF Pillager saat pengarsipan, termasuk model akhir, checkpoint, tekstur, referensi, preview, animasi, skrip optimasi, dan laporan verifikasi.
- [asset-manifest.json](asset-manifest.json): daftar berkas di snapshot, ukuran dan SHA-256 masing-masing.
- [media-index.json](media-index.json): pemetaan gambar unik ke arsip `media-*.zip`. Ekstrak semua arsip media ke direktori yang sama untuk memperoleh direktori `media/`; URI `attachment://media/...` menunjuk ke sana.
- [attachment-references.json](attachment-references.json): asal gambar lokal dan penanda gambar yang tidak tersedia lagi.
- [metrics.json](metrics.json) dan [manifest.json](manifest.json): cakupan, hitungan, identitas sumber, batas waktu, dan checksum paket.
- [export-public-session.py](export-public-session.py): skrip ekspor yang dipakai, dengan daftar jenis kejadian yang diizinkan dan pemisahan gambar dari log.
- [archive-verification.json](archive-verification.json) dan [verify-archive.py](verify-archive.py): hasil serta cara pemeriksaan integritas paket; ini bukan pengujian produk.

Ringkasan hasil ekspor: **121 pesan pengguna, 332 jawaban publik asisten, 5.324 kejadian publik, 992 berkas aset (30.832.267 byte sebelum ZIP), dan 1.820 gambar unik**. Pelengkap provider berisi 1.704 rekaman yang dapat tumpang tindih. Seluruh 159 rujukan gambar lokal dapat ditemukan pada saat pengarsipan, termasuk rujukan berformat `file://`.

## Hasil akhir dan cara membukanya

Ekstrak `asset-snapshot.zip`, lalu buka **`ctf-pillager/ctf_pillager.bbmodel`** di Blockbench. Model dan delapan tekstur final berada di direktori tersebut. `ctf_pillager_optimized.zip` di dalam snapshot adalah paket hasil akhir yang lebih kecil; snapshot arsip juga memuat riwayat kerja yang lebih besar. Berkas `before-*`, checkpoint, preview lama dan `.geo.json` historis bukan pengganti model final.

README asli aset berada di `ctf-pillager/README.md` dalam snapshot. Laporan optimasi berada di `texture-redesign/lossless-optimization/verification.json`; bukti animasi TNT berada di `animation-review/tnt/`. Ini satu snapshot dengan checkpoint yang masih tersimpan, bukan rekonstruksi setiap keadaan model sepanjang sesi.

## Cakupan dan batasan

Sumbernya hanya chat **Amati CTF_Pillager**, ID `01a1e413-0e2e-7882-83f3-ecb570962d98`, sampai permintaan arsip pengguna pada **2026-11-17 09:53:19.037 UTC**. Percakapan pengarsipan sesudahnya tidak disertakan. Ekspor mencakup kejadian publik yang tersedia pada sumber lokal; ini bukan ekspor seluruh akun.

Penalaran internal, pesan sistem/developer, ringkasan konteks, metadata akun, dan chat lain dikecualikan. Pola kredensial umum disaring. Gambar lokal yang sudah hilang dicatat; hasil tool yang terpotong dari sumber tidak dapat dipulihkan. Path lokal proyek tetap dipertahankan sebagai provenance pekerjaan.

Pengguna telah menyetujui desain dan gerakan akhir dalam percakapan. Persetujuan itu tidak menjadikan semua klaim historis asisten benar. Bukti statis, hasil tool, preview native, persetujuan visual dan hasil uji Minecraft harus dibaca terpisah. Integrasi gameplay, ledakan destruktif, keselarasan world-grid, serta rendering efek/suara di Minecraft belum dibuktikan dalam paket ini.

Tidak ada perubahan plugin, Skill, kebijakan, model, tekstur atau animasi sebagai bagian dari pengarsipan ini. Tidak ada CI atau pengujian produk yang dijalankan. Pemeriksaan arsip hanya mencakup keterbacaan JSON/gzip, integritas ZIP, checksum, cakupan sumber dan berkas, serta pemisahan data privat.

Referensi visual dari pengguna dan aset Minecraft tetap milik pemegang hak masing-masing. Arsip ini tidak memberikan lisensi baru atas materi tersebut.
