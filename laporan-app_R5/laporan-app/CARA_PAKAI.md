# Aplikasi Laporan Progress Proyek (Harian / Mingguan / Bulanan)

Aplikasi ini berjalan sepenuhnya di PC Anda sendiri (localhost). Data (proyek, entri, foto)
disimpan **lokal di browser Anda** (IndexedDB) — tidak dikirim ke server manapun.
Koneksi internet hanya dipakai sesaat untuk memuat library saat Anda menekan tombol Export
(Word/PPT/PDF) atau saat membuka halaman pertama kali.

## Cara Menjalankan

**Opsi A — paling simpel (tanpa install apa pun):**
1. Buka folder `laporan-app`.
2. Klik dua kali file `index.html` — akan terbuka di browser (Chrome/Edge/Firefox disarankan).
3. Selesai, aplikasi langsung bisa dipakai.

**Opsi B — via localhost sungguhan (jika Anda sudah punya Python):**
1. Buka Command Prompt / Terminal, masuk ke folder `laporan-app`:
   ```
   cd path/ke/laporan-app
   ```
2. Jalankan:
   ```
   python -m http.server 8000
   ```
3. Buka browser ke: `http://localhost:8000`

> Kedua opsi menyimpan data yang sama persis (IndexedDB terikat ke browser + origin yang
> Anda gunakan untuk membuka file). Supaya data tidak "hilang", **selalu buka aplikasi
> dengan cara yang sama** (mis. selalu lewat `index.html` langsung, atau selalu lewat
> `localhost:8000`) dan gunakan browser yang sama.

## Alur Pemakaian

1. **Buat Proyek** lewat tombol "+ Proyek Baru" di sidebar kiri (isi nama, lokasi, penanggung jawab).
2. Masuk ke tab **Laporan Harian** → isi form: Judul Progress, Tanggal, Waktu, Keterangan
   Pekerjaan, Foto, serta field pelengkap (Progress %, Cuaca, Tenaga Kerja, Kendala,
   Rencana Selanjutnya) → klik **Simpan Entri**. Ulangi setiap hari.
3. Tab **Laporan Mingguan**: pilih rentang tanggal (default Senin–Minggu minggu berjalan),
   tulis ringkasan mingguan (opsional), lalu export.
4. Tab **Laporan Bulanan**: pilih bulan, tulis ringkasan bulanan (opsional), lalu export.
5. Tombol **Export Word / Export PPT / Export PDF** ada di setiap tab, mengekspor entri
   yang sedang tampil pada tab tersebut.

## Backup Data

Karena data tersimpan di browser, sebaiknya:
- Jangan hapus "Data Browsing / Site Data" untuk file ini di pengaturan browser, karena itu
  akan menghapus seluruh laporan tersimpan.
- Untuk backup, cara termudah saat ini adalah export rutin ke Word/PDF sebagai arsip.

## Update Terbaru (revisi ke-2)

**0. Export Word "gagal memuat library" — penyebab sebenarnya bukan koneksi internet.**
`index.html` sebelumnya memuat `docx@8.5.0/build/index.js`, padahal file itu **tidak
ada** di paket npm library "docx" (yang benar `build/index.umd.js`). Jadi `docx` selalu
gagal termuat di browser siapa pun, apa pun koneksinya. Sudah diperbaiki ke URL yang benar,
dan sekarang library Word/PPT/PDF masing-masing punya **CDN cadangan** — jika CDN utama
lambat/diblokir, otomatis dicoba CDN kedua sebelum benar-benar dianggap gagal.

**0b. Output PDF: teks "Nama Proyek" dsb. sekarang otomatis turun baris (word-wrap)**
bila nama proyek/lokasi/judul entri panjang, jadi tidak lagi terpotong di tepi halaman.

**1. Export Word yang tadinya gagal (karena foto) sudah diperbaiki.**
Penyebabnya: versi terbaru library "docx" (v8) mewajibkan tiap foto (ImageRun) diberi
properti `type` (jpg/png/dst). Kode lama tidak mengirim itu, sehingga begitu ada entri
berfoto, proses export berhenti diam-diam tanpa pesan error apapun. Sekarang tipe foto
dideteksi otomatis, dan bila suatu saat ada kegagalan lain, aplikasi akan menampilkan
pesan error yang jelas (bukan cuma diam saja).

**2. Laporan Mingguan & Bulanan sekarang benar-benar "menggabungkan".**
- Laporan **Mingguan** mengelompokkan seluruh entri **Harian** dalam rentang tanggal yang
  dipilih per-tanggal, lalu menambahkan **rekap otomatis** di bagian atas (jumlah hari
  kerja, progress awal → akhir minggu, rata-rata tenaga kerja, jumlah kendala, total foto).
- Laporan **Bulanan** mengelompokkan bulan menjadi beberapa **Minggu** (Minggu 1, Minggu 2,
  dst — otomatis dari tanggal 1 s/d akhir bulan), dan setiap minggu berisi gabungan entri
  hariannya sendiri beserta rekap mini per minggu, plus rekap keseluruhan bulan di atas.
- Berlaku untuk ketiga format export: Word, PPT, dan PDF.

**3. Tampilan laporan dibuat lebih menarik & rapi (Word, PPT, PDF):**
- Banner judul berwarna di halaman awal (mengikuti warna aplikasi, biru).
- Tabel identitas proyek yang rapi.
- Badge warna untuk progress (hijau ≥80%, kuning 40–79%, merah <40%).
- Kotak highlight berwarna untuk "Kendala" (merah muda) dan "Rencana Selanjutnya" (biru muda).
- Rekap kendala terkumpul dalam satu tabel (khusus laporan Mingguan/Bulanan).
- Grid foto 2 kolom agar lebih rapi.
- Blok tanda tangan "Dibuat oleh / Diperiksa oleh / Disetujui oleh" di akhir dokumen Word,
  serta nomor halaman di footer — mengikuti gaya laporan formal seperti contoh yang dikirim.

## Update Terbaru (revisi ke-4) — Gabung Dokumen kini dukung PDF, Word, PowerPoint & foto (termasuk foto di dalamnya)

Sebelumnya foto/gambar yang ada **di dalam** file Word tidak ikut tergabung (hanya
teksnya), dan file PowerPoint (.pptx) belum didukung sama sekali. Sekarang:

- **PDF** — halaman digabung apa adanya (tidak berubah).
- **Word (.docx)** — teks **dan gambar** di dalam dokumen ikut digabung, berurutan
  sesuai isi aslinya (heading, paragraf, daftar bertitik, gambar).
- **PowerPoint (.pptx)** — file dibongkar per slide: teks tiap slide + gambar yang ada
  di slide itu ikut digabung (satu slide = satu blok konten, BUKAN salinan visual
  persis tampilan slide aslinya — posisi/desain slide disederhanakan).
- **Foto** — selain JPG/PNG, sekarang GIF/WEBP/BMP juga ikut terbaca (dikonversi
  otomatis lewat browser). Format HEIC (umum di foto iPhone) umumnya tetap tidak bisa
  dibaca browser sama sekali — konversi dulu ke JPG/PNG sebelum upload bila ini terjadi.
- Format lama **.doc** dan **.ppt** (bukan .docx/.pptx, dari Word/PowerPoint versi lama)
  tidak bisa dibaca karena formatnya biner, bukan format zip seperti versi modern —
  akan ditandai sebagai "tidak dapat dibaca" pada hasil gabungan, bukan bikin proses gagal.

Butuh tambahan library `JSZip` (untuk membongkar .pptx) yang otomatis dimuat dari CDN
seperti library lain di fitur Export/Gabung, jadi tetap butuh koneksi internet sesaat
saat pertama membuka halaman.

## Update Terbaru (revisi ke-3) — Menu "Gabung Dokumen"

Ada tab baru **Gabung Dokumen** di sebelah tab Bulanan, untuk keperluan menggabungkan
beberapa file jadi satu laporan akhir:

1. **Import Dokumen Eksternal** — upload file PDF, Word (.docx), atau foto lewat tombol
   pilih file. File yang diupload tersimpan lokal (per proyek) sama seperti data lainnya,
   dan muncul sebagai daftar di bawahnya.
2. **Atur Urutan** — tiap item di daftar punya tombol ▲ (naikkan) / ▼ (turunkan) / Hapus,
   untuk mengatur urutan penggabungan sesuai kebutuhan.
3. **Sertakan Laporan Otomatis (opsional)** — bisa pilih agar laporan Harian/Mingguan/
   Bulanan yang sedang dibuat di aplikasi ini ikut ditambahkan sebagai halaman **pembuka**
   file gabungan (mengikuti isian tanggal/bulan yang aktif di tab masing-masing).
4. Klik **🔗 Gabungkan & Unduh PDF** — semua dokumen (laporan otomatis, lalu dokumen
   import sesuai urutan) digabung jadi **satu file PDF** dan otomatis terunduh.

Detail teknis & keterbatasan:
- Halaman PDF dan foto digabung **apa adanya** (tidak ada kompresi/perubahan tampilan).
- Isi file Word (.docx) diambil **teks polosnya saja** (heading/list/tabel/gambar di
  dalam dokumen tersebut tidak ikut tersalin persis, hanya teksnya). File .doc lama atau
  docx dengan format/proteksi tidak umum mungkin tidak terbaca otomatis.
- Fitur ini butuh koneksi internet sesaat untuk memuat library `pdf-lib` (penggabung PDF)
  dan `mammoth` (pembaca teks Word) dari CDN, sama seperti fitur Export lainnya.

## Kustomisasi

Semua tampilan ada di `style.css`, semua logika ada di `app.js` (data & tampilan) dan
`export.js` (export Word/PPT/PDF, termasuk logika gabungan harian → mingguan → bulanan
di fungsi `groupEntriesByDate`, `getMonthWeeks`, dan `computeRecap`). Beri tahu saya bila
ingin menambahkan field lain (misalnya nomor laporan, tabel material/alat, logo perusahaan,
dsb) atau mengubah gaya/layout dokumen hasil export — saya bisa sesuaikan.
