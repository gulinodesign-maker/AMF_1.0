// Code_AMF_1.084
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
        return out_({ ok: true, societa: addSocieta_(
          e.parameter.userId,
          e.parameter.nome,
          e.parameter.tag,
          e.parameter.l1,
          e.parameter.l2,
          e.parameter.l3
        ) }, cb);
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
      case "deletePatient":
        return out_({ ok: true, paziente: deletePatient_(e.parameter.userId, e.parameter.id) }, cb);
      case "wipeAll":
        wipeAll_(e.parameter.userId);
        return out_({ ok: true }, cb);
      case "ping":
        return out_({ ok: true, t }, cb);
      case "listMoves":
        return out_({ ok: true, moves: listMoves_(e.parameter.userId, e.parameter.year, e.parameter.month) }, cb);
            case "moveSession":
        return out_({ ok: true, move: moveSession_(
          e.parameter.userId,
          e.parameter.paziente_id,
          e.parameter.from_date,
          e.parameter.from_time,
          e.parameter.to_date,
          e.parameter.to_time
        ) }, cb);
      case "deleteSession":
        return out_({ ok: true, move: deleteSession_(
          e.parameter.userId,
          e.parameter.paziente_id,
          e.parameter.from_date,
          e.parameter.from_time
        ) }, cb);
: "Unknown action" }, cb);
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


function addSocieta_(userId, nome, tag, l1, l2, l3) {
  if (!nome) throw new Error("Nome società richiesto");
  if (!userId) throw new Error("userId richiesto");
  const sh = sheet_(SHEETS.societa);
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxUser = headers.indexOf("id_user");
  const idxNome = headers.indexOf("nome");
  const idxAtt = headers.indexOf("attiva");
  const idxTag = headers.indexOf("tag");
  const idxL1 = headers.indexOf("L1");
  const idxL2 = headers.indexOf("L2");
  const idxL3 = headers.indexOf("L3");
  const idxCre = headers.indexOf("createdAt");
  const idxUpd = headers.indexOf("updatedAt");

  const now = now_();
  const nameNorm = String(nome || "").trim();
  const nameKey = nameNorm.toLowerCase();

  const tagNum = Math.max(0, Math.min(5, parseInt(tag, 10) || 0));

  // Se esiste già (stesso nome) PER LO STESSO USER, riattiva e aggiorna tag/valori
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const rUser = idxUser >= 0 ? String(r[idxUser] || "").trim() : "";
    if (idxUser >= 0 && rUser !== String(userId)) continue;
    const existingName = idxNome >= 0 ? String(r[idxNome] || "").trim() : "";
    if (!existingName) continue;
    if (existingName.toLowerCase() !== nameKey) continue;

    const rowNum = i + 1;
    if (idxAtt >= 0) sh.getRange(rowNum, idxAtt + 1).setValue(true);
    if (idxTag >= 0) sh.getRange(rowNum, idxTag + 1).setValue(tagNum);
    if (idxL1 >= 0) sh.getRange(rowNum, idxL1 + 1).setValue(l1 !== undefined ? l1 : "");
    if (idxL2 >= 0) sh.getRange(rowNum, idxL2 + 1).setValue(l2 !== undefined ? l2 : "");
    if (idxL3 >= 0) sh.getRange(rowNum, idxL3 + 1).setValue(l3 !== undefined ? l3 : "");
    if (idxUpd >= 0) sh.getRange(rowNum, idxUpd + 1).setValue(now);

    const id = idxId >= 0 ? String(r[idxId] || "").trim() : "";
    return { id: id || "", id_user: String(userId), nome: nameNorm, tag: tagNum, L1: l1, L2: l2, L3: l3 };
  }

  const id = uuid_();
  const row = new Array(headers.length).fill("");

  if (idxId >= 0) row[idxId] = id;
  if (idxUser >= 0) row[idxUser] = String(userId);
  if (idxNome >= 0) row[idxNome] = nameNorm;
  if (idxAtt >= 0) row[idxAtt] = true;
  if (idxTag >= 0) row[idxTag] = tagNum;
  if (idxL1 >= 0) row[idxL1] = l1 !== undefined ? l1 : "";
  if (idxL2 >= 0) row[idxL2] = l2 !== undefined ? l2 : "";
  if (idxL3 >= 0) row[idxL3] = l3 !== undefined ? l3 : "";
  if (idxCre >= 0) row[idxCre] = now;
  if (idxUpd >= 0) row[idxUpd] = now;

  sh.appendRow(row);
  return { id, id_user: String(userId), nome: nameNorm, tag: tagNum, L1: l1, L2: l2, L3: l3 };
}



function listSocieta_(userId) {
  const sh = sheet_(SHEETS.societa);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0] || [];
  const idxUser = headers.indexOf("id_user");
  const idxNome = headers.indexOf("nome");
  const idxAtt = headers.indexOf("attiva");
  const idxId = headers.indexOf("id");
  const idxTag = headers.indexOf("tag");
  const idxL1 = headers.indexOf("L1");
  const idxL2 = headers.indexOf("L2");
  const idxL3 = headers.indexOf("L3");

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;

    // Multi-account: restituisce solo le società dell'account corrente
    if (idxUser >= 0 && String(r[idxUser] || "").trim() !== String(userId || "").trim()) continue;

    const nome = idxNome >= 0 ? String(r[idxNome] || "").trim() : "";
    if (!nome) continue;
    const att = idxAtt >= 0 ? r[idxAtt] : true;
    if (String(att).toLowerCase() === "false") continue;

    const tagRaw = idxTag >= 0 ? r[idxTag] : 0;
    const tag = Math.max(0, Math.min(5, parseInt(tagRaw, 10) || 0));

    out.push({
      id: idxId >= 0 ? r[idxId] : "",
      nome,
      tag,
      L1: idxL1 >= 0 ? r[idxL1] : "",
      L2: idxL2 >= 0 ? r[idxL2] : "",
      L3: idxL3 >= 0 ? r[idxL3] : ""
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
  const idxUser = headers.indexOf("id_user");
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
    if (idxUser >= 0 && String(r[idxUser] || "").trim() !== String(userId || "").trim()) continue;
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
  const address = String(payload.address || payload.indirizzo || "").trim();
  const livello = String(payload.livello || "").trim();

  let societa_id = String(payload.societa_id || payload.societaId || "").trim();
  const societa_nome = String(payload.societa_nome || payload.societaNome || payload.societa || "").trim();

  if (!societa_id && societa_nome) {
    // fallback: risolvi id da nome (se disponibile)
    const soc = listSocieta_(userId).find((s) => String(s.nome || "").trim().toLowerCase() === societa_nome.toLowerCase());
    societa_id = soc ? String(soc.id || "").trim() : "";
  }

  if (!nome) throw new Error("Nome paziente richiesto");
  if (!address) throw new Error("Indirizzo richiesto");
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
  if (col("address") > 0) row[col("address")-1] = address;

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
  if (payload.address !== undefined || payload.indirizzo !== undefined) {
    const addr = String(payload.address || payload.indirizzo || "").trim();
    if (!addr) throw new Error("Indirizzo richiesto");
    setIf("address", addr);
  }

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


function deletePatient_(userId, patientId) {
  if (!userId) throw new Error("UserId richiesto");
  if (!patientId) throw new Error("Id paziente richiesto");

  const sh = sheet_(SHEETS.pazienti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) throw new Error("Nessun paziente");
  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxUser = headers.indexOf("utente_id");

  if (idxId < 0) throw new Error("Colonna id mancante");

  let rowNum = -1;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (String(r[idxId] || "") === String(patientId)) {
      if (idxUser >= 0 && userId) {
        if (String(r[idxUser] || "") !== String(userId)) throw new Error("Non autorizzato");
      }
      rowNum = i + 1;
      break;
    }
  }
  if (rowNum < 0) throw new Error("Paziente non trovato");

  sh.deleteRow(rowNum);
  return String(patientId);
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


// -------------------------------
// Sedute / Spostamenti (override calendario)
// -------------------------------
const SEDUTE_HEADERS = [
  "id",
  "utente_id",
  "paziente_id",
  "from_date",
  "from_time",
  "to_date",
  "to_time",
  "isDeleted",
  "createdAt",
  "updatedAt"
];

function ensureSeduteSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEETS.sedute);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.sedute);
  }
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();

  if (lastRow < 1 || lastCol < 1) {
    sh.getRange(1, 1, 1, SEDUTE_HEADERS.length).setValues([SEDUTE_HEADERS]);
    return sh;
  }

  // Se header non coerente, non forzare overwrite: aggiungi solo colonne mancanti in coda
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0] || [];
  const missing = SEDUTE_HEADERS.filter((h) => headers.indexOf(h) < 0);
  if (missing.length) {
    sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}

function normalizeTime_(t) {
  t = String(t || "").trim();
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t;
  const hh = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseYmd_(s) {
  s = String(s || "").trim().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10), d: parseInt(m[3], 10) };
}

function ymdToDate_(ymd) {
  if (Object.prototype.toString.call(ymd) === "[object Date]" && !isNaN(ymd.getTime())) {
    const d = new Date(ymd.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const norm = normalizeYmd_(ymd);
  const p = parseYmd_(norm);
  if (!p) return null;
  const d = new Date(p.y, p.m - 1, p.d);
  d.setHours(0, 0, 0, 0);
  return d;
}


function dateToYmd_(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}


function normalizeYmd_(v) {
  // Accepts Date objects, ISO strings (YYYY-MM-DD...), or other date-like strings.
  if (v === null || v === undefined || v === "") return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    return dateToYmd_(v);
  }
  const s = String(v).trim();
  const ymd = s.slice(0, 10);
  if (parseYmd_(ymd)) return ymd;

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    d.setHours(0, 0, 0, 0);
    return dateToYmd_(d);
  }
  return "";
}

function listMoves_(userId, yearStr, monthStr) {
  if (!userId) throw new Error("UserId richiesto");
  const year = parseInt(String(yearStr || "").trim(), 10);
  const month = parseInt(String(monthStr || "").trim(), 10); // 1..12
  if (!year || !month) return [];

  const start = new Date(year, month - 1, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, month, 0);
  end.setHours(0, 0, 0, 0);

  const sh = ensureSeduteSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0] || [];

  const idxUser = headers.indexOf("utente_id");
  const idxDel = headers.indexOf("isDeleted");

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;

    if (idxDel >= 0 && String(r[idxDel] || "").toLowerCase() === "true") continue;
    if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) continue;

    const obj = {};
    headers.forEach((h, j) => obj[h] = r[j]);

    // Normalize dates (Sheets may return Date objects)
    if (Object.prototype.hasOwnProperty.call(obj, "from_date")) obj.from_date = normalizeYmd_(obj.from_date);
    if (Object.prototype.hasOwnProperty.call(obj, "to_date")) obj.to_date = normalizeYmd_(obj.to_date);

    const fd = ymdToDate_(obj.from_date);
    const td = ymdToDate_(obj.to_date);

    const inMonth =
      (fd && fd.getTime() >= start.getTime() && fd.getTime() <= end.getTime()) ||
      (td && td.getTime() >= start.getTime() && td.getTime() <= end.getTime());

    if (!inMonth) continue;

    obj.from_time = normalizeTime_(obj.from_time);
    obj.to_time = normalizeTime_(obj.to_time);

    out.push(obj);
  }
  return out;
}

function getPatientRow_(userId, patientId) {
  const sh = sheet_(SHEETS.pazienti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) throw new Error("Nessun paziente");
  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxUser = headers.indexOf("utente_id");
  if (idxId < 0) throw new Error("Colonna id mancante");

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;
    if (String(r[idxId] || "") !== String(patientId)) continue;
    if (idxUser >= 0 && userId && String(r[idxUser] || "") !== String(userId)) throw new Error("Non autorizzato");

    const obj = {};
    headers.forEach((h, j) => obj[h] = r[j]);
    return { sh, headers, rowNum: i + 1, patient: obj };
  }
  throw new Error("Paziente non trovato");
}

function normDayLabel_(s) {
  s = String(s || "").trim().toUpperCase();
  // accetta "LUN", "LU", "MON" ecc. -> normalizza a 2 lettere italiane
  if (s.startsWith("LUN") || s === "MON") return "LU";
  if (s.startsWith("MAR") || s === "TUE") return "MA";
  if (s.startsWith("MER") || s === "WED") return "ME";
  if (s.startsWith("GIO") || s === "THU") return "GI";
  if (s.startsWith("VEN") || s === "FRI") return "VE";
  if (s.startsWith("SAB") || s === "SAT") return "SA";
  if (s.startsWith("DOM") || s === "SUN") return "DO";
  if (s === "LUNEDÌ" || s === "LUNEDI") return "LU";
  if (s === "MARTEDÌ" || s === "MARTEDI") return "MA";
  if (s === "MERCOLEDÌ" || s === "MERCOLEDI") return "ME";
  if (s === "GIOVEDÌ" || s === "GIOVEDI") return "GI";
  if (s === "VENERDÌ" || s === "VENERDI") return "VE";
  if (s === "SABATO") return "SA";
  if (s === "DOMENICA") return "DO";
  if (s === "LU" || s === "MA" || s === "ME" || s === "GI" || s === "VE" || s === "SA" || s === "DO") return s;
  return s;
}

function weekdayKey_(dayLabel) {
  // JS: 0=Sun..6=Sat
  const x = normDayLabel_(dayLabel);
  if (x === "DO") return 0;
  if (x === "LU") return 1;
  if (x === "MA") return 2;
  if (x === "ME") return 3;
  if (x === "GI") return 4;
  if (x === "VE") return 5;
  if (x === "SA") return 6;
  // numeric support: 1..7 (7=Sunday)
  if (/^\d+$/.test(String(dayLabel || "").trim())) {
    const n = parseInt(String(dayLabel || "").trim(), 10);
    if (n === 7) return 0;
    if (n >= 0 && n <= 6) return n;
    if (n >= 1 && n <= 6) return n;
  }
  return null;
}

function parseGiorniMap_(raw) {
  if (!raw) return {};
  try {
    if (typeof raw === "object") return raw;
    const s = String(raw || "").trim();
    if (!s) return {};
    if (s.startsWith("{") || s.startsWith("[")) {
      const obj = JSON.parse(s);
      return (obj && typeof obj === "object") ? obj : {};
    }
    return {};
  } catch (e) {
    return {};
  }
}

function normalizeTimeList_(v) {
  const out = [];
  if (v == null) return out;
  if (Array.isArray(v)) {
    v.forEach((x) => { const t = normalizeTime_(x); if (t && t !== "—") out.push(t); });
    return out;
  }
  const s = String(v || "").trim();
  if (!s) return out;
  if (s.includes(",")) {
    s.split(",").forEach((x) => { const t = normalizeTime_(x); if (t && t !== "—") out.push(t); });
    return out;
  }
  const t = normalizeTime_(s);
  if (t && t !== "—") out.push(t);
  return out;
}

function lastOccurrenceDateForPatient_(patient, movesForPatient) {
  const start = ymdToDate_(patient.data_inizio);
  const end0 = ymdToDate_(patient.data_fine);
  if (!start) return null;

  const moves = Array.isArray(movesForPatient) ? movesForPatient : [];
  let maxTo = null;

  moves.forEach((mv) => {
    const td = ymdToDate_(mv.to_date);
    if (td && (!maxTo || td.getTime() > maxTo.getTime())) maxTo = td;
  });

  // candidate end: max(original end, max to_date)
  let end = end0 || start;
  if (maxTo && maxTo.getTime() > end.getTime()) end = maxTo;

  // schedule map
  const map = parseGiorniMap_(patient.giorni_settimana || patient.giorni || "");
  const wkToTimes = {}; // wk -> times[]
  Object.keys(map || {}).forEach((k) => {
    const wk = weekdayKey_(k);
    if (wk == null) return;
    const times = normalizeTimeList_(map[k]);
    if (!times.length) return;
    wkToTimes[wk] = (wkToTimes[wk] || []).concat(times);
  });

  // moves sets
  const removed = {};
  const added = {};
  moves.forEach((mv) => {
    const fk = `${String(mv.from_date || "").slice(0, 10)}|${normalizeTime_(mv.from_time)}`;
    const tk = `${String(mv.to_date || "").slice(0, 10)}|${normalizeTime_(mv.to_time)}`;
    removed[fk] = true;
    added[tk] = true;
  });

  // scan backwards to find last day with at least one occurrence
  const cur = new Date(end);
  cur.setHours(0, 0, 0, 0);

  while (cur.getTime() >= start.getTime()) {
    const ymd = dateToYmd_(cur);

    // base occurrences for that day
    const wk = cur.getDay();
    const times = wkToTimes[wk] || [];
    let count = 0;
    times.forEach((t) => {
      const k = `${ymd}|${normalizeTime_(t)}`;
      if (!removed[k]) count += 1;
    });

    // added occurrences for that day
    // (any moved-to entry counts)
    Object.keys(added).forEach((k) => {
      if (k.startsWith(ymd + "|")) count += 1;
    });

    if (count > 0) return ymd;

    cur.setDate(cur.getDate() - 1);
  }
  return dateToYmd_(start);
}

function moveSession_(userId, pazienteId, fromDate, fromTime, toDate, toTime) {
  if (!userId) throw new Error("UserId richiesto");
  if (!pazienteId) throw new Error("Paziente richiesto");

  fromDate = normalizeYmd_(fromDate) || String(fromDate || "").slice(0, 10);
  toDate = normalizeYmd_(toDate) || String(toDate || "").slice(0, 10);
  fromTime = normalizeTime_(fromTime);
  toTime = normalizeTime_(toTime);

  if (!parseYmd_(fromDate) || !parseYmd_(toDate)) throw new Error("Data non valida");
  if (!fromTime || !toTime) throw new Error("Ora non valida");

  const sh = ensureSeduteSheet_();
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const col = (h) => headers.indexOf(h) + 1;

  const idxId = headers.indexOf("id");
  const idxUser = headers.indexOf("utente_id");
  const idxPid = headers.indexOf("paziente_id");
  const idxFromD = headers.indexOf("from_date");
  const idxFromT = headers.indexOf("from_time");
  const idxDel = headers.indexOf("isDeleted");

  const now = now_();
  let rowNum = -1;

  // Se la cella che stai spostando è già il risultato di uno spostamento precedente,
  // allora "riporta indietro" la from al valore originale e sovrascrivi quel record.
  // Questo evita catene e duplicazioni (A->B, B->C).
  try {
    const idxToD = headers.indexOf("to_date");
    const idxToT = headers.indexOf("to_time");
    if (idxToD >= 0 && idxToT >= 0) {
      for (let i = 1; i < values.length; i++) {
        const r = values[i];
        if (!r) continue;
        if (idxDel >= 0 && String(r[idxDel] || "").toLowerCase() === "true") continue;
        if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) continue;
        if (idxPid >= 0 && String(r[idxPid] || "") !== String(pazienteId)) continue;

        const rToD = normalizeYmd_(r[idxToD]);
        const rToT = normalizeTime_(r[idxToT]);
        if (rToD === fromDate && rToT === fromTime) {
          // questa è la mossa precedente che ha portato la seduta qui
          if (idxFromD >= 0) fromDate = normalizeYmd_(r[idxFromD]) || fromDate;
          if (idxFromT >= 0) fromTime = normalizeTime_(r[idxFromT]) || fromTime;
          rowNum = i + 1; // aggiorna direttamente questa riga
          break;
        }
      }
    }
  } catch (e) {}


  // upsert: stessa seduta (paziente + from_date + from_time)
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;
    if (idxDel >= 0 && String(r[idxDel] || "").toLowerCase() === "true") continue;
    if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) continue;
    if (idxPid >= 0 && String(r[idxPid] || "") !== String(pazienteId)) continue;
    if (idxFromD >= 0 && normalizeYmd_(r[idxFromD]) !== fromDate) continue;
    if (idxFromT >= 0 && normalizeTime_(r[idxFromT]) !== fromTime) continue;
    rowNum = i + 1;
    break;
  }

  
  // Cleanup: se esistono duplicati per la stessa seduta (paziente + from_date + from_time),
  // marca come deleted tutte le righe extra (mantieni solo rowNum).
  try {
    if (idxDel >= 0 && idxPid >= 0 && idxFromD >= 0 && idxFromT >= 0) {
      for (let i = 1; i < values.length; i++) {
        const r = values[i];
        if (!r) continue;
        const rn = i + 1;
        if (rn === rowNum) continue;
        if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) continue;
        if (String(r[idxPid] || "") !== String(pazienteId)) continue;
        if (normalizeYmd_(r[idxFromD]) !== fromDate) continue;
        if (normalizeTime_(r[idxFromT]) !== fromTime) continue;
        // elimina duplicato
        sh.getRange(rn, col("isDeleted")).setValue(true);
        if (col("updatedAt") > 0) sh.getRange(rn, col("updatedAt")).setValue(now);
      }
    }
  } catch (e) {}

if (rowNum > 0) {
    if (col("to_date") > 0) sh.getRange(rowNum, col("to_date")).setValue(toDate);
    if (col("to_time") > 0) sh.getRange(rowNum, col("to_time")).setValue(toTime);
    if (col("updatedAt") > 0) sh.getRange(rowNum, col("updatedAt")).setValue(now);
  } else {
    const row = new Array(headers.length).fill("");
    const id = uuid_();
    if (col("id") > 0) row[col("id") - 1] = id;
    if (col("utente_id") > 0) row[col("utente_id") - 1] = String(userId);
    if (col("paziente_id") > 0) row[col("paziente_id") - 1] = String(pazienteId);
    if (col("from_date") > 0) row[col("from_date") - 1] = fromDate;
    if (col("from_time") > 0) row[col("from_time") - 1] = fromTime;
    if (col("to_date") > 0) row[col("to_date") - 1] = toDate;
    if (col("to_time") > 0) row[col("to_time") - 1] = toTime;
    if (col("isDeleted") > 0) row[col("isDeleted") - 1] = false;
    if (col("createdAt") > 0) row[col("createdAt") - 1] = now;
    if (col("updatedAt") > 0) row[col("updatedAt") - 1] = now;
    sh.appendRow(row);
  }

  // aggiorna scadenza (data_fine) del paziente in base alle sedute effettive
  const pr = getPatientRow_(userId, pazienteId);
  const p = pr.patient || {};

  // carica tutte le mosse di questo paziente
  const allMoves = [];
  const v2 = sh.getDataRange().getValues();
  const h2 = v2[0] || [];
  const iDel2 = h2.indexOf("isDeleted");
  const iUser2 = h2.indexOf("utente_id");
  const iPid2 = h2.indexOf("paziente_id");

  for (let i = 1; i < v2.length; i++) {
    const r = v2[i];
    if (!r) continue;
    if (iDel2 >= 0 && String(r[iDel2] || "").toLowerCase() === "true") continue;
    if (iUser2 >= 0 && String(r[iUser2] || "") !== String(userId)) continue;
    if (iPid2 >= 0 && String(r[iPid2] || "") !== String(pazienteId)) continue;
    const obj = {};
    h2.forEach((hh, j) => obj[hh] = r[j]);
    allMoves.push(obj);
  }

  const newEnd = lastOccurrenceDateForPatient_(p, allMoves);
  if (newEnd) {
    const cEnd = pr.headers.indexOf("data_fine") + 1;
    if (cEnd > 0) {
      pr.sh.getRange(pr.rowNum, cEnd).setValue(newEnd);
    }
    const cUpd = pr.headers.indexOf("updatedAt") + 1;
    if (cUpd > 0) pr.sh.getRange(pr.rowNum, cUpd).setValue(now);
  }

  return { paziente_id: String(pazienteId), from_date: fromDate, from_time: fromTime, to_date: toDate, to_time: toTime, data_fine: newEnd || "" };
}



function deleteSession_(userId, pazienteId, fromDate, fromTime) {
  if (!userId) throw new Error("UserId richiesto");
  if (!pazienteId) throw new Error("Paziente richiesto");

  fromDate = normalizeYmd_(fromDate) || String(fromDate || "").slice(0, 10);
  fromTime = normalizeTime_(fromTime);

  if (!parseYmd_(fromDate)) throw new Error("Data non valida");
  if (!fromTime) throw new Error("Ora non valida");

  const sh = ensureSeduteSheet_();
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const col = (h) => headers.indexOf(h) + 1;

  const idxUser = headers.indexOf("utente_id");
  const idxPid = headers.indexOf("paziente_id");
  const idxFromD = headers.indexOf("from_date");
  const idxFromT = headers.indexOf("from_time");
  const idxToD = headers.indexOf("to_date");
  const idxToT = headers.indexOf("to_time");
  const idxDel = headers.indexOf("isDeleted");

  const now = now_();
  let rowNum = -1;

  // Se la cella eliminata è il risultato di uno spostamento precedente,
  // allora riporta indietro la from al valore originale e sovrascrivi quel record.
  try {
    if (idxToD >= 0 && idxToT >= 0) {
      for (let i = 1; i < values.length; i++) {
        const r = values[i];
        if (!r) continue;
        if (idxDel >= 0 && String(r[idxDel] || "").toLowerCase() === "true") continue;
        if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) continue;
        if (idxPid >= 0 && String(r[idxPid] || "") !== String(pazienteId)) continue;

        const rToD = normalizeYmd_(r[idxToD]);
        const rToT = normalizeTime_(r[idxToT]);
        if (rToD === fromDate && rToT === fromTime) {
          if (idxFromD >= 0) fromDate = normalizeYmd_(r[idxFromD]) || fromDate;
          if (idxFromT >= 0) fromTime = normalizeTime_(r[idxFromT]) || fromTime;
          rowNum = i + 1;
          break;
        }
      }
    }
  } catch (e) {}

  // upsert: stessa seduta (paziente + from_date + from_time)
  if (rowNum < 0) {
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      if (!r) continue;
      if (idxDel >= 0 && String(r[idxDel] || "").toLowerCase() === "true") continue;
      if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) continue;
      if (idxPid >= 0 && String(r[idxPid] || "") !== String(pazienteId)) continue;
      if (idxFromD >= 0 && normalizeYmd_(r[idxFromD]) !== fromDate) continue;
      if (idxFromT >= 0 && normalizeTime_(r[idxFromT]) !== fromTime) continue;
      rowNum = i + 1;
      break;
    }
  }

  // Cleanup duplicati
  try {
    if (idxDel >= 0 && idxPid >= 0 && idxFromD >= 0 && idxFromT >= 0) {
      for (let i = 1; i < values.length; i++) {
        const r = values[i];
        if (!r) continue;
        const rn = i + 1;
        if (rn === rowNum) continue;
        if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) continue;
        if (String(r[idxPid] || "") !== String(pazienteId)) continue;
        if (normalizeYmd_(r[idxFromD]) !== fromDate) continue;
        if (normalizeTime_(r[idxFromT]) !== fromTime) continue;
        sh.getRange(rn, col("isDeleted")).setValue(true);
        if (col("updatedAt") > 0) sh.getRange(rn, col("updatedAt")).setValue(now);
      }
    }
  } catch (e) {}

  if (rowNum > 0) {
    if (col("to_date") > 0) sh.getRange(rowNum, col("to_date")).setValue("");
    if (col("to_time") > 0) sh.getRange(rowNum, col("to_time")).setValue("");
    if (col("updatedAt") > 0) sh.getRange(rowNum, col("updatedAt")).setValue(now);
  } else {
    const row = new Array(headers.length).fill("");
    const id = uuid_();
    if (col("id") > 0) row[col("id") - 1] = id;
    if (col("utente_id") > 0) row[col("utente_id") - 1] = String(userId);
    if (col("paziente_id") > 0) row[col("paziente_id") - 1] = String(pazienteId);
    if (col("from_date") > 0) row[col("from_date") - 1] = fromDate;
    if (col("from_time") > 0) row[col("from_time") - 1] = fromTime;
    if (col("to_date") > 0) row[col("to_date") - 1] = "";
    if (col("to_time") > 0) row[col("to_time") - 1] = "";
    if (col("isDeleted") > 0) row[col("isDeleted") - 1] = false;
    if (col("createdAt") > 0) row[col("createdAt") - 1] = now;
    if (col("updatedAt") > 0) row[col("updatedAt") - 1] = now;
    sh.appendRow(row);
  }

  return { userId: String(userId), paziente_id: String(pazienteId), from_date: fromDate, from_time: fromTime, to_date: "", to_time: "", updatedAt: now };
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