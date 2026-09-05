/* =========================================================
   LAPORAN PROYEK - combine.js
   Fitur "Gabung Dokumen": import dokumen eksternal (PDF,
   Word .docx, PowerPoint .pptx, atau gambar), atur urutannya,
   lalu gabungkan semuanya (opsional + laporan otomatis
   Harian/Mingguan/Bulanan sebagai halaman pembuka) menjadi
   SATU file PDF akhir -- termasuk foto/gambar yang ada di
   dalam file Word/PowerPoint tersebut.

   Library yang dipakai (dimuat lewat CDN, lihat index.html):
   - pdf-lib -> menggabungkan halaman PDF, menyisipkan gambar
   - mammoth -> membaca teks + gambar dari file Word (.docx)
   - JSZip   -> membongkar file PowerPoint (.pptx) untuk
                mengambil teks tiap slide + gambar di dalamnya
                (.pptx sebenarnya adalah file zip)

   Catatan keterbatasan (tidak bisa dihindari sepenuhnya karena
   ini berjalan di browser, tanpa Word/PowerPoint asli):
   - Word (.docx): teks & gambar ikut tersalin, tapi layout
     rumit (tabel, kolom, style halaman) disederhanakan jadi
     teks berurutan + gambar.
   - PowerPoint (.pptx): tiap slide dijadikan satu halaman berisi
     teks slide tsb + gambar yang ada di slide itu -- BUKAN hasil
     render visual slide aslinya (posisi/desain slide tidak ditiru).
   - Format lama seperti .doc dan .ppt (bukan .docx/.pptx) TIDAK
     bisa dibaca, karena formatnya biner lama, bukan format zip
     seperti versi modern (Word/PowerPoint 2007 ke atas).
   - Foto format HEIC (umum di iPhone) umumnya tidak bisa dibaca
     oleh browser sama sekali -- konversi dulu ke JPG/PNG sebelum
     upload, kalau ini terjadi.
   ========================================================= */

const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 40;

function lowerName(d){ return (d.name || "").toLowerCase(); }

function isPdfDoc(d){
  return (d.mime || "").includes("pdf") || lowerName(d).endsWith(".pdf");
}
function isImageDoc(d){
  return (d.mime || "").startsWith("image/");
}
function isWordDoc(d){
  const n = lowerName(d);
  return n.endsWith(".docx") || n.endsWith(".doc") || (d.mime || "").includes("word");
}
function isPptxDoc(d){
  const n = lowerName(d);
  return n.endsWith(".pptx") || n.endsWith(".ppt") ||
    (d.mime || "").includes("presentation") || (d.mime || "").includes("powerpoint");
}

/* =========================================================
   HELPER UMUM: gambar & teks
   ========================================================= */

// Pecah satu baris teks jadi baris-baris yang muat di lebar halaman
function wrapTextForPdfLib(font, text, fontSize, maxWidth){
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for(const w of words){
    const test = current ? current + " " + w : w;
    if(current && font.widthOfTextAtSize(test, fontSize) > maxWidth){
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if(current) lines.push(current);
  return lines;
}

// Menyisipkan gambar apapun (jpg/png/gif/webp/bmp/dll) ke pdf-lib.
// pdf-lib HANYA bisa embed JPG & PNG asli -- untuk format lain,
// gambar didekode lewat <img>+canvas lalu dikonversi ke PNG dulu.
async function embedImageAnyFormat(finalPdf, bytes, mimeHint, nameHint){
  const mime = (mimeHint || "").toLowerCase();
  const name = (nameHint || "").toLowerCase();
  const looksPng = mime.includes("png") || name.endsWith(".png");
  const looksJpg = mime.includes("jpeg") || mime.includes("jpg") || name.endsWith(".jpg") || name.endsWith(".jpeg");

  if(looksPng){
    try{ return await finalPdf.embedPng(bytes); }catch(e){ /* lanjut ke fallback canvas */ }
  } else if(looksJpg){
    try{ return await finalPdf.embedJpg(bytes); }catch(e){ /* lanjut ke fallback canvas */ }
  }

  // Fallback: decode via elemen <img> + canvas, lalu re-encode ke PNG.
  // Ini yang membuat GIF/WEBP/BMP tetap bisa ikut tergabung.
  const blob = new Blob([bytes], { type: mime || "image/*" });
  const url = URL.createObjectURL(blob);
  try{
    const imgEl = await new Promise((resolve, reject)=>{
      const el = new Image();
      el.onload = ()=>resolve(el);
      el.onerror = ()=>reject(new Error("Gagal mendekode gambar"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = imgEl.naturalWidth || imgEl.width;
    canvas.height = imgEl.naturalHeight || imgEl.height;
    canvas.getContext("2d").drawImage(imgEl, 0, 0);
    const pngDataUrl = canvas.toDataURL("image/png");
    const pngBytes = base64ToUint8Array(pngDataUrl);
    return await finalPdf.embedPng(pngBytes);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addImageDocPage(finalPdf, docItem){
  const bytes = base64ToUint8Array(docItem.data);
  let img;
  try{
    img = await embedImageAnyFormat(finalPdf, bytes, docItem.mime, docItem.name);
  }catch(err){
    console.error("Gagal memuat gambar:", docItem.name, err);
    showToast("Gagal memuat gambar '" + docItem.name + "' (format tidak didukung browser), dilewati.");
    return;
  }
  const margin = 30;
  const maxW = PAGE_W - margin * 2, maxH = PAGE_H - margin * 2;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale, h = img.height * scale;
  const page = finalPdf.addPage([PAGE_W, PAGE_H]);
  page.drawImage(img, { x:(PAGE_W - w)/2, y:(PAGE_H - h)/2, width:w, height:h });
}

async function addPdfDocPages(finalPdf, docItem){
  const bytes = base64ToUint8Array(docItem.data);
  const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption:true });
  const pages = await finalPdf.copyPages(src, src.getPageIndices());
  pages.forEach(p=>finalPdf.addPage(p));
}

/* =========================================================
   FLOWING TEXT+IMAGE WRITER
   Satu "writer" yang bisa dipakai bareng untuk docx & pptx:
   menulis paragraf/gambar berurutan, otomatis pindah halaman
   kalau sudah penuh.
   ========================================================= */
function createFlowWriter(finalPdf, font, fontBold){
  let page = finalPdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const maxWidth = PAGE_W - MARGIN * 2;

  function newPage(){
    page = finalPdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }
  function ensureSpace(h){
    if(y - h < MARGIN) newPage();
  }
  function title(text){
    ensureSpace(24);
    y -= 4;
    page.drawText(text, { x: MARGIN, y, size: 13, font: fontBold, color: PDFLib.rgb(0.13,0.16,0.22) });
    y -= 10;
    page.drawLine({ start:{x:MARGIN,y}, end:{x:PAGE_W-MARGIN,y}, thickness:0.75, color: PDFLib.rgb(0.85,0.87,0.9) });
    y -= 18;
  }
  function paragraph(text, opts={}){
    if(!text || !text.trim()) return;
    const size = opts.size || 10.5;
    const f = opts.bold ? fontBold : font;
    const indent = opts.indent || 0;
    const prefix = opts.bullet ? "•  " : "";
    const lines = wrapTextForPdfLib(f, prefix + text.trim(), size, maxWidth - indent);
    lines.forEach(line=>{
      ensureSpace(size * 1.5);
      y -= size * 1.35;
      page.drawText(line, { x: MARGIN + indent, y, size, font: f, color: PDFLib.rgb(0.12,0.15,0.19) });
    });
    y -= 6;
  }
  function note(text){
    ensureSpace(16);
    page.drawText(text, { x: MARGIN, y, size: 9.5, font, color: PDFLib.rgb(0.55,0.55,0.55) });
    y -= 18;
  }
  async function image(bytes, mime, name){
    let img;
    try{
      img = await embedImageAnyFormat(finalPdf, bytes, mime, name);
    }catch(err){
      console.error("Gagal menyisipkan gambar:", name, err);
      note("(satu gambar tidak dapat ditampilkan: format tidak didukung)");
      return;
    }
    const availW = maxWidth;
    const availHmax = PAGE_H - MARGIN * 2;
    let w = img.width, h = img.height;
    const scale = Math.min(availW / w, availHmax / h, 1);
    w *= scale; h *= scale;
    ensureSpace(h + 12);
    y -= h;
    page.drawImage(img, { x: MARGIN, y, width: w, height: h });
    y -= 12;
  }
  function pageBreak(){ newPage(); }

  return { title, paragraph, note, image, pageBreak };
}

/* =========================================================
   WORD (.docx) -> teks + gambar, urut sesuai isi dokumen
   ========================================================= */
async function addWordDocPages(writer, docItem){
  writer.title(docItem.name);

  let html = "";
  try{
    const bytes = base64ToUint8Array(docItem.data);
    const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
    html = result.value || "";
  }catch(err){
    console.error("Gagal membaca docx:", docItem.name, err);
  }

  if(!html){
    writer.note("(Isi dokumen ini tidak dapat dibaca secara otomatis -- kemungkinan format .doc lama atau file rusak/terproteksi)");
    return;
  }

  const container = document.createElement("div");
  container.innerHTML = html;

  async function embedImgEl(imgEl){
    const src = imgEl.getAttribute("src") || "";
    if(!src.startsWith("data:")) return;
    const mimeMatch = /^data:([^;]+);base64,/.exec(src);
    const mime = mimeMatch ? mimeMatch[1] : "";
    const bytes = base64ToUint8Array(src);
    await writer.image(bytes, mime, "gambar.png");
  }

  async function walk(node){
    if(!node || node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();

    if(tag === "img"){ await embedImgEl(node); return; }

    if(/^h[1-6]$/.test(tag)){
      const level = parseInt(tag[1], 10);
      writer.paragraph(node.textContent, { bold:true, size: Math.max(11, 16 - level) });
      return;
    }

    if(tag === "ul" || tag === "ol"){
      for(const li of Array.from(node.children)){
        const imgs = li.querySelectorAll ? Array.from(li.querySelectorAll("img")) : [];
        const clone = li.cloneNode(true);
        clone.querySelectorAll && clone.querySelectorAll("img").forEach(im=>im.remove());
        const text = clone.textContent.trim();
        if(text) writer.paragraph(text, { bullet:true, indent:14 });
        for(const im of imgs) await embedImgEl(im);
      }
      return;
    }

    if(tag === "table"){
      const text = node.textContent.trim();
      if(text) writer.paragraph("[Tabel] " + text, { size:9.5 });
      return;
    }

    // Elemen umum lain (p, div, dst.) -- bisa berisi gambar + teks campur
    const imgs = node.querySelectorAll ? Array.from(node.querySelectorAll("img")) : [];
    if(imgs.length){
      const clone = node.cloneNode(true);
      clone.querySelectorAll && clone.querySelectorAll("img").forEach(im=>im.remove());
      const text = clone.textContent.trim();
      if(text) writer.paragraph(text);
      for(const im of imgs) await embedImgEl(im);
      return;
    }

    const text = node.textContent ? node.textContent.trim() : "";
    if(text) writer.paragraph(text);
  }

  for(const node of Array.from(container.children)){
    await walk(node);
  }
}

/* =========================================================
   POWERPOINT (.pptx) -> tiap slide jadi satu "blok":
   judul file, lalu per slide: teks slide + gambar di slide itu.
   (.pptx dibongkar sebagai file ZIP memakai JSZip.)
   ========================================================= */
function decodeXmlEntities(s){
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function resolvePptxRelPath(baseDir, target){
  if(target.startsWith("/")) return target.replace(/^\//, "");
  const parts = (baseDir + "/" + target).split("/");
  const stack = [];
  for(const p of parts){
    if(p === "..") stack.pop();
    else if(p === "." || p === "") continue;
    else stack.push(p);
  }
  return stack.join("/");
}

async function extractPptxSlides(zip){
  const slidePaths = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a,b)=>{
      const na = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);
      return na - nb;
    });

  const slides = [];
  for(const slidePath of slidePaths){
    const xml = await zip.file(slidePath).async("string");
    const slideNum = slidePath.match(/slide(\d+)\.xml/)[1];
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;

    const rels = {};
    if(zip.file(relsPath)){
      const relsXml = await zip.file(relsPath).async("string");
      const relRegex = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g;
      let m;
      while((m = relRegex.exec(relsXml))) rels[m[1]] = m[2];
    }

    // Teks per paragraf (<a:p>...<a:t>text</a:t>...</a:p>)
    const paragraphs = [];
    const paraRegex = /<a:p>([\s\S]*?)<\/a:p>/g;
    let pm;
    while((pm = paraRegex.exec(xml))){
      const tRegex = /<a:t>([\s\S]*?)<\/a:t>/g;
      let tm, text = "";
      while((tm = tRegex.exec(pm[1]))) text += tm[1];
      text = decodeXmlEntities(text).trim();
      if(text) paragraphs.push(text);
    }

    // Gambar yang dipakai di slide ini (lewat r:embed="rIdX")
    const embedIds = new Set();
    const embedRegex = /r:embed="([^"]+)"/g;
    let em;
    while((em = embedRegex.exec(xml))) embedIds.add(em[1]);

    const images = [];
    for(const id of embedIds){
      const target = rels[id];
      if(!target) continue;
      const mediaPath = resolvePptxRelPath("ppt/slides", target);
      const file = zip.file(mediaPath);
      if(!file) continue;
      try{
        const bytes = await file.async("uint8array");
        const ext = (mediaPath.split(".").pop() || "").toLowerCase();
        images.push({ bytes, ext });
      }catch(e){ console.error("Gagal membaca gambar slide:", mediaPath, e); }
    }

    slides.push({ number: parseInt(slideNum, 10), paragraphs, images });
  }
  return slides;
}

async function addPptxDocPages(writer, docItem){
  writer.title(docItem.name);

  if(typeof JSZip === "undefined"){
    writer.note("Library pembaca PowerPoint (JSZip) belum termuat, isi presentasi ini dilewati.");
    return;
  }

  let slides = [];
  try{
    const bytes = base64ToUint8Array(docItem.data);
    const zip = await JSZip.loadAsync(bytes);
    slides = await extractPptxSlides(zip);
  }catch(err){
    console.error("Gagal membaca pptx:", docItem.name, err);
    writer.note("(Isi presentasi ini tidak dapat dibaca secara otomatis -- kemungkinan format .ppt lama atau file rusak/terproteksi)");
    return;
  }

  if(!slides.length){
    writer.note("(Tidak ditemukan slide yang bisa dibaca pada file ini)");
    return;
  }

  for(const slide of slides){
    writer.pageBreak();
    writer.paragraph(`Slide ${slide.number}`, { bold:true, size:12 });
    if(!slide.paragraphs.length && !slide.images.length){
      writer.note("(Slide ini kosong atau berisi elemen yang tidak bisa dibaca)");
    }
    slide.paragraphs.forEach(text => writer.paragraph(text));
    for(const img of slide.images){
      await writer.image(img.bytes, "image/" + (img.ext === "jpg" ? "jpeg" : img.ext), "slide." + img.ext);
    }
  }
}

/* =========================================================
   Payload laporan otomatis (Harian/Mingguan/Bulanan) -- sama
   persis dengan yang dipakai tombol Export biasa.
   ========================================================= */
function buildExportPayloadForScope(scope){
  const project = getActiveProject();
  let entries, periodeLabel, ringkasan, rangeStart=null, rangeEnd=null, month=null;

  if(scope === "harian"){
    entries = getEntriesForProject();
    periodeLabel = "Laporan Harian - " + fmtDate(todayStr());
    ringkasan = "";
  } else if(scope === "mingguan"){
    const start = document.getElementById("wStart").value;
    const end = document.getElementById("wEnd").value;
    entries = getEntriesForProject().filter(e=> e.tanggal >= start && e.tanggal <= end);
    periodeLabel = `Laporan Mingguan - ${fmtDate(start)} s/d ${fmtDate(end)}`;
    ringkasan = document.getElementById("wRingkasan").value.trim();
    rangeStart = start; rangeEnd = end;
  } else {
    month = document.getElementById("mMonth").value;
    entries = getEntriesForProject().filter(e=> e.tanggal.slice(0,7) === month);
    const [y,m] = month.split("-");
    const namaBulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"][parseInt(m,10)-1];
    periodeLabel = `Laporan Bulanan - ${namaBulan} ${y}`;
    ringkasan = document.getElementById("mRingkasan").value.trim();
  }

  entries = entries.slice().sort((a,b)=>(a.tanggal+a.waktu).localeCompare(b.tanggal+b.waktu));
  return { project, entries, periodeLabel, ringkasan, scope, rangeStart, rangeEnd, month };
}

/* =========================================================
   ORKESTRASI UTAMA
   ========================================================= */
async function gabungkanDokumen(){
  const project = getActiveProject();
  if(!project){ showToast("Pilih proyek dulu"); return; }

  if(typeof PDFLib === "undefined"){
    showToast("Library penggabung PDF belum termuat. Pastikan Anda terhubung ke internet, lalu coba lagi.");
    return;
  }

  const docs = getImportedDocsForProject();
  const scope = document.getElementById("gabungScope").value;

  if(!docs.length && !scope){
    showToast("Belum ada dokumen untuk digabungkan. Upload dokumen atau pilih laporan otomatis dulu.");
    return;
  }

  const btn = document.getElementById("btnGabungkan");
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Menggabungkan...";

  try{
    const finalPdf = await PDFLib.PDFDocument.create();
    const font = await finalPdf.embedFont(PDFLib.StandardFonts.Helvetica);
    const fontBold = await finalPdf.embedFont(PDFLib.StandardFonts.HelveticaBold);

    // 1. Sisipkan laporan otomatis (opsional) sebagai halaman pembuka
    if(scope){
      if(typeof window.jspdf === "undefined"){
        showToast("Library laporan otomatis belum termuat, bagian ini dilewati.");
      } else {
        const payload = buildExportPayloadForScope(scope);
        if(payload.entries.length){
          const reportDoc = buildReportPDF(payload);
          const reportBytes = reportDoc.output("arraybuffer");
          const src = await PDFLib.PDFDocument.load(reportBytes);
          const pages = await finalPdf.copyPages(src, src.getPageIndices());
          pages.forEach(p=>finalPdf.addPage(p));
        } else {
          showToast("Tidak ada entri pada periode laporan otomatis terpilih, bagian ini dilewati.");
        }
      }
    }

    // 2. Gabungkan dokumen yang diimport, sesuai urutan di daftar.
    // Word & PowerPoint memakai satu "writer" flowing bersama supaya
    // halaman tidak terbuang kalau isinya pendek.
    let writer = null;
    function getWriter(){
      if(!writer) writer = createFlowWriter(finalPdf, font, fontBold);
      return writer;
    }

    for(const docItem of docs){
      if(isPdfDoc(docItem)){
        writer = null; // dokumen PDF berikutnya mulai halaman baru sendiri
        await addPdfDocPages(finalPdf, docItem);
      } else if(isImageDoc(docItem)){
        writer = null;
        await addImageDocPage(finalPdf, docItem);
      } else if(isPptxDoc(docItem)){
        if(typeof JSZip === "undefined"){
          showToast("Library pembaca PowerPoint belum termuat, '" + docItem.name + "' dilewati.");
          continue;
        }
        await addPptxDocPages(getWriter(), docItem);
        writer = null;
      } else if(isWordDoc(docItem)){
        if(typeof mammoth === "undefined"){
          showToast("Library pembaca Word belum termuat, '" + docItem.name + "' dilewati.");
          continue;
        }
        await addWordDocPages(getWriter(), docItem);
        writer = null;
      } else {
        showToast("Format '" + docItem.name + "' tidak didukung, dilewati.");
      }
    }

    if(finalPdf.getPageCount() === 0){
      showToast("Tidak ada halaman untuk digabungkan.");
      return;
    }

    const mergedBytes = await finalPdf.save();
    const blob = new Blob([mergedBytes], { type:"application/pdf" });
    downloadBlob(blob, `Laporan_Gabungan_${safeFilename(project.nama)}_${todayStr()}.pdf`);
    showToast("Laporan gabungan berhasil diunduh");
  }catch(err){
    console.error("Gagal menggabungkan dokumen:", err);
    showToast("Gagal menggabungkan: " + (err && err.message ? err.message : "terjadi kesalahan tak terduga"));
  }finally{
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

document.getElementById("btnGabungkan").addEventListener("click", gabungkanDokumen);
