// Service Worker — کش پوسته‌ی برنامه (App Shell)
// هدف: باز شدن خودِ اپ وقتی اینترنت قطع است (مشکل فعلی: بدون این فایل، مرورگر گوشی حتی
// قبل از اجرای app.js صفحه‌ی «دسترسی به اینترنت موجود نیست» خودش را نشان می‌دهد).
// این فایل فقط فایل‌های استاتیکِ همین ریپو (HTML/JS/CSS/آیکون) را کش می‌کند؛
// هیچ درخواستی به Apps Script (JSONP، دامنه‌ی دیگر) را کش یا رهگیری نمی‌کند —
// آن درخواست‌ها دقیقاً طبق منطق موجود در app.js (isOnline + Sync Queue) مدیریت می‌شوند،
// و توکن/نشست کاربر هم فقط در localStorage است، نه در این کش.
// >>> افزوده شد: نسخه‌ی کش به v4 ارتقا یافت — این‌بار علت واقعیِ تکرارِ باگ ورود پیدا شد:
// cache.add(url) با یک رشته‌ی ساده، کشِ HTTP معمولیِ مرورگر را دور نمی‌زند؛ یعنی حتی با تغییر
// CACHE_NAME (v2→v3)، مرورگر می‌توانست همان نسخه‌ی قدیمیِ app.js را از کش HTTP خودش (نه کش
// این Service Worker) بردارد و در کش تازه‌ی v3 بگذارد — باگ را «تازه‌سازی» می‌کرد ولی رفع
// نمی‌کرد. اکنون هر فایل با {cache:'reload'} درخواست می‌شود که کش HTTP را کاملاً دور می‌زند.
var CACHE_NAME = 'wh-scanner-shell-v4';
// <<< پایان بخش افزوده‌شده
var APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icon-192.png'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // >>> تغییر یافت: هر فایل با Request({cache:'reload'}) گرفته می‌شود، نه رشته‌ی ساده —
      // این کش HTTP معمولیِ مرورگر را دور می‌زند و تضمین می‌کند نسخه‌ی واقعاً تازه از شبکه
      // می‌آید. نبودِ یک فایل اختیاری (مثلاً آیکون) هنوز کل نصب را خراب نمی‌کند.
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
      // <<< پایان بخش افزوده‌شده
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // فقط GET؛ بقیه‌ی درخواست‌ها دست‌نخورده به شبکه می‌روند

  var url = new URL(req.url);
  // فقط درخواست‌های هم‌مبدأ (همین گیت‌هاب‌پیجز)؛ هر درخواست دیگری (از جمله JSONP به
  // script.google.com برای لاگین/جست‌وجو/ثبت شمارش) دست‌نخورده به شبکه می‌رود
  if (url.origin !== self.location.origin) return;

  // کش-اول + به‌روزرسانی در پس‌زمینه (stale-while-revalidate)؛ ignoreSearch چون لینک‌های
  // کیوآرکد با ?id=... باز می‌شوند و باید همان index.json کش‌شده را برگردانند
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      var networkFetch = fetch(req).then(function (res) {
        if (res && res.ok) {
          var resClone = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, resClone); });
        }
        return res;
      }).catch(function () { return cached; });

      return cached || networkFetch;
    })
  );
});
