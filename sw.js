// Работа без интернета: файлы тренажёра кладём в кэш браузера.
const CACHE = "trainer-202610102227";
const FILES = ["./", "index.html", "data.js", "app.js", "spar.js", "arrows.js", "style.css", "manifest.webmanifest", "icon-192.png", "libs/chess.js", "libs/chessground.min.js", "libs/chessground.base.css", "libs/chessground.brown.css", "libs/chessground.cburnett.css", "libs/stockfish/stockfish.js", "libs/stockfish/stockfish.wasm"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// сначала сеть (свежая версия), без сети — из кэша
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
