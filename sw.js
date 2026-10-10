/* Offline shell for Brandon Valley Lunch. Live data (menus, events, news) is
 * cached by the app itself in localStorage; this only keeps the shell and
 * fonts so the app opens without a connection. */
const CACHE = "sfp-shell-v1";
const FONT_CACHE = "sfp-fonts-v1";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "data.js",
  "app.js",
  "shared.js",
  "handbooks.js",
  "i18n.js",
  "handbooks-es.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "favicon.ico",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE && k !== "sfp-local").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") {
    e.respondWith(
      caches.match(e.request).then((cached) =>
        cached || fetch(e.request).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(FONT_CACHE).then((c) => c.put(e.request, copy)); }
          return res;
        })
      )
    );
    return;
  }
  // Local preview: always the network, so edits show on the next load.
  if (self.location.hostname === "localhost") return;
  // Never intercept the relays or third-party APIs: the app manages those.
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/.netlify/")) return;
  if (e.request.method !== "GET") return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Notifications. The server sends student ids, never names; the names this
// phone uses are kept in a small local cache the app writes.
async function localNames() {
  try {
    const res = await (await caches.open("sfp-local")).match("/__names");
    return res ? await res.json() : {};
  } catch { return {}; }
}

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    let body = data.body || "";
    if (Array.isArray(data.lines)) {
      const names = await localNames();
      body = data.lines.map((l) => `${names[l.kid] || "Your student"}: ${l.text}`).join("\n");
    }
    await self.registration.showNotification(data.title || "Brandon Valley Lunch", {
      body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: data.tag || "sfp",
      data: { url: data.url || "./" },
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./", self.location.href).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) { open.navigate(target).catch(() => {}); return open.focus(); }
    return clients.openWindow(target);
  }));
});
