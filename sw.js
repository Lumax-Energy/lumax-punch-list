/* ============================================================================
   Lumax Punch List service worker.
   The whole app is one HTML file, so caching it is enough to open the app
   from the home-screen icon on a site with no signal. Network first: an
   inspector with signal always gets the newest version, and a developer on
   localhost never sees a stale copy. The cached copy is only the fallback.
   Inspection data lives in IndexedDB, not here.
   ========================================================================== */
"use strict";

// Keep in step with Lumax.version in index.html. A new name makes the next
// activate step delete the old cache.
const CACHE = "lumax-punchlist-v2.0.4";
const PREFIX = "lumax-punchlist-";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png",
];
// A weak signal on site can hang for a long time; after this, use the saved copy.
const TIMEOUT_MS = 4000;

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // "reload" skips the browser's HTTP cache so the first copy is fresh.
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  // Only our own old caches: other apps on the same github.io origin share
  // the cache list.
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf(PREFIX) === 0 && k !== CACHE;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;                       // never cache writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // never cache other sites
  if (url.href.indexOf(self.registration.scope) !== 0) return;
  const isNav = req.mode === "navigate";
  // One entry per page, whatever query string or #hash it was opened with.
  const key = isNav ? url.origin + url.pathname : req;
  e.respondWith(networkFirst(e, key, isNav));
});

function fromCache(key, isNav) {
  return caches.open(CACHE).then(function (c) {
    return c.match(key).then(function (hit) {
      if (hit || !isNav) return hit;
      // Opened by another URL inside the app's folder: the app is index.html.
      return c.match("./index.html").then(function (h) { return h || c.match("./"); });
    });
  });
}

function networkFirst(e, key, isNav) {
  let saving = Promise.resolve();
  // "no-cache" revalidates with the server, so the browser's HTTP cache
  // cannot hand back an old version either.
  const network = fetch(e.request, { cache: "no-cache" }).then(function (res) {
    if (res.ok && res.type === "basic") {
      const copy = res.clone();
      saving = caches.open(CACHE).then(function (c) { return c.put(key, copy); }).catch(function () { });
    }
    return res;
  });
  // Let the cache refresh finish even if the saved copy answered first.
  e.waitUntil(network.then(function () { return saving; }, function () { }));

  return new Promise(function (resolve) {
    let done = false;
    const finish = function (r) { if (!done) { done = true; resolve(r); } };
    const timer = setTimeout(function () {
      fromCache(key, isNav).then(function (hit) { if (hit) finish(hit); });
    }, TIMEOUT_MS);
    network.then(function (res) {
      clearTimeout(timer);
      if (res.ok) { finish(res); return; }
      // A server error while a good copy is saved: open the saved copy.
      caches.open(CACHE).then(function (c) { return c.match(key); })
        .then(function (hit) { finish(hit || res); }, function () { finish(res); });
    }, function () {
      clearTimeout(timer);
      fromCache(key, isNav).then(function (hit) { finish(hit || Response.error()); },
        function () { finish(Response.error()); });
    });
  });
}
