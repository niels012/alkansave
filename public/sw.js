// AlkanSave service worker: lets the installed app open without internet.
// - The page: network first, falling back to the saved copy when offline.
// - Built files (/assets/, hashed names) and icons: saved copy first; they never change.
// - Google Fonts: saved copy first.
// Firebase traffic goes to other domains and is left alone; Firestore keeps its own offline copy of the data.
const SHELL = "alkansave-shell-v1";
const FONTS = "alkansave-fonts-v1";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const res = await fetch("/", { cache: "no-cache" });
    const html = await res.clone().text();
    await cache.put("/", res);
    // Save the files the page needs so the very next launch works offline.
    const urls = [...html.matchAll(/(?:src|href)="(\/(?:assets|icons)\/[^"]+|\/manifest\.webmanifest)"/g)].map(m => m[1]);
    await cache.addAll([...new Set(urls)]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("alkansave-") && key !== SHELL && key !== FONTS) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && url.pathname === "/") (await caches.open(SHELL)).put("/", res.clone());
        return res;
      } catch {
        return (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  if (url.origin === self.location.origin && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/"))) {
    event.respondWith(cacheFirst(SHELL, req));
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(FONTS, req));
  }
});
