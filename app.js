/* Montalto Fisio - app.js (Build 1.000) */

const BUILD = "1.003";

const UI = {
  ledNet: document.getElementById("ledNet"),
  ledDbRead: document.getElementById("ledDbRead"),
  ledDbWrite: document.getElementById("ledDbWrite"),
  ledErr: document.getElementById("ledErr"),

  viewHome: document.getElementById("viewHome"),
  viewPazienti: document.getElementById("viewPazienti"),
  viewCalendario: document.getElementById("viewCalendario"),
  viewStatistiche: document.getElementById("viewStatistiche"),
  viewImpostazioni: document.getElementById("viewImpostazioni"),

  homeBuild: document.getElementById("homeBuild"),
  homeYearPill: document.getElementById("homeYearPill"),

  tilePazienti: document.getElementById("tilePazienti"),
  tileCalendario: document.getElementById("tileCalendario"),
  tileStatistiche: document.getElementById("tileStatistiche"),

  btnHome: document.getElementById("btnHome"),
  btnSettings: document.getElementById("btnSettings"),

  btnNewPatient: document.getElementById("btnNewPatient"),

  patientsList: document.getElementById("patientsList"),
  patientsHint: document.getElementById("patientsHint"),

  // Impostazioni (phases)
  settingsPhase1: document.getElementById("settingsPhase1"),
  settingsPhase2: document.getElementById("settingsPhase2"),
  settingsPhase3: document.getElementById("settingsPhase3"),
  btnAccCreate: document.getElementById("btnAccCreate"),
  btnAccModify: document.getElementById("btnAccModify"),
  btnAccLogin: document.getElementById("btnAccLogin"),
  accUsername: document.getElementById("accUsername"),
  accPassword: document.getElementById("accPassword"),
  accPassword2: document.getElementById("accPassword2"),
  btnAccBack: document.getElementById("btnAccBack"),
  btnAccSubmit: document.getElementById("btnAccSubmit"),
  loggedUserLabel: document.getElementById("loggedUserLabel"),
  setAnnoEsercizio: document.getElementById("setAnnoEsercizio"),
  setPrezzo1: document.getElementById("setPrezzo1"),
  setPrezzo2: document.getElementById("setPrezzo2"),
  setPrezzo3: document.getElementById("setPrezzo3"),
  btnSetSave: document.getElementById("btnSetSave"),
  btnSetReload: document.getElementById("btnSetReload"),
  btnAddSocieta: document.getElementById("btnAddSocieta"),
  btnDeleteAccount: document.getElementById("btnDeleteAccount"),
  btnLogout: document.getElementById("btnLogout"),


  patientModal: document.getElementById("patientModal"),
  patName: document.getElementById("patName"),
  patSoc: document.getElementById("patSoc"),
  patStart: document.getElementById("patStart"),
  patEnd: document.getElementById("patEnd"),
  levelPills: document.getElementById("levelPills"),
  dayChips: document.getElementById("dayChips"),
  patCancel: document.getElementById("patCancel"),
  patSave: document.getElementById("patSave"),

  timeModal: document.getElementById("timeModal"),
  timeModalTitle: document.getElementById("timeModalTitle"),
  timeInput: document.getElementById("timeInput"),
  durInput: document.getElementById("durInput"),
  timeCancel: document.getElementById("timeCancel"),
  timeOk: document.getElementById("timeOk"),
};


const DAYS = [
  { key:"lun", label:"Lu" },
  { key:"mar", label:"Ma" },
  { key:"mer", label:"Me" },
  { key:"gio", label:"Gi" },
  { key:"ven", label:"Ve" },
  { key:"sab", label:"Sa" },
];

const state = {
  view: "home",
  settings: {
    prezzo_livello_1: "",
    prezzo_livello_2: "",
    prezzo_livello_3: "",
    anno_riferimento: String(new Date().getFullYear()),
    timezone: "Europe/Rome",
  },
  patients: [],
  newPatient: null,
  editingDay: null,
};

function setLed(el, on) {
  if (!el) return;
  el.classList.toggle("on", !!on);
}

function setErrorLed(on) {
  setLed(UI.ledErr, on);
}

function toast(msg) {
  const text = String(msg || "").trim();
  if (!text) return;

  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => el.classList.remove("show"), 2200);
}


function saveSettings() {
  const apiUrl = (UI.apiUrlInput.value || "").trim();
  const year = (UI.yearInput.value || "").trim();
  const tz = (UI.tzInput.value || "").trim();
  const p1 = (UI.p1Input.value || "").trim();
  const p2 = (UI.p2Input.value || "").trim();
  const p3 = (UI.p3Input.value || "").trim();

  if (apiUrl) setApiBaseUrl(apiUrl);

  const yNum = parseInt(year, 10);
  const next = {
    anno_riferimento: Number.isFinite(yNum) ? String(yNum) : (state.settings?.anno_riferimento || String(new Date().getFullYear())),
    timezone: tz || (state.settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome"),
    prezzo_livello_1: p1 || (state.settings?.prezzo_livello_1 || "0"),
    prezzo_livello_2: p2 || (state.settings?.prezzo_livello_2 || "0"),
    prezzo_livello_3: p3 || (state.settings?.prezzo_livello_3 || "0"),
  };

  // Override locale (no backend write). In alternativa possiamo aggiungere un endpoint GAS in seguito.
  localStorage.setItem("fm_settings_override", JSON.stringify(next));
  state.settings = { ...(state.settings || {}), ...next };
  renderSettings();
  toast("Impostazioni salvate");
}
function showView(name) {
  state.view = name;

  UI.viewHome.style.display = name === "home" ? "" : "none";
  UI.viewPazienti.style.display = name === "pazienti" ? "" : "none";
  UI.viewCalendario.style.display = name === "calendario" ? "" : "none";
  UI.viewStatistiche.style.display = name === "statistiche" ? "" : "none";
  UI.viewImpostazioni.style.display = name === "impostazioni" ? "" : "none";

  // Topbar: in Home niente Home, solo Impostazioni. Fuori dalla Home: Home disponibile, Impostazioni nascosta.
  const onHome = name === "home";
  if (UI.btnHome) UI.btnHome.style.display = onHome ? "none" : "";
  if (UI.btnSettings) UI.btnSettings.style.display = onHome ? "" : "none";

  if (name === "impostazioni") {
    renderImpostazioni();
  }
}

function modal(el, on) {
  el.classList.toggle("on", !!on);
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch(_) { return fallback; }
}

function getSession() {
  const raw = localStorage.getItem("SESSION");
  return raw ? safeJsonParse(raw, null) : null;
}
function setSession(session) {
  localStorage.setItem("SESSION", JSON.stringify(session));
}

async function apiFetch(action, payload={}, method="POST") {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error("Imposta prima l'URL del Google Apps Script (Impostazioni).");
  }
  const url = new URL(baseUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("apiKey", API_KEY);

  const session = getSession();
  if (session && session.userId) {
    url.searchParams.set("userId", session.userId);
  }

  setLed(UI.ledNet, true);
  setErrorLed(false);

  try {
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    };
    if (method !== "GET") {
      opts.body = JSON.stringify(payload || {});
    }
    const res = await fetch(url.toString(), opts);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      throw new Error((data && data.error) ? data.error : "Errore API");
    }
    return data.data;
  } finally {
    setLed(UI.ledNet, false);
  }
}


async function hasActiveAccounts() {
  try {
    const res = await apiFetch("hasAccounts", {});
    return !!(res && res.hasActive);
  } catch (e) {
    // If API is unreachable, fallback to existing behavior
    return true;
  }
}


function showSettingsPhase(n) {
  if (!UI.settingsPhase1 || !UI.settingsPhase2 || !UI.settingsPhase3) return;
  UI.settingsPhase1.classList.toggle("hidden", n !== 1);
  UI.settingsPhase2.classList.toggle("hidden", n !== 2);
  UI.settingsPhase3.classList.toggle("hidden", n !== 3);
}

let accountMode = null; // "create" | "modify" | "login"

async function renderImpostazioni() {
  // Always reflect current session
  if (state.user) {
    enterSettingsPhase3();
    return;
  }

  // Default: show the action menu (login/modify). If there are NO active accounts,
  // automatically start the create-account flow.
  showSettingsPhase(1);

  const hasActive = await hasActiveAccounts();
  if (!hasActive) {
    openAccountForm("create");
  }
} else {
    showSettingsPhase(1);
  }
}

function openAccountForm(mode) {
  accountMode = mode;
  if (!UI.accUsername) return;

  UI.accUsername.value = "";
  UI.accPassword.value = "";
  UI.accPassword2.value = "";

  // defaults
  UI.accPassword.type = "password";
  UI.accPassword2.type = "password";

  // mode-specific labels
  if (mode === "create") {
    UI.accPassword.placeholder = "Password";
    UI.accPassword2.placeholder = "Ripeti password";
    UI.accPassword2.classList.remove("hidden");
    UI.btnAccSubmit.textContent = "crea account";
  } else if (mode === "modify") {
    UI.accPassword.placeholder = "Password attuale";
    UI.accPassword2.placeholder = "Nuova password";
    UI.accPassword2.classList.remove("hidden");
    UI.btnAccSubmit.textContent = "modifica account";
  } else {
    UI.accPassword.placeholder = "Password";
    UI.accPassword2.classList.add("hidden");
    UI.btnAccSubmit.textContent = "accedi";
  }

  showSettingsPhase(2);
  setTimeout(() => UI.accUsername?.focus(), 50);
}

function updateLoggedUserLabel() {
  if (UI.loggedUserLabel) UI.loggedUserLabel.textContent = state.user?.email || "—";
}

function renderSettingsPhase3Fields() {
  if (!UI.setAnnoEsercizio) return;
  UI.setAnnoEsercizio.value = state.settings.anno_riferimento || "";
  UI.setPrezzo1.value = state.settings.prezzo_livello_1 || "";
  UI.setPrezzo2.value = state.settings.prezzo_livello_2 || "";
  UI.setPrezzo3.value = state.settings.prezzo_livello_3 || "";
}

function renderSettings() {
  // Backward-compatible: refresh UI with current state
  updateLoggedUserLabel();
  renderSettingsPhase3Fields();
}


function enterSettingsPhase3() {
  updateLoggedUserLabel();
  renderSettingsPhase3Fields();
  showSettingsPhase(3);
}

async function handleAccountSubmit() {
  const username = String(UI.accUsername.value || "").trim();
  const p1 = String(UI.accPassword.value || "");
  const p2 = String(UI.accPassword2.value || "");

  if (!username) return toast("Inserisci il nome utente.");
  if (!p1) return toast("Inserisci la password.");

  if (accountMode === "create") {
    if (!p2) return toast("Ripeti la password.");
    if (p1 !== p2) return toast("Le password non coincidono.");
  }

  if (accountMode === "modify") {
    if (!p2) return toast("Inserisci la nuova password.");
    if (p1 === p2) return toast("La nuova password deve essere diversa.");
  }

  try {
    setLed(UI.ledDbWrite, true);

    if (accountMode === "create") {
      await apiFetch("createAccount", { username, password: p1 });
      const res = await apiFetch("login", { username, password: p1 });
      setSession(res.user);
      state.user = { id: res.user.id, email: res.user.email };
      await refreshAll();
      enterSettingsPhase3();
      toast("Account creato e accesso effettuato.");
      return;
    }

    if (accountMode === "login") {
      const res = await apiFetch("login", { username, password: p1 });
      setSession(res.user);
      state.user = { id: res.user.id, email: res.user.email };
      await refreshAll();
      enterSettingsPhase3();
      toast("Accesso effettuato.");
      return;
    }

    // modify
    await apiFetch("changePassword", { username, password_old: p1, password_new: p2 });
    const res = await apiFetch("login", { username, password: p2 });
    setSession(res.user);
    state.user = { id: res.user.id, email: res.user.email };
    await refreshAll();
    enterSettingsPhase3();
    toast("Password aggiornata.");
  } catch (err) {
    setErrorLed(true);
    toast(err?.message || "Errore account.");
  } finally {
    setLed(UI.ledDbWrite, false);
  }
}

function logoutAccount() {
  localStorage.removeItem("SESSION");
  state.user = null;
  updateLoggedUserLabel();
  showSettingsPhase(1);
}

async function saveSettingsRemote() {
  if (!state.user) return toast("Accedi prima di salvare.");

  const anno = String(UI.setAnnoEsercizio.value || "").trim();
  const p1 = String(UI.setPrezzo1.value || "").trim();
  const p2 = String(UI.setPrezzo2.value || "").trim();
  const p3 = String(UI.setPrezzo3.value || "").trim();

  if (!anno) return toast("Inserisci l'anno di esercizio.");

  const settings = {
    ...state.settings,
    anno_riferimento: anno,
    prezzo_livello_1: p1,
    prezzo_livello_2: p2,
    prezzo_livello_3: p3,
  };

  try {
    setLed(UI.ledDbWrite, true);
    await apiFetch("saveSettings", { settings });
    state.settings = settings;
    toast("Impostazioni salvate.");
  } catch (err) {
    setErrorLed(true);
    toast(err?.message || "Errore salvataggio impostazioni.");
  } finally {
    setLed(UI.ledDbWrite, false);
  }
}

async function reloadSettingsRemote() {
  try {
    await refreshAll();
    renderSettingsPhase3Fields();
    toast("Impostazioni ricaricate.");
  } catch (err) {
    setErrorLed(true);
    toast(err?.message || "Errore ricarica impostazioni.");
  }
}

async function addSocietaPrompt() {
  if (!state.user) return toast("Accedi prima.");

  const nome = prompt("Nome società");
  const clean = String(nome || "").trim();
  if (!clean) return;

  try {
    setLed(UI.ledDbWrite, true);
    await apiFetch("addSocieta", { nome: clean });
    toast("Società aggiunta.");
  } catch (err) {
    setErrorLed(true);
    toast(err?.message || "Errore aggiunta società.");
  } finally {
    setLed(UI.ledDbWrite, false);
  }
}

async function deleteAccountFlow() {
  if (!state.user) return toast("Nessun account attivo.");

  const ok = confirm("Vuoi cancellare definitivamente questo account?");
  if (!ok) return;

  const pwd = prompt("Inserisci la password per confermare");
  if (!pwd) return;

  try {
    setLed(UI.ledDbWrite, true);
    await apiFetch("deleteAccount", { userId: state.user.id, password: String(pwd) });
    toast("Account eliminato.");
    logoutAccount();
  } catch (err) {
    setErrorLed(true);
    toast(err?.message || "Errore cancellazione account.");
  } finally {
    setLed(UI.ledDbWrite, false);
  }
}

function renderPatients() {
  UI.patientsHint.textContent = state.settings.anno_riferimento
    ? `Anno: ${state.settings.anno_riferimento}`
    : "";
  UI.patientsList.innerHTML = "";
  if (!state.patients.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Nessun paziente.";
    UI.patientsList.appendChild(empty);
    return;
  }
  for (const p of state.patients) {
    const el = document.createElement("div");
    el.className = "item";
    const left = document.createElement("div");
    left.innerHTML = `<div class="item-title">${escapeHtml(p.nome_cognome || "")}</div>
      <div class="item-sub">${escapeHtml(p.societa || "")}${p.livello ? " · livello " + p.livello : ""}</div>`;
    const right = document.createElement("div");
    const btn = document.createElement("button");
    btn.className = "btn secondary";
    btn.type = "button";
    btn.textContent = "Dettagli";
    btn.onclick = () => {
      alert(
        `Paziente: ${p.nome_cognome || ""}\nSocietà: ${p.societa || ""}\nLivello: ${p.livello || ""}`
      );
    };
    right.appendChild(btn);
    el.appendChild(left);
    el.appendChild(right);
    UI.patientsList.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

function resetNewPatient() {
  state.newPatient = {
    nome_cognome: "",
    societa: "",
    livello: 1,
    data_inizio: "",
    data_fine: "",
    giorni: {}, // dayKey -> { ora_inizio, durata_min }
  };
  state.editingDay = null;

  UI.patName.value = "";
  UI.patSoc.value = "";
  UI.patStart.value = "";
  UI.patEnd.value = "";
  setLevel(1);
  renderDayChips();
}

function setLevel(level) {
  state.newPatient.livello = Number(level);
  [...UI.levelPills.querySelectorAll(".pill")].forEach(p => {
    p.classList.toggle("on", Number(p.dataset.level) === Number(level));
  });
}

function renderDayChips() {
  [...UI.dayChips.querySelectorAll(".daychip")].forEach(ch => {
    const k = ch.dataset.day;
    ch.classList.toggle("on", !!state.newPatient.giorni[k]);
  });
}

function openTimeModal(dayKey) {
  state.editingDay = dayKey;
  const day = DAYS.find(d => d.key === dayKey);
  const cur = state.newPatient.giorni[dayKey] || {};
  UI.timeModalTitle.textContent = `Orario ${day?.label || dayKey}`;
  UI.timeInput.value = cur.ora_inizio || "14:00";
  UI.durInput.value = cur.durata_min || "45";
  modal(UI.timeModal, true);
}

async function savePatientBundle() {
  const s = state.newPatient;
  if (!s.nome_cognome.trim()) throw new Error("Inserisci nome e cognome.");
  if (!s.data_inizio) throw new Error("Inserisci data inizio.");
  if (!s.data_fine) throw new Error("Inserisci data fine.");
  const days = Object.keys(s.giorni);
  if (!days.length) throw new Error("Seleziona almeno un giorno e imposta l'orario.");

  const year = String(state.settings.anno_riferimento || new Date().getFullYear());
  const prices = {
    1: Number(state.settings.prezzo_livello_1 || 0),
    2: Number(state.settings.prezzo_livello_2 || 0),
    3: Number(state.settings.prezzo_livello_3 || 0),
  };
  const prezzo_unitario = prices[s.livello] || 0;

  const payload = {
    patient: {
      nome_cognome: s.nome_cognome.trim(),
      societa: s.societa.trim(),
      livello: Number(s.livello),
      data_inizio: s.data_inizio,
      data_fine: s.data_fine,
      giorni_settimana: JSON.stringify(days),
      note: "",
      anno: year,
    },
    plan: {
      societa: s.societa.trim(),
      livello: Number(s.livello),
      prezzo_unitario,
      data_inizio: s.data_inizio,
      data_fine: s.data_fine,
      giorni_settimana: JSON.stringify(days),
      anno: year,
      stato: "attivo",
      note: "",
    },
    hours: days.map(dk => ({
      giorno: dk,
      ora_inizio: s.giorni[dk].ora_inizio,
      durata_min: Number(s.giorni[dk].durata_min || 0),
    }))
  };

  setLed(UI.ledDbWrite, true);
  const out = await apiFetch("savePatientBundle", payload);
  setLed(UI.ledDbWrite, false);
  return out;
}

async function refreshAll() {
  renderImpostazioni();

  // settings
  try {
    setLed(UI.ledDbRead, true);
    const settings = await apiFetch("getSettings", {}, "GET");
    if (settings) {
      state.settings = {
        prezzo_livello_1: settings.prezzo_livello_1 ?? state.settings.prezzo_livello_1,
        prezzo_livello_2: settings.prezzo_livello_2 ?? state.settings.prezzo_livello_2,
        prezzo_livello_3: settings.prezzo_livello_3 ?? state.settings.prezzo_livello_3,
        anno_riferimento: settings.anno_riferimento ?? state.settings.anno_riferimento,
        timezone: settings.timezone ?? state.settings.timezone,
      };
    }
  } catch (_) {
    // ignore
  } finally {
    setLed(UI.ledDbRead, false);
  }

  // Override locale (no backend write)
  try {
    const ov = JSON.parse(localStorage.getItem("fm_settings_override") || "null");
    if (ov && typeof ov === "object") {
      state.settings = { ...(state.settings || {}), ...ov };
    }
  } catch (e) {}

  if (UI.homeYearPill) UI.homeYearPill.textContent = String(state.settings.anno_riferimento || String(new Date().getFullYear()));

  UI.apiUrlInput.value = getApiBaseUrl() || "";
  UI.yearInput.value = state.settings.anno_riferimento || String(new Date().getFullYear());
  UI.tzInput.value = state.settings.timezone || "Europe/Rome";
  UI.p1Input.value = state.settings.prezzo_livello_1 ?? "";
  UI.p2Input.value = state.settings.prezzo_livello_2 ?? "";
  UI.p3Input.value = state.settings.prezzo_livello_3 ?? "";
  UI.userHint.textContent = getSession()?.email ? ("Account: " + getSession().email) : "Nessun account selezionato.";

  // patients
  try {
    setLed(UI.ledDbRead, true);
    const year = String(state.settings.anno_riferimento || new Date().getFullYear());
    const data = await apiFetch("listPatients", { anno: year });
    state.patients = Array.isArray(data) ? data : [];
  } catch (e) {
    state.patients = [];
    UI.patientsHint.textContent = e.message;
  } finally {
    setLed(UI.ledDbRead, false);
  }
  renderPatients();
}

function bind() {
  if (UI.btnHome) UI.btnHome.onclick = () => showView("home");
  if (UI.btnSettings) UI.btnSettings.onclick = () => showView("impostazioni");

  if (UI.homeYearPill) {
    UI.homeYearPill.onclick = () => showView("impostazioni");
    UI.homeYearPill.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        showView("impostazioni");
      }
    });
  }

  if (UI.tilePazienti) UI.tilePazienti.onclick = () => showView("pazienti");
  if (UI.tileCalendario) UI.tileCalendario.onclick = () => showView("calendario");
  if (UI.tileStatistiche) UI.tileStatistiche.onclick = () => showView("statistiche");

  if (UI.btnNewPatient) UI.btnNewPatient.onclick = () => {
    resetNewPatient();
    modal(UI.patientModal, true);
  };

  if (UI.patCancel) UI.patCancel.onclick = () => modal(UI.patientModal, false);

  UI.levelPills.addEventListener("click", (e) => {
    const pill = e.target.closest(".pill");
    if (!pill) return;
    setLevel(pill.dataset.level);
  });

  UI.dayChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".daychip");
    if (!chip) return;
    const dayKey = chip.dataset.day;
    openTimeModal(dayKey);
  });

  UI.timeCancel.onclick = () => modal(UI.timeModal, false);
  UI.timeOk.onclick = () => {
    const dayKey = state.editingDay;
    if (!dayKey) return;

    const t = UI.timeInput.value || "09:00";
    const d = Math.max(5, Math.min(240, parseInt(UI.durInput.value || "30", 10)));
    state.dayTimes[dayKey] = { ora_inizio: t, durata_min: d };

    renderDayChips();
    modal(UI.timeModal, false);
  };

  UI.patSave.onclick = savePatient;

  // Impostazioni (phases)
  UI.btnAccCreate && (UI.btnAccCreate.onclick = () => openAccountForm("create"));
  UI.btnAccModify && (UI.btnAccModify.onclick = () => openAccountForm("modify"));
  UI.btnAccLogin && (UI.btnAccLogin.onclick = () => openAccountForm("login"));
  UI.btnAccBack && (UI.btnAccBack.onclick = () => showSettingsPhase(1));
  UI.btnAccSubmit && (UI.btnAccSubmit.onclick = handleAccountSubmit);

  UI.btnSetSave && (UI.btnSetSave.onclick = saveSettingsRemote);
  UI.btnSetReload && (UI.btnSetReload.onclick = reloadSettingsRemote);
  UI.btnAddSocieta && (UI.btnAddSocieta.onclick = addSocietaPrompt);
  UI.btnDeleteAccount && (UI.btnDeleteAccount.onclick = deleteAccountFlow);
  UI.btnLogout && (UI.btnLogout.onclick = logoutAccount);

}

async function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./service-worker.js?v=" + BUILD, { scope: "./" });
    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
  } catch (_) {}
}

(async function init() {
  bind();
  showView("home");
  toast("");
  renderImpostazioni();
  await setupServiceWorker();

  try {
    await refreshAll();
  } catch (e) {
    // ok
  }
})();