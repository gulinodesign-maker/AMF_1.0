/* AMF_1.162 */
(async () => {
    const BUILD = "AMF_1.162";
    const DISPLAY = "1.162";


    const STANDALONE = true; // Standalone protetto (nessuna API remota)

  // --- Encrypted Local DB (IndexedDB + WebCrypto)
  const __DB_NAME = "amf_local_db";
  const __DB_STORE = "kv";
  const __K_META = "meta";
  const __K_CIPHER = "cipher";
  const __SCHEMA_VERSION = 1;
  const __PBKDF2_ITER = 210000;

  let __cryptoKey = null;      // CryptoKey in RAM (sbloccato)
  let __dbPlain = null;        // Oggetto DB in chiaro in RAM (sbloccato)

  const __b64 = {
    enc: (buf) => {
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    },
    dec: (b64) => {
      const bin = atob(String(b64 || ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }
  };

  function __randBytes(len) {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return a.buffer;
  }

  function __todayFilenameDDMMYY() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}-${mm}-${yy}.json`;
  }

  async function __idb() {
    return await new Promise((resolve, reject) => {
      const req = indexedDB.open(__DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(__DB_STORE)) {
          db.createObjectStore(__DB_STORE, { keyPath: "k" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IDB_ERROR"));
    });
  }

  async function __idbGet(k) {
    const db = await __idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(__DB_STORE, "readonly");
      const st = tx.objectStore(__DB_STORE);
      const req = st.get(k);
      req.onsuccess = () => resolve(req.result ? req.result.v : null);
      req.onerror = () => reject(req.error || new Error("IDB_GET_ERROR"));
      tx.oncomplete = () => db.close();
    });
  }

  async function __idbSet(k, v) {
    const db = await __idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(__DB_STORE, "readwrite");
      const st = tx.objectStore(__DB_STORE);
      st.put({ k, v });
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { const e = tx.error || new Error("IDB_SET_ERROR"); db.close(); reject(e); };
    });
  }

  async function __idbClearAll() {
    try { indexedDB.deleteDatabase(__DB_NAME); } catch (_) {}
    __cryptoKey = null;
    __dbPlain = null;
  }

  async function __deriveKey(password, saltB64, iter) {
    const passBytes = new TextEncoder().encode(String(password || ""));
    const salt = __b64.dec(saltB64);
    const baseKey = await crypto.subtle.importKey("raw", passBytes, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: iter || __PBKDF2_ITER, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function __encryptToStore(obj, key, meta) {
    const iv = __randBytes(12);
    const pt = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, pt);
    await __idbSet(__K_META, meta);
    await __idbSet(__K_CIPHER, { iv: __b64.enc(iv), ct: __b64.enc(ct) });
  }

  async function __decryptFromStore(key) {
    const cipher = await __idbGet(__K_CIPHER);
    if (!cipher || !cipher.ct || !cipher.iv) return null;
    const iv = __b64.dec(cipher.iv);
    const ct = __b64.dec(cipher.ct);
    const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, ct);
    const txt = new TextDecoder().decode(ptBuf);
    const obj = JSON.parse(txt);
    if (!obj || obj.__magic !== "AMF_DB_V1") throw new Error("PASSWORD_INVALID");
    return obj;
  }

  async function __hasAccount() {
    const meta = await __idbGet(__K_META);
    return !!(meta && meta.salt);
  }

  async function __createAccount(nome, password) {
    const salt = __b64.enc(__randBytes(16));
    const iter = __PBKDF2_ITER;
    const key = await __deriveKey(password, salt, iter);
    const dbPlain = {
      __magic: "AMF_DB_V1",
      schema: __SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      user: { id: "1", nome: String(nome || "").trim() || "Utente" },
      settings: { anno: new Date().getFullYear() },
      societa: [],
      pazienti: [],
      moves: []
    };
    const meta = { salt, iter, schema: __SCHEMA_VERSION, userNome: dbPlain.user.nome, createdAt: dbPlain.createdAt };
    await __encryptToStore(dbPlain, key, meta);
    __cryptoKey = key;
    __dbPlain = dbPlain;
    return { user: { id: "1", nome: dbPlain.user.nome } };
  }

  async function __unlock(password) {
    const meta = await __idbGet(__K_META);
    if (!meta || !meta.salt) throw new Error("NO_ACCOUNT");
    const key = await __deriveKey(password, meta.salt, meta.iter || __PBKDF2_ITER);
    const dbPlain = await __decryptFromStore(key);
    __cryptoKey = key;
    __dbPlain = dbPlain;
    return { user: { id: "1", nome: dbPlain.user?.nome || meta.userNome || "Utente" } };
  }

  async function __saveDb() {
    if (!__cryptoKey || !__dbPlain) return;
    const meta = await __idbGet(__K_META);
    const meta2 = Object.assign({}, meta || {}, { userNome: __dbPlain.user?.nome || (meta && meta.userNome) });
    await __encryptToStore(__dbPlain, __cryptoKey, meta2);
  }

  async function __changePassword(oldPass, newPass) {
    await __unlock(oldPass); // validates and loads
    const nome = (__dbPlain && __dbPlain.user && __dbPlain.user.nome) ? __dbPlain.user.nome : "Utente";
    // re-encrypt with new salt
    const salt = __b64.enc(__randBytes(16));
    const iter = __PBKDF2_ITER;
    const key = await __deriveKey(newPass, salt, iter);
    const meta = { salt, iter, schema: __SCHEMA_VERSION, userNome: nome, createdAt: (__dbPlain && __dbPlain.createdAt) ? __dbPlain.createdAt : new Date().toISOString() };
    await __encryptToStore(__dbPlain, key, meta);
    __cryptoKey = key;
    return { ok: true };
  }

  async function __exportDbFile() {
    const meta = await __idbGet(__K_META);
    const cipher = await __idbGet(__K_CIPHER);
    if (!meta || !cipher) throw new Error("NO_DB");
    const payload = { meta, cipher, exportedAt: new Date().toISOString(), build: BUILD };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = __todayFilenameDDMMYY();
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch(_){}; try { a.remove(); } catch(_){}; }, 0);
  }

  async function __importDbObject(obj) {
    if (!obj || !obj.meta || !obj.cipher) throw new Error("INVALID_FILE");
    await __idbSet(__K_META, obj.meta);
    await __idbSet(__K_CIPHER, obj.cipher);
    __cryptoKey = null;
    __dbPlain = null;
  }

  // --- Helpers
  const $ = (sel) => document.querySelector(sel);

  const bindTap = (el, fn) => {
    if (!el) return;
    let busy = false;
    const run = async (ev) => {
      try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (_) {}
      if (busy) return;
      busy = true;
      try { await fn(); }
      finally { setTimeout(() => { busy = false; }, 300); }
    };
    el.addEventListener("click", run);
    el.addEventListener("touchend", run, { passive: false });
  };

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

  // Euro helpers (2 decimals)
  function toEuro2String_(v) {
    const raw = String(v ?? "").trim();
    if (!raw) return "";
    const s = raw.replace(/\s+/g, "").replace(",", ".");
    const n = Number(s);
    if (!isFinite(n)) return raw;
    return (Math.round(n * 100) / 100).toFixed(2);
  }
  function toEuro2StringStrict_(v) {
    const raw = String(v ?? "").trim();
    if (!raw) return "";
    const s = raw.replace(/\s+/g, "").replace(",", ".");
    const n = Number(s);
    if (!isFinite(n)) return null;
    return (Math.round(n * 100) / 100).toFixed(2);
  }


  // Convert a normalized euro string with dot decimals (e.g. "15.50")
  // to a Sheets-friendly Italian format (e.g. "15,50") to avoid time parsing like 20.00 -> 20:00
  function euroToSheetNumber_(euroDotString) {
    const s = String(euroDotString ?? "").trim();
    if (!s) return "";
    // ensure 2 decimals with dot
    const norm = toEuro2StringStrict_(s);
    if (norm === null) return null;
    return norm.replace(".", ",");
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


  // Date range helper: checks if a LOCAL calendar date falls within [start,end] (inclusive)
  function inRangeDate(cellDate, startStr, endStr) {
    const s = dateOnlyLocal(startStr);
    const e = dateOnlyLocal(endStr);
    if (!s && !e) return true;
    if (!cellDate) return false;

    const d = dateOnlyLocal(cellDate);
    if (!d) return false;

    if (s && d.getTime() < s.getTime()) return false;
    if (e && d.getTime() > e.getTime()) return false;
    return true;
  }

  function patientDisplayName(p) {
    const fullRaw = String(p?.nome_cognome || p?.nome || "").trim();
    if (!fullRaw) return "—";

    // If stored as "Cognome, Nome"
    if (fullRaw.includes(",")) {
      const parts = fullRaw.split(",").map((x) => x.trim()).filter(Boolean);
      if (parts.length >= 2) return `${parts[0]} ${parts.slice(1).join(" ")}`.trim();
      return parts[0] || fullRaw;
    }

    // Default: assume last token is surname
    const parts = fullRaw.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return fullRaw;
    const cognome = parts[parts.length - 1];
    const nome = parts.slice(0, -1).join(" ");
    return `${cognome} ${nome}`.trim();
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
    const prev = getSession();
    const prevId = (prev && prev.id) ? String(prev.id) : null;
    const nextId = (user && user.id) ? String(user.id) : null;

    localStorage.setItem("AMF_SESSION", JSON.stringify(user));

    if (prevId !== nextId) {
      try { resetCoreDataCaches_("session-change"); } catch (_) {}
    }

    try {
      const qm = (typeof queueMicrotask === "function") ? queueMicrotask : ((fn) => setTimeout(fn, 0));
      qm(() => { try { warmupCoreData(); } catch (_) {} });
    } catch (_) {
      try { setTimeout(() => { try { warmupCoreData(); } catch (_) {} }, 0); } catch (_) {}
    }
  }
  function clearSession() {
    localStorage.removeItem("AMF_SESSION");
    try { resetCoreDataCaches_("logout"); } catch (_) {}
  }


  function setLastLoginName_(name) {
    try { if (name) localStorage.setItem("AMF_LAST_LOGIN", String(name)); } catch (_) {}
  }
  function getLastLoginName_() {
    try { return (localStorage.getItem("AMF_LAST_LOGIN") || "").trim(); } catch (_) { return ""; }
  }
  // Migrazione build: se cambia build e config.js ha un URL valido, aggiorna l"API_URL locale
  // (evita che resti salvato un vecchio endpoint).
  
  // API URL: non sovrascrivere mai AMF_API_URL se già presente (contiene il riferimento agli account esistenti).
  (function ensureApiUrlDefault() {
    try {
      const cfg = (window.AMF_CONFIG && String(window.AMF_CONFIG.API_URL || "").trim()) || "";
      const cfgOk = cfg && cfg.startsWith("http") && !cfg.includes("PASTE_YOUR_GAS_WEBAPP_URL_HERE");

      const prevDefault = "https://script.google.com/macros/s/AKfycbxHpNkpL202ooGlyg3leLGjx8mM9GxVahVJ5EVZBPPNkeui_uG3IxZQrlpeKwcpX4So/exec";
      const current = (localStorage.getItem("AMF_API_URL") || "").trim();

      if (cfgOk) {
        if (!current) {
          localStorage.setItem("AMF_API_URL", cfg);
        } else if (current === prevDefault && cfg !== prevDefault) {
          // Migrazione: se era ancora il vecchio default, aggiorna al nuovo endpoint
          localStorage.setItem("AMF_API_URL", cfg);
        }
      }

      // aggiorna solo il marker build
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
    const last = (localStorage.getItem("AMF_LAST_BUILD") || "").trim();
    if (last !== BUILD) {
      // Non toccare AMF_API_URL: potrebbe puntare agli account esistenti.
      localStorage.setItem("AMF_LAST_BUILD", BUILD);
    }
  })();;

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
    if (STANDALONE) return true;
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
    // Normalizza parametri per compatibilità tra API remota e modalità standalone
    if (action === "deletePatient" && params && params.id && !params.paziente_id) {
      try { params.paziente_id = params.id; } catch (_) {}
    }
    if (STANDALONE) {
      return await localApi_(action, params || {});
    }

    const base = getApiUrl();
    if (!base) throw new Error("API_URL_MISSING");

    const ua = (navigator && navigator.userAgent) ? String(navigator.userAgent) : "";
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || ((navigator && navigator.platform === "MacIntel") && (navigator.maxTouchPoints && navigator.maxTouchPoints > 1));

    const fetchOnce = async () => {
      const url = buildUrl(action, Object.assign({}, params || {}, { _: Date.now() }));
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!data || data.ok !== true) {
        throw new Error((data && data.error) ? String(data.error) : "Errore API");
      }
      return data;
    };

    if (!isIOS) {
      return await fetchOnce();
    }

    try {
      return await apiJsonp(action, params);
    } catch (_) {
      return await fetchOnce();
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

  // --- Local API (standalone encrypted)
  async function localApi_(action, params) {
    // Actions return {ok:true, ...} to match remote
    switch (String(action || "")) {
      case "ping": {
        return { ok: true };
      }
      case "createUser": {
        const nome = String(params.nome || "").trim();
        const password = String(params.password || "");
        if (!nome) throw new Error("Nome mancante");
        if (!password) throw new Error("Password mancante");
        const exists = await __hasAccount();
        if (exists) throw new Error("Account già esistente");
        const res = await __createAccount(nome, password);
        return { ok: true, user: res.user };
      }
      case "login": {
        const password = String(params.password || "");
        if (!password) throw new Error("Password mancante");
        const res = await __unlock(password);
        return { ok: true, user: res.user };
      }
      case "listUsers": {
        const meta = await __idbGet(__K_META);
        if (!meta || !meta.userNome) return { ok: true, users: [] };
        return { ok: true, users: [{ id: "1", nome: meta.userNome }] };
      }
      case "getSettings": {
        if (!__dbPlain) throw new Error("LOCKED");
        return { ok: true, settings: Object.assign({}, __dbPlain.settings || {}) };
      }
      case "saveSettings": {
        if (!__dbPlain) throw new Error("LOCKED");
        // Compat: la UI invia {payload: JSON.stringify({anno_esercizio: ...})}
        let incoming = {};
        try {
          if (params && typeof params.payload === "string" && params.payload.trim()) {
            incoming = JSON.parse(params.payload);
          } else if (params && typeof params.payload === "object" && params.payload) {
            incoming = params.payload;
          } else if (params && params.settings) {
            incoming = params.settings;
          }
        } catch (_) { incoming = {}; }

        __dbPlain.settings = Object.assign({}, __dbPlain.settings || {}, incoming || {});
        await __saveDb();
        return { ok: true, settings: Object.assign({}, __dbPlain.settings || {}) };
      }
      case "listSocieta": {
        if (!__dbPlain) throw new Error("LOCKED");
        return { ok: true, societa: Array.isArray(__dbPlain.societa) ? __dbPlain.societa : [] };
      }
      case "addSocieta": {
        if (!__dbPlain) throw new Error("LOCKED");
        const nome = String(params.nome || "").trim();
        if (!nome) throw new Error("Nome società mancante");
        const arr = Array.isArray(__dbPlain.societa) ? __dbPlain.societa : [];
        const id = String(params.id || params.societa_id || params.societaId || params.societyId || Date.now());

        // Accetta tariffe e tag da diversi nomi campo (compat con UI/remote)
        const tag = (params.tag ?? params.tagIndex ?? params.tag_index ?? params.soc_tag ?? params.socTag ?? null);
        const l1 = (params.l1 ?? params.L1 ?? params.livello1 ?? params.liv1 ?? params.tariffa_livello_1 ?? null);
        const l2 = (params.l2 ?? params.L2 ?? params.livello2 ?? params.liv2 ?? params.tariffa_livello_2 ?? null);
        const l3 = (params.l3 ?? params.L3 ?? params.livello3 ?? params.liv3 ?? params.tariffa_livello_3 ?? null);

        // Se arriva un payload JSON, merge anche quello
        let payloadObj = null;
        try {
          if (params && typeof params.payload === "string" && params.payload.trim()) payloadObj = JSON.parse(params.payload);
        } catch (_) { payloadObj = null; }

        const row = Object.assign(
          { id, nome },
          (payloadObj && typeof payloadObj === "object") ? payloadObj : {},
          {
            id,
            nome,
            tag: (payloadObj && payloadObj.tag !== undefined) ? payloadObj.tag : tag,
            l1: (payloadObj && payloadObj.l1 !== undefined) ? payloadObj.l1 : l1,
            l2: (payloadObj && payloadObj.l2 !== undefined) ? payloadObj.l2 : l2,
            l3: (payloadObj && payloadObj.l3 !== undefined) ? payloadObj.l3 : l3,
            tariffa_livello_1: (payloadObj && payloadObj.tariffa_livello_1 !== undefined) ? payloadObj.tariffa_livello_1 : l1,
            tariffa_livello_2: (payloadObj && payloadObj.tariffa_livello_2 !== undefined) ? payloadObj.tariffa_livello_2 : l2,
            tariffa_livello_3: (payloadObj && payloadObj.tariffa_livello_3 !== undefined) ? payloadObj.tariffa_livello_3 : l3,
            // copie per compat
            L1: (payloadObj && payloadObj.L1 !== undefined) ? payloadObj.L1 : l1,
            L2: (payloadObj && payloadObj.L2 !== undefined) ? payloadObj.L2 : l2,
            L3: (payloadObj && payloadObj.L3 !== undefined) ? payloadObj.L3 : l3,
            livello1: (payloadObj && payloadObj.livello1 !== undefined) ? payloadObj.livello1 : l1,
            livello2: (payloadObj && payloadObj.livello2 !== undefined) ? payloadObj.livello2 : l2,
            livello3: (payloadObj && payloadObj.livello3 !== undefined) ? payloadObj.livello3 : l3,
            liv1: (payloadObj && payloadObj.liv1 !== undefined) ? payloadObj.liv1 : l1,
            liv2: (payloadObj && payloadObj.liv2 !== undefined) ? payloadObj.liv2 : l2,
            liv3: (payloadObj && payloadObj.liv3 !== undefined) ? payloadObj.liv3 : l3
          }
        );

        // Se esiste già stessa id, sovrascrivi (comportamento tipo upsert)
        const idx = arr.findIndex(x => String(x && x.id) === String(id));
        if (idx >= 0) arr[idx] = Object.assign({}, arr[idx], row);
        else arr.push(row);
        __dbPlain.societa = arr;
        await __saveDb();
        return { ok: true, societa: arr };
      }

      case "updateSocieta":
      case "editSocieta":
      case "setSocieta":
      case "updateSociety":
      case "editSociety": {
        if (!__dbPlain) throw new Error("LOCKED");
        const arr = Array.isArray(__dbPlain.societa) ? __dbPlain.societa : [];
        const id = String(params.id || params.societa_id || params.societaId || params.societyId || "").trim();
        const nome = String(params.nome || params.name || "").trim();
        if (!id && !nome) throw new Error("ID/Nome società mancante");

        let payloadObj = null;
        try {
          if (params && typeof params.payload === "string" && params.payload.trim()) payloadObj = JSON.parse(params.payload);
        } catch (_) { payloadObj = null; }

        const idx = arr.findIndex(x => (id && String(x && x.id) === id) || (!id && nome && String(x && x.nome || "").trim().toLowerCase() === nome.toLowerCase()));
        if (idx < 0) throw new Error("Società non trovata");
        const merged = Object.assign({}, arr[idx], payloadObj || {}, params || {});
        // normalizza campi principali
        if (id) merged.id = id;
        if (nome) merged.nome = nome;
        arr[idx] = merged;
        __dbPlain.societa = arr;
        await __saveDb();
        return { ok: true, societa: arr };
      }

      case "deleteSocieta":
      case "delSocieta":
      case "removeSocieta":
      case "deleteSociety": {
        if (!__dbPlain) throw new Error("LOCKED");
        const arr = Array.isArray(__dbPlain.societa) ? __dbPlain.societa : [];
        const id = String(params.id || params.societa_id || params.societaId || params.societyId || "").trim();
        const nome = String(params.nome || params.name || "").trim();
        const out = arr.filter(x => {
          if (id) return String(x && x.id) !== id;
          if (nome) return String(x && x.nome || "").trim().toLowerCase() !== nome.toLowerCase();
          return true;
        });
        __dbPlain.societa = out;
        await __saveDb();
        return { ok: true, societa: out };
      }
      case "listPatients": {
        if (!__dbPlain) throw new Error("LOCKED");
        const all = Array.isArray(__dbPlain.pazienti) ? __dbPlain.pazienti : [];
        const pazienti = all.filter(p => !(p && p.isDeleted));
        return { ok: true, pazienti };
      }
      case "createPatient": {
        if (!__dbPlain) throw new Error("LOCKED");
        const raw = (params && params.paziente) ? params.paziente : (params && params.payload ? (() => { try { return JSON.parse(params.payload); } catch(e){ return {}; } })() : {});
        const p = Object.assign({}, raw || {});
        const arr = Array.isArray(__dbPlain.pazienti) ? __dbPlain.pazienti : [];
        const maxId = arr.reduce((m, x) => Math.max(m, parseInt(String(x.id||0),10)||0), 0);
        p.id = String(maxId + 1);
        p.createdAt = p.createdAt || new Date().toISOString();
        p.updatedAt = new Date().toISOString();
        arr.push(p);
        __dbPlain.pazienti = arr;
        await __saveDb();
        return { ok: true, paziente: p };
      }
      case "updatePatient": {
        if (!__dbPlain) throw new Error("LOCKED");
        const raw = (params && params.paziente) ? params.paziente : (params && params.payload ? (() => { try { return JSON.parse(params.payload); } catch(e){ return {}; } })() : {});
        const p = Object.assign({}, raw || {});
        const id = String(p.id || (params && (params.id || params.paziente_id)) || "");
        if (!p.id && id) p.id = id;
        if (!id) throw new Error("ID mancante");
        const arr = Array.isArray(__dbPlain.pazienti) ? __dbPlain.pazienti : [];
        const idx = arr.findIndex(x => String(x.id) === id);
        if (idx < 0) throw new Error("Paziente non trovato");
        const merged = Object.assign({}, arr[idx], p, { updatedAt: new Date().toISOString() });
        arr[idx] = merged;
        __dbPlain.pazienti = arr;
        await __saveDb();
        return { ok: true, paziente: merged };
      }
      case "deletePatient": {
        if (!__dbPlain) throw new Error("LOCKED");
        const id = String((params && (params.paziente_id || params.id)) || "");
        const arr = Array.isArray(__dbPlain.pazienti) ? __dbPlain.pazienti : [];
        const idx = arr.findIndex(x => String(x.id) === id);
        if (idx >= 0) {
          arr[idx] = Object.assign({}, arr[idx], { isDeleted: true, updatedAt: new Date().toISOString() });
          __dbPlain.pazienti = arr;
          await __saveDb();
        }
        return { ok: true };
      }
      case "listMoves": {
        if (!__dbPlain) throw new Error("LOCKED");
        return { ok: true, moves: Array.isArray(__dbPlain.moves) ? __dbPlain.moves : [] };
      }
      case "moveSession": {
        if (!__dbPlain) throw new Error("LOCKED");
        const mv = {
          id: String(Date.now()) + "_" + Math.floor(Math.random()*1000),
          paziente_id: String(params.paziente_id || ""),
          terapia_id: String(params.terapia_id || ""),
          from_date: String(params.from_date || ""),
          from_time: String(params.from_time || ""),
          to_date: String(params.to_date || ""),
          to_time: String(params.to_time || ""),
          createdAt: new Date().toISOString()
        };
        const arr = Array.isArray(__dbPlain.moves) ? __dbPlain.moves : [];
        arr.push(mv);
        __dbPlain.moves = arr;
        await __saveDb();
        return { ok: true, move: mv };
      }
      case "deleteSession": {
        if (!__dbPlain) throw new Error("LOCKED");
        // Deletion = move without destination (removes slot)
        const mv = {
          id: String(Date.now()) + "_" + Math.floor(Math.random()*1000),
          paziente_id: String(params.paziente_id || ""),
          terapia_id: String(params.terapia_id || ""),
          from_date: String(params.from_date || ""),
          from_time: String(params.from_time || ""),
          to_date: "",
          to_time: "",
          deleted: true,
          createdAt: new Date().toISOString()
        };
        const arr = Array.isArray(__dbPlain.moves) ? __dbPlain.moves : [];
        arr.push(mv);
        __dbPlain.moves = arr;
        await __saveDb();
        return { ok: true };
      }
      case "updatePassword": {
        const oldPass = String(params.old_password || params.oldPassword || "");
        const newPass = String(params.new_password || params.newPassword || "");
        if (!oldPass || !newPass) throw new Error("Password mancante");
        await __changePassword(oldPass, newPass);
        return { ok: true };
      }
      case "wipeAll": {
        await __idbClearAll();
        return { ok: true };
      }
      default:
        throw new Error("Azione non supportata (standalone): " + action);
    }
  }


// --- Views / Routing
  const views = {
    home: $("#viewHome"),
    auth: $("#viewAuth"),
    quick: $("#viewQuick"),
    create: $("#viewCreate"),
    login: $("#viewLogin"),
    modify: $("#viewModify"),
    settings: $("#viewSettings"),
    patients: $("#viewPatients"),
    patientForm: $("#viewPatientForm"),
    calendar: $("#viewCalendar"),
    stats: $("#viewStats"),
    societa: $("#viewSocieta")
  };


  // Società page
  const socList = $("#socList");
  const socEmptyHint = $("#socEmptyHint");

  const btnTopRight = $("#btnTopRight");
  const iconTopRight = $("#iconTopRight");
  const btnTopPlus = $("#btnTopPlus");
  const btnCalPrev = $("#btnCalPrev");
  const btnCalToday = $("#btnCalToday");
  const btnCalNext = $("#btnCalNext");
  const btnCalPatients = $("#btnCalPatients");
  const topbarTitle = $("#topbarTitle");
  const topbarMonth = $("#topbarMonth");

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
      iconTopRight.innerHTML = '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"></path><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"></path>';
    }
  }

  let currentView = "home";

  function updateTopbarTitle() {
    if (!topbarTitle) return;

    // Mostra il nome fisioterapista SOLO in Home.
    const isHome = (currentView === "home");
    const u = getSession();

    const physioName = (u && typeof u.nome === "string" && u.nome.trim()) ? u.nome.trim() : "";
    const baseTitle = "Montalto PMS";
    const titleTopbar = (isHome && physioName) ? physioName : "";

    topbarTitle.textContent = titleTopbar;

    // titolo del documento: mantieni il nome app (utile su iOS / tab)
    try { document.title = baseTitle; } catch (_) {}
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

    if (name === "patients") { setTopPlusMode_("add"); }
    else if (name === "stats") { setTopPlusMode_("print"); }
    else if (name === "societa") { setTopPlusMode_("soc_add"); }
    else { setTopPlusVisible(false); }
    setCalendarControlsVisible(name === "calendar");
    updateTopbarTitle();
    try { syncCalendarTopbarMonth(); } catch (_) {}

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
  function setTopPlusMode_(mode) {
    if (!btnTopPlus) return;
    if (mode === "print") {
      btnTopPlus.hidden = false;
      btnTopPlus.setAttribute("aria-label", "Stampa report");
      btnTopPlus.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l3 3v17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"></path><path d="M15 2v4h4"></path><path d="M8 11h8"></path><path d="M8 15h8"></path><path d="M8 19h5"></path></svg>';
      return;
    }
    if (mode === "soc_add") {
      btnTopPlus.hidden = false;
      btnTopPlus.setAttribute("aria-label", "Aggiungi società");
      btnTopPlus.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
      return;
    }
    // default: add
    btnTopPlus.hidden = false;
    btnTopPlus.setAttribute("aria-label", "Aggiungi");
    btnTopPlus.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
  }




  function setCalendarControlsVisible(isVisible) {
    const list = [btnCalPrev, btnCalToday, btnCalNext, btnCalPatients];
    list.forEach((b) => { if (b) b.hidden = !isVisible; });
  }


  btnTopPlus?.addEventListener("click", () => {
    if (currentView === "stats") {
      try { statsPrintReport_(); } catch (_) {}
      return;
    }
    if (currentView === "societa") {
      try { openSocModalNew_(); } catch (_) {}
      return;
    }
    openPatientCreate();
  });
// --- Home routes placeholders
  const routes = {
    
    pazienti: () => openPatientsFlow(),
    calendario: () => openCalendarFlow(),
    statistiche: () => openStatsFlow(),
    societa: () => openSocietaFlow()
  };
  

  // --- Statistiche
  const btnStatsMonth = $("#btnStatsMonth");
  const lblStatsMonth = $("#lblStatsMonth");
  const btnStatsSoc = $("#btnStatsSoc");
  const lblStatsSoc = $("#lblStatsSoc");
  const statsSocDots = $("#statsSocDots");
  const statsLevelDots = $("#statsLevelDots");
  const statsTableBody = $("#statsTableBody");
  const statsTableCard = $("#statsTableCard");
  const statsTotalAccessi = $("#statsTotalAccessi");
  const statsTotalImporto = $("#statsTotalImporto");

  // Report (popup)
  const modalReport = $("#modalReport");
  const reportFrame = $("#reportFrame");
  const btnReportClose = $("#btnReportClose");
  const btnReportPrint = $("#btnReportPrint");
  let reportModalData = null;

  const modalPickMonth = $("#modalPickMonth");
  const btnPickMonthClose = $("#btnPickMonthClose");
  const monthPickList = $("#monthPickList");

  let statsSelectedSoc = "ALL"; // "ALL" = Tutte
  let statsSelectedLevel = "T"; // L1/L2/L3/T
  let statsSelectedMonthIndex = (new Date()).getMonth(); // 0..11
  let statsYearOverride = null; // number | null (quando selezionato filtro ANNO corrente)

  const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

  let statsHandlersBound = false;

// Moves cache per statistiche (include spostamenti e cancellazioni sedute)
let statsMovesCacheKey = "";
let statsMovesCache = [];
async function ensureStatsMovesCache_() {
  const year = getStatsYear_();
  const mi = statsSelectedMonthIndex;
  const key = `${year}-${mi}`;
  if (statsMovesCacheKey === key && Array.isArray(statsMovesCache)) return;

  try {
    let raws = [];
    if (mi === -1) {
      const all = [];
      for (let m0 = 0; m0 < 12; m0++) {
        try { all.push(...(await fetchCalendarMovesForMonth_(year, m0))); } catch (_) {}
      }
      raws = all;
    } else {
      raws = await fetchCalendarMovesForMonth_(year, mi);
    }
    const moves0 = (raws || []).map(normalizeMove_).filter(Boolean);
    statsMovesCache = collapseMoves_(moves0);
    statsMovesCacheKey = key;
  } catch (_) {
    statsMovesCache = [];
    statsMovesCacheKey = key;
  }
}
function invalidateStatsMovesCache_() {
  statsMovesCacheKey = "";
  statsMovesCache = [];
}
function getStatsMovesCache_() {
  return Array.isArray(statsMovesCache) ? statsMovesCache : [];
}


  function openPickMonthModal_() {
    if (!modalPickMonth) return;
    modalPickMonth.classList.add("show");
    modalPickMonth.setAttribute("aria-hidden", "false");
  }
  function closePickMonthModal_() {
    if (!modalPickMonth) return;
    modalPickMonth.classList.remove("show");
    modalPickMonth.setAttribute("aria-hidden", "true");
  }
  btnPickMonthClose?.addEventListener("click", closePickMonthModal_);
  modalPickMonth?.addEventListener("click", (e) => { if (e.target === modalPickMonth) closePickMonthModal_(); });

  function renderStatsMonthLabel_() {
    if (!lblStatsMonth) return;
    if (statsSelectedMonthIndex === -1) {
      lblStatsMonth.textContent = (`ANNO ${getStatsYear_()}`).toUpperCase();
      return;
    }
    lblStatsMonth.textContent = (MONTHS_IT[statsSelectedMonthIndex] || "Mese").toUpperCase();
  }

  function renderStatsSocLabel_() {
    if (!lblStatsSoc) return;
    const label = (statsSelectedSoc === "ALL") ? "SOCIETÀ" : (String(getSocietaById(statsSelectedSoc)?.nome || "Società").toUpperCase());
    lblStatsSoc.textContent = label;
  }

  function statsSocInitials_(name) {
    const n = String(name || "").trim();
    if (!n) return "S";
    const parts = n.replace(/\s+/g, " ").split(" ").filter(Boolean);
    if (parts.length === 1) {
      const w = parts[0];
      return (w.slice(0, 2) || "S").toUpperCase();
    }
    const a = (parts[0][0] || "");
    const b = (parts[1][0] || "");
    const out = (a + b) || "S";
    return out.toUpperCase();
  }

  function renderStatsSocDots_() {
    if (!statsSocDots) return;
    statsSocDots.innerHTML = "";

    // "Tutte"
    const mkBtn = (id, label, className, bgColor) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = className;
      b.setAttribute("data-soc", id);
      b.textContent = label;
      if (bgColor) {
        b.style.background = bgColor;
        b.style.backgroundColor = bgColor;
      }
      b.classList.toggle("selected", statsSelectedSoc === id);
      b.addEventListener("click", async () => {
        statsSelectedSoc = id;
        await renderStatsTable_();
      });
      return b;
    };

    statsSocDots.appendChild(mkBtn("ALL", "T", "soc-circle soc-all", null));

    const arr = Array.isArray(societaCache) ? societaCache : [];
    arr.forEach((s) => {
      const sid = String(s?.id || "").trim();
      if (!sid) return;
      const nome = String(s?.nome || "Società").trim();
      const tag = Math.max(0, Math.min(5, Number(s?.tag) || 0));
      const cls = "soc-circle t" + String(tag + 1);
      const ini = statsSocInitials_(nome);
      const b = mkBtn(sid, ini, cls, null);
      b.setAttribute("aria-label", "Seleziona " + nome);
      statsSocDots.appendChild(b);
    });

    // layout: keep all dots on one row by providing count to CSS
    statsSocDots.style.setProperty('--soc-count', String(statsSocDots.children.length || 1));

  }

  function getStatsYear_() {
    if (isFinite(statsYearOverride) && statsYearOverride >= 2000 && statsYearOverride <= 2100) return statsYearOverride;
    const y1 = ($("#setAnno")?.value || "").trim();
    const cand = y1;
    const n = parseInt(cand, 10);
    return (isFinite(n) && n >= 2000 && n <= 2100) ? n : (new Date()).getFullYear();
  }

  function getPatientLevel_(p) {
    return normalizeLevel_(p?.livello ?? p?.level ?? p?.liv ?? p?.livello_id ?? p?.lvl);
  }

  function resolveTherapyLevel_(patient, therapy, societaId) {
    // 1) livello sulla terapia (vari campi)
    const direct = normalizeLevel_(therapy?.livello ?? therapy?.level ?? therapy?.liv ?? therapy?.livello_id ?? therapy?.lvl);
    if (direct && direct !== "T") return direct;
    // 2) livello sul paziente
    const pl = getPatientLevel_(patient);
    if (pl && pl !== "T") return pl;
    // 3) fallback: tag della società (1..3 -> L1..L3)
    const sid = String(societaId || patient?.societa_id || patient?.societaId || patient?.soc || "").trim();
    const s = sid ? getSocietaById(sid) : null;
    const t = s ? parseInt(s.tag, 10) : 0;
    if (t === 1) return "L1";
    if (t === 2) return "L2";
    if (t === 3) return "L3";
    return null;
  }

  function getRateForPatient_(p) {
    const lv = getPatientLevel_(p);
    if (!lv || lv === "T") return 0;
    const sid = String(p?.societa_id || p?.societaId || p?.soc || "").trim();
    const s = sid ? getSocietaById(sid) : null;
    if (!s) return 0;

    const l1 = coerceNumber_(s.l1 ?? s.L1 ?? s.liv1 ?? s.livello1 ?? s.tariffa_livello_1 ?? s.tariffa1 ?? s.rate_l1 ?? s.rate1);
    const l2 = coerceNumber_(s.l2 ?? s.L2 ?? s.liv2 ?? s.livello2 ?? s.tariffa_livello_2 ?? s.tariffa2 ?? s.rate_l2 ?? s.rate2);
    const l3 = coerceNumber_(s.l3 ?? s.L3 ?? s.liv3 ?? s.livello3 ?? s.tariffa_livello_3 ?? s.tariffa3 ?? s.rate_l3 ?? s.rate3);

    if (lv === "L1") return l1 ?? 0;
    if (lv === "L2") return l2 ?? 0;
    if (lv === "L3") return l3 ?? 0;
    return 0;
  }

  function countWeekdayInRange_(startDate, endDate, weekday) {
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
  }

  function getPatientRangeWithinYear_(p, year) {
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
  }

  function getPatientTherapiesForStats_(p) {
    // p.terapie è salvato su Sheet come JSON string; in UI può essere già oggetto.
    let arr = [];
    try {
      const raw = (p && (p.terapie ?? p.terapia)) ?? "";
      if (Array.isArray(raw)) arr = raw;
      else if (typeof raw === "string" && raw.trim()) {
        const j = JSON.parse(raw);
        if (Array.isArray(j)) arr = j;
      } else if (raw && typeof raw === "object") {
        // se arriva come oggetto non-array, ignoralo
      }
    } catch (_) { arr = []; }

    // Fallback: terapia singola legacy
    if (!Array.isArray(arr) || !arr.length) {
      return [{
        livello: getPatientLevel_(p),
        data_inizio: String(p?.data_inizio || "").trim(),
        data_fine: String(p?.data_fine || "").trim(),
        giorni_settimana: parseGiorniMap(p?.giorni_settimana || p?.giorni || {})
      }];
    }

    // Normalizza shape
    return arr.map((t) => ({
      livello: normalizeLevel_(t?.livello),
      data_inizio: String(t?.data_inizio || t?.start || "").trim(),
      data_fine: String(t?.data_fine || t?.end || "").trim(),
      giorni_settimana: parseGiorniMap(t?.giorni_settimana || t?.giorni_map || t?.giorni || {})
    }));
  }


  function calcSessionsForPatientMonth_(p, year, monthIndex) {
    if (!p || p.isDeleted) return 0;

    const sid = String(p.societa_id || p.societaId || p.soc || "").trim();
    if (statsSelectedSoc !== "ALL" && sid !== statsSelectedSoc) return 0;

    const therapies = getPatientTherapiesForStats_(p);
    if (!therapies.length) return 0;

    let periodStart, periodEnd;

    if (monthIndex === -1) {
      periodStart = new Date(year, 0, 1); periodStart.setHours(0,0,0,0);
      periodEnd = new Date(year, 11, 31); periodEnd.setHours(0,0,0,0);
    } else {
      periodStart = new Date(year, monthIndex, 1); periodStart.setHours(0,0,0,0);
      periodEnd = new Date(year, monthIndex + 1, 0); periodEnd.setHours(0,0,0,0);
    }

    let sessions = 0;

    for (const t of therapies) {
      const lv = resolveTherapyLevel_(p, t, sid);
      if (statsSelectedLevel !== "T" && lv !== statsSelectedLevel) continue;

      const range = getPatientRangeWithinYear_({ data_inizio: t?.data_inizio, data_fine: t?.data_fine }, year);
      if (!range) continue;

      const start = new Date(Math.max(range.start.getTime(), periodStart.getTime()));
      const end = new Date(Math.min(range.end.getTime(), periodEnd.getTime()));
      if (start.getTime() > end.getTime()) continue;

      const map = parseGiorniMap(t?.giorni_settimana || t?.giorni_map || {});
      if (!map || typeof map !== "object") continue;

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

        const occ = countWeekdayInRange_(start, end, wk);
        sessions += occ * perWeek;
      });
    }

    // Applica spostamenti/cancellazioni (moves) per questo mese
    try {
      const moves = getStatsMovesCache_();
      if (moves && moves.length) {
        const pid0 = String(p.id != null ? p.id : (p.paziente_id || p.pazienteId || ""));
        for (const mv of moves) {
          if (!mv) continue;
          if (String(mv.paziente_id || "") !== pid0) continue;

          const fd2 = dateOnlyLocal(mv.from_date);
          if (fd2 && fd2.getTime() >= periodStart.getTime() && fd2.getTime() <= periodEnd.getTime()) {
            sessions -= 1;
          }

          if (!mv.isDelete && String(mv.to_date || "").trim()) {
            const td2 = dateOnlyLocal(mv.to_date);
            if (td2 && td2.getTime() >= periodStart.getTime() && td2.getTime() <= periodEnd.getTime()) {
              sessions += 1;
            }
          }
        }
      }
    } catch (_) {}

    if (sessions < 0) sessions = 0;
    return sessions;
  }

  function calcAmountForPatientMonth_(p, year, monthIndex) {
    if (!p || p.isDeleted) return 0;

    const sid = String(p.societa_id || p.societaId || p.soc || "").trim();
    if (statsSelectedSoc !== "ALL" && sid !== statsSelectedSoc) return 0;

    const therapies0 = getPatientTherapiesForStats_(p);
    const therapies = (statsSelectedLevel === "T")
      ? therapies0.slice()
      : therapies0.filter((t) => normalizeLevel_(t?.livello) === statsSelectedLevel);

    if (!therapies.length) return 0;

    const yearRange = { start: new Date(year, 0, 1), end: new Date(year, 11, 31) };
    yearRange.start.setHours(0,0,0,0);
    yearRange.end.setHours(0,0,0,0);

    let periodStart, periodEnd;

    if (monthIndex === -1) {
      periodStart = new Date(year, 0, 1); periodStart.setHours(0,0,0,0);
      periodEnd = new Date(year, 11, 31); periodEnd.setHours(0,0,0,0);
    } else {
      periodStart = new Date(year, monthIndex, 1); periodStart.setHours(0,0,0,0);
      periodEnd = new Date(year, monthIndex + 1, 0); periodEnd.setHours(0,0,0,0);
    }

    // Calcolo base per terapia (senza moves)
    const baseSessionsByT = new Array(therapies.length).fill(0);

    for (let ti = 0; ti < therapies.length; ti++) {
      const t = therapies[ti];
      const range = getPatientRangeWithinYear_({ data_inizio: t?.data_inizio, data_fine: t?.data_fine }, year);
      if (!range) continue;

      const start = new Date(Math.max(range.start.getTime(), periodStart.getTime()));
      const end = new Date(Math.min(range.end.getTime(), periodEnd.getTime()));
      if (start.getTime() > end.getTime()) continue;

      const map = parseGiorniMap(t?.giorni_settimana || t?.giorni_map || {});
      if (!map || typeof map !== "object") continue;

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

        const occ = countWeekdayInRange_(start, end, wk);
        baseSessionsByT[ti] += occ * perWeek;
      });
    }

    // Helper: trova terapia più probabile per una seduta (data+ora)
    function findTherapyIndexForSession_(dateStr, timeStr) {
      const d = dateOnlyLocal(dateStr);
      const tNorm = normTime(timeStr);
      if (!d || !tNorm) return -1;

      const wd = d.getDay(); // 0=Sun..6=Sat
      // convert to our wk keys (0..6 Monday..Sunday?) DAY_LABEL_TO_KEY uses labels.
      // In map we allow numeric day labels too; for matching usiamo la stessa logica:
      for (let i = 0; i < therapies.length; i++) {
        const th = therapies[i];
        const range = getPatientRangeWithinYear_({ data_inizio: th?.data_inizio, data_fine: th?.data_fine }, year);
        if (!range) continue;
        const dd = new Date(d); dd.setHours(0,0,0,0);
        if (dd.getTime() < range.start.getTime() || dd.getTime() > range.end.getTime()) continue;

        const map = parseGiorniMap(th?.giorni_settimana || th?.giorni_map || {});
        const keys = Object.keys(map || {});
        for (const k of keys) {
          const dayLabel = __normDayLabel(k);
          let wk = DAY_LABEL_TO_KEY[dayLabel];
          if (wk === undefined || wk === null) {
            if (/^\d+$/.test(dayLabel)) {
              const n = parseInt(dayLabel, 10);
              if (n >= 0 && n <= 6) wk = n;
            }
          }
          if (wk === undefined || wk === null) continue;
          // Nota: la nostra rappresentazione wk è 0=Lun..6=Dom; JS getDay è 0=Dom..6=Sab.
          // Mappiamo JS->wk:
          const jsToWk = (wd === 0) ? 6 : (wd - 1);
          if (wk !== jsToWk) continue;

          const times = normalizeTimeList(map[k]);
          if (times.some((x) => normTime(x) === tNorm)) return i;
        }
      }

      // fallback: prima terapia valida per data
      for (let i = 0; i < therapies.length; i++) {
        const th = therapies[i];
        const range = getPatientRangeWithinYear_({ data_inizio: th?.data_inizio, data_fine: th?.data_fine }, year);
        if (!range) continue;
        const dd = new Date(d); dd.setHours(0,0,0,0);
        if (dd.getTime() >= range.start.getTime() && dd.getTime() <= range.end.getTime()) return i;
      }

      return 0;
    }

    // Applica moves distribuendoli sulla terapia più probabile
    const sessionsByT = baseSessionsByT.slice();
    try {
      const moves = getStatsMovesCache_();
      if (moves && moves.length) {
        const pid0 = String(p.id != null ? p.id : (p.paziente_id || p.pazienteId || ""));
        for (const mv of moves) {
          if (!mv) continue;
          if (String(mv.paziente_id || "") !== pid0) continue;

          const fd2 = dateOnlyLocal(mv.from_date);
          if (fd2 && fd2.getTime() >= periodStart.getTime() && fd2.getTime() <= periodEnd.getTime()) {
            const ti = findTherapyIndexForSession_(mv.from_date, mv.from_time);
            if (ti >= 0) sessionsByT[ti] -= 1;
          }

          if (!mv.isDelete && String(mv.to_date || "").trim()) {
            const td2 = dateOnlyLocal(mv.to_date);
            if (td2 && td2.getTime() >= periodStart.getTime() && td2.getTime() <= periodEnd.getTime()) {
              const ti = findTherapyIndexForSession_(mv.to_date, mv.to_time);
              if (ti >= 0) sessionsByT[ti] += 1;
            }
          }
        }
      }
    } catch (_) {}

    // Importo = somma(sessioni terapia * tariffa livello terapia)
    let total = 0;
    for (let ti = 0; ti < therapies.length; ti++) {
      const cnt = Math.max(0, sessionsByT[ti] || 0);
      if (!cnt) continue;
      const lv = resolveTherapyLevel_(p, therapies[ti], sid);
      const rate = getRateForPatient_({ societa_id: sid, livello: lv });
      total += cnt * (rate || 0);
    }
    return total;
  }

  function computeStatsRows_() {
    const year = getStatsYear_();
    const mi = statsSelectedMonthIndex;

    const rows = [];
    let totalAcc = 0;
    let totalEur = 0;

    const recs = Array.isArray(patientsCache) ? patientsCache : [];
    for (const p of recs) {
      const sessions = calcSessionsForPatientMonth_(p, year, mi);
      if (!sessions) continue;

      const amount = calcAmountForPatientMonth_(p, year, mi);

      const full = String(p?.nome_cognome || p?.nome || "").trim();
      const parts = full.split(/\s+/).filter(Boolean);
      const cognome = parts.length >= 2 ? parts[parts.length - 1] : (parts[0] || "");
      const nome = parts.length >= 2 ? parts.slice(0, -1).join(" ") : "";

      rows.push({ cognome, nome, accessi: sessions, importo: amount });
      totalAcc += sessions;
      totalEur += amount;
    }

    rows.sort((a, b) =>
      String(a.cognome || "").localeCompare(String(b.cognome || ""), "it", { sensitivity: "base" }) ||
      String(a.nome || "").localeCompare(String(b.nome || ""), "it", { sensitivity: "base" })
    );

    return { rows, totalAcc, totalEur, year, monthIndex: mi };
  }
  function formatPatientShort_(cognome, nome) {
    const c = String(cognome || "").trim();
    const n = String(nome || "").trim();
    const init = n ? ((n.split(/\s+/).filter(Boolean)[0] || "").charAt(0) || "") : "";
    if (c && init) return `${c} ${init.toUpperCase()}.`;
    return c || (init ? `${init.toUpperCase()}.` : "");
  }


  function applyStatsCardColor_() {
    if (!statsTableCard) return;
    if (statsSelectedSoc === "ALL") {
      statsTableCard.style.backgroundColor = "rgba(255,255,255,.80)";
      return;
    }
    const tag = getSocTagIndexById(statsSelectedSoc);
    const hex = (SOC_TAG_COLORS && SOC_TAG_COLORS[tag] !== undefined) ? SOC_TAG_COLORS[tag] : null;
    if (hex) {
      statsTableCard.style.backgroundColor = hexToRgba(hex, 0.38);
    } else {
      statsTableCard.style.backgroundColor = "rgba(255,255,255,.80)";
    }
  }

  async function renderStatsTable_() {
    if (!statsTableBody) return;

    renderStatsMonthLabel_();
    renderStatsSocLabel_();
    renderStatsSocDots_();
    applyStatsCardColor_();

    await ensureStatsMovesCache_();
    const out = computeStatsRows_();
    statsTableBody.innerHTML = "";

    (out.rows || []).forEach((r) => {
      const row = document.createElement("div");
      row.className = "stats-row";
      row.innerHTML = `
        <div class="st-c1">${escapeHtml(formatPatientShort_(r.cognome, r.nome))}</div>
        <div class="st-c3 st-num">${escapeHtml(String(r.accessi || 0))}</div>
        <div class="st-c4 st-num">${escapeHtml(formatEuro_(r.importo || 0))}</div>
      `;
      statsTableBody.appendChild(row);
    });

    if (statsTotalAccessi) statsTotalAccessi.textContent = String(out.totalAcc || 0);
    if (statsTotalImporto) statsTotalImporto.textContent = formatEuro_(out.totalEur || 0);
  }

  function statsPrintReport_() {
    const out = computeStatsRows_();
    const societaLabel = (statsSelectedSoc === "ALL") ? "Tutte" : (getSocietaById(statsSelectedSoc)?.nome || "Società");
    const operatorName = (() => {
      const u = getSession();
      return (u && typeof u.nome === "string" && u.nome.trim()) ? u.nome.trim() : "";
    })();

    const rows = (out.rows || []).map((r) => ({ cognome: r.cognome, nome: r.nome, accessi: r.accessi }));
    const total = out.totalAcc || 0;
    openAccessReportModal_(rows, total, { societaLabel, operatorName, monthIndex: out.monthIndex, year: out.year });
  }

  function bindStatsHandlersOnce_() {
    if (statsHandlersBound) return;
    statsHandlersBound = true;

    btnStatsMonth?.addEventListener("click", () => {
      if (!monthPickList) return;
      monthPickList.innerHTML = "";

      // Filtro ANNO corrente
      const yearBtn = document.createElement("button");
      yearBtn.type = "button";
      yearBtn.className = "pill-btn";
      if (statsSelectedMonthIndex === -1) yearBtn.classList.add("selected");
      const cy = (new Date()).getFullYear();
      yearBtn.textContent = `ANNO ${cy}`;
      yearBtn.addEventListener("click", () => {
        statsYearOverride = cy;
        statsSelectedMonthIndex = -1;
        closePickMonthModal_();
        void renderStatsTable_();
      });
      monthPickList.appendChild(yearBtn);

      MONTHS_IT.forEach((m, idx) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pill-btn";
        if (idx === statsSelectedMonthIndex) b.classList.add("selected");
        b.textContent = m;
        b.addEventListener("click", () => {
          statsYearOverride = null;
          statsSelectedMonthIndex = idx;
          closePickMonthModal_();
          void renderStatsTable_();
        });
        monthPickList.appendChild(b);
      });
      openPickMonthModal_();
    });

    btnStatsSoc?.addEventListener("click", async () => {
      try { await loadSocietaCache(false); } catch (_) {}
      const arr = Array.isArray(societaCache) ? societaCache : [];
      if (!socPickList) return;

      socPickList.innerHTML = "";
      const mk = (id, label) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pill-btn";
        if (statsSelectedSoc === id) b.classList.add("selected");
        b.textContent = label;
        b.addEventListener("click", () => {
          statsSelectedSoc = id;
          closePickSocModal();
          void renderStatsTable_();
        });
        return b;
      };

      socPickList.appendChild(mk("ALL", "Tutte"));
      arr.forEach((s) => {
        const sid = String(s?.id || "").trim();
        if (!sid) return;
        socPickList.appendChild(mk(sid, String(s?.nome || "Società")));
      });

      openPickSocModal();
    });
  }




function __hexToRgb_(hex) {
  const h = String(hex || "").trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function __rgbToRgba_(rgb, a) {
  if (!rgb) return "";
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}
function __lerp_(a, b, t) { return a + (b - a) * t; }

// Colori tab mesi: sequenza "tipo gradiente" (tinta unita per ogni tab)
function statsMonthColor_(idx, total) {
  const n = Math.max(1, Number(total) || 12);
  const t = n === 1 ? 0 : Math.min(1, Math.max(0, Number(idx) / (n - 1)));

  const cs = getComputedStyle(document.documentElement);
  const primary = __hexToRgb_(cs.getPropertyValue("--primary").trim() || "#2a74b8") || { r: 42, g: 116, b: 184 };
  const accent  = __hexToRgb_(cs.getPropertyValue("--accent").trim()  || "#c57b2a") || { r: 197, g: 123, b: 42 };

  const rgb = {
    r: Math.round(__lerp_(primary.r, accent.r, t)),
    g: Math.round(__lerp_(primary.g, accent.g, t)),
    b: Math.round(__lerp_(primary.b, accent.b, t))
  };
  return __rgbToRgba_(rgb, 0.80);
}

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

    const levels = ["T","L1","L2","L3"];
    levels.forEach((lv) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "level-circle";
      b.setAttribute("data-lv", lv);
      b.textContent = lv;
      if (statsSelectedLevel === lv) b.classList.add("selected");
      b.addEventListener("click", () => {
        statsSelectedLevel = lv;
        renderStatsLevelDots_();
        void renderStatsTable_();
      });
      statsLevelDots.appendChild(b);
    });
  }

function renderStatsMonthly_() {
    if (!statsMonthlyList) return;

    const readExerciseYear = () => {
      const y1 = ($("#setAnno")?.value || "").trim();
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

        const calcMonthlySessionsForPatient = (p, monthIndex) => {
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

      // criterio importi: se non c'è tariffa, non considerare neanche gli accessi
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

      return sessions;
    };

    const calcMonthlyAmountForPatient = (p, monthIndex) => {
      const sessions = calcMonthlySessionsForPatient(p, monthIndex);
      if (!sessions) return 0;
      const rate = getRateForPatient(p);
      return sessions * (rate || 0);
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

  const left = document.createElement("div");
  left.className = "month-left";

  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "month-tab";
  tab.textContent = MONTHS_IT[i];
  tab.style.background = statsMonthColor_(i, 12);

  const reportBtn = document.createElement("button");
  reportBtn.type = "button";
  reportBtn.className = "month-report-btn";
  reportBtn.setAttribute("aria-label", "Genera report accessi");
  reportBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l3 3v17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"></path><path d="M15 2v4h4"></path><path d="M8 11h8"></path><path d="M8 15h8"></path><path d="M8 19h5"></path></svg><span>Report</span>';

  reportBtn.addEventListener("click", () => {
    try {
      const yearLabel = year;
      const societaLabel = (statsSelectedSoc === "ALL") ? "Tutte" : (getSocietaById(statsSelectedSoc)?.nome || "Società");
      const operatorName = (() => {
        const u = getSession();
        return (u && typeof u.nome === "string" && u.nome.trim()) ? u.nome.trim() : "";
      })();

      const rows = [];
      let total = 0;
      const recs = Array.isArray(patientsCache) ? patientsCache : [];
      for (const p of recs) {
        const sessions = calcMonthlySessionsForPatient(p, i);
        if (!sessions) continue;

        const full = String(p?.nome_cognome || p?.nome || "").trim();
        const parts = full.split(/\s+/).filter(Boolean);
        const cognome = parts.length >= 2 ? parts[parts.length - 1] : (parts[0] || "");
        const nome = parts.length >= 2 ? parts.slice(0, -1).join(" ") : "";

        rows.push({ cognome, nome, accessi: sessions });
        total += sessions;
      }

      rows.sort((a, b) =>
        String(a.cognome || "").localeCompare(String(b.cognome || ""), "it", { sensitivity: "base" }) ||
        String(a.nome || "").localeCompare(String(b.nome || ""), "it", { sensitivity: "base" })
      );

      openAccessReportModal_(rows, total, { societaLabel, operatorName, monthIndex: i, year: yearLabel });
    } catch (e) {
      toast("Impossibile generare il report");
    }
  });

  left.appendChild(tab);
  left.appendChild(reportBtn);

  const value = document.createElement("div");
  value.className = "month-value";
  value.textContent = formatEuro_(val);

  top.appendChild(left);
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



  function buildAccessReportHtml_(rows, total, meta, opts = {}) {
    const safe = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
    const mIdx = Number(meta?.monthIndex) || 0;
    const y = Number(meta?.year) || (new Date()).getFullYear();
    const monthName = MONTHS_IT[mIdx] || "";
    const societaLabel = safe(meta?.societaLabel || "");
    const operatorName = safe(meta?.operatorName || "");
    const autoPrint = (opts && opts.autoPrint !== undefined) ? !!opts.autoPrint : true;

    const cs = getComputedStyle(document.documentElement);
    const primary = cs.getPropertyValue("--primary").trim() || "#2a74b8";
    const accent = cs.getPropertyValue("--accent").trim() || "#c57b2a";
    const text = cs.getPropertyValue("--text").trim() || "#1b1f23";

    const docTitle = `Report Accessi - ${monthName} ${y}`;

    const bodyRows = (Array.isArray(rows) ? rows : []).map((r) => {
      const c = String(r.cognome || "").trim();
      const n = String(r.nome || "").trim();
      const init = n ? ((n.split(/\s+/).filter(Boolean)[0] || "").charAt(0) || "") : "";
      const paz = (c && init) ? `${c} ${String(init).toUpperCase()}.` : (c || (init ? `${String(init).toUpperCase()}.` : ""));
      return `<tr>
        <td class="c1">${safe(paz)}</td>
        <td class="c2">${safe(String(r.accessi || 0))}</td>
      </tr>`;
    }).join("");

    const minRows = 18;
    const emptyCount = Math.max(0, minRows - (Array.isArray(rows) ? rows.length : 0));
    const emptyRows = new Array(emptyCount).fill(0).map(() => `<tr class="empty"><td class="c1">&nbsp;</td><td class="c2"></td></tr>`).join("");

    const autoPrintScript = autoPrint ? `
<script>
  window.addEventListener('load', () => { setTimeout(() => { try{ window.print(); }catch(e){} }, 250); });
</script>` : "";

    const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<base href="${safe((location && location.href ? location.href : '').split('#')[0])}"/>
<title>${safe(docTitle)}</title>
<style>
  :root{ --primary:${primary}; --accent:${accent}; --text:${text}; }
  *{ box-sizing:border-box; }
  body{
    margin:0;
    padding: 18px;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    color: var(--text);
    background:#ffffff;
  }
  .sheet{
    width: 100%;
    max-width: 820px;
    margin: 0 auto;
    border: 2px solid rgba(42,116,184,.55);
    padding: 18px 18px 14px;
    border-radius: 24px;
    background: rgba(255,255,255,.98);
  }
  .title{
    font-size: 30px;
    font-weight: 900;
    letter-spacing: .3px;
    margin: 0 0 6px;
    color: rgba(42,116,184,.98);
  }
  .meta{
    display:flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    font-weight: 700;
    color: rgba(27,31,35,.72);
    margin-bottom: 10px;
  }
  .meta b{ color: rgba(27,31,35,.92); }
  table{
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    border: 1px solid rgba(0,0,0,.12);
    border-radius: 18px;
    overflow: hidden;
  }
  thead th{
    text-align:left;
    padding: 10px 12px;
    font-size: 13px;
    letter-spacing: .2px;
    background: rgba(42,116,184,.12);
    border-bottom: 1px solid rgba(0,0,0,.10);
  }
  tbody td{
    padding: 10px 12px;
    border-bottom: 1px solid rgba(0,0,0,.08);
    font-weight: 700;
    font-size: 14px;
  }
  tbody tr.empty td{
    font-weight: 600;
    color: rgba(27,31,35,.55);
    height: 34px;
  }
  tfoot td{
    padding: 11px 12px;
    font-weight: 900;
    background: rgba(197,123,42,.10);
    border-top: 1px solid rgba(0,0,0,.10);
  }
  .c1{ width: 75%; }
  .c2{ width: 25%; text-align:right; }
  .tot-label{ text-transform: uppercase; letter-spacing: .5px; }
  .tot-val{ text-align:right; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="title">Report accessi</div>
    <div class="meta">
      <div><b>Mese:</b> ${safe(monthName)} ${safe(String(y))}</div>
      <div><b>Società:</b> ${societaLabel || "—"}</div>
      ${operatorName ? `<div><b>Operatore:</b> ${operatorName}</div>` : ``}
    </div>

    <table>
      <thead>
        <tr>
          <th class="c1">Paziente</th>
          <th class="c2">Accessi</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        ${emptyRows}
      </tbody>
      <tfoot>
        <tr>
          <td class="tot-label">TOTALE ACCESSI</td>
          <td class="tot-val">${safe(String(total || 0))}</td>
        </tr>
      </tfoot>
    </table>
  </div>
  ${autoPrintScript}
</body>
</html>`;

    return html;
  }

  function openAccessReportPrint_(rows, total, meta) {
    const html = buildAccessReportHtml_(rows, total, meta, { autoPrint: true });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      window.location.href = url;
    } else {
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 60000);
    }
  }

  function openAccessReportModal_(rows, total, meta) {
    if (!modalReport || !reportFrame) {
      // fallback: print direttamente
      openAccessReportPrint_(rows, total, meta);
      return;
    }
    reportModalData = { rows: Array.isArray(rows) ? rows : [], total: total || 0, meta: meta || {} };
    const html = buildAccessReportHtml_(reportModalData.rows, reportModalData.total, reportModalData.meta, { autoPrint: false });
    try { reportFrame.srcdoc = html; } catch (_) {}
    modalReport.classList.add("show");
    modalReport.setAttribute("aria-hidden", "false");
  }

  function closeAccessReportModal_() {
    if (!modalReport) return;
    modalReport.classList.remove("show");
    modalReport.setAttribute("aria-hidden", "true");
    reportModalData = null;
    try { if (reportFrame) reportFrame.srcdoc = ""; } catch (_) {}
  }

  btnReportClose?.addEventListener("click", closeAccessReportModal_);
  modalReport?.addEventListener("click", (e) => { if (e.target === modalReport) closeAccessReportModal_(); });
  btnReportPrint?.addEventListener("click", () => {
    if (!reportModalData) return;
    openAccessReportPrint_(reportModalData.rows, reportModalData.total, reportModalData.meta);
  });

async function openStatsFlow() {
    setCalendarControlsVisible(false);
    const titleEl = $("#topbarTitle");
    if (titleEl) titleEl.textContent = "Fatturati & Accessi";

    try { await loadSocietaCache(false); } catch (_) {}
    try { await loadPatients({ render: false }); } catch (_) {}

    bindStatsHandlersOnce_();
    renderStatsSocDots_();
    renderStatsLevelDots_();
    await renderStatsTable_();

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

  function _isLandscape_() {
    try { return window.matchMedia && window.matchMedia("(orientation: landscape)").matches; } catch (_) { return false; }
  }

  function syncCalendarTopbarMonth() {
    const inCal = (currentView === "calendar");
    const isLand = _isLandscape_();
    // classe per spostare mese nella topbar quando siamo in Calendario (portrait + landscape)
    try { document.body.classList.toggle("cal-month-topbar", !!inCal); } catch (_) {}
    // classe per micro-spacing aggiuntivo solo in landscape (come da richiesta precedente)
    try { document.body.classList.toggle("cal-landscape", !!(inCal && isLand)); } catch (_) {}

    if (topbarMonth) {
      topbarMonth.hidden = !inCal;
      if (inCal) {
        const t = (calDateTitle && typeof calDateTitle.textContent === "string") ? calDateTitle.textContent : "";
        topbarMonth.textContent = t;
      } else {
        topbarMonth.textContent = "";
      }
    }
  }

  try {
    window.addEventListener("resize", () => { try { syncCalendarTopbarMonth(); } catch (_) {} }, { passive: true });
  } catch (_) {}

  const calNowInfo = $("#calNowInfo");
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
  let calMovesCache = []; // spostamenti/override sedute per il mese corrente
  let calMovesHorizonLoading = false;
  let calMovesHorizonLoadedAt = 0;
  let calMovesMaxTsByPatient = new Map(); // pid -> max date ts (midnight local) derived from calendario (moves/add)
  const CAL_MOVES_HORIZON_MONTHS = 18; // quanto avanti leggere il calendario (mesi) per scadenze reali
  const CAL_COLOR_START = { r: 160, g: 160, b: 160 }; // grey
  const CAL_COLOR_MID   = { r: 90,  g: 150, b: 210 }; // azzurro chiaro
  const CAL_COLOR_END   = { r: 42,  g: 116, b: 184 }; // azzurro (primary)
  function calColorForDay(dayNum) {
    const t = Math.min(1, Math.max(0, (Number(dayNum) - 1) / 30));

    // gradiente a 3 stop: grigio -> arancione -> azzurro
    const a = (t < 0.5) ? (t * 2) : ((t - 0.5) * 2);
    const from = (t < 0.5) ? CAL_COLOR_START : CAL_COLOR_MID;
    const to   = (t < 0.5) ? CAL_COLOR_MID   : CAL_COLOR_END;

    const r = Math.round(from.r + (to.r - from.r) * a);
    const g = Math.round(from.g + (to.g - from.g) * a);
    const b = Math.round(from.b + (to.b - from.b) * a);
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
  const localTagMap = getSocTagMap_();
  (arr || []).forEach((s) => {
    if (!s) return;
    const id = String(s.id || "").trim();
    if (!id) return;
    const nome = String(s.nome || "").trim();
    // Tag/colore società:
    // 1) se il backend lo fornisce, usalo
    // 2) fallback locale (iOS) per salvare modifiche anche se il backend non persiste
    // 3) default: sequenza stabile per id
    let tag = (s.tag ?? s.tagIndex ?? s.tag_index ?? s.colore ?? s.color ?? null);
    if (tag === null || tag === undefined || tag === "") {
      const keyId = "id:" + id;
      const keyName = "name:" + nome;
      if (localTagMap[keyId] !== undefined && localTagMap[keyId] !== null) tag = localTagMap[keyId];
      else if (nome && localTagMap[keyName] !== undefined && localTagMap[keyName] !== null) tag = localTagMap[keyName];
      else if (nome && localTagMap[nome] !== undefined && localTagMap[nome] !== null) tag = localTagMap[nome];
      else tag = assignSocColorIndex0to5_(id);
    }
    tag = Math.max(0, Math.min(5, Number(tag) || 0));
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
    societaCache = arr;
    buildSocietaMap_(arr);
    return arr;
  } catch {
    societaCache = [];
    buildSocietaMap_([]);
    return [];
  }
}

// Refresh società state + UI (iOS: rendi immediato dopo Salva)

// Helper: verifica se una riga società corrisponde ai valori attesi (per refresh immediato iOS)
function societaMatchesExpected_(row, expect) {
  if (!row || !expect) return false;

  const getNum = (v) => {
    const s = String(v ?? "").trim().replace(",", ".");
    if (!s) return "";
    const n = Number(s);
    return isFinite(n) ? String(n) : s;
  };

  const nomeRow = String(row.nome || row.name || "").trim().toLowerCase();
  const nomeExp = String(expect.nome || expect.name || "").trim().toLowerCase();
  const okNome = nomeExp ? (nomeRow === nomeExp) : true;

  const okL1 = (expect.l1 === undefined || expect.l1 === null) ? true :
    (getNum(row.l1 ?? row.L1 ?? row.livello1 ?? row.liv1 ?? row.tariffa_livello_1) === getNum(expect.l1));
  const okL2 = (expect.l2 === undefined || expect.l2 === null) ? true :
    (getNum(row.l2 ?? row.L2 ?? row.livello2 ?? row.liv2 ?? row.tariffa_livello_2) === getNum(expect.l2));
  const okL3 = (expect.l3 === undefined || expect.l3 === null) ? true :
    (getNum(row.l3 ?? row.L3 ?? row.livello3 ?? row.liv3 ?? row.tariffa_livello_3) === getNum(expect.l3));

  return okNome && okL1 && okL2 && okL3;
}

function societaContainsExpected_(arr, expect) {
  const list = Array.isArray(arr) ? arr : [];
  const idExp = String(expect && (expect.id || expect.societa_id || expect.societaId || expect.societyId || "") || "").trim();
  const nomeExp = String(expect && (expect.nome || expect.name || "") || "").trim().toLowerCase();

  for (const r of list) {
    const rid = String(r && (r.id || r.societa_id || r.societaId || r.societyId || "") || "").trim();
    const rnome = String(r && (r.nome || r.name || "") || "").trim().toLowerCase();
    if ((idExp && rid === idExp) || (nomeExp && rnome === nomeExp)) {
      if (societaMatchesExpected_(r, expect)) return true;
    }
  }
  return false;
}

async function refreshSocietaEverywhere_(opts = {}) {
  const {
    rerenderPatients = true,
    rerenderStats = true,
    rerenderDeleteList = true,
    expected = null,
    optimistic = null,
    maxAttempts = 8,
    baseDelayMs = 180
  } = (opts || {});

  const user = getSession();
  if (!user || !user.id) return;

  // 1) Aggiornamento UI immediato (ottimistico) dopo Salva
  if (optimistic) {
    try {
      const getId = (x) => String(x && (x.id || x.societa_id || x.societaId || x.societyId || "") || "").trim();
      const arr = Array.isArray(societaCache) ? Array.from(societaCache) : [];

      const oid = getId(optimistic);
      let done = false;

      if (oid) {
        const idx = arr.findIndex((x) => getId(x) === oid);
        if (idx >= 0) {
          arr[idx] = Object.assign({}, arr[idx], optimistic);
          done = true;
        }
      }

      if (!done) {
        const oname = String(optimistic.nome || optimistic.name || "").trim().toLowerCase();
        if (oname) {
          const idx = arr.findIndex((x) => String(x && (x.nome || x.name || "") || "").trim().toLowerCase() === oname);
          if (idx >= 0) {
            arr[idx] = Object.assign({}, arr[idx], optimistic);
            done = true;
          }
        }
      }

      if (!done) arr.push(optimistic);

      societaCache = arr;
      buildSocietaMap_(arr);

      try { window.dispatchEvent(new CustomEvent("amf:societa-updated", { detail: { phase: "optimistic" } })); } catch (_) {}
    } catch (_) {}
  }

  // 2) Sync reale con retry brevi (backend può essere eventual-consistent)
  let lastArr = Array.isArray(societaCache) ? societaCache : [];
  for (let i = 0; i < Math.max(1, Number(maxAttempts) || 1); i++) {
    try {
      societaCache = null;
      invalidateApiCache("listSocieta");

      // bypass cache: params extra + timestamp
      const fresh = await api("listSocieta", { userId: user.id, __bust: Date.now(), _bust: Date.now() });
      const arr = Array.isArray(fresh && fresh.societa) ? fresh.societa : [];
      lastArr = arr;

      societaCache = arr;
      buildSocietaMap_(arr);

      if (!expected || societaContainsExpected_(arr, expected)) break;
    } catch (_) {
      // ignora, riprova
    }
    // backoff breve
    await new Promise((r) => setTimeout(r, (Number(baseDelayMs) || 150) + i * 120));
  }

  // 3) Aggiorna viste che dipendono da società (senza richiedere riavvio)
  if (rerenderPatients && (currentView === "patients" || currentView === "patientForm" || currentView === "modify" || currentView === "create")) {
    try { renderPatients(); } catch (_) {}
    try { renderPatientForm && renderPatientForm(); } catch (_) {}
  }

  if (rerenderStats && (currentView === "stats")) {
    try {
      const arr = Array.isArray(societaCache) ? societaCache : (Array.isArray(lastArr) ? lastArr : []);
      renderStatsSocTabs_(arr);
      renderStatsMonthly_ && renderStatsMonthly_();
    } catch (_) {}
  }

  if (rerenderDeleteList && socDeletePanel && !socDeletePanel.hidden) {
    try { await renderSocietaDeleteList(); } catch (_) {}
  }

  try { window.dispatchEvent(new CustomEvent("amf:societa-updated", { detail: { phase: "synced" } })); } catch (_) {}
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

function getSocTagMap_() {
  try {
    return safeJsonParse(localStorage.getItem("AMF_SOC_TAGS") || "", {}) || {};
  } catch (_) {
    return {};
  }
}

function getSocTagIndexById(id) {
  const s = getSocietaById(id);
  // 1) Preferisci tag restituito dal backend
  if (s && s.tag !== undefined && s.tag !== null) return (Number(s.tag) || 0);

  // 2) Fallback locale (iOS): salva tag/colore anche se il backend non lo persiste
  const map = getSocTagMap_();
  const keyId = "id:" + String(id || "").trim();
  if (keyId && map[keyId] !== undefined && map[keyId] !== null) return (Number(map[keyId]) || 0);

  const nome = s && s.nome ? String(s.nome).trim() : "";
  const keyName = "name:" + nome;
  if (nome && map[keyName] !== undefined && map[keyName] !== null) return (Number(map[keyName]) || 0);

  // compatibilità vecchie chiavi (nome puro)
  if (nome && map[nome] !== undefined && map[nome] !== null) return (Number(map[nome]) || 0);
  return 0;
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

function buildCalendarSlotsFromPatients(patients) {
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

    const therapies = parseTherapiesFromPatient_(p);
    if (!Array.isArray(therapies) || !therapies.length) return;

    therapies.forEach((th) => {
      if (!th) return;

      const map = th.giorni_map && typeof th.giorni_map === "object" ? th.giorni_map : {};
      if (!Object.keys(map).length) return;

      // weekday keys for this therapy
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

          if (!inRange(cellDate, th.data_inizio || p.data_inizio, th.data_fine || p.data_fine)) return;

          const times = normalizeTimeList(map[key]);
          if (!times.length) return;

          times.forEach((t) => {
            const slotKey = `${dayNum}|${t}`;
            const prev = slots.get(slotKey) || { count: 0, names: [], ids: [], tags: [] };

            // Dedup: non permettere lo stesso paziente due volte nello stesso slot
            const pid = p.id != null ? String(p.id) : "";
            const exists = Array.isArray(prev.ids) && prev.ids.some((x) => String(x) === pid);
            if (!exists) {
              prev.names.push(patientDisplayName(p) || "Paziente");
              prev.ids.push(pid);
              prev.tags.push(getSocTagIndexById(p.societa_id || ""));
              prev.count = prev.ids.length;
              slots.set(slotKey, prev);
            } else {
              prev.count = Array.isArray(prev.ids) ? prev.ids.length : Math.max(0, prev.count || 0);
              slots.set(slotKey, prev);
            }
          });
        });
      }
    });
  });

  return slots;
}

function paintCalendarSlots(slots) {
  if (!calBody) return;
  calSlotPatients = slots;

  calBody.querySelectorAll(".cal-cell").forEach((cell) => {
    const dayNum = parseInt(cell.dataset.day || "0", 10);
    const t = normTime(cell.dataset.time || "");
    const key = `${dayNum}|${t}`;
    const info = slots.get(key);

    if (!info || !info.count) return;

    cell.classList.add("filled");
    {
      const tag = Array.isArray(info.tags) && info.tags.length ? info.tags[0] : null;
      if (tag !== null && tag !== undefined && SOC_TAG_COLORS[tag] !== undefined) {
        cell.style.backgroundColor = hexToRgba(SOC_TAG_COLORS[tag], 0.50);
      } else {
        const col = calColorForDay(dayNum);
        cell.style.backgroundColor = rgba(col, 0.50);
      }
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

function slotInfoClone_(info) {
  return {
    count: info && info.count ? info.count : 0,
    names: Array.isArray(info && info.names) ? info.names.slice() : [],
    ids: Array.isArray(info && info.ids) ? info.ids.slice() : [],
    tags: Array.isArray(info && info.tags) ? info.tags.slice() : []
  };
}

function slotRemovePatient_(slots, slotKey, pid) {
  const info = slots.get(slotKey);
  if (!info || !info.count) return;

  const idx = Array.isArray(info.ids) ? info.ids.findIndex((x) => String(x) === String(pid)) : -1;
  if (idx < 0) return;

  info.ids.splice(idx, 1);
  if (Array.isArray(info.names)) info.names.splice(idx, 1);
  if (Array.isArray(info.tags)) info.tags.splice(idx, 1);

  info.count = Math.max(0, (info.count || 0) - 1);
  if (!info.count) slots.delete(slotKey);
  else slots.set(slotKey, info);
}

function slotAddPatient_(slots, slotKey, p) {
  if (!p) return;
  const pid = (p.id != null ? String(p.id) : "");
  if (!pid) return;

  const info = slots.get(slotKey) || { count: 0, names: [], ids: [], tags: [] };

  // Dedup: non permettere lo stesso paziente due volte nello stesso slot
  const exists = Array.isArray(info.ids) && info.ids.some((x) => String(x) === pid);
  if (exists) {
    // riallinea count in caso di dati incoerenti
    info.count = Array.isArray(info.ids) ? info.ids.length : Math.max(0, info.count || 0);
    slots.set(slotKey, info);
    return;
  }

  info.names = Array.isArray(info.names) ? info.names : [];
  info.ids = Array.isArray(info.ids) ? info.ids : [];
  info.tags = Array.isArray(info.tags) ? info.tags : [];

  info.names.push(patientDisplayName(p) || "Paziente");
  info.ids.push(pid);
  info.tags.push(getSocTagIndexById(p.societa_id || ""));
  info.count = info.ids.length;

  if (!info.count) slots.delete(slotKey);
  else slots.set(slotKey, info);
}

function isoYmdFromParts_(y, m0, d) {
  const mm = String(m0 + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function parseYmd_(s) {
  const m = String(s || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10) - 1, d: parseInt(m[3], 10) };
}

async function fetchCalendarMovesForMonth_(year, month0) {
  try {
    const user = getSession();
    if (!user || !user.id) return [];
    const ok = await ensureApiReady();
    if (!ok) return [];

    const res = await api("listMoves", { userId: user.id, year: String(year), month: String(month0 + 1) });
    const moves = res && (res.moves || res.spostamenti || res.sedute) ? (res.moves || res.spostamenti || res.sedute) : [];
    return Array.isArray(moves) ? moves : [];
  } catch (err) {
    if (apiHintIfUnknownAction(err)) return [];
    return [];
  }
}

function normalizeMove_(m) {
  if (!m) return null;
  const pid = m.paziente_id || m.pazienteId || m.patient_id || m.patientId || m.pid;
  const fd = m.from_date || m.fromDate || m.da_data || m.daData || m.from_day || m.fromDay;
  const ft = m.from_time || m.fromTime || m.da_ora || m.daOra || m.from_hour || m.fromHour;
  const td = m.to_date || m.toDate || m.a_data || m.aData || m.to_day || m.toDay;
  const tt = m.to_time || m.toTime || m.a_ora || m.aOra || m.to_hour || m.toHour;

  if (!pid || !fd || !ft) return null;

  const createdAt = m.createdAt || m.created_at || m.created || "";
  const updatedAt = m.updatedAt || m.updated_at || m.updated || "";

  const hasTo = !!(String(td || "").trim() && String(tt || "").trim());

  return {
    id: m.id || "",
    paziente_id: String(pid),
    from_date: String(fd).slice(0, 10),
    from_time: normTime(ft),
    to_date: hasTo ? String(td).slice(0, 10) : "",
    to_time: hasTo ? normTime(tt) : "",
    isDelete: !hasTo,
    createdAt: createdAt,
    updatedAt: updatedAt
  };
}


function moveTs_(mv) {
  const v = mv && (mv.updatedAt || mv.createdAt);
  if (!v) return 0;
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.getTime();
  // try parse "YYYY-MM-DD HH:MM:SS" etc.
  const s = String(v).replace(" ", "T");
  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2.getTime();
  return 0;
}

function collapseMoves_(moves) {
  const list = Array.isArray(moves) ? moves.filter(Boolean) : [];
  if (!list.length) return [];

  // group by paziente
  const byPid = new Map();
  list.forEach((mv) => {
    const pid = mv && mv.paziente_id != null ? String(mv.paziente_id) : "";
    if (!pid) return;
    if (!byPid.has(pid)) byPid.set(pid, []);
    byPid.get(pid).push(mv);
  });

  const out = [];

  byPid.forEach((arr, pid) => {
    // keep latest per fromKey
    const byFrom = new Map(); // fromKey -> mv
    arr.forEach((mv) => {
      const fk = `${String(mv.from_date).slice(0,10)}|${normTime(mv.from_time)}`;
      const cur = byFrom.get(fk);
      if (!cur) { byFrom.set(fk, mv); return; }
      if (moveTs_(mv) >= moveTs_(cur)) byFrom.set(fk, mv);
    });

    // resolve chains: follow fromKey -> toKey if toKey is also a fromKey
    const fromKeys = new Set(Array.from(byFrom.keys()));
    const visitedGlobal = new Set();

    byFrom.forEach((mv, fk) => {
      if (visitedGlobal.has(fk)) return;

      let cur = mv;
      let steps = 0;
      let tk = `${String(cur.to_date).slice(0,10)}|${normTime(cur.to_time)}`;
      const seen = new Set([fk]);

      while (fromKeys.has(tk) && steps < 12) {
        if (seen.has(tk)) break; // cycle guard
        seen.add(tk);
        const next = byFrom.get(tk);
        if (!next) break;
        // mark intermediate as visited
        visitedGlobal.add(tk);
        cur = next;
        tk = `${String(cur.to_date).slice(0,10)}|${normTime(cur.to_time)}`;
        steps++;
      }

      out.push({
        id: mv.id || "",
        paziente_id: pid,
        from_date: String(mv.from_date).slice(0,10),
        from_time: normTime(mv.from_time),
        to_date: String(cur.to_date || "").slice(0,10),
        to_time: normTime(cur.to_time || ""),
        isDelete: !!cur.isDelete || !(String(cur.to_date || "").trim() && String(cur.to_time || "").trim()),
        createdAt: mv.createdAt || "",
        updatedAt: mv.updatedAt || ""
      });
    });
  });

  return out;

}

async function ensureMovesHorizonLoaded_(opts = {}) {
  try {
    const { force = false, silent = true } = (opts || {});
    const user = getSession();
    if (!user || !user.id) return false;

    const nowTs = Date.now();
    if (!force && calMovesHorizonLoadedAt && (nowTs - calMovesHorizonLoadedAt) < 15000) return true;
    if (calMovesHorizonLoading) return false;

    calMovesHorizonLoading = true;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const months = [];
    for (let i = 0; i <= CAL_MOVES_HORIZON_MONTHS; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      months.push({ y: d.getFullYear(), m0: d.getMonth() });
    }

    const all = [];
    let idx = 0;
    const workers = Math.min(4, months.length);

    async function worker() {
      while (idx < months.length) {
        const cur = months[idx++];
        try {
          const part = await fetchCalendarMovesForMonth_(cur.y, cur.m0);
          if (Array.isArray(part) && part.length) all.push(...part);
        } catch (_) {}
      }
    }

    const jobs = [];
    for (let i = 0; i < workers; i++) jobs.push(worker());
    await Promise.all(jobs);

    const moves0 = (all || []).map(normalizeMove_).filter(Boolean);
    const moves = collapseMoves_(moves0);

    const maxByPid = new Map();
    (moves || []).forEach((mv) => {
      if (!mv || mv.isDelete) return;
      const pid = mv.paziente_id != null ? String(mv.paziente_id) : "";
      if (!pid) return;
      const ymd = String(mv.to_date || "").slice(0, 10);
      if (!ymd) return;
      const d = dateOnlyLocal(ymd);
      if (!d) return;
      d.setHours(0, 0, 0, 0);
      const ts = d.getTime();
      const cur = maxByPid.get(pid) || 0;
      if (ts > cur) maxByPid.set(pid, ts);
    });

    calMovesMaxTsByPatient = maxByPid;
    calMovesHorizonLoadedAt = Date.now();
    calMovesHorizonLoading = false;

    // aggiorna card pazienti quando arriva la scadenza reale da calendario
    try {
      if (currentView === "patients" || currentView === "patientForm" || currentView === "modify" || currentView === "create") {
        renderPatients();
      }
    } catch (_) {}

    return true;
  } catch (err) {
    calMovesHorizonLoading = false;
    return false;
  }
}

async function applyCalendarMoves_(baseSlots, patients) {
  const year = calSelectedDate.getFullYear();
  const month0 = calSelectedDate.getMonth();

  const movesRaw = await fetchCalendarMovesForMonth_(year, month0);
  const moves0 = (movesRaw || []).map(normalizeMove_).filter(Boolean);

  // Dedup/collapse moves per paziente: evita catene A->B, B->C e duplicazioni nello stesso slot
  const moves = collapseMoves_(moves0);

  // clone base slots
  const slots = new Map();
  (baseSlots || new Map()).forEach((info, key) => slots.set(key, slotInfoClone_(info)));

  const patientById = new Map();
  (patients || []).forEach((p) => { if (p && p.id != null) patientById.set(String(p.id), p); });

  moves.forEach((mv) => {
    const p = patientById.get(String(mv.paziente_id));
    if (!p) return;

    const from = parseYmd_(mv.from_date);
    const to = parseYmd_(mv.to_date);

    if (from && from.y === year && from.m === month0) {
      const kFrom = `${from.d}|${mv.from_time}`;
      slotRemovePatient_(slots, kFrom, mv.paziente_id);
    }
    if (to && to.y === year && to.m === month0) {
      const kTo = `${to.d}|${mv.to_time}`;
      slotAddPatient_(slots, kTo, p);
    }
  });

  calMovesCache = moves;
  return slots;
}

function fillCalendarFromPatients(patients) {
  const baseSlots = buildCalendarSlotsFromPatients(patients);
  paintCalendarSlots(baseSlots);
  return baseSlots;
}
async function ensurePatientsForCalendar() {
  const user = getSession();
  if (!user || !user.id) return [];
  if (!patientsLoaded || patientsLoadedForUserId !== user.id) {
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


  function focusCalendarNow(opts = {}) {
  if (!calScroll || !calBody) return;

  const { announce = false, center = false } = (opts && typeof opts === "object") ? opts : {};

  // Rimuovi focus precedente
  calBody.querySelectorAll(".cal-cell.now-focus").forEach((el) => el.classList.remove("now-focus"));

  const now = new Date();
  const ref = new Date(calSelectedDate || now);

  // Day: se siamo nel mese/anno correnti -> oggi, altrimenti il giorno selezionato
  let targetDay = ref.getDate();
  if (now.getFullYear() === ref.getFullYear() && now.getMonth() === ref.getMonth()) {
    targetDay = now.getDate();
  }

  // Time: clamp all'interno degli slot visibili (07:30 -> 21:00), snap a 30'
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
  if (!cell) {
    if (calNowInfo) calNowInfo.textContent = "";
    return;
  }

  // Scroll: sia orizzontale che verticale, con centratura opzionale
  const doScroll = () => {
    const pad = 24;

    if (center) {
      const left = cell.offsetLeft - (calScroll.clientWidth / 2) + (cell.offsetWidth / 2);
      const top = cell.offsetTop - (calScroll.clientHeight / 2) + (cell.offsetHeight / 2);
      calScroll.scrollLeft = Math.max(0, left);
      calScroll.scrollTop = Math.max(0, top);
    } else {
      calScroll.scrollLeft = Math.max(0, cell.offsetLeft - pad);
      calScroll.scrollTop = Math.max(0, cell.offsetTop - pad);
    }

    // Evidenzia cella "adesso"
    cell.classList.add("now-focus");

    // Info paziente/i nello slot corrente
    const slotKey = `${targetDay}|${targetTime}`;
    const info = calSlotPatients && calSlotPatients.get ? calSlotPatients.get(slotKey) : null;
    const names = info && Array.isArray(info.names) ? info.names.filter(Boolean) : [];

    let label = `${targetTime}`;
    if (names.length === 1) {
      label = `Adesso: ${names[0]} • ${targetTime}`;
    } else if (names.length > 1) {
      const uniq = [];
      names.forEach((x) => { if (!uniq.includes(x)) uniq.push(x); });
      const shown = uniq.slice(0, 2);
      label = `Adesso: ${shown.join(", ")}${uniq.length > 2 ? " +" + (uniq.length - 2) : ""} • ${targetTime}`;
    }

    if (calNowInfo) calNowInfo.textContent = label;

    if (announce) {
      // Toast breve per feedback immediato (persistenza in calNowInfo)
      try { toast(label); } catch (_) {}
    }
  };

  // iOS: attendi frame per misure offset corrette
  requestAnimationFrame(() => { try { doScroll(); } catch (_) {} });
}

  function ensureCalendarBuilt() {
  if (calBuilt) return;
  if (!calDaysCol || !calHoursRow || !calBody || !calScroll || !calDaysScroll || !calHoursScroll) return;

  // --- Header: days 1..31 (lettera giorno + numero)
  calDaysCol.innerHTML = "";
  for (let d = 1; d <= 31; d++) {
    const el = document.createElement("div");
    el.className = "cal-day";
    el.dataset.day = String(d);

    const dow = document.createElement("div");
    dow.className = "cal-dow";
    dow.textContent = ""; // valorizzato in updateCalendarUI() in base a mese/anno

    const dom = document.createElement("div");
    dom.className = "cal-dom";
    dom.textContent = String(d);

    el.appendChild(dow);
    el.appendChild(dom);

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

      const resolveEffectiveFrom_ = (pid) => {
        let effective_from_date = "";
        let effective_from_time = "";
        try {
          const year = calSelectedDate.getFullYear();
          const month = calSelectedDate.getMonth();
          const dayNum = parseInt(cell.dataset.day || "0", 10);
          const d = new Date(year, month, dayNum);
          d.setHours(0, 0, 0, 0);
          effective_from_date = ymdLocal(d);
          effective_from_time = normTime(cell.dataset.time || "");
        } catch (_) {}

        try {
          const ymd = effective_from_date;
          const t = effective_from_time;
          const mvPrev = Array.isArray(calMovesCache) ? calMovesCache.find((mv) =>
            String(mv && mv.paziente_id) === String(pid) &&
            String(mv && mv.to_date || "").slice(0, 10) === String(ymd || "").slice(0, 10) &&
            normTime(mv && mv.to_time) === normTime(t)
          ) : null;
          if (mvPrev) {
            effective_from_date = String(mvPrev.from_date || "").slice(0, 10) || effective_from_date;
            effective_from_time = normTime(mvPrev.from_time || "") || effective_from_time;
          }
        } catch (_) {}

        return { from_date: effective_from_date, from_time: effective_from_time };
      };

      const doDeleteSlot = async (pid) => {
        const { from_date, from_time } = resolveEffectiveFrom_(pid);
        if (!from_date || !from_time) { toast("Dati seduta non validi"); return; }

        try { cell.dataset.suppressClick = "1"; } catch (_) {}

        const sure = window.confirm("Cancellare questa terapia?");
        if (!sure) return;

        try {
          const user = getSession();
          if (!user || !user.id) { toast("Devi accedere"); return; }
          const ok = await ensureApiReady();
          if (!ok) return;

          const terapiaId = getTherapyIdForPatientAtDate_(pid, from_date);

          await api("deleteSession", {
            userId: user.id,
            paziente_id: String(pid),
            terapia_id: terapiaId,
            from_date,
            from_time
          });

          invalidateStatsMovesCache_();
          toast("Cancellato");
          await updateCalendarUI();
          try {
            await loadPatients({ render: false });
            if (currentView === "pazienti") renderPatients();
            if (currentView === "stats") await renderStatsTable_();
          } catch (_) {}
        } catch (err) {
          if (apiHintIfUnknownAction(err)) return;
          toast(String(err && err.message ? err.message : "Errore cancellazione"));
        }
      };

      cell.addEventListener("click", (e) => {
        if (cell.dataset.suppressClick === "1") {
          cell.dataset.suppressClick = "";
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        const dayNum = parseInt(cell.dataset.day || "0", 10);
        const t = normTime(cell.dataset.time || "");
        const slotKey = `${dayNum}|${t}`;
        const info = calSlotPatients && calSlotPatients.get ? calSlotPatients.get(slotKey) : null;
        const ids = info && Array.isArray(info.ids) ? info.ids.filter((x) => x != null) : [];
        if (ids.length === 0) return;

        if (ids.length !== 1) { toast("Più pazienti in questo slot"); return; }

        const names = info && Array.isArray(info.names) ? info.names.filter(Boolean) : [];
        const title = names.length ? String(names[0]) : "Paziente";
        try {
          (window.openCalCellActionsModal_ || openCalCellActionsModal_)({
            pid: ids[0],
            fromDay: dayNum,
            fromTime: t,
            title
          });
        } catch (_) {}
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
    focusCalendarNow({ announce: true, center: true });
  });
  btnCalPatients?.addEventListener("click", async () => {
    await openPatientsAfterLogin();
  });
calBuilt = true;
}

  // --- Modal: Sposta seduta (single instance / override calendario)
  let moveSessionModalState = null;


  function getTherapyLabelForPatientSlot_(pid, fromYmd, fromTime) {
    try {
      const p = getPatientFromCacheById_(pid);
      if (!p) return "Terapia";
      const target = dateOnlyLocal(String(fromYmd || "").slice(0, 10));
      const t = normTime(fromTime || "");
      if (!target || !t) return "Terapia";

      const wk = target.getDay(); // 0..6
      const therapies = parseTherapiesFromPatient_(p) || [];
      let bestIndex = -1;
      let bestStart = -1;

      for (let i = 0; i < therapies.length; i++) {
        const th = normalizeTherapy_(therapies[i]);
        if (!th) continue;

        const s = dateOnlyLocal(th.data_inizio || "");
        const e = dateOnlyLocal(th.data_fine || "");
        if (s && target.getTime() < s.getTime()) continue;
        if (e && target.getTime() > e.getTime()) continue;

        const map = th.giorni_map && typeof th.giorni_map === "object" ? th.giorni_map : {};
        const keys = Object.keys(map);
        if (!keys.length) continue;

        let matches = false;

        for (const k of keys) {
          const dayLabel = __normDayLabel(k);
          let wk2 = DAY_LABEL_TO_KEY[dayLabel];

          if (wk2 == null && /^\d+$/.test(dayLabel)) {
            const n = parseInt(dayLabel, 10);
            if (n === 7) wk2 = 0;
            else if (n >= 0 && n <= 6) wk2 = n;
            else if (n >= 1 && n <= 6) wk2 = n;
          }

          if (wk2 == null || wk2 !== wk) continue;

          const times = normalizeTimeList(map[k]);
          if (Array.isArray(times) && times.some((x) => normTime(x) === t)) {
            matches = true;
            break;
          }
        }

        if (!matches) continue;

        const startScore = s ? s.getTime() : 0;
        if (startScore >= bestStart) {
          bestStart = startScore;
          bestIndex = i;
        }
      }

      if (bestIndex >= 0) return `Terapia ${bestIndex + 1}`;
      return "Terapia";
    } catch (_) {
      return "Terapia";
    }
  }

  function openMoveSessionModal_(opts) {
    const modal = $("#modalMoveSession");
    if (!modal) return;

    const dateEl = $("#moveSessionDate");
    const timeEl = $("#moveSessionTime");
    const fromEl = $("#moveSessionFrom");
const therapyEl = $("#moveSessionTherapyName");

    const pid = opts && opts.pid != null ? String(opts.pid) : "";
    const fromDay = opts && opts.fromDay != null ? parseInt(opts.fromDay, 10) : 0;
    const fromTime = normTime(opts && opts.fromTime != null ? opts.fromTime : "");

    if (!pid || !fromDay || !fromTime) return;

    // Range vincolato al mese corrente (stesso comportamento del drag precedente)
    const year = calSelectedDate.getFullYear();
    const month = calSelectedDate.getMonth();
    const daysInThisMonth = new Date(year, month + 1, 0).getDate();

    const fromDate = ymdLocal(new Date(year, month, fromDay));

    try {
      if (therapyEl) therapyEl.textContent = getTherapyLabelForPatientSlot_(pid, fromDate, fromTime);
    } catch (_) {}

    moveSessionModalState = { pid, fromDay, fromTime };

    try {
      if (fromEl) fromEl.textContent = `${fromDate} • ${fromTime}`;
    } catch (_) {}

    if (dateEl) {
      try {
        dateEl.min = ymdLocal(new Date(year, month, 1));
        dateEl.max = ymdLocal(new Date(year, month, daysInThisMonth));
      } catch (_) {}
      try { dateEl.value = fromDate; } catch (_) {}
    }

    if (timeEl) {
      // iOS: evita il time picker nativo (non rispetta sempre step). Selezione tramite modal con slot a mezz'ora.
      try { timeEl.readOnly = true; } catch (_) {}
      try { timeEl.value = fromTime; } catch (_) {}
    }

    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    try { dateEl && dateEl.focus && dateEl.focus(); } catch (_) {}
  }

  function openTimePickerForMoveSession_() {
    if (!moveSessionModalState) return;
    if (!timePickList) return;
    const timeEl = $("#moveSessionTime");
    if (!timeEl) return;

    const currentSel = normTime(String(timeEl.value || "").trim()) || normTime(moveSessionModalState.fromTime || "");

    timePickList.innerHTML = "";
    const list = Array.isArray(calHours) && calHours.length ? calHours.slice() : ["07:30","08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30","21:00"];

    list.forEach((t) => {
      const tt = normTime(t);
      if (!tt) return;
      const btn = document.createElement("button");
      btn.type = "button";
      let cls = "pill-btn";
      if (tt === currentSel) cls += " selected";
      btn.className = cls;
      btn.textContent = tt;
      btn.addEventListener("click", () => {
        try {
          timePickList.querySelectorAll(".pill-btn.selected").forEach((el) => el.classList.remove("selected"));
          btn.classList.add("selected");
        } catch (_) {}
        try { timeEl.value = tt; } catch (_) {}
        closePickTimeModal();
      });
      timePickList.appendChild(btn);
    });

    openPickTimeModal();
  }

  function closeMoveSessionModal_() {
    const modal = $("#modalMoveSession");
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    moveSessionModalState = null;
  }

  async function confirmMoveSessionModal_() {
    try {
      if (!moveSessionModalState) return;

      const pid = String(moveSessionModalState.pid || "");
      const fromDay = parseInt(moveSessionModalState.fromDay || "0", 10);
      const fromTime = normTime(moveSessionModalState.fromTime || "");

      const dateEl = $("#moveSessionDate");
      const timeEl = $("#moveSessionTime");
      const dateStr = String(dateEl && dateEl.value ? dateEl.value : "").slice(0, 10);
      const timeStr = normTime(timeEl && timeEl.value ? timeEl.value : "");

      if (!pid || !fromDay || !fromTime) return;
      if (!dateStr || !timeStr) { toast("Inserisci data e ora"); return; }

      // Valida mese corrente (come drag)
      const year = calSelectedDate.getFullYear();
      const month = calSelectedDate.getMonth();
      const dim = new Date(year, month + 1, 0).getDate();

      const pYmd = parseYmd_(dateStr);
      if (!pYmd) { toast("Data non valida"); return; }
      if (pYmd.y !== year || pYmd.m !== month) { toast("Seleziona una data nel mese corrente"); return; }
      const toDay = pYmd.d;
      if (!toDay || toDay < 1 || toDay > dim) { toast("Data non valida"); return; }

      // Valida ora: solo slot disponibili
      if (!Array.isArray(calHours) || !calHours.includes(timeStr)) { toast("Ora non valida"); return; }

      if (fromDay === toDay && fromTime === timeStr) return;

      // valida slot destinazione vuoto (stesso controllo del drag)
      try {
        const k2 = `${toDay}|${timeStr}`;
        const info2 = calSlotPatients && calSlotPatients.get ? calSlotPatients.get(k2) : null;
        if (info2 && info2.count) { toast("Slot occupato"); return; }
      } catch (_) {}

      const user = getSession();
      if (!user || !user.id) { toast("Devi accedere"); return; }
      const ok = await ensureApiReady();
      if (!ok) return;

      const fromDate = ymdLocal(new Date(year, month, fromDay));
      const toDate = ymdLocal(new Date(year, month, toDay));

      const effFrom = resolveOriginalSlotForPid_(pid, fromDate, fromTime);
      const terapiaId = getTherapyIdForPatientAtDate_(pid, effFrom.from_date || fromDate);

      await api("moveSession", {
        userId: user.id,
        paziente_id: String(pid),
        terapia_id: terapiaId,
        from_date: fromDate,
        from_time: normTime(fromTime),
        to_date: toDate,
        to_time: normTime(timeStr)
      });

      invalidateStatsMovesCache_();
      closeMoveSessionModal_();
      toast("Spostato");
      await updateCalendarUI();
      try {
        await loadPatients({ render: false });
        if (currentView === "pazienti") renderPatients();
        if (currentView === "stats") await renderStatsTable_();
      } catch (_) {}
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore spostamento"));
    }
  }

  (function bindMoveSessionModal_() {
    const modal = $("#modalMoveSession");
    if (!modal) return;
    $("#btnMoveSessionCancel")?.addEventListener("click", closeMoveSessionModal_);
    $("#btnMoveSessionConfirm")?.addEventListener("click", () => { void confirmMoveSessionModal_(); });
    modal.addEventListener("click", (e) => { if (e.target === modal) closeMoveSessionModal_(); });

    const timeEl = $("#moveSessionTime");
    if (timeEl) {
      const open = (e) => {
        try { e && e.preventDefault && e.preventDefault(); } catch (_) {}
        try { e && e.stopPropagation && e.stopPropagation(); } catch (_) {}
        openTimePickerForMoveSession_();
        try { timeEl.blur && timeEl.blur(); } catch (_) {}
      };
      timeEl.addEventListener("click", open);
      timeEl.addEventListener("focus", open);
      timeEl.addEventListener("keydown", (e) => {
        const k = e && e.key ? e.key : "";
        if (k === "Enter" || k === " ") open(e);
      });
    }
  

  // ---- Calendario: popup azioni cella (unifica click / modifica / elimina)
  let calCellActionsState = null;

  function closeCalCellActionsModal_() {
    const modal = $("#modalCalCellActions");
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    calCellActionsState = null;
  }

  function openCalCellActionsModal_(opts) {
    const modal = $("#modalCalCellActions");
    if (!modal) return;

    const titleEl = $("#calCellActionsTitle");

    const pid = opts && opts.pid != null ? String(opts.pid) : "";
    const fromDay = opts && opts.fromDay != null ? parseInt(opts.fromDay, 10) : 0;
    const fromTime = normTime(opts && opts.fromTime != null ? opts.fromTime : "");
    const title = opts && opts.title != null ? String(opts.title) : "";

    if (!pid || !fromDay || !fromTime) return;

    calCellActionsState = { pid, fromDay, fromTime };

    try { if (titleEl) titleEl.textContent = title || "Paziente"; } catch (_) {}

    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
  }

  // Expose for safety (in caso di handler esterni)
  try { window.openCalCellActionsModal_ = openCalCellActionsModal_; } catch (_) {}


  function resolveEffectiveFromBySlot_(pid, fromDay, fromTime) {
    let effective_from_date = "";
    let effective_from_time = "";
    try {
      const year = calSelectedDate.getFullYear();
      const month = calSelectedDate.getMonth();
      const d = new Date(year, month, parseInt(fromDay, 10));
      d.setHours(0, 0, 0, 0);
      effective_from_date = ymdLocal(d);
      effective_from_time = normTime(fromTime || "");
    } catch (_) {}

    try {
      const ymd = String(effective_from_date || "").slice(0, 10);
      const t = normTime(effective_from_time || "");
      const mvPrev = Array.isArray(calMovesCache) ? calMovesCache.find((mv) =>
        String(mv && mv.to_pid) === String(pid) &&
        String(mv && mv.to_date || "").slice(0, 10) === ymd &&
        normTime(mv && mv.to_time) === t
      ) : null;
      if (mvPrev) {
        effective_from_date = String(mvPrev.from_date || "").slice(0, 10) || effective_from_date;
        effective_from_time = normTime(mvPrev.from_time || "") || effective_from_time;
      }
    } catch (_) {}

    return { from_date: effective_from_date, from_time: effective_from_time };
  }

  async function deleteSessionFromCalCellState_(st) {
    const pid = st && st.pid != null ? String(st.pid) : "";
    const fromDay = st && st.fromDay != null ? parseInt(st.fromDay, 10) : 0;
    const fromTime = normTime(st && st.fromTime != null ? st.fromTime : "");
    if (!pid || !fromDay || !fromTime) return;

    const { from_date, from_time } = resolveEffectiveFromBySlot_(pid, fromDay, fromTime);
    if (!from_date || !from_time) { toast("Dati seduta non validi"); return; }

    const sure = window.confirm("Cancellare questa terapia?");
    if (!sure) return;

    try {
      const user = getSession();
      if (!user || !user.id) { toast("Devi accedere"); return; }
      const ok = await ensureApiReady();
      if (!ok) return;

      const terapiaId = getTherapyIdForPatientAtDate_(pid, from_date);

      await api("deleteSession", {
        userId: user.id,
        paziente_id: String(pid),
        terapia_id: terapiaId,
        from_date,
        from_time
      });

      invalidateStatsMovesCache_();
      toast("Cancellato");
      await updateCalendarUI();
      try {
        await loadPatients({ render: false });
        if (currentView === "pazienti") renderPatients();
        if (currentView === "stats") await renderStatsTable_();
      } catch (_) {}
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore cancellazione"));
    }
  }


  (function bindCalCellActionsModal_() {
    const modal = $("#modalCalCellActions");
    if (!modal) return;

    modal.addEventListener("click", (e) => { if (e.target === modal) closeCalCellActionsModal_(); });

    $("#btnCalActionOpen")?.addEventListener("click", async () => {
      if (!calCellActionsState) return;
      const pid = calCellActionsState.pid;
      closeCalCellActionsModal_();
      const patients = await ensurePatientsForCalendar();
      const p = (patients || []).find((x) => String(x.id) === String(pid));
      if (!p) { toast("Paziente non trovato"); return; }
      openPatientExisting(p);
    });

    $("#btnCalActionMove")?.addEventListener("click", () => {
      if (!calCellActionsState) return;
      const st = calCellActionsState;
      closeCalCellActionsModal_();
      openMoveSessionModal_(st);
    });

    $("#btnCalActionDelete")?.addEventListener("click", async () => {
      if (!calCellActionsState) return;
      const st = calCellActionsState;
      closeCalCellActionsModal_();
      await deleteSessionFromCalCellState_(st);
    });
  })();

})();

function scrollCalendarToNow() {
  // Back-compat: usa il focus robusto su giorno+ora correnti
  try { focusCalendarNow({ announce: false, center: true }); } catch (_) {}
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
  try { syncCalendarTopbarMonth(); } catch (_) {}

  calDaysCol.querySelectorAll(".cal-day").forEach((el) => {
    const d = parseInt(el.dataset.day || "0", 10);
    const valid = d >= 1 && d <= daysInThisMonth;

    // Aggiorna lettera del giorno (L M M G V S D) + numero
    const dowEl = el.querySelector(".cal-dow");
    const domEl = el.querySelector(".cal-dom");
    if (domEl) domEl.textContent = valid ? String(d) : String(d);
    if (dowEl) {
      if (valid) {
        const map = ["D","L","M","M","G","V","S"]; // JS: 0=Dom ... 6=Sab
        const wd = new Date(year, month, d).getDay();
        dowEl.textContent = map[wd] || "";
      } else {
        dowEl.textContent = "";
      }
    }

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
  const baseSlots = buildCalendarSlotsFromPatients(patients);
  const effectiveSlots = await applyCalendarMoves_(baseSlots, patients);
  paintCalendarSlots(effectiveSlots);
}


  // Build label
  const buildLabel = $("#buildLabel");
  if (buildLabel) buildLabel.textContent = DISPLAY;

  // Anti-suggerimenti iOS/macOS: evita che WebKit mostri liste (autofill/storico)
  // Pattern: input readonly finché l'utente non interagisce.
  // Nota: i campi login/modifica vengono rimessi readonly ogni volta che si riapre la view;
  // quindi il binding NON deve essere "once".
  function bindReadonlyUnlock(el) {
    if (!el) return;
    try {
      if (el.dataset && el.dataset.unlockReadonlyBound === "1") return;
      if (el.dataset) el.dataset.unlockReadonlyBound = "1";
    } catch (_) {}

    const unlock = () => {
      try { el.removeAttribute("readonly"); } catch (_) {}
    };
    el.addEventListener("focus", unlock, { passive: true });
    el.addEventListener("touchstart", unlock, { passive: true });
    el.addEventListener("mousedown", unlock, { passive: true });
    el.addEventListener("pointerdown", unlock, { passive: true });
  }
  bindReadonlyUnlock($("#loginNome"));
  bindReadonlyUnlock($("#modNome"));
  bindReadonlyUnlock($("#createNome"));

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
    const loginNome = $("#loginNome");
    if (loginNome) {
      // Assicura che lo sblocco readonly sia sempre bindato anche dopo riaperture view
      try { bindReadonlyUnlock(loginNome); } catch (_) {}
      // Non mostrare mai liste/suggerimenti di account: inserimento manuale
      loginNome.value = "";
      loginNome.setAttribute("readonly", "readonly");
    }
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
    const modNome = $("#modNome");
    if (modNome) {
      try { bindReadonlyUnlock(modNome); } catch (_) {}
      modNome.value = "";
      modNome.setAttribute("readonly", "readonly");
    }
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

  
  // --- Quick Login (solo password)
  $("#btnQuickLoginOther")?.addEventListener("click", () => {
    try { closeQuickLoginModal_(); } catch (_) {}
    showView("auth");
  });

  $("#formQuickLogin")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = getLastLoginName_();
    const pass = ($("#quickLoginPass")?.value || "");
    if (!nome) { toast("Seleziona un account"); showView("auth"); return; }
    if (!pass) { toast("Inserisci la password"); return; }

    const ok = await ensureApiReady();
    if (!ok) return;

    try {
      const data = await api("login", { nome, password: pass });
      setSession(data.user);
      setLastLoginName_(nome);
      closeQuickLoginModal_();
      toast("Accesso OK");
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
    if (!nome) { toast("Inserisci il nome"); return; }
    if (!pass) { toast("Inserisci la password"); return; }

    const ok = await ensureApiReady();
    if (!ok) return;

    try {
      const data = await api("login", { nome, password: pass });
      setSession(data.user);
      setLastLoginName_(nome);
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
    if (!nome) { toast("Inserisci il nome"); return; }
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

  function setPills(user, year) {
    if (pillUser) {
      let nm = (user?.nome || "").toString();
      // UI: evita suffissi tipo "dal 2024" accanto al nome
      nm = nm.replace(/\s+(?:dal|dall'?)\s*\d{4}\s*$/i, "").trim();
      nm = nm || "—";
      pillUser.textContent = nm;
    }
  }


  let exerciseYearSelected = null;

  function getExerciseYearSelected_(opts = {}) {
    const { allowNull = true } = (opts || {});
    const yUI = ($("#setAnno")?.value || "").trim();
    const cand = yUI || (exerciseYearSelected ? String(exerciseYearSelected) : "") || yPill;
    const n = parseInt(cand, 10);
    if (isFinite(n) && n >= 2000 && n <= 2100) return n;
    return allowNull ? null : (new Date()).getFullYear();
  }

  function __parseISODate_(s) {
    if (!s) return null;
    const t = String(s).trim();
    if (!t) return null;
    const d = new Date(t);
    return isFinite(d.getTime()) ? d : null;
  }

  function therapyOverlapsYear_(th, year) {
    if (!year) return true;
    if (!th) return false;
    const ds = __parseISODate_(th.data_inizio || th.start || "");
    const de = __parseISODate_(th.data_fine || th.end || "");
    if (!ds && !de) return false; // con filtro attivo, terapie senza date non sono attribuibili ad alcun anno
    const ys = ds ? ds.getFullYear() : null;
    const ye = de ? de.getFullYear() : null;
    if (ys !== null && ye !== null) return (year >= ys && year <= ye);
    if (ys !== null) return year === ys;
    if (ye !== null) return year === ye;
    return false;
  }

  function filterTherapiesByYear_(arr, year) {
    const a = Array.isArray(arr) ? arr : [];
    if (!year) return a.slice();
    return a.filter(th => therapyOverlapsYear_(th, year));
  }

  function patientHasExerciseYear_(p, year) {
    if (!year) return true;
    if (!p || p.isDeleted) return false;
    let arr = null;
    if (Array.isArray(p.terapie_arr)) arr = p.terapie_arr;
    else arr = parseTherapiesFromPatient_(p);
    arr = Array.isArray(arr) ? arr.map(normalizeTherapy_) : [];
    for (const th of arr) {
      if (therapyOverlapsYear_(th, year)) return true;
    }
    return false;
  }

  function onExerciseYearChanged_() {
    // Aggiorna pill in impostazioni (se visibile)
    try { setPills(getSession(), exerciseYearSelected ? String(exerciseYearSelected) : ($("#setAnno")?.value || "").trim()); } catch (_) {}

    // Rerender viste principali
    try {
      if (patientsLoaded) renderPatients();
      if (currentView === "patient") {
        try { renderTherapiesUI_(); } catch (_) {}
      }
      if (currentView === "stats") {
        try { renderStatsSocDots_(); } catch (_) {}
        try { renderStatsLevelDots_(); } catch (_) {}
        try { renderStatsMonthly_(); } catch (_) {}
        try { renderStatsTable_(); } catch (_) {}
      }
    } catch (_) {}
  }

  
  function getExerciseYearStorageKey_(user){
    const uid = user?.id ? String(user.id) : "anon";
    return "amf_exercise_year_" + uid;
  }
  function getLocalExerciseYear_(user){
    try{ return (localStorage.getItem(getExerciseYearStorageKey_(user)) || "").trim(); }catch(_){ return ""; }
  }
  function setLocalExerciseYear_(user, yearStr){
    try{
      const v = (yearStr || "").trim();
      if (!v) localStorage.removeItem(getExerciseYearStorageKey_(user));
      else localStorage.setItem(getExerciseYearStorageKey_(user), v);
    }catch(_){}
  }

function getSettingsPayloadFromUI() {
    return {
      anno_esercizio: ($("#setAnno")?.value || "").trim()
    };
  }

  function applySettingsToUI(settings) {
    const s = settings || {};
    const user = getSession();
    // Prefer server value; if missing, fall back to localStorage; if still missing keep current UI value.
    let yearStr = (s.anno_esercizio ?? "").toString().trim();
    if (!yearStr) yearStr = getLocalExerciseYear_(user);
    if (!yearStr) yearStr = ($("#setAnno")?.value || "").trim();

    if ($("#setAnno")) $("#setAnno").value = yearStr || "";
    const n = parseInt(yearStr, 10);
    exerciseYearSelected = (isFinite(n) && n >= 2000 && n <= 2100) ? n : null;

    // Persist locally so the selection always sticks even if backend settings are unavailable
    setLocalExerciseYear_(user, yearStr);

    setPills(user, yearStr);
    try { onExerciseYearChanged_(); } catch (_) {}
  }

  async function loadSettings() {
    const user = getSession();
    if (!user) return;
    const data = await api("getSettings", { userId: user.id });
    applySettingsToUI(data.settings || {});
  }


  // Cambio anno di esercizio: salva e applica filtro su tutta l'app
  $("#setAnno")?.addEventListener("change", async () => {
    const raw = ($("#setAnno")?.value || "").trim();
    const n = parseInt(raw, 10);
    exerciseYearSelected = (isFinite(n) && n >= 2000 && n <= 2100) ? n : null;
    // aggiorna pill subito (anche se il salvataggio fallisce)
    try { setPills(getSession(), raw); } catch (_) {}
    try { await saveSettings(); } catch (e) { /* non bloccare UI */ }
    try { onExerciseYearChanged_(); } catch (_) {}
  });

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
  const btnSortAZ = $("#patSortAZ");
  const btnSortSoc = $("#patSortSoc");
  const btnSortToday = $("#patSortToday");

  let patientsCache = null;
  let patientsLoaded = false;
  let patientsLoadedForUserId = null;
  let patientsSortMode = "date"; // date|az|soc|today
  let currentPatient = null;
  let patientEditEnabled = true; // per create


  // --- Warmup dati core (per calendario istantaneo)
  let warmupPromise = null;
  let warmupUserId = null;

  function resetCoreDataCaches_(reason) {
    try {
      patientsCache = null;
      patientsLoaded = false;
      patientsLoadedForUserId = null;
      warmupPromise = null;
      warmupUserId = null;
    } catch (_) {}
  }

  function warmupCoreData() {
    const user = getSession();
    if (!user || !user.id) return Promise.resolve();

    // Warmup per utente: se cambia utente, invalida il warmup precedente
    if (warmupPromise && warmupUserId === user.id) return warmupPromise;
    warmupUserId = user.id;

    warmupPromise = (async () => {
      try {
        const patientsOk = (patientsLoaded && patientsLoadedForUserId === user.id);
        await Promise.all([
          loadSocietaCache().catch(() => []),
          (patientsOk ? Promise.resolve() : loadPatients({ render: false }).catch(() => {}))
        ]);
      } finally {
        // lascia warmupPromise per riuso (evita richieste duplicate) SOLO per lo stesso utente
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


  function fmtItDateLongCap(d) {
    if (!d) return "";
    const day = d.getDate();
    const month = IT_MONTHS[d.getMonth()] || "";
    const monthCap = month ? (month.charAt(0).toUpperCase() + month.slice(1)) : "";
    const year = d.getFullYear();
    return `${day} ${monthCap} ${year}`;
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


  // Calcola l'intervallo complessivo delle terapie di un paziente (min start, max end)
  // Usato per: pulsante/ordinamento scadenza e periodo visualizzato nelle card.
  function getPatientTherapySpan_(p) {
    const consider = (sVal, eVal, acc) => {
      const s = dateOnlyLocal(sVal);
      const e = dateOnlyLocal(eVal);
      if (s && (!acc.minStart || s.getTime() < acc.minStart.getTime())) acc.minStart = s;
      if (e && (!acc.maxEnd || e.getTime() > acc.maxEnd.getTime())) acc.maxEnd = e;
    };

    // Scadenza (semplificata):
    // - letta SOLO dalla card paziente (terapie) senza calcoli calendario / giorni / orari.
    // - se ci sono più terapie, usa la data_fine più avanti (max).
    const acc = { minStart: null, maxEnd: null };

    // 1) Terapie (preferito)
    let therapies = [];
    try { therapies = getPatientTherapiesForStats_(p) || []; } catch (_) { therapies = []; }

    if (Array.isArray(therapies) && therapies.length) {
      for (const t of therapies) {
        const sStr = t?.data_inizio ?? t?.da ?? t?.start ?? "";
        const eStr = t?.data_fine ?? t?.a ?? t?.end ?? "";
        consider(sStr, eStr, acc);
      }
    }

    // 2) Fallback su campi legacy del paziente (se non ci sono terapie parseabili)
    if (!acc.minStart && !acc.maxEnd) {
      consider(p?.data_inizio ?? p?.start ?? "", p?.data_fine ?? p?.end ?? "", acc);
    } else {
      if (!acc.minStart) consider(p?.data_inizio ?? p?.start ?? "", "", acc);
      if (!acc.maxEnd) consider("", p?.data_fine ?? p?.end ?? "", acc);
    }

    return {
      start: acc.minStart,
      end: acc.maxEnd,
      startTs: acc.minStart ? acc.minStart.getTime() : Infinity,
      endTs: acc.maxEnd ? acc.maxEnd.getTime() : Infinity
    };
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
    if (!inRangeDate(today, p.data_inizio, p.data_fine)) return [];

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
    btnSortAZ?.classList.toggle("active", mode === "az");
    btnSortSoc?.classList.toggle("active", mode === "soc");
    btnSortToday?.classList.toggle("active", mode === "today");
    renderPatients();
  }

  btnSortDate?.addEventListener("click", () => setPatientsSort("date"));
  btnSortAZ?.addEventListener("click", () => setPatientsSort("az"));
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
      try { ensureMovesHorizonLoaded_({ silent: true }); } catch (_) {}
      patientsLoadedForUserId = user.id || null;
      if (render) renderPatients();
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      throw err;
    }
  }

  function renderPatients() {
    if (!patientsListEl) return;

    let arr = (patientsCache || []).slice();
    const ySel = getExerciseYearSelected_({ allowNull: true });
    if (ySel) {
      arr = arr.filter(p => patientHasExerciseYear_(p, ySel));
    }


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
  const socKey = (p) => String(getSocNameById(p?.societa_id || "") || p?.societa_nome || p?.societa || "").trim();
  const nameKey = (p) => {
    const full = String(p?.nome_cognome || p?.nome || "").trim();
    if (!full) return { cognome: "", nome: "", full: "" };
    const parts = full.split(/\s+/).filter(Boolean);
    if (!parts.length) return { cognome: "", nome: "", full: full };
    const cognome = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
    const nome = parts.length >= 2 ? parts.slice(0, -1).join(" ") : "";
    return { cognome, nome, full };
  };
  arr.sort((a, b) => {
    const s = socKey(a).localeCompare(socKey(b), "it", { sensitivity: "base" });
    if (s) return s;
    const ka = nameKey(a);
    const kb = nameKey(b);
    const c = String(ka.cognome||"").localeCompare(String(kb.cognome||""), "it", { sensitivity: "base" });
    if (c) return c;
    const n = String(ka.nome||"").localeCompare(String(kb.nome||""), "it", { sensitivity: "base" });
    if (n) return n;
    return String(ka.full||"").localeCompare(String(kb.full||""), "it", { sensitivity: "base" });
  });
	} else if (patientsSortMode === "az") {
  const nameKey = (p) => {
    const full = String(p?.nome_cognome || p?.nome || "").trim();
    if (!full) return { cognome: "", nome: "", full: "" };
    const parts = full.split(/\s+/).filter(Boolean);
    if (!parts.length) return { cognome: "", nome: "", full: full };
    const cognome = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
    const nome = parts.length >= 2 ? parts.slice(0, -1).join(" ") : "";
    return { cognome, nome, full };
  };
  arr.sort((a, b) => {
    const ka = nameKey(a);
    const kb = nameKey(b);
    const c = String(ka.cognome||"").localeCompare(String(kb.cognome||""), "it", { sensitivity: "base" });
    if (c) return c;
    const n = String(ka.nome||"").localeCompare(String(kb.nome||""), "it", { sensitivity: "base" });
    if (n) return n;
    return String(ka.full||"").localeCompare(String(kb.full||""), "it", { sensitivity: "base" });
  });
} else if (patientsSortMode === "date") {
  const spanOf = (p) => {
    try {
      // Cache sicura: riusa solo se la firma delle terapie/campi non è cambiata.
      const raw = (p && (p.terapie ?? p.terapia)) ?? "";
      let sig = "";
      try {
        if (typeof raw === "string") sig = raw;
        else sig = JSON.stringify(raw);
      } catch (_) { sig = String(raw || ""); }
      // include anche i campi legacy (fallback) perché influiscono sul calcolo
      const legacySig = `${String(p?.data_inizio ?? p?.start ?? "")}|${String(p?.data_fine ?? p?.end ?? "")}`;
      sig = `${sig}||${legacySig}`;

      if (p && p.___amfSpan && typeof p.___amfSpan === "object" && p.___amfSpanSig === sig) {
        return p.___amfSpan;
      }

      const sp = getPatientTherapySpan_(p);
      if (p && typeof p === "object") {
        p.___amfSpan = sp;
        p.___amfSpanSig = sig;
      }
      return sp;
    } catch (_) {
      return { start: null, end: null, startTs: Infinity, endTs: Infinity };
    }
  };
  const endTs = (p) => spanOf(p).endTs;
  const nameKey = (p) => {
    const full = String(p?.nome_cognome || p?.nome || "").trim();
    if (!full) return { cognome: "", nome: "", full: "" };
    const parts = full.split(/\s+/).filter(Boolean);
    if (!parts.length) return { cognome: "", nome: "", full: full };
    const cognome = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
    const nome = parts.length >= 2 ? parts.slice(0, -1).join(" ") : "";
    return { cognome, nome, full };
  };
  // FILTER_EXPIRED_ON_DATE_SORT: nasconde terapie scadute solo in ordinamento per scadenza
  // Nota: non va eseguito dentro il comparator del sort (causa comportamenti non deterministici su Android/Chrome).
  const today = dateOnlyLocal(new Date());
  const todayTs = today ? today.getTime() : Date.now();
  arr = arr.filter((p) => {
    const t = endTs(p);
    return t === Infinity || t >= todayTs;
  });

  arr.sort((a, b) => {
    const ta = endTs(a);
    const tb = endTs(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    const ka = nameKey(a);
    const kb = nameKey(b);
    const c = String(ka.cognome||"").localeCompare(String(kb.cognome||""), "it", { sensitivity: "base" });
    if (c) return c;
    const n = String(ka.nome||"").localeCompare(String(kb.nome||""), "it", { sensitivity: "base" });
    if (n) return n;
    return String(ka.full||"").localeCompare(String(kb.full||""), "it", { sensitivity: "base" });
  });
} else {
  // fallback: createdAt desc
  arr.sort((a,b) => String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}// render veloce: DocumentFragment + delegation
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

      const name = patientDisplayName(p) || "—";
      const soc = getSocNameById(p.societa_id || "") || "—";
      const __span = getPatientTherapySpan_(p);
      const period = fmtTherapyPeriod(__span.start || "", __span.end || "");
      const endDateObj = (patientsSortMode === "date") ? (__span.end || null) : null;
      const lastTherapyDay = endDateObj ? fmtItDateLongCap(endDateObj) : "";

      // Background color from società tag (20% opacity)
      const tagIdx = getSocTagIndexById(p.societa_id || "");
      const base = (SOC_TAG_COLORS[tagIdx] !== undefined) ? SOC_TAG_COLORS[tagIdx] : SOC_TAG_COLORS[4];
      const bg = hexToRgba(base, 0.20);
      if (bg) row.style.backgroundColor = bg;

      row.innerHTML = `
        <div class="patient-info">
          <div class="patient-name">
            <span class="patient-name-text">${escapeHtml(name)}</span>${patientsSortMode === "today" && p.__todayTime ? '<span class="patient-name-time"> - ' + escapeHtml(p.__todayTime) + '</span>' : ""}
          </div>
          ${patientsSortMode === "date" && lastTherapyDay ? `<div class="patient-lastdate">${escapeHtml(lastTherapyDay)}</div>` : ""}
          <div class="patient-sub">${escapeHtml(soc)}${period ? " • " + escapeHtml(period) : ""}</div>
        </div>
        <button class="patient-badge patient-geotag" type="button" aria-label="Naviga" title="Naviga">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 2c-3.866 0-7 3.134-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"></path>
          </svg>
        </button>
      `;

      frag.appendChild(row);
    }
    patientsListEl.appendChild(frag);
  }

  // click delegation (una sola listener)
  if (patientsListEl && !patientsListEl.__delegatedClick) {
    patientsListEl.__delegatedClick = true;
    patientsListEl.addEventListener("click", (e) => {
      const geoBtn = e.target && e.target.closest ? e.target.closest(".patient-geotag") : null;
      if (geoBtn) {
        const rowG = geoBtn.closest(".patient-row");
        if (!rowG || !patientsListEl.contains(rowG)) return;
        const idxG = parseInt(rowG.dataset.idx || "-1", 10);
        const arrG = patientsListEl.__renderedPatients || [];
        const pG = arrG[idxG];
        if (pG) openMapsToPatient(pG);
        return;
      }

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

    const ids = ["patName"];
    ids.forEach(id => {
      const el = $("#" + id);
      if (el) el.disabled = !patientEditEnabled;
    });

    // Indirizzo: in sola-lettura deve restare tappabile per aprire Maps
    const addrEl = $("#patAddress");
    if (addrEl) {
      addrEl.disabled = false;
      addrEl.readOnly = !patientEditEnabled;
      addrEl.setAttribute("aria-readonly", (!patientEditEnabled) ? "true" : "false");
    }

    // Geotag button: SOLO in lettura (apre Maps/percorso)
    const geoBtn = $("#btnPatGeotag");
    if (geoBtn) {
      // Robusto su iOS: usa sia hidden che display
      if (!patientEditEnabled) {
        geoBtn.hidden = false;
        geoBtn.removeAttribute("hidden");
        geoBtn.style.display = "";
        geoBtn.disabled = false;
      } else {
        geoBtn.hidden = true;
        geoBtn.setAttribute("hidden", "");
        geoBtn.style.display = "none";
        geoBtn.disabled = true;
      }
    }

    const btnPick = $("#btnPickSoc");
    if (btnPick) {
      // In sola lettura non serve la freccia (selezione società)
      if (!patientEditEnabled) btnPick.setAttribute("hidden", "");
      else btnPick.removeAttribute("hidden");
      btnPick.toggleAttribute("disabled", !patientEditEnabled);
    }
    try { renderTherapiesUI_(); } catch (_) {}

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
  }

  

  // ---- Paziente: Geotag + Maps
  function getPatientGeo(p) {
    if (!p) return null;
    const lat = (p.geo_lat !== undefined && p.geo_lat !== null && String(p.geo_lat).trim() !== "") ? Number(p.geo_lat) : null;
    const lng = (p.geo_lng !== undefined && p.geo_lng !== null && String(p.geo_lng).trim() !== "") ? Number(p.geo_lng) : null;
    if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng };
  }

  function openMapsToPatient(p) {
    const addr = String((p && (p.address || p.indirizzo)) || ($("#patAddress")?.value || "")).trim();
    const geo = getPatientGeo(p);
    let dest = "";
    if (geo) dest = geo.lat + "," + geo.lng;
    else dest = addr;
    if (!dest) return;
    const url = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest);
    try { window.open(url, "_blank"); } catch { try { location.href = url; } catch {} }
  }

  async function acquireGeoOnce(optsOverride) {
    if (!("geolocation" in navigator)) return null;
    const opts = Object.assign({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }, (optsOverride || {}));
    try {
      return await new Promise((resolve) => {
        try {
          navigator.geolocation.getCurrentPosition((pos) => {
            const lat = pos && pos.coords ? pos.coords.latitude : null;
            const lng = pos && pos.coords ? pos.coords.longitude : null;
            const acc = pos && pos.coords ? pos.coords.accuracy : null;
            const ts = pos && pos.timestamp ? new Date(pos.timestamp).toISOString() : new Date().toISOString();
            if (lat == null || lng == null) { resolve(null); return; }
            resolve({ lat, lng, acc, ts });
          }, () => resolve(null), opts);
        } catch (_) { resolve(null); }
      });
    } catch (_) {
      return null;
    }
  }


  $("#patAddress")?.addEventListener("click", (e) => {
    if (patientEditEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    openMapsToPatient(currentPatient);
    try { $("#patAddress")?.blur(); } catch {}
  });

  $("#btnPatGeotag")?.addEventListener("click", (e) => {
    // In lettura: apre Google Maps e genera il percorso verso il paziente
    if (patientEditEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    openMapsToPatient(currentPatient);
    try { $("#patAddress")?.blur(); } catch {}
  });



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

      const therapies = parseTherapiesFromPatient_(p);
      for (const th of (therapies || [])) {
        if (!th) continue;
        if (!__rangesOverlap(curStart, curEnd, th.data_inizio, th.data_fine)) continue;

        const map = th.giorni_map && typeof th.giorni_map === "object" ? th.giorni_map : {};
        for (const k of Object.keys(map)) {
          const kDayKey = __dayToKey(k);
          if (!kDayKey || kDayKey !== dayKeyWanted) continue;

          const times = normalizeTimeList(map[k]);
          for (const tt of (times || [])) {
            if (normTime(tt) === tWanted) return true;
          }
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

  const therapiesWrap = $("#therapiesWrap");
  const btnAddTherapy = $("#btnAddTherapy");

  let activeTherapyIndex = 0;
  let activeDayForTime = "";

  function genTherapyId_() {
    // id stabile per schede terapia (necessario per upsert univoco su DB)
    return "th_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  function normalizeTherapy_(t) {
    const src = (t && typeof t === "object") ? t : null;
    let id = "";
    if (src) {
      id = String(src.id || src.therapy_id || src.terapia_id || "").trim();
      if (!id) {
        id = genTherapyId_();
        try { src.id = id; } catch (_) {}
      }
    } else {
      id = genTherapyId_();
    }

    const o = src ? Object.assign({}, src) : {};
    o.id = id;
    o.livello = String(o.livello || o.level || "").trim();
    o.data_inizio = String(o.data_inizio || o.start || "").trim();
    o.data_fine = String(o.data_fine || o.end || "").trim();
    // giorni_settimana può essere oggetto o JSON string.
    // In UI la fonte canonica è "giorni_map": se presente, usalo (anche se vuoto) per non sovrascrivere gli edit.
    let raw;
    if (o.giorni_map !== undefined) raw = o.giorni_map;
    else if (o.giorni_settimana !== undefined) raw = o.giorni_settimana;
    else if (o.giorni !== undefined) raw = o.giorni;
    else raw = {};
    const map = parseGiorniMap(raw);
    o.giorni_map = map && typeof map === "object" ? map : {};
    // Mantieni in sync per compatibilità con codice che legge prima "giorni_settimana"
    o.giorni_settimana = o.giorni_map;
    return o;
  }

  function therapySignature_(th) {
    const t = th || {};
    const map = (t.giorni_map && typeof t.giorni_map === "object") ? t.giorni_map : {};
    const keys = Object.keys(map).sort();
    const parts = keys.map((k) => {
      const v = map[k];
      const s = Array.isArray(v) ? v.map(normTime).filter(Boolean).join(",") : normTime(v);
      return `${String(k)}:${s}`;
    });
    return `${String(t.livello || "").trim()}|${String(t.data_inizio || "").trim()}|${String(t.data_fine || "").trim()}|${parts.join(",")}`;
  }

  function parseTherapiesFromPatient_(p) {
    if (!p) return [normalizeTherapy_({})];

    // Nuova colonna: "terapie" (JSON array)
    const raw = p.terapie !== undefined ? p.terapie : (p.terapia !== undefined ? p.terapia : null);
    let arr = null;
    if (raw && typeof raw === "string") {
      try {
        const j = JSON.parse(raw);
        if (Array.isArray(j)) arr = j;
      } catch (_) { arr = null; }
    } else if (Array.isArray(raw)) {
      arr = raw;
    }

    if (Array.isArray(arr) && arr.length) {
      const out = arr.map(normalizeTherapy_).filter(Boolean);
      // Dedup difensivo: evita duplicazioni identiche (bug storico)
      const seen = new Set();
      const dedup = [];
      for (const th of out) {
        const sig = therapySignature_(th);
        if (seen.has(sig)) continue;
        seen.add(sig);
        dedup.push(th);
      }
      return dedup.length ? dedup : [normalizeTherapy_({})];
    }

    // Fallback legacy: campi singoli
    const legacy = normalizeTherapy_({
      livello: p.livello || "",
      data_inizio: p.data_inizio || "",
      data_fine: p.data_fine || "",
      giorni_settimana: p.giorni_settimana || p.giorni || "{}"
    });
    return [legacy];
  }


  // --- Helpers: terapia_id per spostamenti/cancellazioni sedute ---
  function getPatientFromCacheById_(pid) {
    const id = String(pid || "").trim();
    if (!id) return null;
    try {
      const arr = Array.isArray(patientsCache) ? patientsCache : [];
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        if (p && String(p.id || "").trim() === id) return p;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // Risale allo slot "originario" in caso la seduta sia già stata spostata (catena A->B->C).
  function resolveOriginalSlotForPid_(pid, from_date, from_time) {
    let fd = String(from_date || "").slice(0, 10);
    let ft = normTime(from_time || "");
    try {
      const mvPrev = Array.isArray(calMovesCache) ? calMovesCache.find((mv) =>
        String(mv && mv.paziente_id) === String(pid) &&
        String(mv && mv.to_date || "").slice(0, 10) === fd &&
        normTime(mv && mv.to_time) === ft
      ) : null;

      if (mvPrev) {
        fd = String(mvPrev.from_date || "").slice(0, 10) || fd;
        ft = normTime(mvPrev.from_time || "") || ft;
      }
    } catch (_) {}
    return { from_date: fd, from_time: ft };
  }

  function getTherapyIdForPatientAtDate_(pid, ymd) {
    try {
      const p = getPatientFromCacheById_(pid);
      if (!p) return "";
      const target = dateOnlyLocal(String(ymd || "").slice(0, 10));
      if (!target) return "";
      const therapies = parseTherapiesFromPatient_(p) || [];
      let bestId = "";
      let bestStart = -1;

      for (const th0 of therapies) {
        const th = normalizeTherapy_(th0);
        const s = dateOnlyLocal(th && th.data_inizio ? th.data_inizio : "");
        const e = dateOnlyLocal(th && th.data_fine ? th.data_fine : "");

        if (s && target.getTime() < s.getTime()) continue;
        if (e && target.getTime() > e.getTime()) continue;

        const st = s ? s.getTime() : 0;
        if (st >= bestStart) {
          bestStart = st;
          bestId = String(th && th.id ? th.id : "").trim();
        }
      }

      return bestId || "";
    } catch (_) {
      return "";
    }
  }

  function ensureCurrentTherapies_() {
    if (!currentPatient) currentPatient = {};
    if (!Array.isArray(currentPatient.terapie_arr) || !currentPatient.terapie_arr.length) {
      currentPatient.terapie_arr = parseTherapiesFromPatient_(currentPatient);
    }
    // Normalizza sempre
    currentPatient.terapie_arr = currentPatient.terapie_arr.map(normalizeTherapy_);
    if (!currentPatient.terapie_arr.length) currentPatient.terapie_arr = [normalizeTherapy_({})];
    if (activeTherapyIndex >= currentPatient.terapie_arr.length) activeTherapyIndex = 0;
  }

  function buildTimes() {
    const times = ["—"];
    for (let h=6; h<=21; h++) {
      times.push(String(h).padStart(2,"0")+":00");
      times.push(String(h).padStart(2,"0")+":30");
    }
    return times;
  }

  async function openTimePickerForDay(therapyIdx, day) {
    if (!patientEditEnabled) return;
    ensureCurrentTherapies_();
    activeTherapyIndex = Math.max(0, Math.min((currentPatient.terapie_arr.length - 1), Number(therapyIdx) || 0));
    activeDayForTime = String(day || "").trim();
    if (!activeDayForTime) return;

    const th = currentPatient.terapie_arr[activeTherapyIndex];
    const currentSel = (th && th.giorni_map && th.giorni_map[activeDayForTime]) ? normTime(th.giorni_map[activeDayForTime]) : "—";

    if (!timePickList) return;
    timePickList.innerHTML = "";

    buildTimes().forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      let cls = "pill-btn" + (t === "—" ? " pill-gray" : "");
      if (t === currentSel) cls += " selected";
      btn.className = cls;
      btn.textContent = t;

      btn.addEventListener("click", async () => {
        timePickList.querySelectorAll(".pill-btn.selected").forEach((el) => el.classList.remove("selected"));
        btn.classList.add("selected");

        ensureCurrentTherapies_();
        const selfId = currentPatient && currentPatient.id ? currentPatient.id : null;
        const therapy = currentPatient.terapie_arr[activeTherapyIndex] || normalizeTherapy_({});
        const curStart = String(therapy.data_inizio || "").trim();
        const curEnd = String(therapy.data_fine || "").trim();

        if (t !== "—") {
          const conflict = await hasTherapyConflictSlot(activeDayForTime, t, curStart, curEnd, selfId);
          if (conflict) {
            openTherapyErrorModal("Errore: esiste già una terapia per un altro paziente nello stesso giorno e alla stessa ora.");
            return;
          }
        }

        if (!therapy.giorni_map) therapy.giorni_map = {};
        if (t === "—") delete therapy.giorni_map[activeDayForTime];
        else therapy.giorni_map[activeDayForTime] = t;

        currentPatient.terapie_arr[activeTherapyIndex] = normalizeTherapy_(therapy);
        renderTherapiesUI_();
        closePickTimeModal();
      });

      timePickList.appendChild(btn);
    });

    openPickTimeModal();
  }

  function renderTherapiesUI_() {
    if (!therapiesWrap) return;
    ensureCurrentTherapies_();
    therapiesWrap.replaceChildren();

    // In scheda paziente (inserimento/modifica) non applichiamo il filtro anno:
    // altrimenti la terapia vuota (senza date) sparisce e il tasto + sembra non funzionare.
    const arr = currentPatient.terapie_arr;

    const frag = document.createDocumentFragment();

    for (let i = 0; i < arr.length; i++) {
      const th = arr[i];

      const card = document.createElement("div");
      card.className = "therapy-card";
      card.dataset.tidx = String(i);

      const head = document.createElement("div");
      head.className = "therapy-head";

      const title = document.createElement("div");
      title.className = "therapy-title";
      title.textContent = (i === 0) ? "Terapia" : `Proroga ${i}`;

      const del = document.createElement("button");
      del.type = "button";
      del.className = "therapy-del";
      del.setAttribute("aria-label", "Rimuovi terapia");
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6l-12 12"></path></svg>';
      // Mostra la X solo in modifica paziente

      if (!patientEditEnabled) del.style.display = "none";

      head.appendChild(title);
      head.appendChild(del);

      const levelRow = document.createElement("div");
      levelRow.className = "therapy-level-row";
      ["L1","L2","L3"].forEach((lv) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "therapy-level-btn" + (String(th.livello || "") === lv ? " active" : "");
        b.dataset.level = lv;
        b.textContent = lv;
        levelRow.appendChild(b);
      });

      const dateRow = document.createElement("div");
      dateRow.className = "therapy-date-row";
      const inpStart = document.createElement("input");
      inpStart.type = "date";
      inpStart.className = "field";
      inpStart.placeholder = "Data inizio";
      inpStart.value = fmtIsoDate(th.data_inizio || "");
      inpStart.dataset.role = "start";

      const inpEnd = document.createElement("input");
      inpEnd.type = "date";
      inpEnd.className = "field";
      inpEnd.placeholder = "Data fine";
      inpEnd.value = fmtIsoDate(th.data_fine || "");
      inpEnd.dataset.role = "end";

      dateRow.appendChild(inpStart);
      dateRow.appendChild(inpEnd);

      const daysRow = document.createElement("div");
      daysRow.className = "row-days";
      daysRow.setAttribute("aria-label", "Giorni settimana");

      ["LU","MA","ME","GI","VE","SA"].forEach((d) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "day-btn";
        btn.dataset.day = d;
        btn.dataset.tidx = String(i);

        const daySpan = document.createElement("span");
        daySpan.className = "day";
        daySpan.textContent = d;

        const timeSpan = document.createElement("span");
        timeSpan.className = "time";
        const t = (th.giorni_map && th.giorni_map[d]) ? th.giorni_map[d] : "—";
        timeSpan.textContent = t || "—";

        if (t && t !== "—") btn.classList.add("active");

        btn.appendChild(daySpan);
        btn.appendChild(timeSpan);
        daysRow.appendChild(btn);
      });

      // Handlers (per-card)
      del.addEventListener("click", () => {
        if (!patientEditEnabled) return;
        ensureCurrentTherapies_();
        const arr2 = currentPatient.terapie_arr;
        if (!Array.isArray(arr2) || !arr2.length) {
          currentPatient.terapie_arr = [normalizeTherapy_({})];
          activeTherapyIndex = 0;
          renderTherapiesUI_();
          return;
        }
        // Consenti rimozione anche della prima terapia; mantieni sempre almeno 1 card.
        if (arr2.length === 1) {
          currentPatient.terapie_arr[0] = normalizeTherapy_({});
        } else {
          currentPatient.terapie_arr.splice(i, 1);
        }
        if (activeTherapyIndex >= currentPatient.terapie_arr.length) activeTherapyIndex = 0;
        renderTherapiesUI_();
      });
levelRow.querySelectorAll(".therapy-level-btn").forEach((b) => {
        b.addEventListener("click", () => {
          if (!patientEditEnabled) return;
          ensureCurrentTherapies_();
          const lv = b.dataset.level || "";
          const th2 = currentPatient.terapie_arr[i] || normalizeTherapy_({});
          th2.livello = lv;
          currentPatient.terapie_arr[i] = normalizeTherapy_(th2);
          renderTherapiesUI_();
        });
      });

      const onDateChange = () => {
        if (!patientEditEnabled) return;
        ensureCurrentTherapies_();
        const th2 = currentPatient.terapie_arr[i] || normalizeTherapy_({});
        th2.data_inizio = String(inpStart.value || "").trim();
        th2.data_fine = String(inpEnd.value || "").trim();
        currentPatient.terapie_arr[i] = normalizeTherapy_(th2);
      };
      inpStart.addEventListener("change", onDateChange);
      inpEnd.addEventListener("change", onDateChange);

      // Day click / long-press remove
      daysRow.querySelectorAll(".day-btn").forEach((btn) => {
        let lpTimer = null;
        let lpFired = false;

        const clearLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };

        btn.addEventListener("pointerdown", () => {
          if (!patientEditEnabled) return;
          lpFired = false;
          clearLP();
          lpTimer = setTimeout(() => {
            lpFired = true;
            ensureCurrentTherapies_();
            const th2 = currentPatient.terapie_arr[i] || normalizeTherapy_({});
            if (!th2.giorni_map) th2.giorni_map = {};
            const day = String(btn.dataset.day || "");
            if (day && th2.giorni_map[day]) {
              delete th2.giorni_map[day];
              currentPatient.terapie_arr[i] = normalizeTherapy_(th2);
              renderTherapiesUI_();
              toast("Giorno rimosso");
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
          const d = btn.dataset.day;
          openTimePickerForDay(i, d);
        });
      });

      const divA = document.createElement("div");
      divA.className = "therapy-divider";
      const divB = document.createElement("div");
      divB.className = "therapy-divider";

      card.appendChild(head);
      card.appendChild(dateRow);
      card.appendChild(divA);
      card.appendChild(levelRow);
      card.appendChild(divB);
      card.appendChild(daysRow);

      frag.appendChild(card);
    }

    therapiesWrap.appendChild(frag);

    // abilita/disabilita in base allo stato
    therapiesWrap.querySelectorAll("input,button").forEach((el) => {
      if (el && el.id === "btnPatDelete") return;
      el.toggleAttribute("disabled", !patientEditEnabled);
    });

    // Add button visibile solo in modifica
    if (btnAddTherapy) {
      btnAddTherapy.toggleAttribute("disabled", !patientEditEnabled);
      btnAddTherapy.style.display = patientEditEnabled ? "" : "none";
    }
  }

  btnAddTherapy?.addEventListener("click", () => {
    if (!patientEditEnabled) return;
    ensureCurrentTherapies_();
    currentPatient.terapie_arr.push(normalizeTherapy_({}));
    renderTherapiesUI_();
    try { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); } catch (_) {}
  });

  // ---- Open forms
  function openPatientCreate() {
    const session = getSession();
    if (!session || !session.id) {
      openPatientsFlow();
      return;
    }

    currentPatient = { id: null, terapie_arr: [normalizeTherapy_({})] };
    activeTherapyIndex = 0;

    $("#patName").value = "";
    $("#patAddress").value = "";
    $("#patSoc").value = "";
    $("#patSocId").value = "";

    renderTherapiesUI_();
    showView("patientForm");
    setPatientFormEnabled(true);
  }

  function openPatientExisting(p) {
    const session = getSession();
    if (!session || !session.id) {
      openPatientsFlow();
      return;
    }

    currentPatient = Object.assign({}, p || {});
    currentPatient.terapie_arr = parseTherapiesFromPatient_(currentPatient);
    activeTherapyIndex = 0;

    $("#patName").value = currentPatient.nome_cognome || "";
    $("#patAddress").value = currentPatient.address || "";
    $("#patSocId").value = currentPatient.societa_id ? String(currentPatient.societa_id) : "";
    $("#patSoc").value = String(currentPatient.societa_nome || currentPatient.societa || getSocNameById($("#patSocId").value) || "").trim();

    renderTherapiesUI_();
    showView("patientForm");
    setPatientFormEnabled(false); // view-only finché non premi modifica
  }

  $("#btnPatCalendar")?.addEventListener("click", () => openCalendarFlow());
  $("#btnPatBackList")?.addEventListener("click", () => showView("patients"));
$("#btnPatEdit")?.addEventListener("click", () => setPatientFormEnabled(true));
  bindTap($("#btnPatDelete"), async () => {
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

    toast("Salvataggio...");

    const nome_cognome = ($("#patName")?.value || "").trim();
    const address = ($("#patAddress")?.value || "").trim();
    const societa = ($("#patSoc")?.value || "").trim();
    const societa_id = ($("#patSocId")?.value || "").trim();
    const societa_nome = societa;

    if (!nome_cognome) { toast("Inserisci il nome"); return; }
    if (!address) { toast("Inserisci l\u2019indirizzo"); return; }
    if (!societa_id) { toast("Seleziona la società"); return; }

    ensureCurrentTherapies_();
    const therapies = (currentPatient && Array.isArray(currentPatient.terapie_arr)) ? currentPatient.terapie_arr.map(normalizeTherapy_) : [normalizeTherapy_({})];

    // Se cambia la società del paziente, la nuova società deve propagarsi a tutte le terapie
    try {
      therapies.forEach((t) => { if (t && typeof t === "object") t.societa_id = String(societa_id || "").trim(); });
      if (currentPatient && typeof currentPatient === "object") {
        currentPatient.societa_id = String(societa_id || "").trim();
        currentPatient.societa_nome = String(societa_nome || societa || "").trim();
        currentPatient.societa = String(societa || "").trim();
        currentPatient.terapie_arr = therapies;
      }
    } catch (_) {}


    // Validazioni base
    for (let i = 0; i < therapies.length; i++) {
      const th = therapies[i] || {};
      if (!String(th.livello || "").trim()) { toast(`Seleziona il livello in Terapia ${i + 1}`); return; }
    }

    // Validazione: evita sovrapposizioni TRA le terapie dello stesso paziente
    try {
      for (let i = 0; i < therapies.length; i++) {
        for (let j = i + 1; j < therapies.length; j++) {
          const a = therapies[i] || {};
          const b = therapies[j] || {};
          if (!__rangesOverlap(a.data_inizio, a.data_fine, b.data_inizio, b.data_fine)) continue;
          const amap = a.giorni_map || {};
          const bmap = b.giorni_map || {};
          for (const k of Object.keys(amap)) {
            const tA = normTime(amap[k]);
            const tB = normTime(bmap[k]);
            if (tA && tB && tA !== "—" && tA === tB) {
              openTherapyErrorModal("Errore: due terapie dello stesso paziente hanno lo stesso giorno e la stessa ora.");
              return;
            }
          }
        }
      }
    } catch (_) {}

    // Validazione: evita sovrapposizioni con altri pazienti (stesso giorno + stessa ora)
    try {
      const selfId = currentPatient && currentPatient.id ? currentPatient.id : null;
      for (let i = 0; i < therapies.length; i++) {
        const th = therapies[i] || {};
        const v = await validateTherapyMapNoOverlap(selfId, th.giorni_map || {}, th.data_inizio || "", th.data_fine || "");
        if (!v.ok) {
          openTherapyErrorModal("Errore: terapia sovrapposta (stesso giorno e stessa ora).");
          return;
        }
      }
    } catch (_) {
      // Se la validazione fallisce per motivi tecnici, non bloccare il salvataggio.
    }

    // Geotag automatico (scrittura/modifica): tenta acquisizione senza tasto dedicato
    let geo = null;
    try {
      const ua = (navigator && navigator.userAgent) ? String(navigator.userAgent) : "";
      const isAndroid = /Android/i.test(ua);
      geo = await acquireGeoOnce(isAndroid ? { enableHighAccuracy: false, timeout: 2500, maximumAge: 60000 } : null);
    } catch (_) { geo = null; }

    const t0 = therapies[0] || normalizeTherapy_({});

    const payload = {
      nome_cognome,
      address,
      societa,
      societa_id: societa_id,
      societa_nome: societa_nome,

      // compatibilità: campi "legacy" dalla Terapia 1
      livello: t0.livello || "",
      data_inizio: String(t0.data_inizio || "").trim(),
      data_fine: String(t0.data_fine || "").trim(),
      giorni_settimana: JSON.stringify(t0.giorni_map || {}),

      // nuova colonna: terapie (array JSON)
      terapie: JSON.stringify(therapies.map((t) => ({
        id: String(t.id || "").trim(),
        societa_id: String(societa_id || "").trim(),
        livello: String(t.livello || "").trim(),
        data_inizio: String(t.data_inizio || "").trim(),
        data_fine: String(t.data_fine || "").trim(),
        giorni_settimana: (t.giorni_map && typeof t.giorni_map === "object") ? t.giorni_map : {}
      }))),

      geo_lat: (geo ? geo.lat : ""),
      geo_lng: (geo ? geo.lng : ""),
      geo_accuracy: (geo && geo.acc != null ? geo.acc : ""),
      geo_ts: (geo ? geo.ts : ""),
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
      invalidateApiCache("listPatients");
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

  const socModalTitle = modalSoc ? modalSoc.querySelector(".modal-title") : null;
  let editingSocId = "";
  let editingSocOldName = "";
  let selectedSocTag = 0;
  let socSaveInFlight = false;

  function getSocTagMap() {
    return safeJsonParse(localStorage.getItem("AMF_SOC_TAGS") || "", {}) || {};
  }
  function setSocTagForName(nome, tag, id) {
    const name = String(nome || "").trim();
    const map = getSocTagMap();
    const v = Math.max(0, Math.min(5, Number(tag) || 0));

    // compatibilità: chiave "nome" pura
    if (name) map[name] = v;
    // nuove chiavi stabili
    if (name) map["name:" + name] = v;
    const sid = String(id || "").trim();
    if (sid) map["id:" + sid] = v;

    try { localStorage.setItem("AMF_SOC_TAGS", JSON.stringify(map)); } catch (_) {}
  }
  function deleteSocTagForName(nome, id) {
    const name = String(nome || "").trim();
    const sid = String(id || "").trim();
    if (!name && !sid) return;
    const map = getSocTagMap();
    if (name) {
      delete map[name];
      delete map["name:" + name];
    }
    if (sid) {
      delete map["id:" + sid];
    }
    try { localStorage.setItem("AMF_SOC_TAGS", JSON.stringify(map)); } catch (_) {}
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
    editingSocId = "";
    editingSocOldName = "";
    if (socModalTitle) socModalTitle.textContent = "Aggiungi società";
    socNomeInput.value = "";
    if (socL1Input) socL1Input.value = "";
    if (socL2Input) socL2Input.value = "";
    if (socL3Input) socL3Input.value = "";
    setSelectedSocTag(0);
    socSaveInFlight = false;
    if (btnSocSave) btnSocSave.disabled = false;
    if (socDeletePanel) socDeletePanel.hidden = true;
    if (socDeleteList) socDeleteList.replaceChildren();
    modalSoc.classList.add("show");
    modalSoc.setAttribute("aria-hidden", "false");
    socNomeInput.focus();
  }
  function closeSocModal() {
    if (!modalSoc) return;
    editingSocId = "";
    editingSocOldName = "";
    if (socModalTitle) socModalTitle.textContent = "Aggiungi società";
    socSaveInFlight = false;
    if (btnSocSave) btnSocSave.disabled = false;
    modalSoc.classList.remove("show");
    modalSoc.setAttribute("aria-hidden", "true");
  }


  // --- Società page flow (lista + tariffe)
  function openSocModalNew_() { openSocModal(); }

  function openSocModalEditFromSoc_(s) {
    if (!s) return;
    if (!modalSoc) return;
    const nome = String(s.nome || "").trim();
    const id = String(s.id || "").trim();

    if (socModalTitle) socModalTitle.textContent = "Modifica società";
    editingSocId = id || "";
    editingSocOldName = nome || "";

    if (socNomeInput) socNomeInput.value = nome || "";
    if (socL1Input) socL1Input.value = toEuro2String_(s.l1 ?? s.L1 ?? s.liv1 ?? s.livello1 ?? s.tariffa_livello_1 ?? "");
    if (socL2Input) socL2Input.value = toEuro2String_(s.l2 ?? s.L2 ?? s.liv2 ?? s.livello2 ?? s.tariffa_livello_2 ?? "");
    if (socL3Input) socL3Input.value = toEuro2String_(s.l3 ?? s.L3 ?? s.liv3 ?? s.livello3 ?? s.tariffa_livello_3 ?? "");
    setSelectedSocTag(s.tag ?? s.tagIndex ?? s.tag_index ?? 0);

    if (socDeletePanel) socDeletePanel.hidden = true;
    socSaveInFlight = false;
    if (btnSocSave) btnSocSave.disabled = false;

    modalSoc.classList.add("show");
    modalSoc.setAttribute("aria-hidden", "false");
    if (socL1Input) socL1Input.focus();
  }

  function renderSocietaPageList_() {
    if (!socList) return;
    const arr = Array.isArray(societaCache) ? societaCache : [];
    socList.innerHTML = "";
    if (!arr.length) {
      if (socEmptyHint) socEmptyHint.hidden = false;
      return;
    }
    if (socEmptyHint) socEmptyHint.hidden = true;

    arr.forEach((s) => {
      if (!s) return;
      const id = String(s.id || "").trim();
      const nome = String(s.nome || "").trim();
      const l1 = toEuro2String_(s.l1 ?? s.L1 ?? s.liv1 ?? s.livello1 ?? s.tariffa_livello_1 ?? "");
      const l2 = toEuro2String_(s.l2 ?? s.L2 ?? s.liv2 ?? s.livello2 ?? s.tariffa_livello_2 ?? "");
      const l3 = toEuro2String_(s.l3 ?? s.L3 ?? s.liv3 ?? s.livello3 ?? s.tariffa_livello_3 ?? "");

      const b = document.createElement("button");
      b.type = "button";
      b.className = "soc-item";
      const _rawTag = parseInt(s.tag ?? s.tagIndex ?? s.tag_index ?? s.soc_tag ?? s.socTag ?? "", 10);
      let _tag = Number.isNaN(_rawTag) ? NaN : _rawTag;
      // Compat: alcuni DB salvano tag 0-5 (UI), altri 1-6 (CSS)
      if (!Number.isNaN(_tag) && _tag >= 0 && _tag <= 5) _tag = _tag + 1;
      if (!Number.isNaN(_tag) && _tag >= 1 && _tag <= 6) b.classList.add("t" + _tag);
      b.dataset.id = id;
      b.setAttribute("aria-label", "Società " + (nome || ""));
      const l1Show = l1 ? (escapeHtml(l1) + " €") : "—";
      const l2Show = l2 ? (escapeHtml(l2) + " €") : "—";
      const l3Show = l3 ? (escapeHtml(l3) + " €") : "—";
      b.innerHTML = `
        <span class="soc-x" role="button" aria-label="Elimina società" title="Elimina">×</span>
        <div class="soc-left">
          <div class="soc-name">${escapeHtml(nome || "—")}</div>
        </div>
        <div class="soc-right">
          <div class="soc-col"><div class="soc-lab">L1</div><div class="soc-val">${l1Show}</div></div>
          <div class="soc-col"><div class="soc-lab">L2</div><div class="soc-val">${l2Show}</div></div>
          <div class="soc-col"><div class="soc-lab">L3</div><div class="soc-val">${l3Show}</div></div>
        </div>
      `;
      b.addEventListener("click", async (e) => {
        const x = e && e.target && e.target.closest ? e.target.closest(".soc-x") : null;
        if (x && b.contains(x)) {
          e.preventDefault();
          e.stopPropagation();

          const sure = confirm(`Eliminare la società "${(nome || id)}"?`);
          if (!sure) return;

          const user = getSession();
          if (!user) { toast("Accesso richiesto"); return; }

          try {
            await apiTry(
              ["deleteSocieta", "delSocieta", "removeSocieta", "deleteSociety"],
              {
                userId: user.id,
                id: id || undefined,
                societa_id: id || undefined,
                societaId: id || undefined,
                societyId: id || undefined,
                nome: nome || undefined,
                name: nome || undefined,
                oldNome: nome || undefined,
                nome_old: nome || undefined,
                old_name: nome || undefined
              }
            );
            // pulizia fallback locale tag/colore
            deleteSocTagForName(nome, id);
            await refreshSocietaEverywhere_({ rerenderDeleteList: false });
            renderSocietaPageList_();
            toast("Società eliminata");
          } catch (err) {
            if (apiHintIfUnknownAction(err)) return;
            toast(String(err && err.message ? err.message : "Errore"));
          }
          return;
        }

        openSocModalEditFromSoc_(s);
      });
      socList.appendChild(b);
    });
  }

  async function openSocietaFlow() {
    setCalendarControlsVisible(false);
    const titleEl = $("#topbarTitle");
    if (titleEl) titleEl.textContent = "Società";
    try { await loadSocietaCache(true); } catch (_) {}
    renderSocietaPageList_();
    showView("societa");
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

  
  async function verifySocietaApplied_(expect) {
    try {
      invalidateApiCache("listSocieta");
      const fresh = await api("listSocieta", { userId: expect.userId });
      const arr = Array.isArray(fresh && fresh.societa) ? fresh.societa : [];
      const byId = expect.id ? arr.find((x) => String(x.id || x.societa_id || x.societaId || x.societyId || "").trim() === String(expect.id).trim()) : null;
      const byName = arr.find((x) => String(x.nome || x.name || "").trim().toLowerCase() === String(expect.nome || "").trim().toLowerCase());
      const row = byId || byName;
      if (!row) return false;

      const getNum = (v) => {
        const s = String(v ?? "").trim().replace(",", ".");
        if (!s) return "";
        const n = Number(s);
        return isFinite(n) ? String(n) : s;
      };

      const okNome = String(row.nome || row.name || "").trim().toLowerCase() === String(expect.nome || "").trim().toLowerCase();
      const okL1 = getNum(row.l1 ?? row.L1 ?? row.livello1 ?? row.liv1 ?? row.tariffa_livello_1) === getNum(expect.l1);
      const okL2 = getNum(row.l2 ?? row.L2 ?? row.livello2 ?? row.liv2 ?? row.tariffa_livello_2) === getNum(expect.l2);
      const okL3 = getNum(row.l3 ?? row.L3 ?? row.livello3 ?? row.liv3 ?? row.tariffa_livello_3) === getNum(expect.l3);

      // tag opzionale: il backend può non restituirlo
      return okNome && okL1 && okL2 && okL3;
    } catch (_) {
      return false;
    }
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
    societaCache = arr;
    buildSocietaMap_(arr);

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

      const actions = document.createElement("div");
      actions.className = "soc-del-actions";

      const delBtn = document.createElement("button");
      delBtn.className = "soc-del-btn";
      delBtn.type = "button";
      delBtn.setAttribute("aria-label", "Elimina " + nome);
      delBtn.dataset.nome = nome;
      delBtn.dataset.id = id;

      const editBtn = document.createElement("button");
      editBtn.className = "soc-edit-btn";
      editBtn.type = "button";
      editBtn.setAttribute("aria-label", "Modifica " + nome);
      editBtn.dataset.nome = nome;
      editBtn.dataset.id = id;

      const l1v = (s && (s.l1 ?? s.L1 ?? s.livello1 ?? s.liv1 ?? s.tariffa_livello_1)) ?? "";
      const l2v = (s && (s.l2 ?? s.L2 ?? s.livello2 ?? s.liv2 ?? s.tariffa_livello_2)) ?? "";
      const l3v = (s && (s.l3 ?? s.L3 ?? s.livello3 ?? s.liv3 ?? s.tariffa_livello_3)) ?? "";
      editBtn.dataset.l1 = toEuro2String_(l1v ?? "");
      editBtn.dataset.l2 = toEuro2String_(l2v ?? "");
      editBtn.dataset.l3 = toEuro2String_(l3v ?? "");
      editBtn.dataset.tag = String(getSocTagIndexById(id) || 0);

      editBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L4 16v4z" fill="none" stroke="rgba(42,116,184,1)" stroke-width="2" stroke-linejoin="round"></path><path d="M13 6l5 5" fill="none" stroke="rgba(42,116,184,1)" stroke-width="2" stroke-linecap="round"></path></svg>';

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      row.appendChild(actions);
      frag.appendChild(row);

      // se il backend non restituisce il tag, lo manteniamo localmente
      if (s && (s.tag !== undefined && s.tag !== null)) {
        // se il backend restituisce il tag, aggiorna anche il fallback locale
        setSocTagForName(nome, s.tag, id);
      }
    }
    socDeleteList.appendChild(frag);
  }

  // delegation: elimina societa
  if (socDeleteList && !socDeleteList.__delegated) {
    socDeleteList.__delegated = true;
    socDeleteList.addEventListener("click", async (e) => {
      const editBtn = e.target && e.target.closest ? e.target.closest(".soc-edit-btn") : null;
      if (editBtn && socDeleteList.contains(editBtn)) {
        const nome = String(editBtn.dataset.nome || "").trim();
        const id = String(editBtn.dataset.id || "").trim();

        if (socModalTitle) socModalTitle.textContent = "Modifica società";
        editingSocId = id || "";
        editingSocOldName = nome || "";

        if (socNomeInput) socNomeInput.value = nome || "";
        if (socL1Input) socL1Input.value = toEuro2String_(editBtn.dataset.l1 || "");
        if (socL2Input) socL2Input.value = toEuro2String_(editBtn.dataset.l2 || "");
        if (socL3Input) socL3Input.value = toEuro2String_(editBtn.dataset.l3 || "");
        setSelectedSocTag(editBtn.dataset.tag || 0);

        if (socDeletePanel) socDeletePanel.hidden = true;
        if (socL1Input) socL1Input.focus();
        return;
      }

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
          {
            userId: user.id,
            id: id || undefined,
            societa_id: id || undefined,
            societaId: id || undefined,
            societyId: id || undefined,
            nome: nome || undefined,
            name: nome || undefined,
            oldNome: nome || undefined,
            nome_old: nome || undefined,
            old_name: nome || undefined
          }
        );
          // pulizia fallback locale tag/colore
          deleteSocTagForName(nome, id);
        await refreshSocietaEverywhere_({ rerenderDeleteList: false });
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
    if (socSaveInFlight) return;

    const nome = (socNomeInput.value || "").trim();
    if (!nome) { toast("Inserisci un nome"); return; }

    const l1Dot = toEuro2StringStrict_(socL1Input ? socL1Input.value : "");
    const l2Dot = toEuro2StringStrict_(socL2Input ? socL2Input.value : "");
    const l3Dot = toEuro2StringStrict_(socL3Input ? socL3Input.value : "");
    if (l1Dot === null || l2Dot === null || l3Dot === null) { toast("Valori livelli non validi"); return; }

    // Sheets (locale IT) can parse "20.00" as time (20:00). Send decimals with comma to force number parsing.
    const l1 = euroToSheetNumber_(l1Dot);
    const l2 = euroToSheetNumber_(l2Dot);
    const l3 = euroToSheetNumber_(l3Dot);
    if (l1 === null || l2 === null || l3 === null) { toast("Valori livelli non validi"); return; }
    const user = getSession();
    if (!user) { toast("Accesso richiesto"); return; }

    // Snapshot stato corrente del modal (evita race dopo chiusura)
    const _editingSocId = editingSocId;
    const _editingSocOldName = editingSocOldName;
    const _selectedSocTag = selectedSocTag;

    const baseSocPayload = {
      userId: user.id,
      nome,
      name: nome,
      tag: _selectedSocTag,
      tagIndex: _selectedSocTag,
      l1, l2, l3,
      L1: l1, L2: l2, L3: l3,
      livello1: l1, livello2: l2, livello3: l3,
      liv1: l1, liv2: l2, liv3: l3,
      tariffa_livello_1: l1,
      tariffa_livello_2: l2,
      tariffa_livello_3: l3
    };

    // UX: chiudi subito e torna alle impostazioni (salvataggio prosegue in background)
    socSaveInFlight = true;
    if (btnSocSave) btnSocSave.disabled = true;
    closeSocModal();
    showView("settings");
    toast("Salvataggio in corso…");

    (async () => {
      try {
        if (_editingSocId) {
          const expected = Object.assign({}, baseSocPayload, { id: _editingSocId });
          // 1) Prova update (più nomi action possibili)
          let updated = false;
          try {
            await apiTry(
              ["updateSocieta", "editSocieta", "updSocieta", "setSocieta", "updateSociety", "editSociety"],
              Object.assign({}, baseSocPayload, {
                id: _editingSocId,
                societa_id: _editingSocId,
                societaId: _editingSocId,
                societyId: _editingSocId,
                oldNome: _editingSocOldName || undefined,
                nome_old: _editingSocOldName || undefined,
                old_name: _editingSocOldName || undefined,
                prevNome: _editingSocOldName || undefined,
                payload: JSON.stringify(baseSocPayload),
                data: JSON.stringify(baseSocPayload)
              })
            );
            updated = await verifySocietaApplied_(expected);
          } catch (errUp) {
            updated = false;
          }

          // 2) Fallback robusto: delete + add
          if (!updated) {
            try {
              await apiTry(
                ["deleteSocieta", "delSocieta", "removeSocieta", "deleteSociety"],
                {
                  userId: user.id,
                  id: _editingSocId || undefined,
                  societa_id: _editingSocId || undefined,
                  societaId: _editingSocId || undefined,
                  societyId: _editingSocId || undefined,
                  nome: _editingSocOldName || undefined,
                  name: _editingSocOldName || undefined,
                  oldNome: _editingSocOldName || undefined,
                  nome_old: _editingSocOldName || undefined,
                  old_name: _editingSocOldName || undefined
                }
              );
            } catch (_) { /* ignore */ }

            await apiTry(
              ["addSocieta", "createSocieta", "insertSocieta", "newSocieta", "addSociety", "createSociety"],
              Object.assign({}, baseSocPayload, {
                oldNome: _editingSocOldName || undefined,
                nome_old: _editingSocOldName || undefined
              })
            );

            updated = await verifySocietaApplied_(Object.assign({}, baseSocPayload, { id: "" }));
          }

          if (!updated) {
            toast("Salvataggio non riuscito");
            return;
          }

          if (_editingSocOldName && _editingSocOldName.trim() && _editingSocOldName.trim().toLowerCase() !== nome.trim().toLowerCase()) {
            deleteSocTagForName(_editingSocOldName, _editingSocId);
          }
          setSocTagForName(nome, _selectedSocTag, _editingSocId);

          await refreshSocietaEverywhere_({ expected: expected, optimistic: { id: _editingSocId, nome, l1: l1Dot, l2: l2Dot, l3: l3Dot, tag: _selectedSocTag } });
          toast("Società aggiornata");
          return;
        }

        const addRes = await api("addSocieta", baseSocPayload);
        const newId = String((addRes && (addRes.id || addRes.societa_id || addRes.societaId || addRes.societyId)) || "").trim();
        setSocTagForName(nome, _selectedSocTag, newId);
        await refreshSocietaEverywhere_({ expected: Object.assign({}, baseSocPayload, { id: newId, userId: user.id }), optimistic: { id: newId, nome, l1: l1Dot, l2: l2Dot, l3: l3Dot, tag: _selectedSocTag } });
        toast("Società aggiunta");
      } catch (err) {
        if (apiHintIfUnknownAction(err)) return;
        toast(String(err && err.message ? err.message : "Errore"));
      } finally {
        socSaveInFlight = false;
        if (btnSocSave) btnSocSave.disabled = false;
      }
    })();
  });

  btnSocDelete?.addEventListener("click", async () => {
    if (!socDeletePanel) return;
    const willOpen = !!socDeletePanel.hidden;
    socDeletePanel.hidden = !willOpen;
    if (willOpen) await renderSocietaDeleteList();
  });

  $("#btnAddSoc")?.addEventListener("click", openSocietaFlow);

  $("#btnWipe")?.addEventListener("click", async () => {
    const user = getSession();
    if (!user) { toast("Accesso richiesto"); return; }
    const sure = confirm("Cancellare account e tutti i dati nel database?");
    if (!sure) return;
    try {
      await api("wipeAll", { userId: user.id });
      clearSession();
      toast("Account eliminato");
      showView("create");
    } catch (err) {
      if (apiHintIfUnknownAction(err)) return;
      toast(String(err && err.message ? err.message : "Errore"));
    }
  });



  // --- DB Import/Export (standalone)
  
  function openQuickLoginModal_(username) {
    const modal = $("#modalQuickLogin");
    if (!modal) return;
    try { $("#quickLoginName").textContent = username || "—"; } catch (_) {}
    try { const p = $("#quickLoginPass"); if (p) p.value = ""; } catch (_) {}
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    try { const p = $("#quickLoginPass"); if (p) setTimeout(() => p.focus(), 50); } catch (_) {}
  }
  function closeQuickLoginModal_() {
    const modal = $("#modalQuickLogin");
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }
function openDbIOModal_() {
    const modal = $("#modalDbIO");
    if (!modal) return;
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
  }
  function closeDbIOModal_() {
    const modal = $("#modalDbIO");
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }

  $("#btnDbIO")?.addEventListener("click", () => {
    try { openDbIOModal_(); } catch (_) {}
  });
  $("#btnDbClose")?.addEventListener("click", closeDbIOModal_);
  $("#modalDbIO")?.addEventListener("click", (e) => {
    const t = e && e.target;
    if (t && t.id === "modalDbIO") closeDbIOModal_();
  });

  $("#btnDbExport")?.addEventListener("click", async () => {
    try {
      const user = getSession();
      if (!user) { toast("Accesso richiesto"); return; }
      await __exportDbFile();
      toast("Esportato");
      closeDbIOModal_();
    } catch (err) {
      toast(String(err && err.message ? err.message : "Errore"));
    }
  });

  $("#btnDbImport")?.addEventListener("click", () => {
    try {
      const user = getSession();
      if (!user) { toast("Accesso richiesto"); return; }
      const inp = $("#fileDbImport");
      if (inp) inp.click();
    } catch (_) {}
  });

  $("#fileDbImport")?.addEventListener("change", async (e) => {
    try {
      const file = e && e.target && e.target.files ? e.target.files[0] : null;
      if (!file) return;
      const txt = await file.text();
      const obj = safeJsonParse(txt, null);
      if (!obj) throw new Error("File non valido");
      const sure = confirm("Importare il database? Sovrascriverà i dati locali.");
      if (!sure) return;
      await __importDbObject(obj);
      clearSession();
      closeDbIOModal_();
      toast("Database importato");
      // Richiedi password per sbloccare
      showView("auth");
    } catch (err) {
      toast(String(err && err.message ? err.message : "Errore"));
    } finally {
      try { const inp = $("#fileDbImport"); if (inp) inp.value = ""; } catch (_) {}
    }
  });

  
  // --- Logout (standalone)
  $("#btnLogout")?.addEventListener("click", () => {
    try { clearSession(); } catch (_) {}
    toast("Logout");
    const last = getLastLoginName_();
    if (last) {
      showView("quick");
      openQuickLoginModal_(last);
    } else {
      showView("auth");
    }
  });



  // --- Boot (Standalone protetto)
  if (STANDALONE) {
    try { clearSession(); } catch (_) {}
    const hasAcc = await __hasAccount();
    if (hasAcc) {
      // Accesso rapido: mostra solo popup con ultimo utente
      const last = getLastLoginName_();
      if (last) {
        showView("quick");
        openQuickLoginModal_(last);
      } else {
        // Fallback: schermata accesso completa
        showView("auth");
      }
    } else {
      showView("create");
    }
  } else {
    // Default view: home
    showView("home");
  }

  // PWA (iOS): registra Service Worker
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js?v=1.162").catch(() => {});
    });
  }
})();


function openGoogleMapsAddress(address){
  if(!address) return;
  const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
  window.open(url, '_blank');
}