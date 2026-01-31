/* AMF_1.009 */
(() => {
  const BUILD = "AMF_1.009";
  const DISPLAY = "1.009";

  // --- Helpers
  const $ = (sel) => document.querySelector(sel);

  const toastEl = $("#toast");
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function apiHintIfUnknownAction(err) {
    const msg = String(err && err.message ? err.message : err);
    if (msg.toLowerCase().includes("unknown action")) {
      toast("API non aggiornata: ridistribuisci Code.gs (Web App) e riprova");
      return true;
    }
    return false;
  }


  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  // Date helpers (robust with ISO/timezone): always interpret as LOCAL calendar date (iOS-safe)
  function dateOnlyLocal(value) {
    if (value == null || value === "") return null;

    if (value instanceof Date) {
      if (isNaN(value)) return null;
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }

    const s = String(value).trim();
    if (!s) return null;

    // YYYY-MM-DD (date-only)
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const d = parseInt(m[3], 10);
      return new Date(y, mo, d);
    }

    // dd/mm/yyyy (common Sheet formatting)
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const y = parseInt(m[3], 10);
      return new Date(y, mo, d);
    }

    // dd/mm/yy (two-digit year, common mobile shorthand)
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (m) {
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const yy = parseInt(m[3], 10);
      const y = (yy >= 70) ? (1900 + yy) : (2000 + yy);
      return new Date(y, mo, d);
    }

    // ISO / any parsable datetime -> convert to LOCAL date (fixes -1 day when server returns UTC date-times)
    const dt = new Date(s);
    if (!isNaN(dt)) {
      return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }

    // Fallback: extract YYYY-MM-DD prefix
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const d = parseInt(m[3], 10);
      return new Date(y, mo, d);
    }

    return null;
  }

  function ymdLocal(value) {
    const d = dateOnlyLocal(value);
    if (!d) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function getSession() {
    return safeJsonParse(localStorage.getItem("AMF_SESSION") || "", null);
  }
  function setSession(user) {
    localStorage.setItem("AMF_SESSION", JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem("AMF_SESSION");
  }

  // Migrazione build: se cambia build e config.js ha un URL valido, aggiorna l"API_URL locale
  // (evita che resti salvato un vecchio endpoint).
  (function migrateApiUrlOnBuild() {
    try {
      const last = (localStorage.getItem("AMF_LAST_BUILD") || "").trim();
      const cfg = (window.AMF_CONFIG && String(window.AMF_CONFIG.API_URL || "").trim()) || "";
      const cfgOk = cfg && cfg.startsWith("http") && !cfg.includes("PASTE_YOUR_GAS_WEBAPP_URL_HERE");
      if (cfgOk && last && last != BUILD) {
        localStorage.setItem("AMF_API_URL", cfg);
      }
      // se non esiste ancora, imposta comunque il default
      if (cfgOk && !(localStorage.getItem("AMF_API_URL") || "").trim()) {
        localStorage.setItem("AMF_API_URL", cfg);
      }
      localStorage.setItem("AMF_LAST_BUILD", BUILD);
    } catch (_) {}
  })();

  // --- API URL config (config.js + localStorage override)
  function getApiUrl() {
    const fromLs = (localStorage.getItem("AMF_API_URL") || "").trim();
    if (fromLs) return fromLs;

    const cfg = (window.AMF_CONFIG && String(window.AMF_CONFIG.API_URL || "").trim()) || "";
    if (!cfg) return "";
    if (cfg.includes("PASTE_YOUR_GAS_WEBAPP_URL_HERE")) return "";
    return cfg;
  }

  function setApiUrl(url) {
    localStorage.setItem("AMF_API_URL", url.trim());
  }


  function getDefaultApiUrl() {
    const cfg = (window.AMF_CONFIG && String(window.AMF_CONFIG.API_URL || "").trim()) || "";
    if (!cfg) return "";
    if (cfg.includes("PASTE_YOUR_GAS_WEBAPP_URL_HERE")) return "";
    return cfg;
  }

  // Se la build cambia e nel pacchetto c'è un API_URL valido, aggiorna quello salvato in locale
  (() => {
    const def = getDefaultApiUrl();
    const last = (localStorage.getItem("AMF_LAST_BUILD") || "").trim();
    if (def && last !== BUILD) {
      localStorage.setItem("AMF_API_URL", def);
    }
    if (last !== BUILD) {
      localStorage.setItem("AMF_LAST_BUILD", BUILD);
    }
  })();

  // Modal API
  const modalApi = $("#modalApi");
  const apiUrlInput = $("#apiUrlInput");
  const btnApiCancel = $("#btnApiCancel");
  const btnApiSave = $("#btnApiSave");

  let apiModalResolve = null;

  function openApiModal() {
    if (!modalApi) return Promise.resolve(false);
    modalApi.classList.add("show");
    modalApi.setAttribute("aria-hidden", "false");
    apiUrlInput.value = getApiUrl() || "";
    apiUrlInput.focus();
    return new Promise((resolve) => { apiModalResolve = resolve; });
  }

  function closeApiModal(ok) {
    if (!modalApi) return;
    modalApi.classList.remove("show");
    modalApi.setAttribute("aria-hidden", "true");
    if (apiModalResolve) {
      apiModalResolve(!!ok);
      apiModalResolve = null;
    }
  }

  btnApiCancel?.addEventListener("click", () => closeApiModal(false));
  btnApiSave?.addEventListener("click", async () => {
    const u = (apiUrlInput.value || "").trim();
    if (!u || !u.startsWith("http")) {
      toast("Inserisci un URL valido");
      return;
    }
    setApiUrl(u);
    try {
      await api("ping", {});
      toast("Collegamento OK");
      closeApiModal(true);
    } catch (e) {
      toast("URL non valido o non raggiungibile");
    }
  });

  async function ensureApiReady() {
    if (getApiUrl()) return true;
    const ok = await openApiModal();
    return ok && !!getApiUrl();
  }

  function buildUrl(action, params) {
    const base = getApiUrl();
    const sp = new URLSearchParams();
    sp.set("action", action);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      sp.set(k, String(v));
    });
    return base + (base.includes("?") ? "&" : "?") + sp.toString();
  }

  function apiJsonp(action, params) {
    const cb = "AMF_JSONP_" + Math.random().toString(36).slice(2);
    const url = buildUrl(action, Object.assign({}, params || {}, {
      callback: cb,
      _: Date.now()
    }));

    return new Promise((resolve, reject) => {
      let done = false;
      let script = null;

      function cleanup() {
        try { if (script && script.parentNode) script.parentNode.removeChild(script); } catch (_) {}
        try { delete window[cb]; } catch (_) { window[cb] = undefined; }
      }

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("Failed to fetch"));
      }, 12000);

      window[cb] = (data) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();

        if (!data || data.ok !== true) {
          reject(new Error((data && data.error) ? String(data.error) : "Errore API"));
          return;
        }
        resolve(data);
      };

      script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error("Failed to fetch"));
      };
      document.head.appendChild(script);
    });
  }

  async function api(action, params) {
    const base = getApiUrl();
    if (!base) throw new Error("API_URL_MISSING");

    // iOS PWA: JSONP evita blocchi CORS/redirect (fallback a fetch se serve)
    try {
      return await apiJsonp(action, params);
    } catch (_) {
      const url = buildUrl(action, Object.assign({}, params || {}, { _: Date.now() }));
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!data || data.ok !== true) {
        throw new Error((data && data.error) ? String(data.error) : "Errore API");
      }
      return data;
    }
  }

  
  // ---- API cache (performance)
  const __apiCache = new Map(); // key -> { t, data }

  function __apiCacheKey(action, params) {
    try { return action + "|" + JSON.stringify(params || {}); } catch { return action; }
  }
  function invalidateApiCache(prefix) {
    const p = String(prefix || "");
    for (const k of Array.from(__apiCache.keys())) {
      if (!p || k.startsWith(p + "|") || k.startsWith(p)) __apiCache.delete(k);
    }
  }
  async function apiCached(action, params, ttlMs) {
    const key = __apiCacheKey(action, params);
    const now = Date.now();
    const hit = __apiCache.get(key);
    if (hit && (now - hit.t) < (ttlMs || 8000)) return hit.data;
    const data = await api(action, params);
    __apiCache.set(key, { t: now, data });
    return data;
  }

// --- Views / Routing
  const views = {
    home: $("#viewHome"),
    auth: $("#viewAuth"),
    create: $("#viewCreate"),
    login: $("#viewLogin"),
    modify: $("#viewModify"),
    settings: $("#viewSettings"),
    patients: $("#viewPatients"),
    patientForm: $("#viewPatientForm"),
    calendar: $("#viewCalendar")
  };

  const btnTopRight = $("#btnTopRight");
  const iconTopRight = $("#iconTopRight");
  const btnTopPlus = $("#btnTopPlus");
  const btnCalPrev = $("#btnCalPrev");
  const btnCalToday = $("#btnCalToday");
  const btnCalNext = $("#btnCalNext");
  const btnCalMonth = $("#btnCalMonth");

  function setTopRight(mode) {
    if (!btnTopRight || !iconTopRight) return;
    iconTopRight.innerHTML = "";
    if (mode === "home") {
      btnTopRight.setAttribute("aria-label", "Home");
      // home icon
      iconTopRight.innerHTML = '<path d="M3 10.5 12 3l9 7.5"></path><path d="M5 10v11h14V10"></path><path d="M10 21v-6h4v6"></path>';
    } else {
      btnTopRight.setAttribute("aria-label", "Impostazioni");
      // settings icon
      iconTopRight.innerHTML = '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path><path d="M19.4 15a7.9 7.9 0 0 0 .1-1l2-1.5-2-3.5-2.4 1a8.6 8.6 0 0 0-1.7-1L15 5H9L8.6 7.9a8.6 8.6 0 0 0-1.7 1L4.5 8l-2 3.5L4.5 13a7.9 7.9 0 0 0 .1 1l-2 1.5 2 3.5 2.4-1a8.6 8.6 0 0 0 1.7 1L9 19h6l.4-2.9a8.6 8.6 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5Z"></path>';
    }
  }

  let currentView = "home";

  function showView(name) {
    Object.entries(views).forEach(([k, el]) => {
      if (!el) return;
      el.classList.toggle("active", k === name);
    });
    currentView = name;

    // Home: right is settings. Others: right is home.
    if (name === "home") setTopRight("settings");
    else setTopRight("home");

    setTopPlusVisible(name === "patients");
    setCalendarControlsVisible(name === "calendar");
  }

  btnTopRight?.addEventListener("click", () => {
    if (currentView === "home") {
      openSettingsFlow();
    } else {
      showView("home");
    }
  });

  function setTopPlusVisible(isVisible) {
    if (!btnTopPlus) return;
    btnTopPlus.hidden = !isVisible;
  }


  function setCalendarControlsVisible(isVisible) {
    const list = [btnCalPrev, btnCalToday, btnCalNext, btnCalMonth];
    list.forEach((b) => { if (b) b.hidden = !isVisible; });
  }


  btnTopPlus?.addEventListener("click", () => {
    openPatientCreate();
  });


  // --- Home routes placeholders
  const routes = {
    
    pazienti: () => openPatientsFlow(),
    calendario: () => openCalendarFlow(),
    statistiche: () => toast("Statistiche (da implementare)")
  };
  document.querySelectorAll("[data-route]").forEach((btn) => {
    btn.addEventListener("click", () => {
        // UI: evidenzia selezione
        timePickList.querySelectorAll(".pill-btn.selected").forEach((el) => el.classList.remove("selected")); 
        btn.classList.add("selected");
      const r = btn.getAttribute("data-route");
      (routes[r] || (() => {}))();
    });
  });


  // --- Calendario
  const calDateTitle = $("#calDateTitle");
  const calDaysCol = $("#calDaysCol");
  const calHoursRow = $("#calHoursRow");
  const calBody = $("#calBody");

  const CAL_DAYS = [
    { key: 1, label: "LU" },
    { key: 2, label: "MA" },
    { key: 3, label: "ME" },
    { key: 4, label: "GI" },
    { key: 5, label: "VE" },
    { key: 6, label: "SA" }
  ];

  let calSelectedDate = new Date();
  let calHours = [];
  let calBuilt = false;
  let calSlotPatients = new Map(); // key "dayKey|HH:MM" -> {count, ids:[]}

function __normDayLabel(v) {
  let s = String(v || "").trim().toUpperCase();
  if (!s) return "";
  // remove accents (VENERDÌ -> VENERDI) — Safari-safe
  try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  // keep only letters/numbers
  return s.replace(/[^A-Z0-9]/g, "");
}

const DAY_LABEL_TO_KEY = {
  // Abbreviazioni
  LU: 1, MA: 2, ME: 3, GI: 4, VE: 5, SA: 6,
  // 3-letter
  LUN: 1, MAR: 2, MER: 3, GIO: 4, VEN: 5, SAB: 6,
  // Full (no accents)
  LUNEDI: 1, MARTEDI: 2, MERCOLEDI: 3, GIOVEDI: 4, VENERDI: 5, SABATO: 6
};

function normTime(t) {
  if (t == null || t === "") return "";

  // Date object -> HH:MM
  if (t instanceof Date) {
    if (isNaN(t)) return "";
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // Google Sheets time serials or numeric times
  if (typeof t === "number" && isFinite(t)) {
    let totalMinutes = null;

    // Common Sheet time: fraction of day (0..1)
    if (t >= 0 && t < 1) {
      totalMinutes = Math.round(t * 24 * 60);
    } else if (t >= 1 && t < 24) {
      // hours as number (e.g., 9.5 -> 09:30)
      totalMinutes = Math.round(t * 60);
    } else if (t >= 0 && t < 24 * 60) {
      // minutes as number (fallback)
      totalMinutes = Math.round(t);
    }

    if (totalMinutes != null) {
      const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
      const mm = String(totalMinutes % 60).padStart(2, "0");
      return `${hh}:${mm}`;
    }
  }

  let s = String(t).trim();
  if (!s) return "";

  // Normalize separators (09.30 -> 09:30)
  s = s.replace(".", ":");

  // ISO/DateTime string from Sheets/API (e.g., 1899-12-30T09:00:00.000Z) -> HH:MM
  // Only attempt if it contains a time component
  if ((s.includes("T") || s.includes(" ")) && s.includes(":")) {
    const dt = new Date(s);
    if (!isNaN(dt)) {
      const hh = String(dt.getHours()).padStart(2, "0");
      const mm = String(dt.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
  }

  // "9" or "9:" -> "09:00"
  let m = s.match(/^(\d{1,2})\s*:?$/);
  if (m) {
    const hh = String(parseInt(m[1], 10)).padStart(2, "0");
    return `${hh}:00`;
  }

  // "9:0" -> "09:00"
  m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (m) {
    const hh = String(parseInt(m[1], 10)).padStart(2, "0");
    const mm = String(parseInt(m[2], 10)).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // Already HH:MM
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hh = String(parseInt(m[1], 10)).padStart(2, "0");
    const mm = m[2];
    return `${hh}:${mm}`;
  }

  return s;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "•";
  const a = parts[0][0] || "";
  const b = parts.length > 1 ? (parts[parts.length - 1][0] || "") : "";
  return (a + b).toUpperCase();
}


function parseGiorniMap(raw) {
  if (raw == null) return {};
  if (typeof raw === "object") {
    try { return Object.assign({}, raw); } catch { return {}; }
  }
  const s = String(raw).trim();
  if (!s || s === "—") return {};
  try {
    const obj = JSON.parse(s);
    return (obj && typeof obj === "object") ? obj : {};
  } catch {
    return {};
  }
}

function normalizeTimeList(value) {
  if (value == null) return [];

  // If value is a Sheet serial/number or a Date, normalize directly
  if (typeof value === "number" || value instanceof Date) {
    const t = normTime(value);
    return t ? [t] : [];
  }

  if (Array.isArray(value)) return value.map(normTime).filter(Boolean);

  if (typeof value === "object") {
    const maybe = (value.ora_inizio ?? value.time ?? value.ora ?? value.orario ?? "");
    const t = normTime(maybe);
    return t ? [t] : [];
  }

  const s = String(value).trim();
  if (!s || s === "—") return [];
  const parts = s.split(/[,;\n]+/).map((x) => normTime(x)).filter(Boolean);
  return parts.length ? parts : (normTime(s) ? [normTime(s)] : []);
}



// --- Società cache (id -> {nome, tag})
let societaCache = null;
let societaMapById = new Map();

function buildSocietaMap_(arr) {
  societaMapById = new Map();
  (arr || []).forEach((s) => {
    if (!s) return;
    const id = String(s.id || "").trim();
    if (!id) return;
    const nome = String(s.nome || "").trim();
    const tagRaw = (s.tag !== undefined && s.tag !== null) ? s.tag : 0;
    const tag = Math.max(0, Math.min(5, parseInt(tagRaw, 10) || 0));
    societaMapById.set(id, { id, nome, tag });
  });
}

async function loadSocietaCache(force = false) {
  const user = getSession();
  if (!user || !user.id) return [];
  if (societaCache && !force) return societaCache;
  try {
    const data = await apiCached("listSocieta", { userId: user.id }, 15000);
    const arr = Array.isArray(data && data.societa) ? data.societa : [];
    societaCache = arr;
    buildSocietaMap_(arr);
    return arr;
  } catch {
    societaCache = [];
    buildSocietaMap_([]);
    return [];
  }
}

function getSocietaById(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  return societaMapById.get(key) || null;
}

function getSocNameById(id) {
  const s = getSocietaById(id);
  return s && s.nome ? s.nome : "";
}

function getSocTagIndexById(id) {
  const s = getSocietaById(id);
  return s && s.tag !== undefined && s.tag !== null ? (Number(s.tag) || 0) : 0;
}


function clearCalendarCells() {
  if (!calBody) return;
  if (calSlotPatients && calSlotPatients.clear) calSlotPatients.clear();
  calBody.querySelectorAll(".cal-cell").forEach((c) => {
    c.classList.remove("filled");
    c.innerHTML = "";
    c.removeAttribute("title");
  });
}

function fillCalendarFromPatients(patients) {
  if (!calBody) return;

  // Compute the real date for each weekday cell (Mon-Sat) in the week of calSelectedDate

  function mondayOfWeek(dateObj) {
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);
    const jsDay = d.getDay(); // 0=Sun..6=Sat
    const diff = (jsDay === 0) ? 1 : (1 - jsDay); // Sun -> next Monday, else back to Monday
    d.setDate(d.getDate() + diff);
    return d;
  }

  const weekMon = mondayOfWeek(calSelectedDate);

  function dateForDayKey(dayKey) {
    const d = new Date(weekMon);
    d.setDate(d.getDate() + (parseInt(dayKey, 10) - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function inRange(cellDate, startStr, endStr) {
    if (!cellDate) return false;
    const s = dateOnlyLocal(startStr);
    const e = dateOnlyLocal(endStr);
    const t = cellDate.getTime();
    if (s && t < s.getTime()) return false;
    if (e && t > e.getTime()) return false;
    return true;
  }

  const slots = new Map(); // key -> {count, names:[], ids:[], tags:[]}

  (patients || []).forEach((p) => {
    if (!p || p.isDeleted) return;

    const raw = p.giorni_settimana || p.giorni || "";
    if (!raw) return;

    const map = parseGiorniMap(raw);
    if (!map || typeof map !== "object") return;

    Object.keys(map).forEach((k) => {
      const dayLabel = __normDayLabel(k);
      let dayKey = DAY_LABEL_TO_KEY[dayLabel];
      // support numeric keys (1..6)
      if (!dayKey && /^\d+$/.test(dayLabel)) {
        const n = parseInt(dayLabel, 10);
        if (n >= 1 && n <= 6) dayKey = n;
      }
      if (!dayKey) return;

      // Date-range filter (patient should only appear within its active period)
      const cellDate = dateForDayKey(dayKey);
      if (!inRange(cellDate, p.data_inizio, p.data_fine)) return;

      const times = normalizeTimeList(map[k]);
      if (!times.length) return;

      times.forEach((t) => {
        const slotKey = `${dayKey}|${t}`;
        const prev = slots.get(slotKey) || { count: 0, names: [], ids: [], tags: [] };
        prev.count += 1;
        prev.names.push(p.nome_cognome || "Paziente");
        prev.ids.push(p.id);
        // Tag colore società (da foglio societa)
        prev.tags.push(getSocTagIndexById(p.societa_id || ""));
        slots.set(slotKey, prev);
      });
    });
  });


  calSlotPatients = slots;

  // Render: initials + società dot(s) inside each day/time cell
  calBody.querySelectorAll(".cal-cell").forEach((cell) => {
    const slotKey = `${cell.dataset.dayKey}|${cell.dataset.time}`;
    const info = slots.get(slotKey);
    if (!info) return;

    const names = Array.isArray(info.names) ? info.names : [];
    const tags = Array.isArray(info.tags) ? info.tags : [];

    cell.classList.add("filled");
    cell.innerHTML = "";

    // Text (initials). If multiple patients, show up to 3 initials + counter.
    const inits = names.map((n) => initials(n)).filter(Boolean);
    let txt = "";
    if (inits.length === 1) {
      txt = inits[0];
    } else if (inits.length > 1) {
      const shown = inits.slice(0, 3);
      txt = shown.join(" ");
      if (inits.length > 3) txt += ` +${inits.length - 3}`;
    }

    const textEl = document.createElement("div");
    textEl.className = "cal-cell-text";
    textEl.textContent = txt || "•";
    cell.appendChild(textEl);

    // Dots (unique società tags)
    const uniq = [];
    tags.forEach((t) => {
      const n = Math.max(0, Math.min(5, parseInt(t, 10) || 0));
      if (!uniq.includes(n)) uniq.push(n);
    });

    if (uniq.length === 1) {
      const dot = document.createElement("div");
      dot.className = `cal-socdot t${uniq[0] + 1}`;
      cell.appendChild(dot);
    } else if (uniq.length > 1) {
      const cont = document.createElement("div");
      cont.className = "cal-socdots";
      uniq.slice(0, 3).forEach((tg) => {
        const d = document.createElement("div");
        d.className = `cal-socdot t${tg + 1}`;
        cont.appendChild(d);
      });
      if (uniq.length > 3) {
        const more = document.createElement("div");
        more.className = "cal-socdot cal-socdot-more";
        more.textContent = `+${uniq.length - 3}`;
        cont.appendChild(more);
      }
      cell.appendChild(cont);
    }

    // Tooltip with full names (compact)
    if (names.length) {
      const shown = names.slice(0, 6);
      cell.title = shown.join(", ") + (names.length > 6 ? ` +${names.length - 6}` : "");
    }
  });
}
async function ensurePatientsForCalendar() {
  const user = getSession();
  if (!user || !user.id) return [];
  if (!patientsCache) {
    try { await loadPatients(); } catch { /* ignore */ }
  }
  return Array.isArray(patientsCache) ? patientsCache : [];
}


  function openCalendarFlow() {
    ensureCalendarBuilt();
    showView("calendar");
    updateCalendarUI();
  }

  function ensureCalendarBuilt() {
    if (calBuilt) return;
    if (!calDaysCol || !calHoursRow || !calBody) return;

    // Days column (fixed)
    calDaysCol.innerHTML = "";

    // Empty corner cell (1x1) to align with hours header; pushes days down by 1 row
    const spacer = document.createElement("div");
    spacer.className = "cal-day cal-day-spacer";
    spacer.setAttribute("aria-hidden", "true");
    calDaysCol.appendChild(spacer);
    CAL_DAYS.forEach((d) => {
      const el = document.createElement("div");
      el.className = "cal-day";
      el.textContent = d.label;
      el.dataset.dayKey = String(d.key);
      calDaysCol.appendChild(el);
    });

    // Hours (scrollable) - 30 min slots 06:00 -> 21:30 (coerente con selettore terapia)
    calHours = [];
    for (let h = 6; h <= 21; h++) {
      for (let m = 0; m < 60; m += 30) {
        const hh = String(h).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        calHours.push(`${hh}:${mm}`);
      }
    }

    calHoursRow.innerHTML = "";
    calHours.forEach((t) => {
      const el = document.createElement("div");
      el.className = "cal-hour";
      el.textContent = t;
      calHoursRow.appendChild(el);
    });

    // Body grid
    calBody.innerHTML = "";
    CAL_DAYS.forEach((d) => {
      const row = document.createElement("div");
      row.className = "cal-row";
      row.dataset.dayKey = String(d.key);

      calHours.forEach((t) => {
        const cell = document.createElement("div");
        cell.className = "cal-cell";
        cell.dataset.dayKey = String(d.key);
        cell.dataset.time = t;
        cell.addEventListener("click", async () => {
          const slotKey = `${cell.dataset.dayKey}|${cell.dataset.time}`;
          const info = calSlotPatients && calSlotPatients.get ? calSlotPatients.get(slotKey) : null;
          const ids = info && Array.isArray(info.ids) ? info.ids.filter((x) => x != null) : [];
          if (ids.length === 0) return;
          if (ids.length !== 1) {
            toast("Più pazienti in questo slot");
            return;
          }
          const pid = ids[0];
          const patients = await ensurePatientsForCalendar();
          const p = (patients || []).find((x) => String(x.id) === String(pid));
          if (!p) { toast("Paziente non trovato"); return; }
          openPatientExisting(p);
        });
        row.appendChild(cell);
      });

      calBody.appendChild(row);
    });

    // Topbar calendar controls
    btnCalPrev?.addEventListener("click", () => { shiftCalendarDay(-1); });
    btnCalNext?.addEventListener("click", () => { shiftCalendarDay(1); });
    btnCalToday?.addEventListener("click", () => { calSelectedDate = new Date(); updateCalendarUI(); });
    btnCalMonth?.addEventListener("click", () => toast("Vista mese (da implementare)"));

    calBuilt = true;
  }

  function shiftCalendarDay(delta) {
    const d = new Date(calSelectedDate);
    d.setDate(d.getDate() + delta);
    calSelectedDate = d;
    updateCalendarUI();
  }

  function formatItDate(dateObj) {
    const fmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });
    let s = fmt.format(dateObj);
    // Capitalizza mese (Febbraio, Marzo, ...)
    return s.replace(/(\d+ )([a-zàèéìòù]+)( \d+)/i, (m, a, b, c) => `${a}${b.charAt(0).toUpperCase()}${b.slice(1)}${c}`);
  }

  async function updateCalendarUI() {
  if (!calDateTitle || !calDaysCol) return;

  calDateTitle.textContent = formatItDate(calSelectedDate);

  // Active weekday (Mon-Sat only)
  const jsDay = calSelectedDate.getDay(); // 0=Sun ... 6=Sat
  const key = jsDay === 0 ? 7 : jsDay; // 7=Sun (not present)
  calDaysCol.querySelectorAll(".cal-day").forEach((el) => {
    el.classList.toggle("active", el.dataset.dayKey === String(key));
  });

  // Fill therapies from patients schedule
  clearCalendarCells();
  await loadSocietaCache();
  const patients = await ensurePatientsForCalendar();
  fillCalendarFromPatients(patients);
}


  // Build label
  const buildLabel = $("#buildLabel");
  if (buildLabel) buildLabel.textContent = DISPLAY;

  // --- Auth buttons
  $("#btnGoCreate")?.addEventListener("click", () => showView("create"));
  $("#btnGoModify")?.addEventListener("click", () => openModify());
  $("#btnGoLogin")?.addEventListener("click", () => openLogin());

  $("#btnCreateBack")?.addEventListener("click", () => showView("auth"));
  $("#btnLoginBack")?.addEventListener("click", () => showView("auth"));
  $("#btnModBack")?.addEventListener("click", () => showView("auth"));

  // --- Auth redirect
  let postLoginTarget = "settings";

  // --- Users cache
  let usersCache = null;
  async function fetchUsers() {
    const data = await apiCached("listUsers", {}, 15000);
    usersCache = Array.isArray(data.users) ? data.users : [];
    return usersCache;
  }

  function fillUserSelect(selectEl, users) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    (users || []).forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.nome || "";
      opt.textContent = u.nome || "";
      selectEl.appendChild(opt);
    });
  }

  async function openLogin() {
    const ok = await ensureApiReady();
    if (!ok) return;
    const users = await fetchUsers().catch(() => []);
    if (!users.length) {
      toast("Nessun utente: crea account");
      showView("create");
      return;
    }
    fillUserSelect($("#loginNome"), users);
    showView("login");
  }

  async function openModify() {
    const ok = await ensureApiReady();
    if (!ok) return;
    const users = await fetchUsers().catch(() => []);
    if (!users.length) {
      toast("Nessun utente: crea account");
      showView("create");
      return;
    }
    fillUserSelect($("#modNome"), users);
    showView("modify");
  }

  // --- Create account
  $("#formCreate")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = ($("#createNome")?.value || "").trim();
    const p1 = ($("#createPass")?.value || "");
    const p2 = ($("#createPass2")?.value || "");
    if (!nome) { toast("Inserisci il nome"); return; }
    if (!p1) { toast("Inserisci la password"); return; }
    if (p1 !== p2) { toast("Le password non coincidono"); return; }

    const ok = await ensureApiReady();
    if (!ok) return;

    try {
      const data = await api("createUser", { nome, password: p1 });
      setSession(data.user);
      toast("Account creato");
      await goAfterLogin();
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
    }
  });

  // --- Login submit
  $("#formLogin")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = ($("#loginNome")?.value || "").trim();
    const pass = ($("#loginPass")?.value || "");
    if (!nome) { toast("Seleziona un nome"); return; }
    if (!pass) { toast("Inserisci la password"); return; }

    const ok = await ensureApiReady();
    if (!ok) return;

    try {
      const data = await api("login", { nome, password: pass });
      setSession(data.user);
      toast("Accesso OK");
      await goAfterLogin();
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
    }
  });

  // --- Modify submit
  $("#formModify")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = ($("#modNome")?.value || "").trim();
    const oldP = ($("#modOld")?.value || "");
    const newP = ($("#modNew")?.value || "");
    const newP2 = ($("#modNew2")?.value || "");
    if (!nome) { toast("Seleziona un nome"); return; }
    if (!oldP || !newP) { toast("Compila tutti i campi"); return; }
    if (newP !== newP2) { toast("Le password non coincidono"); return; }

    const ok = await ensureApiReady();
    if (!ok) return;

    try {
      await api("updatePassword", { nome, oldPassword: oldP, newPassword: newP });
      toast("Password aggiornata");
      showView("auth");
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
    }
  });

  // --- Settings view logic
  const pillUser = $("#pillUser");
  const pillYear = $("#pillYear");

  function setPills(user, year) {
    if (pillUser) pillUser.textContent = user?.nome || "—";
    if (pillYear) pillYear.textContent = year ? String(year) : "—";
  }

  function getSettingsPayloadFromUI() {
    return {
      anno_esercizio: ($("#setAnno")?.value || "").trim(),
      tariffa_livello_1: ($("#setL1")?.value || "").trim(),
      tariffa_livello_2: ($("#setL2")?.value || "").trim(),
      tariffa_livello_3: ($("#setL3")?.value || "").trim()
    };
  }

  function applySettingsToUI(settings) {
    const s = settings || {};
    if ($("#setAnno")) $("#setAnno").value = s.anno_esercizio ?? "";
    if ($("#setL1")) $("#setL1").value = s.tariffa_livello_1 ?? "";
    if ($("#setL2")) $("#setL2").value = s.tariffa_livello_2 ?? "";
    if ($("#setL3")) $("#setL3").value = s.tariffa_livello_3 ?? "";

    const year = s.anno_esercizio || "";
    setPills(getSession(), year);
  }

  async function loadSettings() {
    const user = getSession();
    if (!user) return;
    const data = await api("getSettings", { userId: user.id });
    applySettingsToUI(data.settings || {});
  }

  async function saveSettings() {
    const user = getSession();
    if (!user) return;
    const payload = getSettingsPayloadFromUI();
    const data = await api("saveSettings", { userId: user.id, payload: JSON.stringify(payload) });
    applySettingsToUI(data.settings || {});
  }

  async function openSettingsAfterLogin() {
    showView("settings");
    try {
      await loadSettings();
    } catch (e) {
      setPills(getSession(), "");
      toast("Impostazioni non disponibili");
    }
  }

  async function openPatientsAfterLogin() {
    showView("patients");
    try {
      await loadSocietaCache();
      await loadPatients();
    } catch (e) {
      toast("Pazienti non disponibili");
    }
  }

  async function goAfterLogin() {
    if (postLoginTarget === "patients") {
      await openPatientsAfterLogin();
    } else {
      await openSettingsAfterLogin();
    }
  }

  async function openPatientsFlow() {
    postLoginTarget = "patients";
    const ok = await ensureApiReady();
    if (!ok) return;

    let users = [];
    try { users = await fetchUsers(); } catch { users = []; }

    const session = getSession();

    if (!users.length) {
      showView("create");
      toast("Crea il primo account");
      return;
    }

    if (session && session.id) {
      await openPatientsAfterLogin();
    } else {
      showView("auth");
    }
  }



  async function openSettingsFlow() {
    postLoginTarget = "settings";
    const ok = await ensureApiReady();
    if (!ok) return;

    let users = [];
    try { users = await fetchUsers(); } catch { users = []; }

    const session = getSession();

    // se nessun utente -> forza crea account
    if (!users.length) {
      showView("create");
      toast("Crea il primo account");
      return;
    }

    // se già loggato -> settings, altrimenti auth
    if (session && session.id) {
      await goAfterLogin();
    } else {
      showView("auth");
    }
  }

  // --- Pazienti (UI + API)
  const patientsListEl = $("#patientsList");
  const btnSortDate = $("#patSortDate");
  const btnSortSoc = $("#patSortSoc");

  let patientsCache = [];
  let patientsSortMode = "date"; // date|soc
  let currentPatient = null;
  let patientEditEnabled = true; // per create

  function fmtIsoDate(iso) {
    return ymdLocal(iso);
  }

  function setPatientsSort(mode) {
    patientsSortMode = mode;
    btnSortDate?.classList.toggle("active", mode === "date");
    btnSortSoc?.classList.toggle("active", mode === "soc");
    renderPatients();
  }

  btnSortDate?.addEventListener("click", () => setPatientsSort("date"));
  btnSortSoc?.addEventListener("click", () => setPatientsSort("soc"));

  async function loadPatients() {
    const user = getSession();
    if (!user) return;
    try {
      const data = await apiCached("listPatients", { userId: user.id }, 8000);
      patientsCache = Array.isArray(data.pazienti) ? data.pazienti : [];
      renderPatients();
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      throw err;
    }
  }

  function renderPatients() {
    if (!patientsListEl) return;
    const arr = (patientsCache || []).slice();

    if (patientsSortMode === "soc") {
      arr.sort((a,b) =>
        String(getSocNameById(a.societa_id||"")||"").localeCompare(String(getSocNameById(b.societa_id||"")||""), "it", { sensitivity: "base" }) ||
        String(a.nome_cognome||"").localeCompare(String(b.nome_cognome||""), "it", { sensitivity: "base" })
      );
    } else {
      arr.sort((a,b) => String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    }

    // render veloce: DocumentFragment + delegation
    patientsListEl.replaceChildren();
    patientsListEl.__renderedPatients = arr;

    if (!arr.length) {
      const empty = document.createElement("div");
      empty.className = "patient-row";
      empty.dataset.idx = "-1";
      empty.innerHTML = '<div class="patient-info"><div class="patient-name">Nessun paziente</div><div class="patient-sub">Premi + per inserire</div></div><div class="patient-badge">+</div>';
      patientsListEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const row = document.createElement("div");
      row.className = "patient-row";
      row.dataset.idx = String(i);

      const name = p.nome_cognome || p.nome || "—";
      const soc = getSocNameById(p.societa_id || "") || "—";
      const dt = fmtIsoDate(p.createdAt || p.created_at || "");

      row.innerHTML = `
        <div class="patient-info">
          <div class="patient-name">${escapeHtml(name)}</div>
          <div class="patient-sub">${escapeHtml(soc)}${dt ? " • " + escapeHtml(dt) : ""}</div>
        </div>
        <div class="patient-badge">${escapeHtml(String(p.livello || ""))}</div>
      `;
      frag.appendChild(row);
    }
    patientsListEl.appendChild(frag);
  }

  // click delegation (una sola listener)
  if (patientsListEl && !patientsListEl.__delegatedClick) {
    patientsListEl.__delegatedClick = true;
    patientsListEl.addEventListener("click", (e) => {
      const row = e.target && e.target.closest ? e.target.closest(".patient-row") : null;
      if (!row || !patientsListEl.contains(row)) return;
      const idx = parseInt(row.dataset.idx || "-1", 10);
      if (idx === -1) { openPatientCreate(); return; }
      const arr = patientsListEl.__renderedPatients || [];
      const p = arr[idx];
      if (p) openPatientExisting(p);
    }, { passive: true });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setPatientFormEnabled(enabled) {
    patientEditEnabled = !!enabled;
    const ids = ["patName","patStart","patEnd"];
    ids.forEach(id => {
      const el = $("#" + id);
      if (el) el.disabled = !patientEditEnabled;
    });
    $("#btnPickSoc")?.toggleAttribute("disabled", !patientEditEnabled);
    document.querySelectorAll(".circle-btn").forEach(b => b.toggleAttribute("disabled", !patientEditEnabled));
    document.querySelectorAll(".day-btn").forEach(b => b.toggleAttribute("disabled", !patientEditEnabled));
    $("#btnPatSave")?.toggleAttribute("disabled", !patientEditEnabled);
    if (!patientEditEnabled) $("#btnPatSave")?.classList.add("pill-gray");
    else $("#btnPatSave")?.classList.remove("pill-gray");

    // Mostra il tasto elimina solo in sola-lettura (scheda esistente)
    const btnDel = $("#btnPatDelete");
    if (btnDel) {
      const canShow = !patientEditEnabled && currentPatient && currentPatient.id;
      if (canShow) btnDel.removeAttribute("hidden");
      else btnDel.setAttribute("hidden", "");
    }

  }

  // ---- Società picker (modal)
  const modalPickSoc = $("#modalPickSoc");
  const socPickList = $("#socPickList");
  const btnPickSocClose = $("#btnPickSocClose");

  function openPickSocModal() {
    if (!modalPickSoc) return;
    modalPickSoc.classList.add("show");
    modalPickSoc.setAttribute("aria-hidden", "false");
  }
  function closePickSocModal() {
    if (!modalPickSoc) return;
    modalPickSoc.classList.remove("show");
    modalPickSoc.setAttribute("aria-hidden", "true");
  }
  btnPickSocClose?.addEventListener("click", closePickSocModal);
  modalPickSoc?.addEventListener("click", (e) => { if (e.target === modalPickSoc) closePickSocModal(); });

  async function loadSocietaForPick() {
    await loadSocietaCache();
    const arr = Array.isArray(societaCache) ? societaCache : [];
    return arr;
  }

  async function pickSocieta() {
    if (!patientEditEnabled) return;
    const ok = await ensureApiReady();
    if (!ok) return;
    const arr = await loadSocietaForPick().catch(() => []);
    if (!socPickList) return;
    socPickList.innerHTML = "";

    if (!arr.length) {
      const btn = document.createElement("button");
      btn.className = "pill-btn pill-gray";
      btn.type = "button";
      btn.textContent = "Nessuna società (aggiungila da impostazioni)";
      socPickList.appendChild(btn);
    } else {
      arr.forEach((s) => {
        const btn = document.createElement("button");
        btn.className = "pill-btn";
        btn.type = "button";
        btn.textContent = s.nome || s;
        btn.addEventListener("click", () => {
        // UI: evidenzia selezione
        timePickList.querySelectorAll(".pill-btn.selected").forEach((el) => el.classList.remove("selected")); 
        btn.classList.add("selected");
          $("#patSoc").value = s.nome || s;
          $("#patSocId").value = (s && s.id) ? String(s.id) : "";
          closePickSocModal();
        });
        socPickList.appendChild(btn);
      });
    }
    openPickSocModal();
  }
  $("#btnPickSoc")?.addEventListener("click", pickSocieta);

  // ---- Time picker modal
  const modalPickTime = $("#modalPickTime");
  const timePickList = $("#timePickList");
  const btnPickTimeClose = $("#btnPickTimeClose");
  let activeDayForTime = null;

  function openPickTimeModal() {
    if (!modalPickTime) return;
    modalPickTime.classList.add("show");
    modalPickTime.setAttribute("aria-hidden", "false");
  }
  function closePickTimeModal() {
    if (!modalPickTime) return;
    modalPickTime.classList.remove("show");
    modalPickTime.setAttribute("aria-hidden", "true");
  }
  btnPickTimeClose?.addEventListener("click", closePickTimeModal);
  modalPickTime?.addEventListener("click", (e) => { if (e.target === modalPickTime) closePickTimeModal(); });

  function buildTimes() {
    const times = ["—"];
    for (let h=6; h<=21; h++) {
      times.push(String(h).padStart(2,"0")+":00");
      times.push(String(h).padStart(2,"0")+":30");
    }
    return times;
  }

  function openTimePickerForDay(day) {
    if (!patientEditEnabled) return;
    activeDayForTime = day;
    if (!timePickList) return;
    timePickList.innerHTML = "";
    const currentSel = (currentPatient && currentPatient.giorni_map && currentPatient.giorni_map[day]) ? normTime(currentPatient.giorni_map[day]) : "—";
    buildTimes().forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      let cls = "pill-btn" + (t === "—" ? " pill-gray" : "");
      if (t === currentSel) cls += " selected";
      btn.className = cls;
      btn.textContent = t;
      btn.addEventListener("click", () => {
        // UI: evidenzia selezione
        timePickList.querySelectorAll(".pill-btn.selected").forEach((el) => el.classList.remove("selected")); 
        btn.classList.add("selected");
        if (!currentPatient) currentPatient = {};
        if (!currentPatient.giorni_map) currentPatient.giorni_map = {};
        if (t === "—") {
          delete currentPatient.giorni_map[day];
        } else {
          currentPatient.giorni_map[day] = t;
        }
        applyDayUI();
        closePickTimeModal();
      });
      timePickList.appendChild(btn);
    });
    openPickTimeModal();
  }

  function applyDayUI() {
    const map = (currentPatient && currentPatient.giorni_map) ? currentPatient.giorni_map : {};
    document.querySelectorAll(".day-btn").forEach((btn) => {
      const d = btn.getAttribute("data-day");
      const t = map && map[d] ? map[d] : "—";
      btn.classList.toggle("active", t !== "—");
      const lab = $("#t_" + d);
      if (lab) lab.textContent = t;
    });
  }

  document.querySelectorAll(".day-btn").forEach((btn) => {
    let lpTimer = null;
    let lpFired = false;

    const clearLP = () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    };

    btn.addEventListener("pointerdown", () => {
      if (!patientEditEnabled) return;
      lpFired = false;
      clearLP();
      lpTimer = setTimeout(async () => {
        lpFired = true;
        const d = btn.getAttribute("data-day");
        if (!d) return;
        if (!currentPatient) currentPatient = {};
        if (!currentPatient.giorni_map) currentPatient.giorni_map = {};
        if (!currentPatient.giorni_map[d]) return;

        delete currentPatient.giorni_map[d];
        applyDayUI();

        // Persist immediately for existing patients
        try {
          const user = getSession();
          if (!user) return;

          const nome_cognome = ($("#patName")?.value || currentPatient.nome_cognome || "").trim();
          const societa = ($("#patSoc")?.value || currentPatient.societa || "").trim();
          const societa_id = ($("#patSocId")?.value || "").trim();
          const societa_nome = societa;
          const data_inizio = ($("#patStart")?.value || currentPatient.data_inizio || "").trim();
          const data_fine = ($("#patEnd")?.value || currentPatient.data_fine || "").trim();
          const liv = level || (currentPatient && currentPatient.livello) || "";

          if (!currentPatient.id) return; // nothing to persist yet
          if (!nome_cognome || !societa || !liv) return;

          const payload = {
            nome_cognome,
            societa_id: societa_id,
            societa_nome: societa_nome,
            livello: liv,
            data_inizio,
            data_fine,
            giorni_settimana: JSON.stringify(currentPatient.giorni_map || {}),
            utente_id: user.id
          };

          const ok = await ensureApiReady();
          if (!ok) return;

          await api("updatePatient", { userId: user.id, id: currentPatient.id, payload: JSON.stringify(payload) });
          try { await loadPatients(); } catch {}
          toast("Giorno rimosso");
        } catch {
          toast("Errore rimozione");
        }
      }, 500);
    });

    btn.addEventListener("pointerup", clearLP);
    btn.addEventListener("pointercancel", clearLP);
    btn.addEventListener("pointerleave", clearLP);

    btn.addEventListener("click", (e) => {
      if (lpFired) {
        e.preventDefault();
        e.stopPropagation();
        lpFired = false;
        return;
      }
      const d = btn.getAttribute("data-day");
      if (d) openTimePickerForDay(d);
    });
  });
// ---- Level selection
  let level = "";
  function setLevel(l) {
    level = l;
    ["1","2","3"].forEach(n => {
      $("#btnL"+n)?.classList.toggle("active", "L"+n === l);
    });
  }
  $("#btnL1")?.addEventListener("click", () => patientEditEnabled && setLevel("L1"));
  $("#btnL2")?.addEventListener("click", () => patientEditEnabled && setLevel("L2"));
  $("#btnL3")?.addEventListener("click", () => patientEditEnabled && setLevel("L3"));

  // ---- Open forms
  function openPatientCreate() {
    const session = getSession();
    if (!session || !session.id) {
      openPatientsFlow();
      return;
    }
    currentPatient = { id: null, giorni_map: {} };
    level = "";
    $("#patName").value = "";
    $("#patSoc").value = "";
    $("#patSocId").value = "";
    $("#patStart").value = "";
    $("#patEnd").value = "";
    setLevel("");
    applyDayUI();
    setPatientFormEnabled(true);
    showView("patientForm");
  }

  function openPatientExisting(p) {
    const session = getSession();
    if (!session || !session.id) {
      openPatientsFlow();
      return;
    }
    currentPatient = Object.assign({}, p || {});
    // parse giorni_settimana JSON map (se presente)
    const raw = currentPatient.giorni_settimana || currentPatient.giorni || null;
    const map = parseGiorniMap(raw);
    currentPatient.giorni_map = map;
    level = String(currentPatient.livello || "");
    $("#patName").value = currentPatient.nome_cognome || "";
    $("#patSocId").value = currentPatient.societa_id ? String(currentPatient.societa_id) : "";
    $("#patSoc").value = String(currentPatient.societa_nome || currentPatient.societa || getSocNameById($("#patSocId").value) || "").trim();
    $("#patStart").value = fmtIsoDate(currentPatient.data_inizio || "");
    $("#patEnd").value = fmtIsoDate(currentPatient.data_fine || "");
    setLevel(level);
    applyDayUI();
    setPatientFormEnabled(false); // view-only finché non premi modifica
    showView("patientForm");
  }

  $("#btnPatCalendar")?.addEventListener("click", () => openCalendarFlow());
  $("#btnPatEdit")?.addEventListener("click", () => setPatientFormEnabled(true));
  $("#btnPatDelete")?.addEventListener("click", async () => {
    // Solo scheda esistente in sola lettura
    if (patientEditEnabled) return;
    const user = getSession();
    if (!user) { toast("Devi accedere"); return; }
    if (!currentPatient || !currentPatient.id) { toast("Paziente non valido"); return; }

    const ok = await ensureApiReady();
    if (!ok) return;

    const sure = confirm("Eliminare definitivamente questo paziente dal database?");
    if (!sure) return;

    const btn = $("#btnPatDelete");
    try {
      if (btn) btn.setAttribute("disabled", "");
      await api("deletePatient", { userId: user.id, id: currentPatient.id });
      toast("Paziente eliminato");
      await openPatientsAfterLogin();
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
    } finally {
      if (btn) btn.removeAttribute("disabled");
    }
  });


  $("#formPatient")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!patientEditEnabled) return;

    const user = getSession();
    if (!user) { toast("Devi accedere"); return; }

    const nome_cognome = ($("#patName")?.value || "").trim();
    const societa = ($("#patSoc")?.value || "").trim();
    const societa_id = ($("#patSocId")?.value || "").trim();
    const societa_nome = societa;
    const data_inizio = ($("#patStart")?.value || "").trim();
    const data_fine = ($("#patEnd")?.value || "").trim();

    if (!nome_cognome) { toast("Inserisci il nome"); return; }
    if (!societa_id) { toast("Seleziona la società"); return; }
    if (!level) { toast("Seleziona il livello"); return; }

    const payload = {
      nome_cognome,
      societa,
      societa_id: societa_id,
      societa_nome: societa_nome,
      livello: level,
      data_inizio,
      data_fine,
      giorni_settimana: JSON.stringify((currentPatient && currentPatient.giorni_map) ? currentPatient.giorni_map : {}),
      utente_id: user.id
    };

    const ok = await ensureApiReady();
    if (!ok) return;

    try {
      if (currentPatient && currentPatient.id) {
        await api("updatePatient", { userId: user.id, id: currentPatient.id, payload: JSON.stringify(payload) });
      } else {
        await api("createPatient", { userId: user.id, payload: JSON.stringify(payload) });
      }
      toast("Salvato");
      await openPatientsAfterLogin();
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
    }
  });



  // Settings buttons
  $("#btnSave")?.addEventListener("click", async () => {
    try {
      await saveSettings();
      toast("Dati salvati");
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
    }
  });

  $("#btnLoad")?.addEventListener("click", async () => {
    try {
      await loadSettings();
      toast("Dati caricati");
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
    }
  });

  // Modal Societa
  const modalSoc = $("#modalSoc");
  const socNomeInput = $("#socNomeInput");
  const socTagDots = $("#socTagDots");
  const btnSocClose = $("#btnSocClose");
  const btnSocCancel = $("#btnSocCancel");
  const btnSocDelete = $("#btnSocDelete");
  const btnSocSave = $("#btnSocSave");
  const socDeletePanel = $("#socDeletePanel");
  const socDeleteList = $("#socDeleteList");

  let selectedSocTag = 0;

  function getSocTagMap() {
    return safeJsonParse(localStorage.getItem("AMF_SOC_TAGS") || "", {}) || {};
  }
  function setSocTagForName(nome, tag) {
    const key = String(nome || "").trim();
    if (!key) return;
    const map = getSocTagMap();
    map[key] = Number(tag) || 0;
    localStorage.setItem("AMF_SOC_TAGS", JSON.stringify(map));
  }
  function deleteSocTagForName(nome) {
    const key = String(nome || "").trim();
    if (!key) return;
    const map = getSocTagMap();
    delete map[key];
    localStorage.setItem("AMF_SOC_TAGS", JSON.stringify(map));
  }

  function setSelectedSocTag(tag) {
    selectedSocTag = Math.max(0, Math.min(5, Number(tag) || 0));
    if (!socTagDots) return;
    socTagDots.querySelectorAll(".tag-dot").forEach((b) => {
      b.classList.toggle("selected", Number(b.dataset.tag) === selectedSocTag);
    });
  }

  // click delegation per i 6 pallini
  if (socTagDots && !socTagDots.__delegated) {
    socTagDots.__delegated = true;
    socTagDots.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest(".tag-dot") : null;
      if (!btn || !socTagDots.contains(btn)) return;
      setSelectedSocTag(btn.dataset.tag);
    }, { passive: true });
  }

  function openSocModal() {
    if (!modalSoc) return;
    socNomeInput.value = "";
    setSelectedSocTag(0);
    if (socDeletePanel) socDeletePanel.hidden = true;
    if (socDeleteList) socDeleteList.replaceChildren();
    modalSoc.classList.add("show");
    modalSoc.setAttribute("aria-hidden", "false");
    socNomeInput.focus();
  }
  function closeSocModal() {
    if (!modalSoc) return;
    modalSoc.classList.remove("show");
    modalSoc.setAttribute("aria-hidden", "true");
  }

  async function apiTry(actions, params) {
    const list = Array.isArray(actions) ? actions : [actions];
    let lastErr = null;
    for (const a of list) {
      try {
        return await api(a, params);
      } catch (err) {
        lastErr = err;
        const msg = String(err && err.message ? err.message : err).toLowerCase();
        if (msg.includes("unknown action")) continue;
        throw err;
      }
    }
    throw lastErr || new Error("Errore API");
  }

  async function renderSocietaDeleteList() {
    const user = getSession();
    if (!user) { toast("Accesso richiesto"); return; }
    const ok = await ensureApiReady();
    if (!ok) return;

    let data = null;
    try {
      data = await apiCached("listSocieta", { userId: user.id }, 15000);
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
      return;
    }
    const arr = Array.isArray(data && data.societa) ? data.societa : [];

    if (!socDeleteList) return;
    socDeleteList.replaceChildren();

    if (!arr.length) {
      const d = document.createElement("div");
      d.className = "modal-text";
      d.textContent = "Nessuna società registrata";
      socDeleteList.appendChild(d);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const s of arr) {
      const nome = (s && s.nome) ? s.nome : String(s || "");
      const id = (s && s.id) ? String(s.id) : "";
      const row = document.createElement("div");
      row.className = "soc-del-row";
      row.dataset.nome = nome;
      row.dataset.id = id;
      row.innerHTML = '<div class="soc-del-name">' + escapeHtml(nome) + '</div>';

      const btn = document.createElement("button");
      btn.className = "soc-del-btn";
      btn.type = "button";
      btn.setAttribute("aria-label", "Elimina " + nome);
      btn.dataset.nome = nome;
      btn.dataset.id = id;

      row.appendChild(btn);
      frag.appendChild(row);

      // se il backend non restituisce il tag, lo manteniamo localmente
      if (s && (s.tag !== undefined && s.tag !== null)) {
        setSocTagForName(nome, s.tag);
      } else if (tagMap[nome] !== undefined) {
        // no-op
      }
    }
    socDeleteList.appendChild(frag);
  }

  // delegation: elimina societa
  if (socDeleteList && !socDeleteList.__delegated) {
    socDeleteList.__delegated = true;
    socDeleteList.addEventListener("click", async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest(".soc-del-btn") : null;
      if (!btn || !socDeleteList.contains(btn)) return;

      const nome = String(btn.dataset.nome || "").trim();
      const id = String(btn.dataset.id || "").trim();
      if (!nome && !id) return;

      const sure = confirm(`Eliminare la società "${(nome || id)}"?`);
      if (!sure) return;

      const user = getSession();
      if (!user) { toast("Accesso richiesto"); return; }

      try {
        await apiTry(
          ["deleteSocieta", "delSocieta", "removeSocieta", "deleteSociety"],
          { userId: user.id, id: id || undefined, nome: nome || undefined }
        );
        invalidateApiCache("listSocieta");
        toast("Società eliminata");
        await renderSocietaDeleteList();
      } catch (err) {
        if (apiHintIfUnknownAction(err)) return;
        toast(String(err && err.message ? err.message : "Errore"));
      }
    }, { passive: false });
  }

  btnSocClose?.addEventListener("click", closeSocModal);
  btnSocCancel?.addEventListener("click", closeSocModal);

  btnSocSave?.addEventListener("click", async () => {
    const nome = (socNomeInput.value || "").trim();
    if (!nome) { toast("Inserisci un nome"); return; }
    const user = getSession();
    if (!user) { toast("Accesso richiesto"); return; }
    try {
      await api("addSocieta", { userId: user.id, nome, tag: selectedSocTag });
      invalidateApiCache("listSocieta");
      toast("Società aggiunta");
      closeSocModal();
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
    }
  });

  btnSocDelete?.addEventListener("click", async () => {
    if (!socDeletePanel) return;
    const willOpen = !!socDeletePanel.hidden;
    socDeletePanel.hidden = !willOpen;
    if (willOpen) await renderSocietaDeleteList();
  });

  $("#btnAddSoc")?.addEventListener("click", openSocModal);

  $("#btnWipe")?.addEventListener("click", async () => {
    const user = getSession();
    if (!user) { toast("Accesso richiesto"); return; }
    const sure = confirm("Cancellare account e tutti i dati nel database?");
    if (!sure) return;
    try {
      await api("wipeAll", { userId: user.id });
      clearSession();
      toast("Dati cancellati");
      showView("home");
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
    }
  });

  $("#btnLogout")?.addEventListener("click", () => {
    clearSession();
    toast("Uscito");
    showView("home");
  });

  // --- Boot
  // Default view: home
  showView("home");

  // PWA (iOS): registra Service Worker
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js?v=1.008").catch(() => {});
    });
  }
})();
