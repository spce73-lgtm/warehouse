// Service Worker — کش پوسته‌ی برنامه (App Shell)
// هدف: باز شدن خودِ اپ وقتی اینترنت قطع است (مشکل فعلی: بدون این فایل، مرورگر گوشی حتی
// قبل از اجرای app.js صفحه‌ی «دسترسی به اینترنت موجود نیست» خودش را نشان می‌دهد).
// این فایل فقط فایل‌های استاتیکِ همین ریپو (HTML/JS/CSS/آیکون) را کش می‌کند؛
// هیچ درخواستی به Apps Script (JSONP، دامنه‌ی دیگر) را کش یا رهگیری نمی‌کند —
// آن درخواست‌ها دقیقاً طبق منطق موجود در app.js (isOnline + Sync Queue) مدیریت می‌شوند،
// و توکن/نشست کاربر هم فقط در localStorage است، نه در این کش.
// >>> افزوده شد: نسخه‌ی کش به v4 ارتقا یافت — علت این‌بار بازطراحی کامل هدر/ناوبری پایین در
// index.html/style.css/app.js بود. بدون این تغییر نام کش، کاربرانی که نسخه‌ی قبلی (v3، هدر و
// کارت‌های قدیمی) را از قبل به‌عنوان PWA نصب کرده‌اند، همچنان index.html/style.css کهنه را از
// کش می‌بینند (هدر تیره‌ی جدید، دکمه‌ی همگام‌سازی و ناوبری پایین اصلاً رندر نمی‌شوند) درحالی‌که
// app.js تازه از شبکه گرفته می‌شود و بر اساس ساختار HTML جدید رندر می‌کند — دقیقاً همان
// حالت ترکیبیِ «هدر/ناوبری قدیمی + کارت‌های جدید» که در گزارش کاربر دیده شد. تغییر نام کش باعث
// می‌شود activate handler زیر بلافاصله کش قبلی (v3) را پاک کند و همه‌ی فایل‌های پوسته از شبکه
// تازه گرفته شوند.
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
      // هر فایل جدا کش می‌شود؛ نبودِ یک فایل اختیاری (مثلاً آیکون) نباید کل نصب را خراب کند
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
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
