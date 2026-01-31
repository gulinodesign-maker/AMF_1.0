/* Montalto Fisio Config - Build 1.003 */
const API_BASE_URL_DEFAULT = "https://script.google.com/macros/s/AKfycbwQmBBeQxESG2sNn5z3szkhHfl1Mwms2B0g22ddAw-ta1sb3vQ0wIojtda2_rYpZcnD/exec"; // Incolla qui l'URL di deploy del tuo Google Apps Script (es. https://script.google.com/macros/s/.../exec)
const API_KEY = "montalto2026";

function getApiBaseUrl() {
  return localStorage.getItem("API_BASE_URL") || API_BASE_URL_DEFAULT;
}
function setApiBaseUrl(url) {
  localStorage.setItem("API_BASE_URL", String(url||"").trim());
}
