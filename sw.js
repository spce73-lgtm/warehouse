// نسخه‌ی اصلاح‌شده: به‌جای «اول کش»، حالا «اول شبکه» است — یعنی هر بار که
// اینترنت وصل باشد، همیشه آخرین نسخه‌ی index.html و app.js از سرور گرفته
// می‌شود؛ کش فقط برای زمانی است که اینترنت قطع باشد (حالت آفلاین).
// همچنین نسخه‌ی کش عوض شد تا کش قدیمی و گیرکرده‌ی قبلی کامل پاک شود.
var CACHE_NAME = 'wh-scanner-shell-v2';
var SHELL_FILES = ['./', './index.html', './app.js', './style.css', './manifest.json'];

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
      // آخرین نسخه از شبکه رسید؛ همان را نشان بده و نسخه‌ی کش را هم به‌روز کن
      caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, networkResponse.clone()); });
      return networkResponse;
    }).catch(function () {
      // اینترنت قطع بود؛ به‌عنوان آخرین راه‌حل از کش قدیمی استفاده کن
      return caches.match(event.request);
    })
  );
});
