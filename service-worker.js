/* Service Worker - Montalto Fisio (Build 1.003) */
const BUILD = "1.003";
const CACHE_NAME = "montalto-cache-" + BUILD;

const CORE_ASSETS = [
  "./",
  "./index.html?v=" + BUILD,
  "./styles.css?v=" + BUILD,
  "./app.js?v=" + BUILD,
  "./config.js?v=" + BUILD,
  "./manifest.json?v=" + BUILD,
  "./version.json",
  "./assets/logo.jpg?v=" + BUILD,
  "./assets/bg-montalto.png?v=" + BUILD,
  "./assets/icons/icon-192.png?v=" + BUILD,
  "./assets/icons/icon-512.png?v=" + BUILD,
  "./assets/icons/favicon-16.png?v=" + BUILD,
  "./assets/icons/favicon-32.png?v=" + BUILD,
  "./assets/icons/apple-touch-icon.png?v=" + BUILD,
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isApiRequest(url) {
  // Google Apps Script endpoint (non cache)
  return url.origin.includes("script.google.com") || url.origin.includes("googleusercontent.com");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;

  if (isApiRequest(url)) {
    // no cache for API
    event.respondWith(fetch(req));
    return;
  }

  const isNav = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (isNav) {
    // network-first for navigation (iOS update friendly)
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put("./index.html?v=" + BUILD, fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cached = await caches.match("./index.html?v=" + BUILD);
        return cached || caches.match("./") || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // stale-while-revalidate for assets
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req).then((fresh) => {
      caches.open(CACHE_NAME).then((cache) => cache.put(req, fresh.clone()).catch(() => {}));
      return fresh;
    }).catch(() => cached);

    return cached || fetchPromise;
  })());
});
