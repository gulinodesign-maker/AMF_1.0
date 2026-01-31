/* AMF_1.018 */
const CACHE_NAME = "amf-cache-1.018";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./app.js",
  "./manifest.json",
  "./version.json",
  "./assets/bg-montalto.png",
  "./assets/logo.jpg",
  "./assets/pwa_gradient.png",
  "./assets/apple-touch-icon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

function isApiRequest(request) {
  const url = new URL(request.url);

  // Evita cache per Google Apps Script Web App e chiamate con action=...
  const host = url.hostname || "";
  if (host.includes("script.google.com") || host.includes("script.googleusercontent.com")) return true;
  if (url.searchParams.has("action")) return true;
  if (url.pathname.includes("/exec")) return true;

  return false;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (isApiRequest(req)) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  const url = new URL(req.url);

  // Network-first per navigazioni e index.html (iOS update)
  const isNav = req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname === "/" || url.pathname.endsWith("/");
  if (isNav) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match("./index.html");
        return cached || Response.error();
      }
    })());
    return;
  }

  // Cache-first per static assets
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});
