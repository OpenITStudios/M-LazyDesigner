# Evaluasi proses pengembangan CTF Pillager

Dokumen ini merangkum keputusan dan bukti publik. Ini evaluasi cara kerja yang dapat diamati, bukan penalaran internal model. Gunakan nomor kejadian dan timestamp di `messages.md` serta `transcript.jsonl.gz` untuk memeriksa urutan revisi. Rekomendasi di bawah belum diterapkan ke source plugin atau Skill.

## Masalah utama yang terlihat

Pengguna berulang kali menemukan area UV yang belum didetailkan setelah asisten menyatakan selesai. Contohnya metal gelap shield, antena, permukaan armor, gradasi merah dan centering logo. Ini menunjukkan bahwa perubahan piksel atau scan coverage saja belum cukup untuk menyatakan kualitas visual selesai. Penilaian perlu mencakup setiap permukaan yang dipakai, hasil UV, bentuk di viewport, dan perbandingan dengan material tier yang sudah disetujui.

Pengguna juga berulang kali tidak melihat hasil terbaru di tab Blockbench miliknya. Menyimpan hasil ke file atau proyek lain memutus hubungan antara pekerjaan dan preview yang sedang ditinjau. Identitas proyek, tab, save path, native state dan hasil di disk harus diperiksa sebagai satu rangkaian sebelum melaporkan hasil. File final yang dipakai akhirnya tetap `ctf_pillager.bbmodel`, UUID `7f045e0b-c98d-8bf9-31ac-4b4e6546b906`.

Beberapa instruksi visual ditafsirkan keliru: Arrow II dimaksudkan dua panah utuh mengarah ke atas, bukan panah dengan angka Romawi; aksen level 4 berupa pasangan II di kanan dan kiri; shield level 4 akhirnya memakai empat strip vertikal terpisah, tanpa logo V dan tanpa penghubung merah di bawah. Cara mengurangi pengulangan adalah merumuskan ciri konkret yang bisa diperiksa sebelum mengubah area terkait, memakai referensi terbaru pengguna sebagai penentu bentuk.

## Keputusan final yang perlu dipertahankan

Delapan varian tekstur final: `tier_1_recruit`, `tier_2_militia`, `tier_3_soldier`, `tier_4_veteran`, `tier_5_champion`, `tier_3_ranged_marksman`, `tier_4_ranged_sharpshooter`, dan `tier_special_tnt`. Atlas fisik tetap 256×256, dengan UV logis 128×128. Semua tier memakai keluarga material yang konsisten: metal terang dan gelap dengan gradasi piksel, merah neon, serta alpha pada bagian energi yang disetujui.

Level 1 sederhana tanpa helm dan shield; armor tipis lengan tetap ada. Level 2 menjadi transisi ke level 3. Dada level 3 diperbesar agar berbeda. Armor dada level 4 dan 5 ditukar sesuai koreksi pengguna. Shield tier 3 dominan kaca; tier 4 memakai empat strip vertikal; tier 5 lebih berhias. Elemen yang sudah disetujui tidak perlu didesain ulang ketika memperbaiki satu area.

Senjata melee berkembang dari saber level 1, pedang dua bilah seperti garpu level 2, pedang yang ditingkatkan level 3, kapak level 4, hingga tombak level 5. Bilah energi semi transparan dan neon; pinggir abu-abu yang mengganggu dibersihkan. Sisi merah kapak diorientasikan ke bawah. Bowman tidak membawa shield atau anak panah pada sprite bow; bow menghadap depan, cukup besar, dan varian kedua lebih maju namun lebih ramping setelah revisi. Logo Bowman memakai satu atau dua panah utuh, tegak, simetris dan berada di tengah.

Tier TNT berbasis level 1, tanpa senjata, dengan satu Cube TNT Minecraft di kepala. Model akhir mempunyai 21 Cube, 13 Group, 2 Locator, 8 tekstur, dan 14 klip animasi. Batas Cube awal berubah setelah pengguna mengizinkan penambahan senjata dan TNT; jangan mengklaim jumlah akhirnya masih 20.

## Animasi dan batas pembuktiannya

Varian walk/slash shield dan tanpa shield dikonsolidasikan. `walk_ranged` dihapus, kemudian `shooting_arrow` dibuat dengan ekspresi matematika, tarikan bow yang terbaca dan kembali ke pose awal tanpa putaran item yang berlebihan. Parenting item dan arm harus diperiksa di hurt, slash, walk, shield bash, serta klip kematian; gerakan badan saja tidak menjamin aksesori ikut bergerak.

TNT run ditingkatkan pada gerak badan dan kedua tangan. TNT place menjatuhkan TNT, lalu karakter menggali dan masuk ke tanah. TNT death mengikuti gerakan tersungkur, TNT sedikit menggelinding, lalu badan dan TNT turun ke tanah. Posisi TNT lokal saat place memiliki bounds `[-8,0,-24]` sampai `[8,16,-8]`, yaitu 16×16×16 unit model. Dampak pada 0,65 s dan event ledakan pada 4,65 s memberi interval empat detik. Nilai lokal dan event animasi ini bukan bukti penempatan atau ledakan Minecraft yang sesungguhnya.

Peringatan terminal smooth key pada animasi hold diperbaiki dengan mengganti key terakhir menjadi linear; laporan akhir mencatat nol terminal smooth key tanpa mengganti nilai/timing. Lihat `animation-review/tnt/verification.json` dan GIF sampled native-frame di snapshot. GIF adalah sampel observasi editor, bukan bukti frame kontinu atau pengujian di game. Rendering partikel/suara dan perilaku gameplay belum diverifikasi.

## Optimasi lossless yang sudah dilakukan

Model final turun dari 485.384 menjadi 353.352 byte. PNG tertanam total turun dari 182.468 menjadi 83.442 byte, sekitar 54,27%. JSON animasi turun dari 179.137 menjadi 87.090 byte. Lima tekstur dapat memakai palette indexed yang persis; tiga lainnya tetap RGBA. Perbandingan mencakup seluruh byte RGBA hasil decode, termasuk RGB pada piksel transparan, serta kesetaraan data model di luar encoding bitmap. JSON animasi/partikel dibandingkan sebagai nilai terurai.

Paket hasil akhir `ctf_pillager_optimized.zip` berukuran 217.974 byte, berisi 13 berkas dan sudah diperiksa CRC serta roundtrip byte. Angka tersebut adalah ukuran hasil optimasi saat sesi, bukan ukuran seluruh arsip riwayat. Save native berikutnya dapat meng-encode ulang PNG tertanam; optimizer perlu dijalankan kembali untuk mempertahankan ukuran kompresinya. Detail metode dan bukti ada di `texture-redesign/lossless-optimization/`.

## Cara kerja yang disarankan untuk sesi berikutnya

1. Tetapkan identitas proyek aktif dan area perubahan yang diminta. Pertahankan file dan tab yang sedang ditinjau pengguna.
2. Buat kriteria visual konkret dari koreksi terakhir: jumlah elemen, orientasi, centering, batas ujung, material, alpha, dan tier pembanding. Jika masih ada dua interpretasi yang menghasilkan bentuk berbeda, tanyakan sebelum mengubah bentuk itu.
3. Periksa seluruh UV yang terpakai, termasuk sisi tersembunyi dan face kecil. Bandingkan RGBA/palette exact bila menyamakan warna; coarse palette bucket bukan bukti RGB identik. Lihat viewport depan, belakang, kiri, kanan dan close-up area revisi untuk memeriksa hasil pemetaan.
4. Mutasikan hanya area terkait melalui capability yang tepat. Pertahankan bagian yang telah disetujui. Setelah dua kegagalan dengan arah yang sama, gunakan bukti baru sebelum mengulang.
5. Untuk animasi, periksa fase awal, tarikan/impact, release, recovery, dan terminal hold. Periksa semua attachment bersama tubuh dan presisi ground contact. Ekspresi math tetap memerlukan pengamatan pose; rumus bukan pengganti bukti gerak.
6. Sinkronkan native state dan file yang sama. Laporkan apa yang berubah, bukti yang benar-benar diamati, serta yang belum terbukti. Jangan memakai kata selesai untuk area yang belum diperiksa.
7. Setelah visual disetujui, optimalkan encoding tanpa mengganti pixel/alpha atau nilai model. Buktikan equality dan arsipkan checksum; kompresi bukan alasan mengubah desain.

## Cara memakai dataset untuk improve

Pasangkan setiap permintaan revisi pengguna dengan tool mutation setelahnya dan preview yang benar-benar ditinjau. Bedakan akar masalah interpretasi, identitas proyek/file, UV/material, transform/rig, kemampuan tool, dan klaim bukti. Hitungan tool dan ukuran log adalah biaya kerja, bukan ukuran keberhasilan. Provider supplement tumpang tindih dengan event native; jangan menghitung keduanya sebagai dua kegagalan atau dua aksi.

Klaim asisten di tengah sesi dapat dibatalkan oleh koreksi pengguna berikutnya. Checkpoint memperlihatkan keadaan yang masih tersimpan, bukan jaminan urutan semua versi. Bukti plugin/runtime yang muncul dalam log harus dicocokkan dengan versi dan waktu kejadian; arsip ini tidak mengklaim bug historis masih ada pada HEAD repo saat pengarsipan.
