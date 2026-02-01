/* AMF_1.031 */
(() => {
  const BUILD = "AMF_1.031";
  const DISPLAY = "1.031";

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
    try {
      const qm = (typeof queueMicrotask === "function") ? queueMicrotask : ((fn) => setTimeout(fn, 0));
      qm(() => { try { warmupCoreData(); } catch (_) {} });
    } catch (_) {
      try { setTimeout(() => { try { warmupCoreData(); } catch (_) {} }, 0); } catch (_) {}
    }
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
    calendar: $("#viewCalendar"),
    stats: $("#viewStats")
  };

  const btnTopRight = $("#btnTopRight");
  const iconTopRight = $("#iconTopRight");
  const btnTopPlus = $("#btnTopPlus");
  const btnCalPrev = $("#btnCalPrev");
  const btnCalToday = $("#btnCalToday");
  const btnCalNext = $("#btnCalNext");
  const topbarTitle = $("#topbarTitle");

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

  function updateTopbarTitle() {
    if (!topbarTitle) return;
    const u = getSession();
    const name = (u && typeof u.nome === "string" && u.nome.trim()) ? u.nome.trim() : "Montalto PMS";
    topbarTitle.textContent = name;
    // aggiorna anche il titolo del documento
    try { document.title = name; } catch (_) {}
  }

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
    updateTopPatientsVisible();
    updateTopbarTitle();

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
    const list = [btnCalPrev, btnCalToday, btnCalNext];
    list.forEach((b) => { if (b) b.hidden = !isVisible; });
  }

  function updateTopPatientsVisible() {
    if (!btnTopPatients) return;
    const isRO = (currentView === "patientForm") && !patientEditEnabled;
    btnTopPatients.hidden = !isRO;
  }

  btnTopPatients?.addEventListener("click", () => {
    openPatientsFlow();
  });


  btnTopPlus?.addEventListener("click", () => {
    openPatientCreate();
  });


  // --- Home routes placeholders
  const routes = {
    
    pazienti: () => openPatientsFlow(),
    calendario: () => openCalendarFlow(),
    statistiche: () => openStatsFlow()
  };
  

  // --- Statistiche
  const statsSocTabs = $("#statsSocTabs");
  const statsLevelDots = $("#statsLevelDots");
  const statsMonthlyList = $("#statsMonthlyList");

  let statsSelectedSoc = "ALL"; // "ALL" = Tutte
  let statsSelectedLevel = "T"; // L1/L2/L3/T

  const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

  function coerceNumber_(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" && isFinite(v)) return v;
    const s = String(v).trim();
    if (!s) return null;
    const cleaned = s.replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
  }

  function pickAmountFromRecord_(rec) {
    if (!rec) return 0;
    const keys = ["importo","amount","totale","fatturato","fatturato_euro","valore","prezzo","revenue","incasso","pagato"];
    for (const k of keys) {
      if (rec[k] !== undefined && rec[k] !== null) {
        const n = coerceNumber_(rec[k]);
        if (n !== null) return n;
      }
    }
    return 0;
  }

  function pickDateFromRecord_(rec) {
    if (!rec) return null;
    const keys = ["data","date","data_prestazione","dataVisita","giorno","createdAt","created_at","updatedAt","updated_at"];
    for (const k of keys) {
      const v = rec[k];
      if (!v) continue;
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  function normalizeLevel_(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().toUpperCase();
    if (!s) return null;
    if (s === "T" || s === "TOT" || s === "TOTALE" || s === "TOTAL") return "T";
    if (s === "L1" || s === "1") return "L1";
    if (s === "L2" || s === "2") return "L2";
    if (s === "L3" || s === "3") return "L3";
    return null;
  }

  function getRecordLevel_(rec) {
    const direct = normalizeLevel_(rec.livello ?? rec.level ?? rec.liv ?? rec.livello_id ?? rec.lvl);
    if (direct && direct !== "T") return direct;
    // Fallback: usa tag della società (1..3 -> L1..L3)
    const sid = String(rec.societa_id || rec.societaId || rec.soc || "").trim();
    const s = sid ? getSocietaById(sid) : null;
    const t = s ? parseInt(s.tag, 10) : 0;
    if (t === 1) return "L1";
    if (t === 2) return "L2";
    if (t === 3) return "L3";
    return null;
  }

  function formatEuro_(n) {
    const v = (typeof n === "number" && isFinite(n)) ? n : 0;
    return v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  function renderStatsSocTabs_(societaArr) {
    if (!statsSocTabs) return;
    statsSocTabs.innerHTML = "";

    const mkBtn = (id, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "seg-tab";
      b.setAttribute("role", "tab");
      b.setAttribute("data-soc", id);
      b.textContent = label;
      if (statsSelectedSoc === id) b.classList.add("selected");
      b.addEventListener("click", () => {
        statsSelectedSoc = id;
        renderStatsSocTabs_(societaArr);
        renderStatsMonthly_();
      });
      return b;
    };

    statsSocTabs.appendChild(mkBtn("ALL", "Tutte"));
    (societaArr || []).forEach((s) => {
      const sid = String(s.id || "").trim();
      if (!sid) return;
      const nome = String(s.nome || "").trim() || "Società";
      statsSocTabs.appendChild(mkBtn(sid, nome));
    });
  }

  function renderStatsLevelDots_() {
    if (!statsLevelDots) return;
    statsLevelDots.innerHTML = "";

    const levels = ["L1","L2","L3","T"];
    levels.forEach((lv) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dot-filter";
      b.setAttribute("data-lv", lv);
      b.textContent = lv;
      if (statsSelectedLevel === lv) b.classList.add("selected");
      b.addEventListener("click", () => {
        statsSelectedLevel = lv;
        renderStatsLevelDots_();
        renderStatsMonthly_();
      });
      statsLevelDots.appendChild(b);
    });
  }

  function renderStatsMonthly_() {
    if (!statsMonthlyList) return;

    const readExerciseYear = () => {
      const y1 = ($("#setAnno")?.value || "").trim();
      const y2 = ($("#pillYear")?.textContent || "").trim();
      const cand = y1 || y2;
      const n = parseInt(cand, 10);
      return (isFinite(n) && n >= 2000 && n <= 2100) ? n : (new Date()).getFullYear();
    };

    const year = readExerciseYear();
    const monthly = new Array(12).fill(0);

    const countWeekdayInRange = (startDate, endDate, weekday) => {
      if (!startDate || !endDate) return 0;
      const s = new Date(startDate); s.setHours(0,0,0,0);
      const e = new Date(endDate); e.setHours(0,0,0,0);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
      if (s.getTime() > e.getTime()) return 0;

      const wd = Number(weekday);
      if (!isFinite(wd)) return 0;

      const shift = (wd - s.getDay() + 7) % 7;
      const first = new Date(s);
      first.setDate(s.getDate() + shift);
      if (first.getTime() > e.getTime()) return 0;

      const days = Math.floor((e.getTime() - first.getTime()) / 86400000);
      return 1 + Math.floor(days / 7);
    };

    const getPatientLevel = (p) => normalizeLevel_(p?.livello ?? p?.level ?? p?.liv ?? p?.livello_id ?? p?.lvl);

    const getRateForPatient = (p) => {
      const lv = getPatientLevel(p);
      if (!lv || lv === "T") return 0;
      const sid = String(p?.societa_id || p?.societaId || p?.soc || "").trim();
      const s = sid ? getSocietaById(sid) : null;
      if (!s) return 0;

      const l1 = coerceNumber_(s.l1 ?? s.L1 ?? s.liv1 ?? s.livello1);
      const l2 = coerceNumber_(s.l2 ?? s.L2 ?? s.liv2 ?? s.livello2);
      const l3 = coerceNumber_(s.l3 ?? s.L3 ?? s.liv3 ?? s.livello3);

      if (lv === "L1") return l1 ?? 0;
      if (lv === "L2") return l2 ?? 0;
      if (lv === "L3") return l3 ?? 0;
      return 0;
    };

    const getPatientRangeWithinYear = (p) => {
      const yStart = new Date(year, 0, 1); yStart.setHours(0,0,0,0);
      const yEnd = new Date(year, 11, 31); yEnd.setHours(0,0,0,0);

      const pStart = dateOnlyLocal(p?.data_inizio || p?.start || "");
      const pEnd = dateOnlyLocal(p?.data_fine || p?.end || "");

      const s = pStart ? new Date(pStart) : new Date(yStart);
      const e = pEnd ? new Date(pEnd) : new Date(yEnd);
      s.setHours(0,0,0,0);
      e.setHours(0,0,0,0);

      const start = new Date(Math.max(s.getTime(), yStart.getTime()));
      const end = new Date(Math.min(e.getTime(), yEnd.getTime()));
      if (start.getTime() > end.getTime()) return null;
      return { start, end };
    };

    const calcMonthlyAmountForPatient = (p, monthIndex) => {
      if (!p || p.isDeleted) return 0;

      // filtro società
      const sid = String(p.societa_id || p.societaId || p.soc || "").trim();
      if (statsSelectedSoc !== "ALL" && sid !== statsSelectedSoc) return 0;

      // filtro livello
      const lv = getPatientLevel(p);
      if (statsSelectedLevel !== "T" && lv !== statsSelectedLevel) return 0;

      const range = getPatientRangeWithinYear(p);
      if (!range) return 0;

      const monthStart = new Date(year, monthIndex, 1); monthStart.setHours(0,0,0,0);
      const monthEnd = new Date(year, monthIndex + 1, 0); monthEnd.setHours(0,0,0,0);

      const start = new Date(Math.max(range.start.getTime(), monthStart.getTime()));
      const end = new Date(Math.min(range.end.getTime(), monthEnd.getTime()));
      if (start.getTime() > end.getTime()) return 0;

      const raw = p.giorni_settimana || p.giorni || "";
      const map = parseGiorniMap(raw);
      if (!map || typeof map !== "object") return 0;

      const rate = getRateForPatient(p);
      if (!rate) return 0;

      let sessions = 0;
      Object.keys(map).forEach((k) => {
        const dayLabel = __normDayLabel(k);
        let wk = DAY_LABEL_TO_KEY[dayLabel];
        if (wk === undefined || wk === null) {
          if (/^\d+$/.test(dayLabel)) {
            const n = parseInt(dayLabel, 10);
            if (n >= 0 && n <= 6) wk = n;
          }
        }
        if (wk === undefined || wk === null) return;
        const times = normalizeTimeList(map[k]);
        const perWeek = times.length || 0;
        if (!perWeek) return;
        const occ = countWeekdayInRange(start, end, wk);
        sessions += occ * perWeek;
      });

      return sessions * rate;
    };

    const recs = Array.isArray(patientsCache) ? patientsCache : [];
    for (let mi = 0; mi < 12; mi++) {
      let sum = 0;
      for (const p of recs) sum += calcMonthlyAmountForPatient(p, mi);
      monthly[mi] = sum;
    }

    const max = Math.max(0, ...monthly);
    statsMonthlyList.innerHTML = "";

    monthly.forEach((val, i) => {
      const row = document.createElement("div");
      row.className = "month-card";

      const top = document.createElement("div");
      top.className = "month-row";

      const name = document.createElement("div");
      name.className = "month-name";
      name.textContent = MONTHS_IT[i];

      const value = document.createElement("div");
      value.className = "month-value";
      value.textContent = formatEuro_(val);

      top.appendChild(name);
      top.appendChild(value);

      const track = document.createElement("div");
      track.className = "month-track";

      const bar = document.createElement("div");
      bar.className = "month-bar";
      const pct = max > 0 ? Math.max(0, Math.min(1, val / max)) : 0;
      bar.style.width = (pct * 100).toFixed(2) + "%";

      track.appendChild(bar);

      row.appendChild(top);
      row.appendChild(track);

      statsMonthlyList.appendChild(row);
    });
  }

async function openStatsFlow() {
    setCalendarControlsVisible(false);
    btnTopPlus && (btnTopPlus.hidden = true);
    const titleEl = $("#topbarTitle");
    if (titleEl) titleEl.textContent = "Statistiche";

    try { await loadSocietaCache(false); } catch (_) {}
    try { await loadPatients({ render: false }); } catch (_) {}

    const societaArr = Array.isArray(societaCache) ? societaCache : [];
    renderStatsSocTabs_(societaArr);
    renderStatsLevelDots_();
    renderStatsMonthly_();

    showView("stats");
  }

document.querySelectorAll("[data-route]").forEach((btn) => {
    btn.addEventListener("click", async () => {
        // UI: evidenzia selezione
        timePickList.querySelectorAll(".pill-btn.selected").forEach((el) => el.classList.remove("selected")); 
        btn.classList.add("selected");
      const r = btn.getAttribute("data-route");
      (routes[r] || (() => {}))();
    });
  });


  // --- Calendario
  const calDateTitle = $("#calDateTitle");
  const calDaysCol = $("#calDaysCol");      // header row: days 1..31
  const calHoursRow = $("#calHoursRow");    // first column: hours 07:30..21:00
  const calBody = $("#calBody");            // grid cells
  const calScroll = $("#calScroll");        // body scroll container (both axes)

  const calDaysScroll = $("#calDaysScroll");
  const calHoursScroll = $("#calHoursScroll");
  const calCorner = $("#calCorner");


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

  const CAL_COLOR_START = { r: 160, g: 160, b: 160 }; // grey
  const CAL_COLOR_END   = { r: 42,  g: 116, b: 184 }; // azzurro (primary)
  function calColorForDay(dayNum) {
    const t = Math.min(1, Math.max(0, (Number(dayNum) - 1) / 30));
    const r = Math.round(CAL_COLOR_START.r + (CAL_COLOR_END.r - CAL_COLOR_START.r) * t);
    const g = Math.round(CAL_COLOR_START.g + (CAL_COLOR_END.g - CAL_COLOR_START.g) * t);
    const b = Math.round(CAL_COLOR_START.b + (CAL_COLOR_END.b - CAL_COLOR_START.b) * t);
    return { r, g, b };
  }
  function rgba({ r, g, b }, a) { return `rgba(${r},${g},${b},${a})`; }

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
  LU: 1, MA: 2, ME: 3, GI: 4, VE: 5, SA: 6, DO: 0,
  // 3-letter
  LUN: 1, MAR: 2, MER: 3, GIO: 4, VEN: 5, SAB: 6, DOM: 0,
  // Full (no accents)
  LUNEDI: 1, MARTEDI: 2, MERCOLEDI: 3, GIOVEDI: 4, VENERDI: 5, SABATO: 6, DOMENICA: 0
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

  // Pure time with seconds/millis (e.g., 09:00:00, 09:00:00.000, 9:0:0) -> HH:MM
  let ms = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?$/);
  if (ms) {
    const hh = String(parseInt(ms[1], 10)).padStart(2, "0");
    const mm = String(parseInt(ms[2], 10)).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // Time with AM/PM (e.g., 9:00 AM, 09:00PM, 9 AM) -> HH:MM
  ms = s.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2})(?:\.\d+)?)?\s*(AM|PM)$/i);
  if (ms) {
    let h = parseInt(ms[1], 10);
    const m2 = ms[2] != null ? parseInt(ms[2], 10) : 0;
    const ap = String(ms[4] || "").toUpperCase();
    if (ap === "AM") {
      if (h === 12) h = 0;
    } else if (ap === "PM") {
      if (h < 12) h += 12;
    }
    const hh = String(h).padStart(2, "0");
    const mm = String(m2).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // Fallback: if string starts with HH:MM (even if it has more), keep only HH:MM
  ms = s.match(/^(\d{1,2}):(\d{2})/);
  if (ms) {
    const hh = String(parseInt(ms[1], 10)).padStart(2, "0");
    const mm = ms[2];
    return `${hh}:${mm}`;
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



// --- Società cache (id -> {nome, tag, l1, l2, l3})
let societaCache = null;
let societaMapById = new Map();

// Assegnazione colori società (progressiva, stabile su iOS):
// - 6 colori in sequenza: Rosso, Arancione, Giallo, Verde, Azzurro, Indaco
// - Ogni nuova società riceve il colore successivo; oltre 6 riparte (mod 6)
// - Persistenza locale per mantenere coerenza tra viste e sessioni
const SOC_COLOR_SEQ = [
  "#E53935", // Rosso
  "#FB8C00", // Arancione
  "#FDD835", // Giallo
  "#43A047", // Verde
  "#1E88E5", // Azzurro
  "#3949AB"  // Indaco
];

function getSocColorMapById_() {
  return safeJsonParse(localStorage.getItem("AMF_SOC_COLOR_BY_ID") || "", {}) || {};
}
function setSocColorMapById_(map) {
  try { localStorage.setItem("AMF_SOC_COLOR_BY_ID", JSON.stringify(map || {})); } catch (_) {}
}
function getSocColorNext_() {
  const n = parseInt(localStorage.getItem("AMF_SOC_COLOR_NEXT") || "0", 10);
  return isFinite(n) && n >= 0 ? n : 0;
}
function setSocColorNext_(n) {
  try { localStorage.setItem("AMF_SOC_COLOR_NEXT", String(Math.max(0, n | 0))); } catch (_) {}
}

function assignSocColorIndex0to5_(socId) {
  const id = String(socId || "").trim();
  if (!id) return 0;

  const map = getSocColorMapById_();
  if (map[id] !== undefined && map[id] !== null) {
    const v = Number(map[id]);
    return isFinite(v) ? ((v % 6) + 6) % 6 : 0;
  }

  const next = getSocColorNext_();
  const idx = ((next % 6) + 6) % 6;
  map[id] = idx;
  setSocColorMapById_(map);
  setSocColorNext_(next + 1);
  return idx;
}

function buildSocietaMap_(arr) {
  societaMapById = new Map();
  (arr || []).forEach((s) => {
    if (!s) return;
    const id = String(s.id || "").trim();
    if (!id) return;
    const nome = String(s.nome || "").trim();
    // Colore assegnato in modo progressivo e coerente (0..5)
    const tag = assignSocColorIndex0to5_(id);
    const l1 = (s.l1 ?? s.L1 ?? s.livello1 ?? s.liv1 ?? s.tariffa_livello_1 ?? "");
    const l2 = (s.l2 ?? s.L2 ?? s.livello2 ?? s.liv2 ?? s.tariffa_livello_2 ?? "");
    const l3 = (s.l3 ?? s.L3 ?? s.livello3 ?? s.liv3 ?? s.tariffa_livello_3 ?? "");
    societaMapById.set(id, { id, nome, tag, l1, l2, l3 });
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
    const d = parseInt(c.dataset.day || "0", 10);
    if (d >= 1 && d <= 31) {
      const col = calColorForDay(d);
      c.style.backgroundColor = rgba(col, 0.25);
    }
    c.classList.remove("filled");
    c.innerHTML = "";
    c.removeAttribute("title");
  });
}

function initialsFromName(fullName) {
  const s = String(fullName || "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const w = parts[0].toUpperCase();
    return w.slice(0, 2);
  }
  const first = parts[0].charAt(0).toUpperCase();
  const last = parts[parts.length - 1].charAt(0).toUpperCase();
  return first + last;
}

function fillCalendarFromPatients(patients) {
  if (!calBody) return;

  const year = calSelectedDate.getFullYear();
  const month = calSelectedDate.getMonth();
  const daysInThisMonth = new Date(year, month + 1, 0).getDate();

  function dateForDayNumber(dayNum) {
    if (dayNum < 1 || dayNum > daysInThisMonth) return null;
    const d = new Date(year, month, dayNum);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function weekdayKeyForDate(d) {
    if (!d) return null;
    return d.getDay(); // 0=Sun..6=Sat (Sun supported)
  }

  function inRange(cellDate, startStr, endStr) {
    const s = dateOnlyLocal(startStr);
    const e = dateOnlyLocal(endStr);
    if (!s && !e) return true;
    if (!cellDate) return false;

    const d = new Date(cellDate);
    d.setHours(0, 0, 0, 0);

    if (s && d.getTime() < s.getTime()) return false;
    if (e && d.getTime() > e.getTime()) return false;
    return true;
  }

  const slots = new Map(); // key -> {count, names:[], ids:[], tags:[]}

  (patients || []).forEach((p) => {
    if (!p || p.isDeleted) return;

    const raw = p.giorni_settimana || p.giorni || "";
    if (!raw) return;

    const map = parseGiorniMap(raw);
    if (!map || typeof map !== "object") return;

    // weekday keys for this patient
    const weekdayEntries = [];
    Object.keys(map).forEach((k) => {
      const dayLabel = __normDayLabel(k);
      let wk = DAY_LABEL_TO_KEY[dayLabel];

      if (wk == null && /^\d+$/.test(dayLabel)) {
        const n = parseInt(dayLabel, 10);
        if (n === 7) wk = 0; // Sunday
        else if (n >= 0 && n <= 6) wk = n;
        else if (n >= 1 && n <= 6) wk = n;
      }

      if (wk == null) return;
      weekdayEntries.push({ wk, key: k });
    });

    if (!weekdayEntries.length) return;

    for (let dayNum = 1; dayNum <= 31; dayNum++) {
      const cellDate = dateForDayNumber(dayNum);
      if (!cellDate) continue;

      const wk = weekdayKeyForDate(cellDate);

      weekdayEntries.forEach(({ wk: wk2, key }) => {
        if (wk2 !== wk) return;

        if (!inRange(cellDate, p.data_inizio, p.data_fine)) return;

        const times = normalizeTimeList(map[key]);
        if (!times.length) return;

        times.forEach((t) => {
          const slotKey = `${dayNum}|${t}`;
          const prev = slots.get(slotKey) || { count: 0, names: [], ids: [], tags: [] };
          prev.count += 1;
          prev.names.push(p.nome_cognome || "Paziente");
          prev.ids.push(p.id);
          prev.tags.push(getSocTagIndexById(p.societa_id || ""));
          slots.set(slotKey, prev);
        });
      });
    }
  });

  calSlotPatients = slots;

  calBody.querySelectorAll(".cal-cell").forEach((cell) => {
    const dayNum = parseInt(cell.dataset.day || "0", 10);
    const t = cell.dataset.time || "";
    const key = `${dayNum}|${t}`;
    const info = slots.get(key);

    if (!info || !info.count) return;

    cell.classList.add("filled");
    {
      const col = calColorForDay(dayNum);
      cell.style.backgroundColor = rgba(col, 0.50);
    }

    // Initials
    const initialsList = (info.names || []).map(initialsFromName).filter(Boolean);
    const uniq = [];
    initialsList.forEach((x) => { if (!uniq.includes(x)) uniq.push(x); });
    let initialsText = uniq.slice(0, 3).join(" ");
    if (uniq.length > 3) initialsText += ` +${uniq.length - 3}`;
    if (initialsText) {
      const ini = document.createElement("div");
      ini.className = "cal-initials";
      ini.textContent = initialsText;
      cell.appendChild(ini);
    }

    const dot = document.createElement("div");
    dot.className = "cal-dot";
    const tag = Array.isArray(info.tags) && info.tags.length ? info.tags[0] : 0;
    dot.dataset.tag = String(tag);
    cell.appendChild(dot);

    if (info.count === 1) {
      cell.title = info.names[0] || "";
    } else {
      cell.title = `${info.count} pazienti`;
      const badge = document.createElement("div");
      badge.className = "cal-badge";
      badge.textContent = String(info.count);
      cell.appendChild(badge);
    }
  });
}
async function ensurePatientsForCalendar() {
  const user = getSession();
  if (!user || !user.id) return [];
  if (!patientsLoaded) {
    try { await loadPatients({ render: false }); } catch { /* ignore */ }
  }
  return Array.isArray(patientsCache) ? patientsCache : [];
}


  async function openCalendarFlow() {
    postLoginTarget = "calendar";
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

    if (!session || !session.id) {
      showView("auth");
      return;
    }

    ensureCalendarBuilt();
    const now = new Date();
    calSelectedDate = now;

    // Apertura pagina immediata
    showView("calendar");

    // Warmup dati in background (no blocchi UI)
    try { warmupCoreData(); } catch (_) {}

    // Aggiorna UI senza bloccare la navigazione
    updateCalendarUI()
      .then(() => { try { focusCalendarNow(); } catch (_) {} })
      .catch(() => {});

    // Focus rapido (anche prima del caricamento dati)
    try { setTimeout(() => { try { focusCalendarNow(); } catch (_) {} }, 80); } catch (_) {}
  }


  function focusCalendarNow() {
  if (!calScroll || !calBody) return;

  const now = new Date();
  const ref = new Date(calSelectedDate || now);

  let targetDay = ref.getDate();
  if (now.getFullYear() === ref.getFullYear() && now.getMonth() === ref.getMonth()) {
    targetDay = now.getDate();
  }

  const startMin = 7 * 60 + 30;
  const endMin = 21 * 60;
  let m = now.getHours() * 60 + now.getMinutes();
  m = Math.max(startMin, Math.min(endMin, m));
  m = Math.round(m / 30) * 30;
  m = Math.max(startMin, Math.min(endMin, m));

  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  const targetTime = `${hh}:${mm}`;

  const cell = calBody.querySelector(`.cal-cell[data-day="${targetDay}"][data-time="${targetTime}"]`);
  if (!cell) return;

  calScroll.scrollLeft = Math.max(0, cell.offsetLeft - 24);
  calScroll.scrollTop = Math.max(0, cell.offsetTop - 24);
}

  function ensureCalendarBuilt() {
  if (calBuilt) return;
  if (!calDaysCol || !calHoursRow || !calBody || !calScroll || !calDaysScroll || !calHoursScroll) return;

  // --- Header: days 1..31
  calDaysCol.innerHTML = "";
  for (let d = 1; d <= 31; d++) {
    const el = document.createElement("div");
    el.className = "cal-day";
    el.textContent = String(d);
    el.dataset.day = String(d);
    const c = calColorForDay(d);
    el.style.backgroundColor = rgba(c, 0.80);
    el.style.color = "rgba(255,255,255,.95)";
    calDaysCol.appendChild(el);
  }

  // --- Hours: 30 min slots 07:30 -> 21:00
  calHours = [];
  const startMin = 7 * 60 + 30;
  const endMin = 21 * 60;
  for (let m = startMin; m <= endMin; m += 30) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    calHours.push(`${hh}:${mm}`);
  }

  calHoursRow.innerHTML = "";
  calHours.forEach((t) => {
    const el = document.createElement("div");
    el.className = "cal-hour";
    el.textContent = t;
    calHoursRow.appendChild(el);
  });

  // --- Body grid (rows=hours, cols=days)
  calBody.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (let r = 0; r < calHours.length; r++) {
    const t = calHours[r];
    for (let d = 1; d <= 31; d++) {
      const cell = document.createElement("div");
      cell.className = "cal-cell";
      cell.dataset.day = String(d);
      cell.dataset.time = t;
      const c = calColorForDay(d);
      cell.style.backgroundColor = rgba(c, 0.25);

      cell.addEventListener("click", async () => {
        const slotKey = `${cell.dataset.day}|${cell.dataset.time}`;
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

      frag.appendChild(cell);
    }
  }
  calBody.appendChild(frag);

  // --- Scroll sync (iOS-safe)
  let syncing = false;

  calScroll.addEventListener("scroll", () => {
    if (syncing) return;
    syncing = true;
    try {
      calDaysScroll.scrollLeft = calScroll.scrollLeft;
      calHoursScroll.scrollTop = calScroll.scrollTop;
    } finally {
      syncing = false;
    }
  });

  calDaysScroll.addEventListener("scroll", () => {
    if (syncing) return;
    syncing = true;
    try {
      calScroll.scrollLeft = calDaysScroll.scrollLeft;
    } finally {
      syncing = false;
    }
  });

  calHoursScroll.addEventListener("scroll", () => {
    if (syncing) return;
    syncing = true;
    try {
      calScroll.scrollTop = calHoursScroll.scrollTop;
    } finally {
      syncing = false;
    }
  });

  // Topbar calendar controls (hidden by default)
  btnCalPrev?.addEventListener("click", () => { shiftCalendarMonth(-1); });
  btnCalNext?.addEventListener("click", () => { shiftCalendarMonth(1); });
  btnCalToday?.addEventListener("click", async () => {
    calSelectedDate = new Date();
    await updateCalendarUI();
    scrollCalendarToNow();
  });

  calBuilt = true;
}

function scrollCalendarToNow() {
  if (!calScroll || !calBody) return;
  const now = new Date();
  const day = now.getDate();
  // snap to nearest 30 minutes slot
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = now.getMinutes() < 30 ? "00" : "30";
  const t = `${hh}:${mm}`;
  const cell = calBody.querySelector(`.cal-cell[data-day="${day}"][data-time="${t}"]`);
  if (!cell) return;
  requestAnimationFrame(() => {
    const top = cell.offsetTop - (calScroll.clientHeight / 2) + (cell.offsetHeight / 2);
    calScroll.scrollTop = Math.max(0, top);
  });
}

function shiftCalendarMonth(delta) {
  const d = new Date(calSelectedDate);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, dim));
  calSelectedDate = d;
  updateCalendarUI();
}

function formatItMonth(dateObj) {
    const fmt = new Intl.DateTimeFormat("it-IT", { month: "long" });
    let s = fmt.format(dateObj);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function mondayOfWeek(dateObj) {
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);
    const jsDay = d.getDay(); // 0=Sun..6=Sat
    const diff = (jsDay === 0) ? 1 : (1 - jsDay); // Sun -> next Monday, else back to Monday
    d.setDate(d.getDate() + diff);
    return d;
  }

  function formatItDate(dateObj) {
    const fmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });
    let s = fmt.format(dateObj);
    // Capitalizza mese (Febbraio, Marzo, ...)
    return s.replace(/(\d+ )([a-zàèéìòù]+)( \d+)/i, (m, a, b, c) => `${a}${b.charAt(0).toUpperCase()}${b.slice(1)}${c}`);
  }

  async function updateCalendarUI() {
  if (!calDateTitle || !calDaysCol || !calBody) return;

  const year = calSelectedDate.getFullYear();
  const month = calSelectedDate.getMonth();
  const daysInThisMonth = new Date(year, month + 1, 0).getDate();

  const fmt = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });
  let title = fmt.format(new Date(year, month, 1));
  title = title.charAt(0).toUpperCase() + title.slice(1);
  calDateTitle.textContent = title;

  calDaysCol.querySelectorAll(".cal-day").forEach((el) => {
    const d = parseInt(el.dataset.day || "0", 10);
    const valid = d >= 1 && d <= daysInThisMonth;
    el.classList.toggle("disabled", !valid);
    el.classList.toggle("active", valid && d === calSelectedDate.getDate());
  });

  calBody.querySelectorAll(".cal-cell").forEach((cell) => {
    const d = parseInt(cell.dataset.day || "0", 10);
    const valid = d >= 1 && d <= daysInThisMonth;
    cell.classList.toggle("disabled", !valid);
  });

  clearCalendarCells();
  await loadSocietaCache();
  const patients = await ensurePatientsForCalendar();
  fillCalendarFromPatients(patients);
}


  // Build label
  const buildLabel = $("#buildLabel");
  if (buildLabel) buildLabel.textContent = DISPLAY;

  // Warmup (session persistita) per calendario istantaneo
  try { warmupCoreData(); } catch (_) {}


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
      anno_esercizio: ($("#setAnno")?.value || "").trim()
    };
  }

  function applySettingsToUI(settings) {
    const s = settings || {};
    if ($("#setAnno")) $("#setAnno").value = s.anno_esercizio ?? "";
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
  const btnSortToday = $("#patSortToday");

  let patientsCache = null;
  let patientsLoaded = false;
  let patientsSortMode = "date"; // date|soc|today
  let currentPatient = null;
  let patientEditEnabled = true; // per create


  // --- Warmup dati core (per calendario istantaneo)
  let warmupPromise = null;
  function warmupCoreData() {
    const user = getSession();
    if (!user || !user.id) return Promise.resolve();
    if (warmupPromise) return warmupPromise;
    warmupPromise = (async () => {
      try {
        await Promise.all([
          loadSocietaCache().catch(() => []),
          (patientsLoaded ? Promise.resolve() : loadPatients({ render: false }).catch(() => {}))
        ]);
      } finally {
        // lascia warmupPromise per riuso (evita richieste duplicate)
      }
    })();
    return warmupPromise;
  }
  function fmtIsoDate(iso) {
    return ymdLocal(iso);
  }

  // Palette società (0..5): Rosso, Arancione, Giallo, Verde, Azzurro, Indaco
  const SOC_TAG_COLORS = {
    0: "#E53935",
    1: "#FB8C00",
    2: "#FDD835",
    3: "#43A047",
    4: "#1E88E5",
    5: "#3949AB"
  };

  function hexToRgba(hex, alpha) {
    const h = String(hex || "").trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(h);
    if (!m) return "";
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  const IT_MONTHS = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];

  function fmtItDateLong(d) {
    if (!d) return "";
    const day = d.getDate();
    const month = IT_MONTHS[d.getMonth()] || "";
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  }

  function fmtTherapyPeriod(startStr, endStr) {
    const s = dateOnlyLocal(startStr);
    const e = dateOnlyLocal(endStr);
    if (!s && !e) return "";
    if (s && e) {
      const d1 = s.getDate();
      const d2 = e.getDate();
      const m1 = IT_MONTHS[s.getMonth()] || "";
      const m2 = IT_MONTHS[e.getMonth()] || "";
      const y1 = s.getFullYear();
      const y2 = e.getFullYear();

      if (y1 === y2 && s.getMonth() === e.getMonth()) {
        return `${d1}-${d2} ${m1} ${y1}`;
      }
      if (y1 === y2) {
        return `${d1} ${m1} - ${d2} ${m2} ${y1}`;
      }
      return `${d1} ${m1} ${y1} - ${d2} ${m2} ${y2}`;
    }
    if (s) return `dal ${fmtItDateLong(s)}`;
    return `fino al ${fmtItDateLong(e)}`;
  }

  function getTodayDayKey() {
    // JS: 0=DOM,1=LUN,...6=SAB. App calendar uses 1..6 (LU..SA)
    const d = new Date();
    const jsDay = d.getDay();
    if (jsDay === 0) return null;
    if (jsDay >= 1 && jsDay <= 6) return jsDay;
    return null;
  }

  function getPatientTodayTimes(p) {
    if (!p || p.isDeleted) return [];
    const dayKey = getTodayDayKey();
    if (!dayKey) return [];

    // active period check
    const today = dateOnlyLocal(new Date());
    if (!inRange(today, p.data_inizio, p.data_fine)) return [];

    const raw = p.giorni_settimana || p.giorni || "";
    if (!raw) return [];
    const map = parseGiorniMap(raw);
    if (!map || typeof map !== "object") return [];

    const out = [];
    Object.keys(map).forEach((k) => {
      const dayLabel = __normDayLabel(k);
      let kDay = DAY_LABEL_TO_KEY[dayLabel];
      if (!kDay && /^\d+$/.test(dayLabel)) {
        const n = parseInt(dayLabel, 10);
        if (n >= 1 && n <= 6) kDay = n;
      }
      if (kDay !== dayKey) return;
      const times = normalizeTimeList(map[k]);
      times.forEach((t) => { if (t) out.push(t); });
    });

    out.sort();
    return out;
  }

  function setPatientsSort(mode) {
    patientsSortMode = mode;
    btnSortDate?.classList.toggle("active", mode === "date");
    btnSortSoc?.classList.toggle("active", mode === "soc");
    btnSortToday?.classList.toggle("active", mode === "today");
    renderPatients();
  }

  btnSortDate?.addEventListener("click", () => setPatientsSort("date"));
  btnSortSoc?.addEventListener("click", () => setPatientsSort("soc"));
  btnSortToday?.addEventListener("click", () => setPatientsSort("today"));

  async function loadPatients(opts = {}) {
    const { render = true } = (opts || {});
    const user = getSession();
    if (!user) return;
    try {
      const data = await apiCached("listPatients", { userId: user.id }, 8000);
      patientsCache = Array.isArray(data.pazienti) ? data.pazienti : [];
      patientsLoaded = true;
      if (render) renderPatients();
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      throw err;
    }
  }

  function renderPatients() {
    if (!patientsListEl) return;

    let arr = (patientsCache || []).slice();

    if (patientsSortMode === "today") {
      const filtered = [];
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const times = getPatientTodayTimes(p);
        if (!times.length) continue;
        // keep earliest time for sorting
        p.__todayTime = times[0];
        filtered.push(p);
      }
      filtered.sort((a, b) => String(a.__todayTime || "").localeCompare(String(b.__todayTime || "")) ||
        String(getSocNameById(a.societa_id||"")||"").localeCompare(String(getSocNameById(b.societa_id||"")||""), "it", { sensitivity: "base" }) ||
        String(a.nome_cognome||"").localeCompare(String(b.nome_cognome||""), "it", { sensitivity: "base" })
      );
      arr = filtered;
    } else if (patientsSortMode === "soc") {
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
      const period = fmtTherapyPeriod(p.data_inizio || "", p.data_fine || "");

      // Background color from società tag (20% opacity)
      const tagIdx = getSocTagIndexById(p.societa_id || "");
      const base = SOC_TAG_COLORS[tagIdx] || "";
      const bg = base ? hexToRgba(base, 0.20) : "";
      if (bg) row.style.backgroundColor = bg;

      row.innerHTML = `
        <div class="patient-info">
          <div class="patient-name">${escapeHtml(name)}</div>
          <div class="patient-sub">${escapeHtml(soc)}${period ? " • " + escapeHtml(period) : ""}</div>
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

    // Stato sola-lettura: solo per scheda paziente (viewPatientForm)
    const patCard = document.querySelector("#viewPatientForm .patient-card");
    if (patCard) patCard.classList.toggle("patient-readonly", !patientEditEnabled);
    const rowSoc = document.querySelector("#viewPatientForm .row-soc");
    if (rowSoc) rowSoc.classList.toggle("no-drop", !patientEditEnabled);

    const ids = ["patName","patStart","patEnd"];
    ids.forEach(id => {
      const el = $("#" + id);
      if (el) el.disabled = !patientEditEnabled;
    });
    const btnPick = $("#btnPickSoc");
    if (btnPick) {
      // In sola lettura non serve la freccia (selezione società)
      if (!patientEditEnabled) btnPick.setAttribute("hidden", "");
      else btnPick.removeAttribute("hidden");
      btnPick.toggleAttribute("disabled", !patientEditEnabled);
    }
    document.querySelectorAll(".circle-btn").forEach(b => b.toggleAttribute("disabled", !patientEditEnabled));
    document.querySelectorAll(".day-btn").forEach(b => b.toggleAttribute("disabled", !patientEditEnabled));
    $("#btnPatSave")?.toggleAttribute("disabled", !patientEditEnabled);
    if (!patientEditEnabled) $("#btnPatSave")?.classList.add("pill-gray");
    else $("#btnPatSave")?.classList.remove("pill-gray");

    // Mostra il tasto X: in modifica = chiudi; in sola-lettura = elimina (solo se esistente)
    const btnDel = $("#btnPatDelete");
    if (btnDel) {
      const canShow = patientEditEnabled ? true : (!!(currentPatient && currentPatient.id));
      if (canShow) btnDel.removeAttribute("hidden");
      else btnDel.setAttribute("hidden", "");
      btnDel.setAttribute("aria-label", patientEditEnabled ? "Chiudi" : "Elimina paziente");
    }

    updateTopPatientsVisible();
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

  // ---- Modal errore terapia (no sovrapposizioni)
  const modalTherapyError = $("#modalTherapyError");
  const therapyErrorMsg = $("#therapyErrorMsg");
  const btnTherapyErrorClose = $("#btnTherapyErrorClose");

  function openTherapyErrorModal(msg) {
    if (therapyErrorMsg) therapyErrorMsg.textContent = msg || "Conflitto terapia.";
    if (!modalTherapyError) return;
    modalTherapyError.classList.add("show");
    modalTherapyError.setAttribute("aria-hidden", "false");
  }
  function closeTherapyErrorModal() {
    if (!modalTherapyError) return;
    modalTherapyError.classList.remove("show");
    modalTherapyError.setAttribute("aria-hidden", "true");
  }
  btnTherapyErrorClose?.addEventListener("click", closeTherapyErrorModal);
  modalTherapyError?.addEventListener("click", (e) => { if (e.target === modalTherapyError) closeTherapyErrorModal(); });

  function __rangesOverlap(aStartStr, aEndStr, bStartStr, bEndStr) {
    const aS = dateOnlyLocal(aStartStr);
    const aE = dateOnlyLocal(aEndStr);
    const bS = dateOnlyLocal(bStartStr);
    const bE = dateOnlyLocal(bEndStr);

    // Open ranges
    const sA = aS ? aS.getTime() : -Infinity;
    const eA = aE ? aE.getTime() : Infinity;
    const sB = bS ? bS.getTime() : -Infinity;
    const eB = bE ? bE.getTime() : Infinity;

    return (sA <= eB) && (sB <= eA);
  }

  function __dayToKey(dayLabel) {
    const norm = __normDayLabel(dayLabel);
    let k = DAY_LABEL_TO_KEY[norm];
    if (!k && /^\d+$/.test(norm)) {
      const n = parseInt(norm, 10);
      if (n >= 1 && n <= 6) k = n;
    }
    return k || null;
  }

  async function hasTherapyConflictSlot(dayLabel, timeStr, curStart, curEnd, selfId) {
    const dayKeyWanted = __dayToKey(dayLabel);
    if (!dayKeyWanted) return false;
    const tWanted = normTime(timeStr);
    if (!tWanted || tWanted === "—") return false;

    const patients = await ensurePatientsForCalendar();
    for (const p of (patients || [])) {
      if (!p || p.isDeleted) continue;
      if (selfId && String(p.id) === String(selfId)) continue;

      if (!__rangesOverlap(curStart, curEnd, p.data_inizio, p.data_fine)) continue;

      const raw = p.giorni_settimana || p.giorni || "";
      if (!raw) continue;
      const map = parseGiorniMap(raw);
      if (!map || typeof map !== "object") continue;

      for (const k of Object.keys(map)) {
        const kDayKey = __dayToKey(k);
        if (!kDayKey || kDayKey !== dayKeyWanted) continue;

        const times = normalizeTimeList(map[k]);
        for (const tt of (times || [])) {
          if (normTime(tt) === tWanted) return true;
        }
      }
    }
    return false;
  }

  async function validateTherapyMapNoOverlap(selfId, giorniMap, curStart, curEnd) {
    const map = giorniMap && typeof giorniMap === "object" ? giorniMap : {};
    for (const k of Object.keys(map)) {
      const t = map[k];
      if (!t) continue;
      const conflict = await hasTherapyConflictSlot(k, t, curStart, curEnd, selfId);
      if (conflict) return { ok: false, day: k, time: t };
    }
    return { ok: true };
  }


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
      btn.addEventListener("click", async () => {
        // UI: evidenzia selezione
        timePickList.querySelectorAll(".pill-btn.selected").forEach((el) => el.classList.remove("selected")); 
        btn.classList.add("selected");
        if (!currentPatient) currentPatient = {};
        if (!currentPatient.giorni_map) currentPatient.giorni_map = {};
        const curStart = ($("#patStart")?.value || (currentPatient && currentPatient.data_inizio) || "").trim();
        const curEnd = ($("#patEnd")?.value || (currentPatient && currentPatient.data_fine) || "").trim();
        const selfId = currentPatient && currentPatient.id ? currentPatient.id : null;

        if (t !== "—") {
          const conflict = await hasTherapyConflictSlot(day, t, curStart, curEnd, selfId);
          if (conflict) {
            openTherapyErrorModal("Errore: esiste già una terapia per un altro paziente nello stesso giorno e alla stessa ora.");
            return;
          }
        }

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
    // In modifica: chiudi scheda
    if (patientEditEnabled) {
      const session = getSession();
      if (session && session.id) {
        await openPatientsAfterLogin();
      } else {
        showView("home");
      }
      return;
    }

    // In sola lettura: elimina paziente
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

    // Validazione: evita sovrapposizioni terapia (stesso giorno + stessa ora)
    try {
      const selfId = currentPatient && currentPatient.id ? currentPatient.id : null;
      const map = (currentPatient && currentPatient.giorni_map) ? currentPatient.giorni_map : {};
      const v = await validateTherapyMapNoOverlap(selfId, map, data_inizio, data_fine);
      if (!v.ok) {
        openTherapyErrorModal("Errore: terapia sovrapposta (stesso giorno e stessa ora).");
        return;
      }
    } catch (_) {
      // Se la validazione fallisce per motivi tecnici, non bloccare il salvataggio.
    }

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
  const socL1Input = $("#socL1Input");
  const socL2Input = $("#socL2Input");
  const socL3Input = $("#socL3Input");
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
    if (socL1Input) socL1Input.value = "";
    if (socL2Input) socL2Input.value = "";
    if (socL3Input) socL3Input.value = "";
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

    const normEuro = (v) => {
      const s = String(v || "").trim().replace(",", ".");
      if (!s) return "";
      const n = Number(s);
      if (!isFinite(n)) return null;
      return String(n);
    };

    const l1 = normEuro(socL1Input ? socL1Input.value : "");
    const l2 = normEuro(socL2Input ? socL2Input.value : "");
    const l3 = normEuro(socL3Input ? socL3Input.value : "");
    if (l1 === null || l2 === null || l3 === null) { toast("Valori livelli non validi"); return; }
    const user = getSession();
    if (!user) { toast("Accesso richiesto"); return; }
    try {
      await api("addSocieta", { userId: user.id, nome, tag: selectedSocTag, l1, l2, l3 });
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
      navigator.serviceWorker.register("./service-worker.js?v=1.025").catch(() => {});
    });
  }
})();
