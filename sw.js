// اول شبکه، بعد کش (برای اینکه به‌روزرسانی‌های آینده همیشه فوری اعمال شود).
// نسخه‌ی کش عوض شد: رفع باگِ «ورود آفلاین مسدود می‌شود».
// >>> افزوده شد: علت واقعی مسدود شدن ورودِ آفلاین: cache.addAll در نصب، اگر فقط یکی از
// فایل‌های SHELL_FILES (مثلاً manifest.json) در دسترس نباشد/۴۰۴ بدهد، کل addAll رد می‌شود و
// هیچ فایلی کش نمی‌شود — یعنی SW نصب می‌شد ولی عملاً هیچ‌وقت چیزی برای آفلاین نداشت.
// این نسخه هر فایل را جدا کش می‌کند تا نبودِ یک فایل، بقیه را خراب نکند. بقیه‌ی منطق
// (اول شبکه/کش، عبور کامل درخواست‌های action=... به Apps Script) دقیقاً مثل قبل حفظ شده.
// <<< پایان بخش افزوده‌شده
var CACHE_NAME = 'wh-scanner-shell-v5';
var SHELL_FILES = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // >>> تغییر یافت: به‌جای cache.addAll(SHELL_FILES) که با شکستِ یک فایل کل نصب را
      // خراب می‌کرد، هر فایل جدا و مقاوم در برابر خطا کش می‌شود.
      return Promise.all(SHELL_FILES.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
      // <<< پایان تغییر
    })
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
  // درخواست‌های API (شامل action=...) هرگز کش نمی‌شوند، همیشه مستقیم از شبکه — دست‌نخورده
  if (url.indexOf('action=') !== -1 || event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).then(function (networkResponse) {
      caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, networkResponse.clone()); });
      return networkResponse;
    }).catch(function () {
      // >>> افزوده شد: ignoreSearch — لینک‌های کیوآرکد با ?id=... باز می‌شوند؛ بدون این گزینه،
      // در حالت آفلاین با کوئری‌استرینگ هیچ تطبیقی با index.html کش‌شده پیدا نمی‌شد
      return caches.match(event.request, { ignoreSearch: true });
      // <<< پایان بخش افزوده‌شده
    })
  );
});
