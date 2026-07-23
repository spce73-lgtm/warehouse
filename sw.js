// اول شبکه، بعد کش (برای اینکه به‌روزرسانی‌های آینده همیشه فوری اعمال شود).
// نسخه‌ی کش عوض شد چون معماری اپ کامل تغییر کرد (بدون اسکنر داخلی).
var CACHE_NAME = 'wh-scanner-shell-v3';
var SHELL_FILES = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL_FILES); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var url = event.request.url;
  // درخواست‌های API (شامل action=...) هرگز کش نمی‌شوند، همیشه مستقیم از شبکه
  if (url.indexOf('action=') !== -1 || event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).then(function (networkResponse) {
      caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, networkResponse.clone()); });
      return networkResponse;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
