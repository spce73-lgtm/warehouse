// Service Worker — کش پوسته‌ی برنامه (App Shell)
// هدف: باز شدن خودِ اپ وقتی اینترنت قطع است (مشکل فعلی: بدون این فایل، مرورگر گوشی حتی
// قبل از اجرای app.js صفحه‌ی «دسترسی به اینترنت موجود نیست» خودش را نشان می‌دهد).
// این فایل فقط فایل‌های استاتیکِ همین ریپو (HTML/JS/CSS/آیکون) را کش می‌کند؛
// هیچ درخواستی به Apps Script (JSONP، دامنه‌ی دیگر) را کش یا رهگیری نمی‌کند —
// آن درخواست‌ها دقیقاً طبق منطق موجود در app.js (isOnline + Sync Queue) مدیریت می‌شوند،
// و توکن/نشست کاربر هم فقط در localStorage است، نه در این کش.
// >>> افزوده شد: نسخه‌ی کش به v6 ارتقا یافت — این‌بار به‌خاطر: ۱) حذف کامل کارت جداگانه‌ی
// «تخصیص قفسه» (تخصیص قفسه از طریق «ثبت شمارش انبارگردانی» انجام می‌شود)، ۲) رفع قطعیِ باگ
// اندازه در PWA نصب‌شده با محاسبه‌ی جاوااسکریپتیِ ارتفاع واقعی ویوپورت (--app-vh)، مستقل از
// پشتیبانی dvh. بدون این تغییر نام کش، PWAهای از قبل نصب‌شده همچنان نسخه‌ی v5 (قبل از این
// اصلاحات) را از کش می‌بینند.
// >>> افزوده شد: نسخه‌ی کش به v7 ارتقا یافت — این‌بار به‌خاطر پشتیبانی از موجودیِ واقعیِ
// هر قفسه (ستون‌های «موجودی قفسه ۱..۴»)، نمایش «موجودی فعلی» در فرم شمارش، و امکان شمارش
// فقط یک قفسه بدون نیاز به پر کردن بقیه‌ی ردیف‌ها. بدون این تغییر نام کش، PWAهای از قبل
// نصب‌شده همچنان نسخه‌ی v6 (قبل از این اصلاحات) را از کش می‌بینند.
// >>> افزوده شد: نسخه‌ی کش به v8 ارتقا یافت — رفعِ باگِ واقعیِ CSS در بلوکِ ویوپورت پهن
// (min-width:720px): نوار جست‌وجو از این بلوک جا افتاده بود (تمام‌عرض می‌ماند) و ناوبری پایین
// با transform:translateX به‌جای رسیدن به max-width، به کوچک‌ترین اندازه‌ی ممکن جمع می‌شد
// (shrink-to-fit). بدون این تغییر نام کش، PWAهای از قبل نصب‌شده همچنان style.css نسخه‌ی v7
// (دارای این باگ) را از کش می‌بینند.
var CACHE_NAME = 'wh-scanner-shell-v8';
// <<< پایان بخش افزوده‌شده
// <<< پایان بخش افزوده‌شده
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
