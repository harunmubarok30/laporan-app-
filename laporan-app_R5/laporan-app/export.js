/* =========================================================
   LAPORAN PROYEK - export.js
   Export laporan ke Word (.docx), PowerPoint (.pptx), dan PDF.
   Membutuhkan koneksi internet (untuk memuat library dari CDN).

   Perubahan penting:
   - FIX: export Word dulu gagal diam-diam karena versi terbaru
     library "docx" (v8) mewajibkan properti `type` pada setiap
     ImageRun (jpg/png/dst). Kode lama tidak mengirim itu, jadi
     begitu ada foto di sebuah entri, Packer.toBlob() melempar
     error tanpa ada try/catch -> tombol Export terlihat "gagal"
     tanpa pesan apapun. Sekarang dideteksi otomatis dari data
     foto + dibungkus try/catch dengan pesan error yang jelas.
   - BARU: laporan Mingguan sekarang benar-benar "menggabungkan"
     entri Harian (dikelompokkan per tanggal + rekap otomatis),
     dan laporan Bulanan menggabungkan Mingguan (dikelompokkan
     per minggu, tiap minggu berisi gabungan entri harian di
     dalamnya) + rekap kendala & progress otomatis.
   - BARU: tampilan dibuat lebih rapi & menarik: banner judul,
     tabel identitas, badge warna untuk progress, kotak highlight
     untuk kendala/rencana, grid foto 2 kolom, serta blok
     pengesahan (tanda tangan) di akhir dokumen — mengikuti gaya
     contoh laporan yang dikirim.
   ========================================================= */

const BRAND = {
  primary: "2563EB",
  primaryDark: "1D4ED8",
  primaryTint: "EFF6FF",
  text: "1F2937",
  muted: "6B7280",
  border: "E2E6EC",
  green: "16A34A",
  amber: "D97706",
  red: "DC2626",
  redTint: "FEE2E2"
};

const NAMA_BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function base64ToUint8Array(base64DataUrl){
  const base64 = base64DataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// docx@8+ mewajibkan `type` eksplisit per gambar (jpg/png/gif/bmp).
// Deteksi dari mime base64, fallback ke "jpg" (format yang dipakai
// aplikasi ini saat mengompres foto).
function detectImageType(dataUrl){
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl || "");
  const ext = (m ? m[1] : "jpeg").toLowerCase();
  if(ext === "jpeg") return "jpg";
  if(["jpg","png","gif","bmp"].includes(ext)) return ext;
  return "jpg";
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

function safeFilename(str){
  return str.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

function chunkArray(arr, size){
  const out = [];
  for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size));
  return out;
}

function progressColorHex(val){
  if(val === null || val === undefined || val === "") return null;
  const n = Number(val);
  if(isNaN(n)) return null;
  if(n >= 80) return BRAND.green;
  if(n >= 40) return BRAND.amber;
  return BRAND.red;
}

/* =========================================================
   LOGIKA GABUNGAN: Harian -> Mingguan -> Bulanan
   ========================================================= */

// Mengelompokkan entri per tanggal (dipakai untuk laporan Mingguan,
// dan di dalam tiap minggu pada laporan Bulanan)
function groupEntriesByDate(entries){
  const map = new Map();
  for(const e of entries){
    if(!map.has(e.tanggal)) map.set(e.tanggal, []);
    map.get(e.tanggal).push(e);
  }
  return Array.from(map.keys()).sort().map(tanggal => ({
    tanggal,
    entries: map.get(tanggal).sort((a,b)=> a.waktu.localeCompare(b.waktu))
  }));
}

// Membagi satu bulan menjadi kelompok minggu (7 hari berurutan
// dari tanggal 1), lalu memasukkan entri yang jatuh di rentang itu.
// Ini yang membuat laporan Bulanan = gabungan beberapa "Mingguan".
function getMonthWeeks(monthStr, entries){
  const [y, m] = monthStr.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const weeks = [];
  let start = 1, idx = 1;
  while(start <= daysInMonth){
    const end = Math.min(start + 6, daysInMonth);
    const startDate = `${monthStr}-${String(start).padStart(2,"0")}`;
    const endDate = `${monthStr}-${String(end).padStart(2,"0")}`;
    const weekEntries = entries.filter(e => e.tanggal >= startDate && e.tanggal <= endDate);
    weeks.push({
      label: `Minggu ${idx}`,
      startDate, endDate,
      rangeLabel: `${fmtDate(startDate)} s/d ${fmtDate(endDate)}`,
      entries: weekEntries,
      recap: computeRecap(weekEntries)
    });
    start = end + 1; idx++;
  }
  return weeks.filter(w => w.entries.length); // sembunyikan minggu kosong
}

// Rekap otomatis dari sekumpulan entri (dipakai di level minggu & bulan)
function computeRecap(entries){
  const hariKerjaSet = new Set(entries.map(e=>e.tanggal));
  const progressList = entries
    .filter(e => e.progress !== "" && e.progress !== null && e.progress !== undefined)
    .map(e => ({ tanggal: e.tanggal, waktu: e.waktu, val: Number(e.progress) }))
    .sort((a,b)=> (a.tanggal+a.waktu).localeCompare(b.tanggal+b.waktu));
  const tenagaList = entries
    .filter(e => e.tenagaKerja !== "" && e.tenagaKerja !== null && e.tenagaKerja !== undefined)
    .map(e => Number(e.tenagaKerja))
    .filter(n => !isNaN(n));
  const kendalaList = entries
    .filter(e => e.kendala && e.kendala.trim())
    .map(e => ({ tanggal: e.tanggal, judul: e.judul, kendala: e.kendala }));
  const totalFoto = entries.reduce((sum,e)=> sum + (e.fotos ? e.fotos.length : 0), 0);

  return {
    jumlahEntri: entries.length,
    hariKerja: hariKerjaSet.size,
    progressAwal: progressList.length ? progressList[0].val : null,
    progressAkhir: progressList.length ? progressList[progressList.length-1].val : null,
    rataTenagaKerja: tenagaList.length ? Math.round((tenagaList.reduce((a,b)=>a+b,0) / tenagaList.length) * 10) / 10 : null,
    kendalaList,
    totalFoto
  };
}

function metaBitsFor(entry){
  const bits = [];
  if(entry.progress !== "" && entry.progress !== null && entry.progress !== undefined) bits.push(`Progress: ${entry.progress}%`);
  if(entry.cuaca) bits.push(`Cuaca: ${entry.cuaca}`);
  if(entry.tenagaKerja) bits.push(`Tenaga kerja: ${entry.tenagaKerja} orang`);
  return bits;
}

/* =========================================================
   EXPORT WORD (.docx)  -- menggunakan library "docx"
   ========================================================= */
async function exportWord(payload){
  try{
    if(typeof docx === "undefined"){
      showToast("Gagal memuat library Word. Pastikan Anda terhubung ke internet.");
      return;
    }
    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
      Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
      ShadingType, Footer, PageNumber, VerticalAlign
    } = docx;

    const { project, entries, periodeLabel, ringkasan, scope, rangeStart, rangeEnd, month } = payload;
    const recap = computeRecap(entries);
    const children = [];

    /* ---------- helper builders (pakai closure ke docx classes) ---------- */
    function shading(fill){
      return { fill, type: ShadingType.CLEAR, color: "auto" };
    }

    function sectionHeading(text){
      return new Paragraph({
        spacing:{ before:280, after:120 },
        border:{ bottom:{ style: BorderStyle.SINGLE, size:8, color: BRAND.primary, space:4 } },
        children:[ new TextRun({ text: text.toUpperCase(), bold:true, color: BRAND.primaryDark, size:24 }) ]
      });
    }

    function bannerTable(title, subtitle){
      return new Table({
        width:{ size:100, type: WidthType.PERCENTAGE },
        rows:[ new TableRow({ children:[ new TableCell({
          shading: shading(BRAND.primary),
          verticalAlign: VerticalAlign.CENTER,
          margins:{ top:220, bottom:220, left:200, right:200 },
          children:[
            new Paragraph({ alignment: AlignmentType.CENTER, children:[ new TextRun({ text:"LAPORAN PROGRESS PROYEK", bold:true, color:"FFFFFF", size:34 }) ] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing:{ before:60 }, children:[ new TextRun({ text: subtitle, color:"DBEAFE", size:22 }) ] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing:{ before:40 }, children:[ new TextRun({ text: title, bold:true, color:"FFFFFF", size:22 }) ] })
          ]
        }) ] }) ]
      });
    }

    function infoRow(label, value, shadeLabel=true){
      return new TableRow({ children:[
        new TableCell({
          width:{ size:32, type: WidthType.PERCENTAGE },
          shading: shadeLabel ? shading("F3F4F6") : undefined,
          children:[ new Paragraph({ children:[ new TextRun({ text: label, bold:true, color: BRAND.text, size:20 }) ] }) ]
        }),
        new TableCell({
          width:{ size:68, type: WidthType.PERCENTAGE },
          children:[ new Paragraph({ children:[ new TextRun({ text: value || "-", size:20 }) ] }) ]
        })
      ]});
    }

    function infoTable(rows){
      return new Table({ width:{ size:100, type: WidthType.PERCENTAGE }, rows: rows.map(([l,v])=>infoRow(l,v)) });
    }

    function highlightBox(label, text, color, tint){
      return new Paragraph({
        shading: shading(tint),
        spacing:{ before:80, after:80 },
        indent:{ left:120, right:120 },
        border:{
          left:{ style: BorderStyle.SINGLE, size:16, color, space:6 }
        },
        children:[
          new TextRun({ text: label + " ", bold:true, color, size:20 }),
          new TextRun({ text, size:20 })
        ]
      });
    }

    function photoGrid(fotos){
      if(!fotos || !fotos.length) return [];
      const out = [];
      const rows = chunkArray(fotos, 2).map(pair => {
        const cells = pair.map(foto => {
          try{
            const bytes = base64ToUint8Array(foto);
            return new TableCell({
              width:{ size:50, type: WidthType.PERCENTAGE },
              margins:{ top:60, bottom:60, left:60, right:60 },
              children:[ new Paragraph({
                alignment: AlignmentType.CENTER,
                children:[ new ImageRun({ data: bytes, type: detectImageType(foto), transformation:{ width:250, height:188 } }) ]
              }) ]
            });
          }catch(e){
            console.error("Gagal memasukkan foto ke Word:", e);
            return new TableCell({ children:[ new Paragraph("(foto gagal dimuat)") ] });
          }
        });
        if(cells.length === 1) cells.push(new TableCell({ children:[ new Paragraph("") ] }));
        return new TableRow({ children: cells });
      });
      out.push(new Table({ width:{ size:100, type: WidthType.PERCENTAGE }, rows }));
      out.push(new Paragraph({ text:"", spacing:{ after:120 } }));
      return out;
    }

    function entryBlock(entry, level=2){
      const blk = [];
      const progColor = progressColorHex(entry.progress);
      const titleRuns = [ new TextRun({ text: entry.judul, bold:true, size:24, color: BRAND.text }) ];
      blk.push(new Paragraph({ heading: level===2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4, spacing:{ before:160, after:20 }, children: titleRuns }));
      blk.push(new Paragraph({
        spacing:{ after:100 },
        children:[
          new TextRun({ text: `${fmtDate(entry.tanggal)} • ${entry.waktu}`, italics:true, color: BRAND.muted, size:19 }),
          ...(progColor ? [ new TextRun({ text: `   ●  Progress ${entry.progress}%`, bold:true, color: progColor, size:19 }) ] : [])
        ]
      }));
      blk.push(new Paragraph({ text: entry.keterangan, spacing:{ after:100 }, children: undefined }));
      // (menggunakan text langsung agar tetap aman bila keterangan kosong)
      const metaBits = metaBitsFor(entry).filter(b => !b.startsWith("Progress")); // progress sudah tampil di badge
      if(metaBits.length){
        blk.push(new Paragraph({ children:[ new TextRun({ text: metaBits.join("   |   "), italics:true, color: BRAND.muted, size:19 }) ], spacing:{ after:100 } }));
      }
      if(entry.kendala) blk.push(highlightBox("Kendala:", entry.kendala, BRAND.red, BRAND.redTint));
      if(entry.rencana) blk.push(highlightBox("Rencana Selanjutnya:", entry.rencana, BRAND.primary, BRAND.primaryTint));
      blk.push(...photoGrid(entry.fotos));
      blk.push(new Paragraph({ text:"", spacing:{ after:80 } }));
      return blk;
    }

    function kendalaRecapTable(kendalaList){
      if(!kendalaList.length) return [];
      const rows = [ new TableRow({ children:[
        new TableCell({ shading: shading(BRAND.primary), children:[ new Paragraph({ children:[ new TextRun({ text:"No", bold:true, color:"FFFFFF", size:19 }) ] }) ] }),
        new TableCell({ shading: shading(BRAND.primary), children:[ new Paragraph({ children:[ new TextRun({ text:"Tanggal", bold:true, color:"FFFFFF", size:19 }) ] }) ] }),
        new TableCell({ shading: shading(BRAND.primary), children:[ new Paragraph({ children:[ new TextRun({ text:"Kegiatan", bold:true, color:"FFFFFF", size:19 }) ] }) ] }),
        new TableCell({ shading: shading(BRAND.primary), children:[ new Paragraph({ children:[ new TextRun({ text:"Kendala", bold:true, color:"FFFFFF", size:19 }) ] }) ] })
      ]}) ];
      kendalaList.forEach((k,i)=>{
        rows.push(new TableRow({ children:[
          new TableCell({ children:[ new Paragraph(String(i+1)) ] }),
          new TableCell({ children:[ new Paragraph(fmtDate(k.tanggal)) ] }),
          new TableCell({ children:[ new Paragraph(k.judul) ] }),
          new TableCell({ children:[ new Paragraph(k.kendala) ] })
        ]}));
      });
      return [ sectionHeading("Rekap Kendala Selama Periode Ini"), new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows }), new Paragraph({text:"", spacing:{after:120}}) ];
    }

    function recapTable(r){
      const rows = [
        ["Jumlah Hari Kerja Tercatat", `${r.hariKerja} hari`],
        ["Progress Awal → Akhir Periode", (r.progressAwal===null || r.progressAkhir===null) ? "-" : `${r.progressAwal}% → ${r.progressAkhir}%`],
        ["Rata-rata Tenaga Kerja / Hari", r.rataTenagaKerja===null ? "-" : `${r.rataTenagaKerja} orang`],
        ["Jumlah Kendala Tercatat", `${r.kendalaList.length}`],
        ["Total Foto Dokumentasi", `${r.totalFoto}`]
      ];
      return infoTable(rows);
    }

    function signatureTable(){
      const col = (label) => new TableCell({
        width:{ size:33.3, type: WidthType.PERCENTAGE },
        margins:{ top:120, bottom:120 },
        children:[
          new Paragraph({ alignment: AlignmentType.CENTER, children:[ new TextRun({ text: label, size:19 }) ] }),
          new Paragraph({ text:"" }), new Paragraph({ text:"" }),
          new Paragraph({ alignment: AlignmentType.CENTER, border:{ top:{ style: BorderStyle.SINGLE, size:4, color: BRAND.border } }, children:[ new TextRun({ text:"( ................................. )", size:19 }) ] })
        ]
      });
      return [
        new Paragraph({ text:"", spacing:{ before:300 } }),
        new Table({ width:{ size:100, type: WidthType.PERCENTAGE }, rows:[ new TableRow({ children:[ col("Dibuat oleh,\nPelaksana"), col("Diperiksa oleh,\nSupervisor / PM"), col("Disetujui oleh,\n" + (project.penanggungJawab || "Penanggung Jawab")) ] }) ] })
      ];
    }

    /* ---------- rangkai isi dokumen sesuai scope ---------- */
    children.push(bannerTable(project.nama, periodeLabel));
    children.push(new Paragraph({ text:"", spacing:{ after:120 } }));

    const baseInfoRows = [
      ["Nama Proyek", project.nama],
      ["Lokasi", project.lokasi],
      ["Penanggung Jawab", project.penanggungJawab],
      ["Periode Laporan", periodeLabel],
      ["Tanggal Dicetak", fmtDate(todayStr())]
    ];
    children.push(infoTable(baseInfoRows));
    children.push(new Paragraph({ text:"", spacing:{ after:160 } }));

    if(scope === "harian"){
      if(ringkasan){
        children.push(sectionHeading("Ringkasan"));
        children.push(new Paragraph({ text: ringkasan, spacing:{ after:160 } }));
      }
      children.push(sectionHeading("Rincian Progress"));
      entries.forEach(e => children.push(...entryBlock(e)));

    } else if(scope === "mingguan"){
      children.push(sectionHeading("Ringkasan Capaian Mingguan (Gabungan Laporan Harian)"));
      children.push(recapTable(recap));
      children.push(new Paragraph({ text:"", spacing:{ after:160 } }));

      if(ringkasan){
        children.push(sectionHeading("Catatan Ringkasan Mingguan"));
        children.push(new Paragraph({ text: ringkasan, spacing:{ after:160 } }));
      }
      children.push(...kendalaRecapTable(recap.kendalaList));

      children.push(sectionHeading("Rincian Harian dalam Minggu Ini"));
      const byDate = groupEntriesByDate(entries);
      byDate.forEach(day => {
        children.push(new Paragraph({
          shading: shading(BRAND.primaryTint),
          spacing:{ before:200, after:80 },
          children:[ new TextRun({ text: fmtDate(day.tanggal), bold:true, color: BRAND.primaryDark, size:22 }) ]
        }));
        day.entries.forEach(e => children.push(...entryBlock(e)));
      });

    } else { // bulanan
      children.push(sectionHeading("Ringkasan Capaian Bulanan (Gabungan Laporan Mingguan)"));
      children.push(recapTable(recap));
      children.push(new Paragraph({ text:"", spacing:{ after:160 } }));

      if(ringkasan){
        children.push(sectionHeading("Catatan Ringkasan Bulanan"));
        children.push(new Paragraph({ text: ringkasan, spacing:{ after:160 } }));
      }
      children.push(...kendalaRecapTable(recap.kendalaList));

      children.push(sectionHeading("Rincian per Minggu dalam Bulan Ini"));
      const weeks = getMonthWeeks(month, entries);
      weeks.forEach(week => {
        children.push(new Paragraph({
          shading: shading(BRAND.primary),
          spacing:{ before:260, after:100 },
          children:[
            new TextRun({ text: `${week.label}  `, bold:true, color:"FFFFFF", size:23 }),
            new TextRun({ text: `(${week.rangeLabel})`, color:"DBEAFE", size:19 })
          ]
        }));
        children.push(new Paragraph({
          spacing:{ after:120 },
          children:[ new TextRun({
            text: `Hari kerja: ${week.recap.hariKerja}   |   Progress akhir minggu: ${week.recap.progressAkhir===null?"-":week.recap.progressAkhir+"%"}   |   Kendala: ${week.recap.kendalaList.length}`,
            italics:true, color: BRAND.muted, size:19
          }) ]
        }));
        const byDate = groupEntriesByDate(week.entries);
        byDate.forEach(day => {
          children.push(new Paragraph({
            shading: shading("F3F4F6"),
            spacing:{ before:120, after:60 },
            children:[ new TextRun({ text: fmtDate(day.tanggal), bold:true, color: BRAND.text, size:20 }) ]
          }));
          day.entries.forEach(e => children.push(...entryBlock(e, 3)));
        });
      });
    }

    children.push(...signatureTable());

    const doc = new Document({
      sections:[{
        properties:{ page:{ size:{ width:11906, height:16838 }, margin:{ top:720, bottom:720, left:900, right:900 } } },
        footers:{ default: new Footer({ children:[ new Paragraph({
          alignment: AlignmentType.CENTER,
          children:[
            new TextRun({ text:"Halaman ", size:17, color: BRAND.muted }),
            new TextRun({ children:[PageNumber.CURRENT], size:17, color: BRAND.muted }),
            new TextRun({ text:" dari ", size:17, color: BRAND.muted }),
            new TextRun({ children:[PageNumber.TOTAL_PAGES], size:17, color: BRAND.muted })
          ]
        }) ] }) },
        children
      }]
    });

    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `Laporan_${safeFilename(project.nama)}_${scope}_${todayStr()}.docx`);
    showToast("Word berhasil diexport");

  }catch(err){
    console.error("Export Word gagal:", err);
    showToast("Export Word gagal: " + (err && err.message ? err.message : "terjadi kesalahan tak terduga"));
  }
}

/* =========================================================
   EXPORT PPT (.pptx) -- menggunakan library "PptxGenJS"
   ========================================================= */
async function exportPPT(payload){
  try{
    if(typeof PptxGenJS === "undefined"){
      showToast("Gagal memuat library PPT. Pastikan Anda terhubung ke internet.");
      return;
    }
    const { project, entries, periodeLabel, ringkasan, scope, month } = payload;
    const recap = computeRecap(entries);

    const pptx = new PptxGenJS();
    pptx.defineLayout({name:"LAYOUT_16x9", width:10, height:5.63});
    pptx.layout = "LAYOUT_16x9";
    const C = { primary:"2563EB", dark:"1D4ED8", text:"1F2937", muted:"6B7280", tint:"EFF6FF" };

    // Slide judul
    let slide = pptx.addSlide();
    slide.background = { color: C.primary };
    slide.addText("LAPORAN PROGRESS PROYEK", {x:0.5,y:1.7,w:9,h:0.8,fontSize:30,bold:true,align:"center",color:"FFFFFF"});
    slide.addText(periodeLabel, {x:0.5,y:2.5,w:9,h:0.5,fontSize:18,align:"center",color:"DBEAFE"});
    slide.addText(project.nama + (project.lokasi ? "  •  " + project.lokasi : ""), {x:0.5,y:3.1,w:9,h:0.5,fontSize:14,align:"center",color:"E0E7FF"});

    // Slide ringkasan / rekap (mingguan & bulanan = gabungan)
    if(scope !== "harian"){
      slide = pptx.addSlide();
      const judulRekap = scope === "mingguan" ? "Ringkasan Mingguan (Gabungan Harian)" : "Ringkasan Bulanan (Gabungan Mingguan)";
      slide.addText(judulRekap, {x:0.5,y:0.35,w:9,h:0.6,fontSize:22,bold:true,color:C.dark});
      const rows = [
        ["Hari Kerja Tercatat", `${recap.hariKerja} hari`],
        ["Progress Awal → Akhir", (recap.progressAwal===null?"-":recap.progressAwal+"%") + " → " + (recap.progressAkhir===null?"-":recap.progressAkhir+"%")],
        ["Rata-rata Tenaga Kerja", recap.rataTenagaKerja===null?"-":recap.rataTenagaKerja+" orang/hari"],
        ["Kendala Tercatat", `${recap.kendalaList.length}`],
        ["Total Foto Dokumentasi", `${recap.totalFoto}`]
      ];
      slide.addTable(rows.map(([a,b])=>[{text:a,options:{bold:true,color:C.text,fill:{color:"F3F4F6"}}},{text:b,options:{color:C.text}}]), {
        x:0.5,y:1.1,w:9,colW:[4.5,4.5],fontSize:14,border:{type:"solid",color:"E2E6EC",pt:0.5},autoPage:false
      });
      if(ringkasan){
        slide.addText("Catatan: " + ringkasan, {x:0.5,y:3.9,w:9,h:1.4,fontSize:13,color:C.muted,italic:true,valign:"top"});
      }
    }

    function addEntrySlide(entry, dividerLabel){
      if(dividerLabel){
        const div = pptx.addSlide();
        div.background = { color: C.dark };
        div.addText(dividerLabel, {x:0.5,y:2.3,w:9,h:1,fontSize:26,bold:true,align:"center",color:"FFFFFF"});
      }
      const s = pptx.addSlide();
      s.addText(entry.judul, {x:0.5,y:0.3,w:9,h:0.55,fontSize:22,bold:true,color:C.text});
      s.addText(`${fmtDate(entry.tanggal)}  •  ${entry.waktu}`, {x:0.5,y:0.82,w:9,h:0.35,fontSize:12,color:C.muted});

      const hasFoto = entry.fotos && entry.fotos.length;
      const textW = hasFoto ? 5.3 : 9;

      let bodyLines = [entry.keterangan];
      const metaBits = metaBitsFor(entry);
      if(metaBits.length) bodyLines.push(metaBits.join("   |   "));
      if(entry.kendala) bodyLines.push("Kendala: " + entry.kendala);
      if(entry.rencana) bodyLines.push("Rencana selanjutnya: " + entry.rencana);

      s.addText(bodyLines.join("\n\n"), {x:0.5,y:1.3,w:textW,h:3.9,fontSize:13,color:C.text,valign:"top"});

      if(hasFoto){
        const fotos = entry.fotos.slice(0,4);
        const positions = [ {x:6.0,y:1.3},{x:8.0,y:1.3},{x:6.0,y:3.3},{x:8.0,y:3.3} ];
        fotos.forEach((f, i)=>{ s.addImage({data:f, x:positions[i].x, y:positions[i].y, w:1.85, h:1.85}); });
      }
    }

    if(scope === "harian"){
      entries.forEach(e => addEntrySlide(e));
    } else if(scope === "mingguan"){
      groupEntriesByDate(entries).forEach(day => {
        day.entries.forEach((e,i) => addEntrySlide(e, i===0 ? fmtDate(day.tanggal) : null));
      });
    } else {
      getMonthWeeks(month, entries).forEach(week => {
        let firstOfWeek = true;
        groupEntriesByDate(week.entries).forEach(day => {
          day.entries.forEach((e,i) => addEntrySlide(e, (firstOfWeek && i===0) ? `${week.label} (${week.rangeLabel})` : null));
          firstOfWeek = false;
        });
      });
    }

    await pptx.writeFile({fileName:`Laporan_${safeFilename(project.nama)}_${scope}_${todayStr()}.pptx`});
    showToast("PPT berhasil diexport");
  }catch(err){
    console.error("Export PPT gagal:", err);
    showToast("Export PPT gagal: " + (err && err.message ? err.message : "terjadi kesalahan tak terduga"));
  }
}

/* =========================================================
   EXPORT PDF -- menggunakan library "jsPDF"
   ========================================================= */
// Membangun dokumen jsPDF dari payload laporan TANPA menyimpan/mengunduh apapun.
// Dipisah dari exportPDF() supaya bisa dipakai ulang oleh fitur "Gabung Dokumen"
// (combine.js) untuk menyisipkan laporan otomatis sebagai halaman awal PDF gabungan.
function buildReportPDF(payload){
    const { project, entries, periodeLabel, ringkasan, scope, month } = payload;
    const recap = computeRecap(entries);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({unit:"pt", format:"a4"});
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;
    let y = margin;

    function ensureSpace(h){
      if(y + h > pageH - margin){ doc.addPage(); y = margin; }
    }
    function addWrappedText(text, x, fontSize, style="normal", color="#1f2937", maxWidth){
      doc.setFont("helvetica", style); doc.setFontSize(fontSize); doc.setTextColor(color);
      const lines = doc.splitTextToSize(text, maxWidth || (pageW - margin*2 - (x-margin)));
      lines.forEach(line=>{ ensureSpace(fontSize*1.4); doc.text(line, x, y); y += fontSize*1.4; });
    }
    function sectionBar(text){
      ensureSpace(30);
      doc.setFillColor("#2563eb");
      doc.rect(margin, y, pageW - margin*2, 22, "F");
      doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.setTextColor("#ffffff");
      doc.text(text.toUpperCase(), margin+8, y+15);
      y += 32;
    }
    function subBar(text, color="#eff6ff", textColor="#1d4ed8"){
      ensureSpace(24);
      doc.setFillColor(color);
      doc.rect(margin, y, pageW - margin*2, 20, "F");
      doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(textColor);
      doc.text(text, margin+8, y+14);
      y += 28;
    }
    function recapBox(r){
      const rows = [
        ["Hari Kerja Tercatat", `${r.hariKerja} hari`],
        ["Progress Awal -> Akhir", (r.progressAwal===null?"-":r.progressAwal+"%") + " -> " + (r.progressAkhir===null?"-":r.progressAkhir+"%")],
        ["Rata-rata Tenaga Kerja", r.rataTenagaKerja===null?"-":r.rataTenagaKerja+" orang/hari"],
        ["Kendala Tercatat", `${r.kendalaList.length}`],
        ["Total Foto Dokumentasi", `${r.totalFoto}`]
      ];
      ensureSpace(rows.length*16 + 16);
      doc.setDrawColor("#e2e6ec"); doc.setFillColor("#f9fafb");
      doc.roundedRect(margin, y, pageW - margin*2, rows.length*16 + 12, 4, 4, "FD");
      let ry = y + 14;
      rows.forEach(([k,v])=>{
        doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor("#1f2937");
        doc.text(k, margin+10, ry);
        doc.setFont("helvetica","normal"); doc.setTextColor("#374151");
        doc.text(v, margin+220, ry);
        ry += 16;
      });
      y = ry + 12;
    }
    function progressBadgeColor(val){
      const c = progressColorHex(val);
      if(!c) return "#6b7280";
      return "#" + c.toLowerCase();
    }

    function renderEntry(entry){
      ensureSpace(40);
      addWrappedText(entry.judul, margin, 13, "bold", "#1f2937", pageW - margin*2);
      doc.setFont("helvetica","italic"); doc.setFontSize(10); doc.setTextColor("#6b7280");
      let line = `${fmtDate(entry.tanggal)}  •  ${entry.waktu}`;
      doc.text(line, margin, y);
      if(entry.progress !== "" && entry.progress != null){
        doc.setFont("helvetica","bold"); doc.setTextColor(progressBadgeColor(entry.progress));
        doc.text(`Progress ${entry.progress}%`, margin + 220, y);
      }
      y += 16;

      addWrappedText(entry.keterangan, margin, 11, "normal", "#1f2937", pageW - margin*2);

      const metaBits = metaBitsFor(entry).filter(b=>!b.startsWith("Progress"));
      if(metaBits.length) addWrappedText(metaBits.join("   |   "), margin, 10, "italic", "#374151", pageW - margin*2);
      if(entry.kendala) addWrappedText("Kendala: " + entry.kendala, margin, 11, "normal", "#b91c1c", pageW - margin*2);
      if(entry.rencana) addWrappedText("Rencana selanjutnya: " + entry.rencana, margin, 11, "normal", "#1d4ed8", pageW - margin*2);

      y += 6;
      if(entry.fotos && entry.fotos.length){
        const imgW = 150, imgH = 110, gap = 10;
        let x = margin;
        for(const foto of entry.fotos){
          if(x + imgW > pageW - margin){ x = margin; y += imgH + gap; }
          ensureSpace(imgH + gap);
          try{ doc.addImage(foto, "JPEG", x, y, imgW, imgH); }
          catch(e){ console.error("Gagal memasukkan foto ke PDF:", e); }
          x += imgW + gap;
        }
        y += imgH + 20;
      }
      y += 8;
    }

    // Judul
    doc.setFillColor("#2563eb"); doc.rect(0, 0, pageW, 70, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(20); doc.setTextColor("#ffffff");
    doc.text("LAPORAN PROGRESS PROYEK", pageW/2, 32, {align:"center"});
    doc.setFont("helvetica","normal"); doc.setFontSize(12); doc.setTextColor("#dbeafe");
    doc.text(periodeLabel, pageW/2, 52, {align:"center"});
    y = 90;

    doc.setFontSize(11); doc.setTextColor("#374151");
    addWrappedText(`Nama Proyek: ${project.nama}`, margin, 11, "bold", "#1f2937", pageW - margin*2);
    addWrappedText(`Lokasi: ${project.lokasi || "-"}`, margin, 11, "normal", "#374151", pageW - margin*2);
    addWrappedText(`Penanggung Jawab: ${project.penanggungJawab || "-"}`, margin, 11, "normal", "#374151", pageW - margin*2);
    y += 8;

    if(scope === "harian"){
      if(ringkasan){
        sectionBar("Ringkasan");
        addWrappedText(ringkasan, margin, 11, "normal", "#1f2937", pageW - margin*2);
        y += 8;
      }
      sectionBar("Rincian Progress");
      entries.forEach(renderEntry);

    } else if(scope === "mingguan"){
      sectionBar("Ringkasan Mingguan (Gabungan Laporan Harian)");
      recapBox(recap);
      if(ringkasan){ addWrappedText("Catatan: " + ringkasan, margin, 11, "normal", "#1f2937", pageW - margin*2); y += 8; }

      sectionBar("Rincian Harian dalam Minggu Ini");
      groupEntriesByDate(entries).forEach(day => {
        subBar(fmtDate(day.tanggal));
        day.entries.forEach(renderEntry);
      });

    } else {
      sectionBar("Ringkasan Bulanan (Gabungan Laporan Mingguan)");
      recapBox(recap);
      if(ringkasan){ addWrappedText("Catatan: " + ringkasan, margin, 11, "normal", "#1f2937", pageW - margin*2); y += 8; }

      sectionBar("Rincian per Minggu dalam Bulan Ini");
      getMonthWeeks(month, entries).forEach(week => {
        subBar(`${week.label}  (${week.rangeLabel})`, "#2563eb", "#ffffff");
        addWrappedText(`Hari kerja: ${week.recap.hariKerja}   |   Progress akhir: ${week.recap.progressAkhir===null?"-":week.recap.progressAkhir+"%"}   |   Kendala: ${week.recap.kendalaList.length}`, margin, 9.5, "italic", "#6b7280", pageW - margin*2);
        y += 4;
        groupEntriesByDate(week.entries).forEach(day => {
          subBar(fmtDate(day.tanggal), "#f3f4f6", "#1f2937");
          day.entries.forEach(renderEntry);
        });
      });
    }

    return doc;
}

async function exportPDF(payload){
  try{
    if(typeof window.jspdf === "undefined"){
      showToast("Gagal memuat library PDF. Pastikan Anda terhubung ke internet.");
      return;
    }
    const doc = buildReportPDF(payload);
    doc.save(`Laporan_${safeFilename(payload.project.nama)}_${payload.scope}_${todayStr()}.pdf`);
    showToast("PDF berhasil diexport");
  }catch(err){
    console.error("Export PDF gagal:", err);
    showToast("Export PDF gagal: " + (err && err.message ? err.message : "terjadi kesalahan tak terduga"));
  }
}
