// AlkanSave service worker: lets the installed app open without internet.
// Built into dist/sw.js by vite.config.js, which fills in the list of built files and a version.
// A new version is produced whenever the app's files change, so each deploy refreshes the saved copy.
// - The page: network first, falling back to the saved copy when offline.
// - Built files (/assets/, hashed names) and icons: saved copy first; they never change.
// - Google Fonts: saved copy first.
// Firebase traffic goes to other domains and is left alone; Firestore keeps its own offline copy of the data.
const VERSION = "__VERSION__";
const BUILT_FILES = __PRECACHE__;
const STATIC_FILES = ["/manifest.webmanifest", "/icons/mark.png", "/icons/favicon-32.png", "/icons/favicon-64.png", "/icons/apple-touch-icon.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/splash-light.webp", "/icons/splash-dark.webp"];
const SHELL = `alkansave-shell-${VERSION}`;
const FONTS = "alkansave-fonts-v1";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.put("/", await fetch("/", { cache: "no-cache" }));
    // Every built file, including the Firebase code that loads after the first screen.
    await cache.addAll([...BUILT_FILES, ...STATIC_FILES]);
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

// ---------- Bill reminders ----------
// api/reminders.js sends data-only Firebase Cloud Messaging pushes; this shows them as notifications.
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  const data = payload.data || payload;
  const shown = payload.notification || {};
  event.waitUntil(self.registration.showNotification(data.title || shown.title || "AlkanSave", {
    body: data.body || shown.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon-64.png",
    tag: data.tag || "alkansave-bills",
    data: { url: data.url || "/" }
  }));
});

// Tapping a reminder opens AlkanSave (or brings it forward) on the Budget tab.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      await w.focus();
      if ("navigate" in w) await w.navigate(url).catch(() => {});
      return;
    }
    await self.clients.openWindow(url);
  })());
});
