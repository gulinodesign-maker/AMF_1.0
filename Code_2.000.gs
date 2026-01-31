// Code_2.000
/**
 * AMF - Google Apps Script Web App API
 * Deploy as Web App (doGet) and paste /exec URL into config.js (API_URL).
 */
const SPREADSHEET_ID = "1W4XXl3TxC_aEzXtrDz46hWkq2O070Fs3gFNmWGEhVsg";

const SHEETS = {
  impostazioni: "impostazioni",
  utenti: "utenti",
  pazienti: "pazienti",
  piani_terapia: "piani_terapia",
  orari_terapia: "orari_terapia",
  sedute: "sedute",
  societa: "societa"
};

function doGet(e) {
  try {
    const cb = sanitizeCallback_(e && e.parameter ? e.parameter.callback : "");
    const action = (e.parameter.action || "").trim();
    const t = new Date().toISOString();
    if (!action) return out_({ ok: false, error: "Missing action" }, cb);

    switch (action) {
      case "listUsers":
        return out_({ ok: true, users: listUsers_() }, cb);
      case "createUser":
        return out_({ ok: true, user: createUser_(e.parameter.nome, e.parameter.password) }, cb);
      case "login":
        return out_({ ok: true, user: login_(e.parameter.nome, e.parameter.password) }, cb);
      case "updatePassword":
        return out_({ ok: true, user: updatePassword_(e.parameter.nome, e.parameter.oldPassword, e.parameter.newPassword) }, cb);
      case "getSettings":
        return out_({ ok: true, settings: getSettings_(e.parameter.userId) }, cb);
      case "saveSettings":
        return out_({ ok: true, settings: saveSettings_(e.parameter.userId, e.parameter.payload) }, cb);
      case "addSocieta":
        return out_({ ok: true, societa: addSocieta_(e.parameter.userId, e.parameter.nome, e.parameter.tag) }, cb);
      case "deleteSocieta":
        return out_({ ok: true, societa: deleteSocieta_(e.parameter.userId, e.parameter.id, e.parameter.nome) }, cb);
      case "listSocieta":
        return out_({ ok: true, societa: listSocieta_(e.parameter.userId) }, cb);
      case "listPatients":
        return out_({ ok: true, pazienti: listPatients_(e.parameter.userId) }, cb);
      case "createPatient":
        return out_({ ok: true, paziente: createPatient_(e.parameter.userId, e.parameter.payload) }, cb);
      case "updatePatient":
        return out_({ ok: true, paziente: updatePatient_(e.parameter.userId, e.parameter.id, e.parameter.payload) }, cb);
      case "wipeAll":
        wipeAll_(e.parameter.userId);
        return out_({ ok: true }, cb);
      case "ping":
        return out_({ ok: true, t }, cb);
      default:
        return out_({ ok: false, error: "Unknown action" }, cb);
    }
  } catch (err) {
    const cb = sanitizeCallback_(e && e.parameter ? e.parameter.callback : "");
    return out_({ ok: false, error: String(err && err.message ? err.message : err) }, cb);
  }
}

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error("Missing sheet: " + name);
  return s;
}

function now_() {
  return new Date().toISOString();
}

function uuid_() {
  return Utilities.getUuid();
}

function sha256_(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function userHash_(userId, password) {
  return sha256_(password + "|" + userId);
}

function listUsers_() {
  const sh = sheet_(SHEETS.utenti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || !row[0]) continue;
    const obj = {};
    headers.forEach((h, idx) => obj[h] = row[idx]);
    // non esportare hash
    delete obj.pin_hash;
    out.push(obj);
  }
  return out.filter(u => String(u.attivo).toLowerCase() !== "false");
}

function createUser_(nome, password) {
  if (!nome) throw new Error("Nome richiesto");
  if (!password) throw new Error("Password richiesta");

  const sh = sheet_(SHEETS.utenti);
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const col = (h) => headers.indexOf(h) + 1;

  const id = uuid_();
  const createdAt = now_();
  const updatedAt = createdAt;
  const hash = userHash_(id, password);

  // prevent duplicate name (case-insensitive)
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (String(r[col("nome")-1]).trim().toLowerCase() === String(nome).trim().toLowerCase()) {
      throw new Error("Utente già esistente");
    }
  }

  const row = new Array(headers.length).fill("");
  row[col("id")-1] = id;
  row[col("nome")-1] = nome;
  if (col("email") > 0) row[col("email")-1] = "";
  if (col("ruolo") > 0) row[col("ruolo")-1] = "admin";
  if (col("attivo") > 0) row[col("attivo")-1] = true;
  row[col("pin_hash")-1] = hash;
  if (col("createdAt") > 0) row[col("createdAt")-1] = createdAt;
  if (col("updatedAt") > 0) row[col("updatedAt")-1] = updatedAt;

  sh.appendRow(row);

  return { id, nome };
}

function login_(nome, password) {
  if (!nome) throw new Error("Nome richiesto");
  if (!password) throw new Error("Password richiesta");

  const sh = sheet_(SHEETS.utenti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) throw new Error("Nessun utente");
  const headers = values[0];
  const col = (h) => headers.indexOf(h);

  const idxNome = col("nome");
  const idxId = col("id");
  const idxHash = col("pin_hash");
  const idxAttivo = col("attivo");

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[idxId]) continue;
    if (String(r[idxNome]).trim().toLowerCase() !== String(nome).trim().toLowerCase()) continue;
    if (idxAttivo >= 0 && String(r[idxAttivo]).toLowerCase() === "false") throw new Error("Utente non attivo");
    const userId = String(r[idxId]);
    const expected = String(r[idxHash]);
    const got = userHash_(userId, password);
    if (got !== expected) throw new Error("Password errata");
    return { id: userId, nome: r[idxNome] };
  }
  throw new Error("Utente non trovato");
}

function updatePassword_(nome, oldPassword, newPassword) {
  if (!nome) throw new Error("Nome richiesto");
  if (!oldPassword) throw new Error("Password attuale richiesta");
  if (!newPassword) throw new Error("Nuova password richiesta");

  const sh = sheet_(SHEETS.utenti);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const col = (h) => headers.indexOf(h);

  const idxNome = col("nome");
  const idxId = col("id");
  const idxHash = col("pin_hash");
  const idxUpdated = col("updatedAt");

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[idxId]) continue;
    if (String(r[idxNome]).trim().toLowerCase() !== String(nome).trim().toLowerCase()) continue;

    const userId = String(r[idxId]);
    const expected = String(r[idxHash]);
    const got = userHash_(userId, oldPassword);
    if (got !== expected) throw new Error("Password attuale errata");

    const newHash = userHash_(userId, newPassword);
    sh.getRange(i+1, idxHash+1).setValue(newHash);
    if (idxUpdated >= 0) sh.getRange(i+1, idxUpdated+1).setValue(now_());
    return { id: userId, nome: r[idxNome] };
  }
  throw new Error("Utente non trovato");
}

function getSettings_(userId) {
  const sh = sheet_(SHEETS.impostazioni);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return {};
  const headers = values[0];
  const idxKey = headers.indexOf("key");
  const idxVal = headers.indexOf("value");
  if (idxKey < 0 || idxVal < 0) throw new Error("Schema impostazioni non valido");

  const out = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const k = String(r[idxKey] || "").trim();
    if (!k) continue;
    out[k] = r[idxVal];
  }
  return out;
}

function saveSettings_(userId, payloadJson) {
  const payload = payloadJson ? JSON.parse(payloadJson) : {};
  const sh = sheet_(SHEETS.impostazioni);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idxKey = headers.indexOf("key");
  const idxVal = headers.indexOf("value");
  const idxUpd = headers.indexOf("updatedAt");
  if (idxKey < 0 || idxVal < 0) throw new Error("Schema impostazioni non valido");

  const mapRow = {};
  for (let i = 1; i < values.length; i++) {
    const k = String(values[i][idxKey] || "").trim();
    if (k) mapRow[k] = i+1;
  }

  const keys = ["anno_esercizio","tariffa_livello_1","tariffa_livello_2","tariffa_livello_3"];
  const now = now_();
  keys.forEach(k => {
    const v = (payload[k] !== undefined) ? payload[k] : "";
    if (mapRow[k]) {
      sh.getRange(mapRow[k], idxVal+1).setValue(v);
      if (idxUpd >= 0) sh.getRange(mapRow[k], idxUpd+1).setValue(now);
    } else {
      const row = new Array(headers.length).fill("");
      row[idxKey] = k;
      row[idxVal] = v;
      if (idxUpd >= 0) row[idxUpd] = now;
      sh.appendRow(row);
    }
  });
  return getSettings_(userId);
}


function addSocieta_(userId, nome, tag) {
  if (!nome) throw new Error("Nome società richiesto");
  const sh = sheet_(SHEETS.societa);
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxNome = headers.indexOf("nome");
  const idxAtt = headers.indexOf("attiva");
  const idxTag = headers.indexOf("tag");
  const idxCre = headers.indexOf("createdAt");
  const idxUpd = headers.indexOf("updatedAt");

  const now = now_();
  const nameNorm = String(nome || "").trim();
  const nameKey = nameNorm.toLowerCase();

  const tagNum = Math.max(0, Math.min(5, parseInt(tag, 10) || 0));

  // Se esiste già (stesso nome), riattiva e aggiorna tag
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const existingName = idxNome >= 0 ? String(r[idxNome] || "").trim() : "";
    if (!existingName) continue;
    if (existingName.toLowerCase() !== nameKey) continue;

    const rowNum = i + 1;
    if (idxAtt >= 0) sh.getRange(rowNum, idxAtt + 1).setValue(true);
    if (idxTag >= 0) sh.getRange(rowNum, idxTag + 1).setValue(tagNum);
    if (idxUpd >= 0) sh.getRange(rowNum, idxUpd + 1).setValue(now);

    const id = idxId >= 0 ? String(r[idxId] || "").trim() : "";
    return { id: id || "", nome: nameNorm, tag: tagNum };
  }

  const id = uuid_();
  const row = new Array(headers.length).fill("");

  if (idxId >= 0) row[idxId] = id;
  if (idxNome >= 0) row[idxNome] = nameNorm;
  if (idxAtt >= 0) row[idxAtt] = true;
  if (idxTag >= 0) row[idxTag] = tagNum;
  if (idxCre >= 0) row[idxCre] = now;
  if (idxUpd >= 0) row[idxUpd] = now;

  sh.appendRow(row);
  return { id, nome: nameNorm, tag: tagNum };
}



function listSocieta_(userId) {
  const sh = sheet_(SHEETS.societa);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0] || [];
  const idxNome = headers.indexOf("nome");
  const idxAtt = headers.indexOf("attiva");
  const idxId = headers.indexOf("id");
  const idxTag = headers.indexOf("tag");

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;
    const nome = idxNome >= 0 ? String(r[idxNome] || "").trim() : "";
    if (!nome) continue;
    const att = idxAtt >= 0 ? r[idxAtt] : true;
    if (String(att).toLowerCase() === "false") continue;

    const tagRaw = idxTag >= 0 ? r[idxTag] : 0;
    const tag = Math.max(0, Math.min(5, parseInt(tagRaw, 10) || 0));

    out.push({
      id: idxId >= 0 ? r[idxId] : "",
      nome,
      tag
    });
  }
  out.sort((a,b) => String(a.nome).localeCompare(String(b.nome), "it", { sensitivity: "base" }));
  return out;
}



function deleteSocieta_(userId, id, nome) {
  const sh = sheet_(SHEETS.societa);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) throw new Error("Nessuna società");
  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxNome = headers.indexOf("nome");
  const idxAtt = headers.indexOf("attiva");
  const idxUpd = headers.indexOf("updatedAt");

  const idKey = String(id || "").trim();
  const nameKey = String(nome || "").trim().toLowerCase();
  if (!idKey && !nameKey) throw new Error("Id o nome richiesto");

  let rowNum = -1;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;
    const rid = idxId >= 0 ? String(r[idxId] || "").trim() : "";
    const rname = idxNome >= 0 ? String(r[idxNome] || "").trim() : "";
    if (idKey && rid && rid === idKey) { rowNum = i + 1; break; }
    if (!idKey && rname && rname.toLowerCase() === nameKey) { rowNum = i + 1; break; }
  }
  if (rowNum < 0) throw new Error("Società non trovata");

  if (idxAtt >= 0) sh.getRange(rowNum, idxAtt + 1).setValue(false);
  if (idxUpd >= 0) sh.getRange(rowNum, idxUpd + 1).setValue(now_());

  return { id: idKey || "", nome: nome || "" };
}


function listPatients_(userId) {
  const sh = sheet_(SHEETS.pazienti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxDel = headers.indexOf("isDeleted");
  const idxUser = headers.indexOf("utente_id");

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;

    const id = idxId >= 0 ? r[idxId] : "";
    if (!id) continue;

    const del = idxDel >= 0 ? r[idxDel] : false;
    if (String(del).toLowerCase() === "true") continue;

    if (idxUser >= 0 && userId) {
      if (String(r[idxUser] || "") !== String(userId)) continue;
    }

    const obj = {};
    headers.forEach((h, idx) => obj[h] = r[idx]);
    out.push(obj);
  }
  return out;
}


function createPatient_(userId, payloadJson) {
  if (!userId) throw new Error("UserId richiesto");
  const payload = payloadJson ? JSON.parse(payloadJson) : {};

  const nome = String(payload.nome_cognome || "").trim();
  const livello = String(payload.livello || "").trim();

  let societa_id = String(payload.societa_id || payload.societaId || "").trim();
  const societa_nome = String(payload.societa_nome || payload.societaNome || payload.societa || "").trim();

  if (!societa_id && societa_nome) {
    // fallback: risolvi id da nome (se disponibile)
    const soc = listSocieta_(userId).find((s) => String(s.nome || "").trim().toLowerCase() === societa_nome.toLowerCase());
    societa_id = soc ? String(soc.id || "").trim() : "";
  }

  if (!nome) throw new Error("Nome paziente richiesto");
  if (!societa_id) throw new Error("Società richiesta");
  if (!livello) throw new Error("Livello richiesto");

  const sh = sheet_(SHEETS.pazienti);
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const col = (h) => headers.indexOf(h) + 1;

  const id = uuid_();
  const now = now_();

  const row = new Array(headers.length).fill("");
  if (col("id") > 0) row[col("id")-1] = id;
  if (col("nome_cognome") > 0) row[col("nome_cognome")-1] = nome;

  // nuova struttura
  if (col("societa_id") > 0) row[col("societa_id")-1] = societa_id;
  // compat: se esiste ancora la colonna "societa"
  if (col("societa") > 0) row[col("societa")-1] = societa_nome || "";

  if (col("livello") > 0) row[col("livello")-1] = livello;
  if (col("data_inizio") > 0) row[col("data_inizio")-1] = payload.data_inizio || "";
  if (col("data_fine") > 0) row[col("data_fine")-1] = payload.data_fine || "";
  if (col("giorni_settimana") > 0) row[col("giorni_settimana")-1] = payload.giorni_settimana || "{}";
  if (col("note") > 0) row[col("note")-1] = payload.note || "";
  if (col("utente_id") > 0) row[col("utente_id")-1] = String(userId);
  if (col("isDeleted") > 0) row[col("isDeleted")-1] = false;
  if (col("createdAt") > 0) row[col("createdAt")-1] = now;
  if (col("updatedAt") > 0) row[col("updatedAt")-1] = now;

  sh.appendRow(row);
  return { id };
}



function updatePatient_(userId, patientId, payloadJson) {
  if (!userId) throw new Error("UserId richiesto");
  if (!patientId) throw new Error("Id paziente richiesto");
  const payload = payloadJson ? JSON.parse(payloadJson) : {};

  const sh = sheet_(SHEETS.pazienti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) throw new Error("Nessun paziente");
  const headers = values[0] || [];
  const col = (h) => headers.indexOf(h) + 1;
  const idxId = headers.indexOf("id");

  let rowNum = -1;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (String(r[idxId] || "") === String(patientId)) {
      rowNum = i + 1;
      break;
    }
  }
  if (rowNum < 0) throw new Error("Paziente non trovato");

  const now = now_();
  const setIf = (h, v) => {
    const c = col(h);
    if (c > 0) sh.getRange(rowNum, c).setValue(v);
  };

  if (payload.nome_cognome !== undefined) setIf("nome_cognome", String(payload.nome_cognome || "").trim());

  // nuova struttura: societa_id
  if (payload.societa_id !== undefined || payload.societaId !== undefined || payload.societa_nome !== undefined || payload.societa !== undefined) {
    let societa_id = String(payload.societa_id || payload.societaId || "").trim();
    const societa_nome = String(payload.societa_nome || payload.societaNome || payload.societa || "").trim();
    if (!societa_id && societa_nome) {
      const soc = listSocieta_(userId).find((s) => String(s.nome || "").trim().toLowerCase() === societa_nome.toLowerCase());
      societa_id = soc ? String(soc.id || "").trim() : "";
    }
    if (societa_id) setIf("societa_id", societa_id);
    // compat: se esiste ancora la colonna "societa"
    if (col("societa") > 0) setIf("societa", societa_nome || "");
  }

  if (payload.livello !== undefined) setIf("livello", String(payload.livello || "").trim());
  if (payload.data_inizio !== undefined) setIf("data_inizio", payload.data_inizio || "");
  if (payload.data_fine !== undefined) setIf("data_fine", payload.data_fine || "");
  if (payload.giorni_settimana !== undefined) setIf("giorni_settimana", payload.giorni_settimana || "{}");
  if (payload.note !== undefined) setIf("note", payload.note || "");

  setIf("updatedAt", now);
  return { id: patientId };
}


function wipeAll_(userId) {
  const ss = ss_();
  const targets = [
    SHEETS.impostazioni,
    SHEETS.utenti,
    SHEETS.pazienti,
    SHEETS.piani_terapia,
    SHEETS.orari_terapia,
    SHEETS.sedute,
    SHEETS.societa
  ];
  targets.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (last >= 2 && lastCol >= 1) {
      sh.getRange(2, 1, last-1, lastCol).clearContent();
    }
  });
}

function sanitizeCallback_(cb) {
  cb = String(cb || "").trim();
  if (!cb) return "";
  cb = cb.replace(/[^0-9A-Za-z_$.]/g, "");
  if (!cb) return "";
  if (!/^[A-Za-z_$]/.test(cb)) return "";
  return cb;
}

function out_(obj, cb) {
  const txt = JSON.stringify(obj);
  if (cb) {
    return ContentService
      .createTextOutput(cb + "(" + txt + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(txt)
    .setMimeType(ContentService.MimeType.JSON);
}

