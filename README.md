# Montalto PMS (AMF)

PWA ottimizzata per iOS, deploy su GitHub Pages.

## Funzioni
- Home con icone (Pazienti / Calendario / Statistiche)
- Accesso + pagina Impostazioni (richiede login)
- Collegamento a Google Sheet tramite Google Apps Script (Web App)

## Deploy backend (Google Apps Script)
1) Apri `Code.gs` in Apps Script
2) Deploy come **Web App** e copia l'URL `/exec`
3) Incollalo nell'app (popup “Collegamento database”) oppure in `config.js`

## Struttura
- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `service-worker.js`
- `manifest.json`
- `version.json`
- `assets/`
- `Code.gs`
