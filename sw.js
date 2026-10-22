// Caches the app so it opens with no connection. Online it always asks the
// server first, so a new upload shows up on the next launch; the cached copy
// is used when the network is down or too slow (gym basements).
const CACHE = "logbook-v4";
const ASSETS = ["./", "index.html", "md.js", "app.js", "manifest.webmanifest", "icon-180.png", "icon-512.png"];
const NETWORK_TIMEOUT = 4000;

self.addEventListener("install", e => {
  // cache: "reload" skips the browser's HTTP cache, which can still hold the old files
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const fromNetwork = req => new Promise((resolve, reject) => {
  const timer = setTimeout(reject, NETWORK_TIMEOUT);
  fetch(req, { cache: "no-cache" }).then(res => { clearTimeout(timer); resolve(res); }, reject);
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fromNetwork(e.request)
    .then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    })
    .catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || fetch(e.request)));
});
