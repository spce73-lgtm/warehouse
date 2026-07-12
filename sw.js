// یک سرویس‌ورکر بسیار سبک: فقط پوسته‌ی برنامه (HTML/JS/CSS) را کش می‌کند تا
// باز شدن اپ سریع باشد. جستجوی کالا و ثبت شمارش همیشه نیاز به اینترنت دارند
// و از کش عبور نمی‌کنند.
var CACHE_NAME = 'wh-scanner-shell-v1';
var SHELL_FILES = ['./', './index.html', './app.js', './manifest.json'];

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
  // درخواست‌های API (شامل action=...) هرگز کش نمی‌شوند، همیشه از شبکه واقعی می‌آیند
  if (url.indexOf('action=') !== -1 || event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});
