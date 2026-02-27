/* AMF_1.140 */
const CACHE_NAME = "AMF_1.140";

// Core files always expected in the ZIP/repo
const CORE_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=1.140",
  "./config.js",
  "./app.js?v=1.140",
  "./manifest.json",
  "./version.json"
];

// Optional assets (cache if present, but do not fail install if missing)
const OPTIONAL_SHELL = [
  "./assets/logo.jpg",
  "./assets/apple-touch-icon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/favicon-16.png",
  "./assets/favicon-32.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Cache core shell (must succeed as much as possible)
    try {
      await cache.addAll(CORE_SHELL);
    } catch (_) {
      // Fallback: best-effort individual caching
      await Promise.allSettled(CORE_SHELL.map(async (u) => {
        try {
          const r = await fetch(u, { cache: "reload" });
          if (r && r.ok) await cache.put(u, r);
        } catch (_) {}
      }));
    }

    // Cache optional assets (best-effort, never block install)
    await Promise.allSettled(OPTIONAL_SHELL.map(async (u) => {
      try {
        const r = await fetch(u, { cache: "reload" });
        if (r && r.ok) await cache.put(u, r);
      } catch (_) {}
    }));
  })());
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

  // No-cache for API calls (Google Apps Script and action-based calls)
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

  // Network-first for navigations and index.html (iOS update)
  const isNav =
    req.mode === "navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname === "/" ||
    url.pathname.endsWith("/");

  if (isNav) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        try { await cache.put("./index.html", fresh.clone()); } catch (_) {}
        return fresh;
      } catch (e) {
        const cached = await caches.match("./index.html");
        return cached || Response.error();
      }
    })());
    return;
  }

  // Cache-first for static assets (best-effort)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      try { await cache.put(req, fresh.clone()); } catch (_) {}
      return fresh;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});
