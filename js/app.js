const API_BASE = "https://zerotime-api.matteoriserva0411.workers.dev";

let simMinutes   = 0;
let companies    = [];
let adminToken   = null;
let clockTick    = null;
let adminRefresh = null;

async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (adminToken) opts.headers["X-Admin-Token"] = adminToken;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function syncClock() {
  try {
    const { minutes } = await api("GET", "/api/clock");
    simMinutes = minutes;
    renderClock();
  } catch (e) { console.warn("Clock sync error:", e); }
}

function renderClock() {
  const h = Math.floor(simMinutes / 60) % 24;
  const m = simMinutes % 60;
  const el = document.getElementById("clock");
  el.textContent = pad(h) + ":" + pad(m);
  el.classList.remove("tick");
  void el.offsetWidth;
  el.classList.add("tick");
  setTimeout(() => el.classList.remove("tick"), 150);
}

function tickLocal() {
  simMinutes = (simMinutes + 1) % (24 * 60);
  renderClock();
  renderCompanies();
}

function startClock() {
  syncClock();
  clockTick = setInterval(tickLocal, 7000);
  setInterval(syncClock, 30000);
}

async function loadCompanies() {
  try {
    companies = await api("GET", "/api/companies");
    renderCompanies();
  } catch (e) {
    document.getElementById("companiesGrid").innerHTML =
      '<p style="color:var(--text-muted);text-align:center;padding:40px 0">Errore nel caricamento aziende.</p>';
  }
}

function isOpen(hoursStr, closedDays) {
  const dayNames = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
  const now = simMinutes;

  if (closedDays) {
    const todayName = dayNames[Math.floor(simMinutes / (24 * 60)) % 7];
    const closed = closedDays.split(",").map(s => s.trim());
    if (closed.some(d => d === todayName)) return false;
  }

  const ranges = [...hoursStr.matchAll(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/g)];
  if (!ranges.length) return true;
  return ranges.some(m => {
    const open  = toMin(m[1]);
    const close = toMin(m[2]);
    return close > open ? now >= open && now < close : now >= open || now < close;
  });
}

function renderCompanies() {
  const grid    = document.getElementById("companiesGrid");
  const empty   = document.getElementById("emptyState");
  const countEl = document.getElementById("openCount");

  const open = companies
    .filter(c => isOpen(c.hours, c.closedDays))
    .sort((a, b) => {
      if (a.important !== b.important) return a.important ? -1 : 1;
      return a.name.localeCompare(b.name, "it");
    });

  countEl.textContent = open.length + (open.length === 1 ? " aperta" : " aperte");

  if (!open.length) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  grid.innerHTML = open.map(c => `
    <div class="company-card ${c.important ? "important" : ""}">
      <div class="company-info">
        <div class="company-name">
          ${c.important ? '<span class="important-star">★</span>' : ""}
          ${esc(c.name)}
        </div>
        <div class="company-hours">${esc(c.hours)}</div>
      </div>
      <div class="company-meta">
        ${c.coords  ? `<span class="meta-tag">📍 ${esc(c.coords)}</span>` : ""}
        ${c.channel ? `<span class="meta-tag">📢 ${esc(c.channel)}</span>` : ""}
      </div>
    </div>`).join("");
}

function openAddCompany() {
  ["f_name","f_hours","f_closedDays","f_coords","f_channel","f_telegram"].forEach(id => document.getElementById(id).value = "");
  openModal("addCompanyModal");
}

function validateCoords(val) {
  return /^-?\d+;-?\d+;-?\d+$/.test(val);
}

function validateHours(val) {
  return /^"[^"]+"/.test(val);
}

async function submitCompanyForm() {
  const name       = document.getElementById("f_name").value.trim();
  const hours      = document.getElementById("f_hours").value.trim();
  const closedDays = document.getElementById("f_closedDays").value.trim();
  const coords     = document.getElementById("f_coords").value.trim();
  const channel    = document.getElementById("f_channel").value.trim();
  const telegram   = document.getElementById("f_telegram").value.trim();

  if (!name || !hours || !coords || !channel || !telegram) {
    showToast("⚠️ Compila tutti i campi obbligatori."); return;
  }
  if (!validateCoords(coords)) {
    showToast('⚠️ Coordinate non valide. Usa il formato X;Y;Z es. 102;66;34'); return;
  }
  if (!validateHours(hours)) {
    showToast('⚠️ Orari non validi. Inizia con le virgolette, es. "Lun-Ven 08:00-18:00"'); return;
  }

  const btn = document.getElementById("submitBtn");
  btn.disabled = true; btn.textContent = "Invio…";
  try {
    await api("POST", "/api/pending", { name, hours, closedDays, coords, channel, telegram });
    closeModal("addCompanyModal");
    showToast("✅ Richiesta inviata! In attesa di approvazione.");
  } catch (e) {
    showToast("❌ Errore: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Invia Richiesta";
  }
}

function openAdminLogin() {
  document.getElementById("adminPassword").value = "";
  document.getElementById("loginError").style.display = "none";
  openModal("adminLoginModal");
}

async function checkAdminLogin() {
  const pw = document.getElementById("adminPassword").value;
  const hash = await sha256(pw);
  adminToken = hash;
  try {
    await api("GET", "/api/admin/pending");
    closeModal("adminLoginModal");
    openAdmin();
  } catch (e) {
    adminToken = null;
    document.getElementById("loginError").style.display = "block";
  }
}

async function sha256(msg) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function openAdmin() {
  document.getElementById("mainSite").style.display   = "none";
  document.getElementById("mainHeader").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";
  loadAdminData();
  adminRefresh = setInterval(loadAdminData, 15000);
}

function closeAdmin() {
  document.getElementById("adminPanel").style.display = "none";
  document.getElementById("mainHeader").style.display = "";
  document.getElementById("mainSite").style.display   = "";
  clearInterval(adminRefresh);
  loadCompanies();
}

async function loadAdminData() {
  await Promise.all([loadPending(), loadAdminCompanies()]);
  document.getElementById("adminCurrentTime").textContent = minsToStr(simMinutes);
  document.getElementById("adminTimeInput").value = minsToStr(simMinutes);
}

async function setAdminTime() {
  const val = document.getElementById("adminTimeInput").value;
  if (!val) return;
  const minutes = toMin(val);
  try {
    await api("PUT", "/api/admin/clock", { minutes });
    simMinutes = minutes;
    renderClock();
    showToast("⏱ Orario impostato: " + val);
  } catch (e) { showToast("❌ " + e.message); }
}

async function loadPending() {
  const el = document.getElementById("pendingList");
  try {
    const pending = await api("GET", "/api/admin/pending");
    if (!pending.length) { el.innerHTML = '<div class="empty-admin">Nessuna richiesta in attesa.</div>'; return; }
    el.innerHTML = pending.map(p => `
      <div class="pending-card" id="pcard_${p.id}">
        <div class="pending-name">${esc(p.name)}</div>
        <div class="pending-info"><strong>Orari:</strong> ${esc(p.hours)}</div>
        ${p.closedDays ? `<div class="pending-info"><strong>Chiuso:</strong> ${esc(p.closedDays)}</div>` : ""}
        <div class="pending-info"><strong>Coordinate:</strong> ${esc(p.coords)}</div>
        <div class="pending-info"><strong>Canale:</strong> ${esc(p.channel)}</div>
        <div class="pending-info"><strong>Contatto:</strong> ${esc(p.telegram)}</div>
        <div class="pending-actions">
          <button class="btn-approve" onclick="approveRequest(${p.id})">✓ Approva</button>
          <button class="btn-reject"  onclick="rejectRequest(${p.id})">✕ Rifiuta</button>
        </div>
      </div>`).join("");
  } catch (e) { el.innerHTML = `<div class="empty-admin">Errore: ${esc(e.message)}</div>`; }
}

async function approveRequest(id) {
  try {
    await api("POST", `/api/admin/pending/${id}/approve`);
    showToast("✅ Azienda approvata");
    loadAdminData(); loadCompanies();
  } catch (e) { showToast("❌ " + e.message); }
}

async function rejectRequest(id) {
  try {
    await api("DELETE", `/api/admin/pending/${id}`);
    showToast("🗑 Richiesta rifiutata");
    loadPending();
  } catch (e) { showToast("❌ " + e.message); }
}

async function loadAdminCompanies() {
  const el = document.getElementById("adminCompaniesList");
  try {
    const list = await api("GET", "/api/companies");
    const sorted = [...list].sort((a,b) => {
      if (a.important !== b.important) return a.important ? -1 : 1;
      return a.name.localeCompare(b.name, "it");
    });
    if (!sorted.length) { el.innerHTML = '<div class="empty-admin">Nessuna azienda registrata.</div>'; return; }
    el.innerHTML = sorted.map(c => `
      <div class="admin-company-item">
        <div class="admin-co-info">
          <div class="admin-co-name">${esc(c.name)}</div>
          <div class="admin-co-meta">${esc(c.hours)} · ${esc(c.channel)}</div>
        </div>
        <div class="admin-co-actions">
          <button class="toggle-important ${c.important ? "active" : ""}"
            onclick="toggleImportant(${c.id}, ${!c.important})">
            ${c.important ? "★ Importante" : "☆ Importante"}
          </button>
          <button class="btn-delete-co" onclick="deleteCompany(${c.id})" title="Elimina">✕</button>
        </div>
      </div>`).join("");
  } catch (e) { el.innerHTML = `<div class="empty-admin">Errore: ${esc(e.message)}</div>`; }
}

async function toggleImportant(id, value) {
  try {
    await api("PUT", `/api/admin/companies/${id}`, { important: value });
    loadAdminCompanies(); loadCompanies();
    showToast(value ? "★ Contrassegnata come importante" : "Rimossa da importanti");
  } catch (e) { showToast("❌ " + e.message); }
}

async function deleteCompany(id) {
  try {
    await api("DELETE", `/api/admin/companies/${id}`);
    showToast("🗑 Azienda eliminata");
    loadAdminCompanies(); loadCompanies();
  } catch (e) { showToast("❌ " + e.message); }
}

function openTelegram() { window.open("https://t.me/ozziuqs", "_blank", "noopener"); }

function openModal(id)  { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

function pad(n)       { return String(n).padStart(2,"0"); }
function toMin(str)   { const [h,m] = str.split(":").map(Number); return h*60+m; }
function minsToStr(m) { return pad(Math.floor(m/60)%24) + ":" + pad(m%60); }
function esc(s)       { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

document.querySelectorAll(".modal-overlay").forEach(o =>
  o.addEventListener("click", e => { if (e.target === o) o.classList.remove("open"); })
);

startClock();
loadCompanies();
setInterval(loadCompanies, 60000);
