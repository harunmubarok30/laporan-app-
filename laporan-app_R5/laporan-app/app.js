/* =========================================================
   LAPORAN PROYEK - app.js
   Menyimpan data di IndexedDB (browser) via idb-keyval.
   Data TIDAK terkirim ke internet manapun, murni lokal di PC ini.
   ========================================================= */

const STORAGE_KEY = "laporan-app-data-v1";

let DB = {
  projects: [],   // {id, nama, lokasi, penanggungJawab, createdAt}
  entries: [],    // {id, projectId, tanggal, waktu, judul, keterangan, progress, cuaca, tenagaKerja, kendala, rencana, fotos:[base64,...]}
  importedDocs: [] // {id, projectId, name, mime, size, data:base64DataURL, addedAt} - dokumen eksternal (PDF/Word/gambar) untuk fitur "Gabung Dokumen"
};

let state = {
  activeProjectId: null,
  activeTab: "harian",
  editingEntryId: null
};

/* ---------- helpers ---------- */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function todayStr(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function nowTimeStr(){
  const d = new Date();
  return d.toTimeString().slice(0,5);
}
function fmtDate(iso){
  if(!iso) return "";
  const [y,m,d] = iso.split("-");
  const bulan = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${d} ${bulan[parseInt(m,10)-1]} ${y}`;
}
function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(showToast._h);
  showToast._h = setTimeout(()=>t.classList.add("hidden"), 2500);
}

/* ---------- persistence ---------- */
async function loadDB(){
  try{
    const saved = await idbKeyval.get(STORAGE_KEY);
    if(saved) DB = saved;
  }catch(e){ console.error("Gagal memuat data:", e); }
  // Jaga kompatibilitas dengan data lama (sebelum fitur "Gabung Dokumen" ada)
  if(!Array.isArray(DB.importedDocs)) DB.importedDocs = [];
}
async function saveDB(){
  try{
    await idbKeyval.set(STORAGE_KEY, DB);
  }catch(e){
    console.error("Gagal menyimpan data:", e);
    showToast("Gagal menyimpan data (mungkin penyimpanan penuh)");
  }
}

/* ---------- image compression ---------- */
function fileToCompressedBase64(file, maxWidth = 900, quality = 0.72){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      const img = new Image();
      img.onload = ()=>{
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- PROJECT CRUD ---------- */
function getActiveProject(){
  return DB.projects.find(p=>p.id === state.activeProjectId);
}

function openProjectModal(project){
  const modal = document.getElementById("modalProject");
  const title = document.getElementById("modalProjectTitle");
  const delBtn = document.getElementById("btnDeleteProject");
  document.getElementById("pId").value = project ? project.id : "";
  document.getElementById("pNama").value = project ? project.nama : "";
  document.getElementById("pLokasi").value = project ? project.lokasi : "";
  document.getElementById("pPenanggungJawab").value = project ? project.penanggungJawab : "";
  title.textContent = project ? "Edit Proyek" : "Proyek Baru";
  delBtn.classList.toggle("hidden", !project);
  modal.classList.remove("hidden");
}
function closeProjectModal(){
  document.getElementById("modalProject").classList.add("hidden");
}

document.getElementById("btnNewProject").addEventListener("click", ()=>openProjectModal(null));
document.getElementById("btnCloseModal").addEventListener("click", closeProjectModal);
document.getElementById("btnEditProject").addEventListener("click", ()=>{
  const p = getActiveProject();
  if(p) openProjectModal(p);
});

document.getElementById("projectForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const id = document.getElementById("pId").value;
  const nama = document.getElementById("pNama").value.trim();
  const lokasi = document.getElementById("pLokasi").value.trim();
  const penanggungJawab = document.getElementById("pPenanggungJawab").value.trim();
  if(!nama) return;

  if(id){
    const p = DB.projects.find(x=>x.id===id);
    Object.assign(p, {nama, lokasi, penanggungJawab});
  } else {
    const newP = {id: uid(), nama, lokasi, penanggungJawab, createdAt: todayStr()};
    DB.projects.push(newP);
    state.activeProjectId = newP.id;
  }
  await saveDB();
  closeProjectModal();
  renderProjectList();
  renderProjectView();
  showToast("Proyek disimpan");
});

document.getElementById("btnDeleteProject").addEventListener("click", async ()=>{
  const id = document.getElementById("pId").value;
  if(!id) return;
  if(!confirm("Hapus proyek ini beserta seluruh entrinya? Tindakan tidak bisa dibatalkan.")) return;
  DB.projects = DB.projects.filter(p=>p.id !== id);
  DB.entries = DB.entries.filter(e=>e.projectId !== id);
  if(state.activeProjectId === id) state.activeProjectId = null;
  await saveDB();
  closeProjectModal();
  renderProjectList();
  renderProjectView();
  showToast("Proyek dihapus");
});

function renderProjectList(){
  const list = document.getElementById("projectList");
  list.innerHTML = "";
  DB.projects.forEach(p=>{
    const div = document.createElement("div");
    div.className = "project-item" + (p.id === state.activeProjectId ? " active" : "");
    div.textContent = p.nama;
    div.addEventListener("click", ()=>{
      state.activeProjectId = p.id;
      renderProjectList();
      renderProjectView();
    });
    list.appendChild(div);
  });
}

function renderProjectView(){
  const project = getActiveProject();
  document.getElementById("emptyState").classList.toggle("hidden", !!project);
  document.getElementById("projectView").classList.toggle("hidden", !project);
  if(!project) return;

  document.getElementById("pjName").textContent = project.nama;
  document.getElementById("pjMeta").textContent =
    [project.lokasi, project.penanggungJawab ? "PJ: " + project.penanggungJawab : ""].filter(Boolean).join(" • ");

  resetEntryForm();
  setDefaultRanges();
  renderAllEntryLists();
  renderImportedDocsList();
}

/* ---------- TABS ---------- */
document.querySelectorAll(".tab-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    state.activeTab = btn.dataset.tab;
  });
});

/* ---------- ENTRY FORM (harian) ---------- */
let pendingFotos = [];

document.getElementById("fFoto").addEventListener("change", async (e)=>{
  const files = Array.from(e.target.files);
  for(const f of files){
    const b64 = await fileToCompressedBase64(f);
    pendingFotos.push(b64);
  }
  renderFotoPreview();
  e.target.value = "";
});

function renderFotoPreview(){
  const wrap = document.getElementById("fotoPreview");
  wrap.innerHTML = "";
  pendingFotos.forEach((src, idx)=>{
    const img = document.createElement("img");
    img.src = src;
    img.title = "Klik untuk hapus";
    img.addEventListener("click", ()=>{
      pendingFotos.splice(idx,1);
      renderFotoPreview();
    });
    wrap.appendChild(img);
  });
}

function resetEntryForm(){
  state.editingEntryId = null;
  document.getElementById("entryForm").reset();
  document.getElementById("fTanggal").value = todayStr();
  document.getElementById("fWaktu").value = nowTimeStr();
  pendingFotos = [];
  renderFotoPreview();
  document.getElementById("entryFormTitle").textContent = "Tambah Entri Harian";
  document.getElementById("btnCancelEdit").classList.add("hidden");
}

document.getElementById("btnCancelEdit").addEventListener("click", resetEntryForm);

document.getElementById("entryForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const project = getActiveProject();
  if(!project) return;

  const data = {
    projectId: project.id,
    judul: document.getElementById("fJudul").value.trim(),
    tanggal: document.getElementById("fTanggal").value,
    waktu: document.getElementById("fWaktu").value,
    keterangan: document.getElementById("fKeterangan").value.trim(),
    progress: document.getElementById("fProgress").value,
    cuaca: document.getElementById("fCuaca").value,
    tenagaKerja: document.getElementById("fTenagaKerja").value,
    kendala: document.getElementById("fKendala").value.trim(),
    rencana: document.getElementById("fRencana").value.trim(),
    fotos: pendingFotos.slice()
  };

  if(state.editingEntryId){
    const entry = DB.entries.find(x=>x.id === state.editingEntryId);
    Object.assign(entry, data);
  } else {
    DB.entries.push({id: uid(), ...data});
  }

  await saveDB();
  resetEntryForm();
  renderAllEntryLists();
  showToast("Entri disimpan");
});

function editEntry(id){
  const entry = DB.entries.find(x=>x.id===id);
  if(!entry) return;
  state.editingEntryId = id;
  document.getElementById("fJudul").value = entry.judul;
  document.getElementById("fTanggal").value = entry.tanggal;
  document.getElementById("fWaktu").value = entry.waktu;
  document.getElementById("fKeterangan").value = entry.keterangan;
  document.getElementById("fProgress").value = entry.progress || "";
  document.getElementById("fCuaca").value = entry.cuaca || "";
  document.getElementById("fTenagaKerja").value = entry.tenagaKerja || "";
  document.getElementById("fKendala").value = entry.kendala || "";
  document.getElementById("fRencana").value = entry.rencana || "";
  pendingFotos = (entry.fotos || []).slice();
  renderFotoPreview();
  document.getElementById("entryFormTitle").textContent = "Edit Entri Harian";
  document.getElementById("btnCancelEdit").classList.remove("hidden");
  document.querySelector('.tab-btn[data-tab="harian"]').click();
  window.scrollTo({top:0, behavior:"smooth"});
}

async function deleteEntry(id){
  if(!confirm("Hapus entri ini?")) return;
  DB.entries = DB.entries.filter(x=>x.id !== id);
  await saveDB();
  renderAllEntryLists();
  showToast("Entri dihapus");
}

/* ---------- RENDER ENTRY LISTS ---------- */
function entryCardHTML(entry, showEdit){
  const tags = [];
  if(entry.progress !== "" && entry.progress != null) tags.push(`Progress: ${entry.progress}%`);
  if(entry.cuaca) tags.push(`Cuaca: ${entry.cuaca}`);
  if(entry.tenagaKerja) tags.push(`Tenaga kerja: ${entry.tenagaKerja} orang`);

  return `
  <div class="entry-card" data-id="${entry.id}">
    <div class="entry-card-head">
      <div>
        <h4>${escapeHtml(entry.judul)}</h4>
        <p class="muted">${fmtDate(entry.tanggal)} • ${entry.waktu}</p>
      </div>
      ${showEdit ? `
      <div class="entry-actions">
        <button class="btn btn-ghost btn-sm" onclick="editEntry('${entry.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteEntry('${entry.id}')">Hapus</button>
      </div>` : ""}
    </div>
    <p>${escapeHtml(entry.keterangan)}</p>
    ${tags.length ? `<div class="entry-tags">${tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>` : ""}
    ${entry.kendala ? `<p><b>Kendala:</b> ${escapeHtml(entry.kendala)}</p>` : ""}
    ${entry.rencana ? `<p><b>Rencana selanjutnya:</b> ${escapeHtml(entry.rencana)}</p>` : ""}
    ${entry.fotos && entry.fotos.length ? `<div class="entry-fotos">${entry.fotos.map(f=>`<img src="${f}">`).join("")}</div>` : ""}
  </div>`;
}

function escapeHtml(str){
  if(!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function getEntriesForProject(){
  const project = getActiveProject();
  if(!project) return [];
  return DB.entries
    .filter(e=>e.projectId === project.id)
    .sort((a,b)=> (b.tanggal+b.waktu).localeCompare(a.tanggal+a.waktu));
}

function renderAllEntryLists(){
  renderHarianList();
  renderMingguanList();
  renderBulananList();
}

function renderHarianList(){
  const wrap = document.getElementById("entryListHarian");
  const entries = getEntriesForProject();
  wrap.innerHTML = entries.length
    ? entries.map(e=>entryCardHTML(e, true)).join("")
    : `<div class="no-data">Belum ada entri harian.</div>`;
}

function setDefaultRanges(){
  const now = new Date();
  const day = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now); monday.setDate(now.getDate() - day + 1);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  document.getElementById("wStart").value = monday.toISOString().slice(0,10);
  document.getElementById("wEnd").value = sunday.toISOString().slice(0,10);
  document.getElementById("mMonth").value = now.toISOString().slice(0,7);
}

function renderMingguanList(){
  const wrap = document.getElementById("entryListMingguan");
  const start = document.getElementById("wStart").value;
  const end = document.getElementById("wEnd").value;
  const entries = getEntriesForProject().filter(e=> e.tanggal >= start && e.tanggal <= end);
  wrap.innerHTML = entries.length
    ? entries.map(e=>entryCardHTML(e, false)).join("")
    : `<div class="no-data">Tidak ada entri pada periode ini.</div>`;
}
document.getElementById("wStart").addEventListener("change", renderMingguanList);
document.getElementById("wEnd").addEventListener("change", renderMingguanList);

function renderBulananList(){
  const wrap = document.getElementById("entryListBulanan");
  const month = document.getElementById("mMonth").value; // YYYY-MM
  const entries = getEntriesForProject().filter(e=> e.tanggal.slice(0,7) === month);
  wrap.innerHTML = entries.length
    ? entries.map(e=>entryCardHTML(e, false)).join("")
    : `<div class="no-data">Tidak ada entri pada bulan ini.</div>`;
}
document.getElementById("mMonth").addEventListener("change", renderBulananList);

/* ---------- EXPORT BUTTONS (logic in export.js) ---------- */
document.querySelectorAll("[data-export]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const project = getActiveProject();
    if(!project){ showToast("Pilih proyek dulu"); return; }
    const scope = btn.dataset.scope; // harian | mingguan | bulanan
    const format = btn.dataset.export; // word | ppt | pdf

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

    if(!entries.length){
      showToast("Tidak ada entri untuk diexport pada periode ini");
      return;
    }

    // sort chronologically for the exported report
    entries = entries.slice().sort((a,b)=>(a.tanggal+a.waktu).localeCompare(b.tanggal+b.waktu));

    const payload = { project, entries, periodeLabel, ringkasan, scope, rangeStart, rangeEnd, month };

    if(format === "word") exportWord(payload);
    else if(format === "ppt") exportPPT(payload);
    else if(format === "pdf") exportPDF(payload);
  });
});

/* ---------- IMPORT DOKUMEN (untuk fitur Gabung Dokumen di combine.js) ---------- */
function fileToDataURL(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function guessMimeFromName(name){
  const ext = (name.split(".").pop() || "").toLowerCase();
  if(ext === "pdf") return "application/pdf";
  if(ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if(ext === "doc") return "application/msword";
  if(ext === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if(ext === "ppt") return "application/vnd.ms-powerpoint";
  if(["png","jpg","jpeg","gif","webp","bmp"].includes(ext)) return "image/" + (ext === "jpg" ? "jpeg" : ext);
  return "application/octet-stream";
}

document.getElementById("fImportDocs").addEventListener("change", async (e)=>{
  const project = getActiveProject();
  if(!project){
    showToast("Pilih proyek dulu sebelum mengimport dokumen");
    e.target.value = "";
    return;
  }
  const files = Array.from(e.target.files);
  for(const f of files){
    try{
      const dataUrl = await fileToDataURL(f);
      DB.importedDocs.push({
        id: uid(),
        projectId: project.id,
        name: f.name,
        mime: f.type || guessMimeFromName(f.name),
        size: f.size,
        data: dataUrl,
        addedAt: Date.now()
      });
    }catch(err){
      console.error("Gagal membaca file:", f.name, err);
      showToast("Gagal membaca file: " + f.name);
    }
  }
  await saveDB();
  renderImportedDocsList();
  showToast("Dokumen ditambahkan (" + files.length + ")");
  e.target.value = "";
});

function docTypeLabel(doc){
  const name = (doc.name || "").toLowerCase();
  const mime = doc.mime || "";
  if(mime.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if(mime.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) return "Word";
  if(mime.includes("presentation") || mime.includes("powerpoint") || name.endsWith(".pptx") || name.endsWith(".ppt")) return "PowerPoint";
  if(mime.startsWith("image/")) return "Gambar";
  return "Berkas";
}

function fmtSize(bytes){
  if(!bytes && bytes !== 0) return "-";
  if(bytes < 1024) return bytes + " B";
  if(bytes < 1024*1024) return (bytes/1024).toFixed(1) + " KB";
  return (bytes/1024/1024).toFixed(2) + " MB";
}

function getImportedDocsForProject(){
  const project = getActiveProject();
  if(!project) return [];
  return DB.importedDocs.filter(d=>d.projectId === project.id);
}

function renderImportedDocsList(){
  const wrap = document.getElementById("importedDocsList");
  if(!wrap) return;
  const docs = getImportedDocsForProject();
  if(!docs.length){
    wrap.innerHTML = `<div class="no-data">Belum ada dokumen diimport. Upload PDF, Word (.docx), atau gambar di atas untuk mulai digabungkan.</div>`;
    return;
  }
  wrap.innerHTML = docs.map((d, idx)=>`
    <div class="imported-doc-item" data-id="${d.id}">
      <div class="doc-info">
        <span class="doc-name">${idx+1}. ${escapeHtml(d.name)}</span>
        <span class="doc-meta">${docTypeLabel(d)} • ${fmtSize(d.size)}</span>
      </div>
      <div class="doc-actions">
        <button class="btn btn-ghost btn-sm" title="Naikkan urutan" onclick="moveImportedDoc('${d.id}', -1)" ${idx===0 ? "disabled" : ""}>▲</button>
        <button class="btn btn-ghost btn-sm" title="Turunkan urutan" onclick="moveImportedDoc('${d.id}', 1)" ${idx===docs.length-1 ? "disabled" : ""}>▼</button>
        <button class="btn btn-danger btn-sm" onclick="deleteImportedDoc('${d.id}')">Hapus</button>
      </div>
    </div>`).join("");
}

async function moveImportedDoc(id, dir){
  const project = getActiveProject();
  if(!project) return;
  const projectDocs = DB.importedDocs.filter(d=>d.projectId === project.id);
  const posInSub = projectDocs.findIndex(d=>d.id === id);
  const swapWith = posInSub + dir;
  if(posInSub === -1 || swapWith < 0 || swapWith >= projectDocs.length) return;

  const idA = projectDocs[posInSub].id;
  const idB = projectDocs[swapWith].id;
  const iA = DB.importedDocs.findIndex(d=>d.id === idA);
  const iB = DB.importedDocs.findIndex(d=>d.id === idB);
  const tmp = DB.importedDocs[iA];
  DB.importedDocs[iA] = DB.importedDocs[iB];
  DB.importedDocs[iB] = tmp;

  await saveDB();
  renderImportedDocsList();
}

async function deleteImportedDoc(id){
  if(!confirm("Hapus dokumen import ini?")) return;
  DB.importedDocs = DB.importedDocs.filter(d=>d.id !== id);
  await saveDB();
  renderImportedDocsList();
  showToast("Dokumen dihapus");
}

/* ---------- INIT ---------- */
(async function init(){
  await loadDB();
  renderProjectList();
  if(DB.projects.length && !state.activeProjectId){
    state.activeProjectId = DB.projects[0].id;
  }
  renderProjectList();
  renderProjectView();
})();
