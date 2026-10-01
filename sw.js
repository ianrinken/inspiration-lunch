/* Offline shell for Brandon Valley Lunch. Menu data is cached by the app in
 * localStorage; the service worker handles the static shell and fonts. */
const CACHE = "bvl-shell-v37";
const FONT_CACHE = "bvl-fonts-v1";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "grades.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "favicon.ico",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Google Fonts: cache-first so the display font works offline.
  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") {
    e.respondWith(
      caches.match(e.request).then((cached) =>
        cached ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(FONT_CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
      )
    );
    return;
  }

  // Never intercept the menu API or the events function — the app manages
  // its own data caches for both.
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/.netlify/")) return;

  // Stale-while-revalidate for the shell.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Evening heads-up: the server sends {title, body, url}.
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || "Brandon Valley Lunch", {
    body: data.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "bvl-digest",
    data: { url: data.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || "./", self.location.href).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : clients.openWindow(target);
  }));
});
