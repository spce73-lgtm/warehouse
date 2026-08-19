// Service Worker — کش پوسته‌ی برنامه (App Shell)
// هدف: باز شدن خودِ اپ وقتی اینترنت قطع است (مشکل فعلی: بدون این فایل، مرورگر گوشی حتی
// قبل از اجرای app.js صفحه‌ی «دسترسی به اینترنت موجود نیست» خودش را نشان می‌دهد).
// این فایل فقط فایل‌های استاتیکِ همین ریپو (HTML/JS/CSS/آیکون) را کش می‌کند؛
// هیچ درخواستی به Apps Script (JSONP، دامنه‌ی دیگر) را کش یا رهگیری نمی‌کند —
// آن درخواست‌ها دقیقاً طبق منطق موجود در app.js (isOnline + Sync Queue) مدیریت می‌شوند،
// و توکن/نشست کاربر هم فقط در localStorage است، نه در این کش.
// >>> افزوده شد: نسخه‌ی کش به v2 ارتقا یافت — تغییرات اخیر (app.js/index.html) را مجبور می‌کند
// دوباره از شبکه دریافت شوند به‌جای نسخه‌ی قدیمیِ گیرافتاده در کش مرورگر (Stale Cache)؛ این
// شایع‌ترین علتِ واقعیِ «کار نکردن دکمه‌ی ورود بعد از آپدیت فایل‌ها» در اپ‌های PWA است. تغییر
// نام کش باعث می‌شود activate handler زیر (که کش‌های قدیمی را پاک می‌کند) خودش کش v1 را حذف کند.
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
      // >>> اصلاح شد: قبلاً cache.add(url) با یک رشته‌ی ساده صدا زده می‌شد که یعنی fetch با
      // حالت پیش‌فرض ('default') انجام می‌شود — یعنی اگر کش HTTP خودِ مرورگر (نه CacheStorage
      // سرویس‌ورکر؛ این یک لایه‌ی کاملاً جداست) هنوز یک نسخه‌ی «تازه» (در بازه‌ی max-age) از
      // app.js/index.html داشته باشد، حتی نصب کاملاً جدیدِ سرویس‌ورکر هم می‌توانست همان نسخه‌ی
      // قدیمیِ کش‌شده در مرورگر را بگیرد — بدون هیچ تماسی با شبکه — و همین باعث می‌شد بلافاصله
      // بعد از هر دیپلوی جدید (در بازه‌ی کش HTTP گیت‌هاب‌پیجز)، ورود دوباره «بی‌واکنش» شود، چون
      // Cache Storage همیشه از یک نسخه‌ی قدیمی (که از کش HTTP آمده) پر می‌شد، صرف‌نظر از تغییر
      // CACHE_NAME یا منطق fetch handler. اصلاح: با {cache:'reload'} کش HTTP مرورگر را دور می‌زنیم
      // تا نصبِ سرویس‌ورکر همیشه واقعاً از شبکه (نسخه‌ی واقعاً جدید) بگیرد.
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
      // <<< پایان بخش اصلاح‌شده
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
  // >>> اصلاح شد: قبلاً caches.match(req,...) بدون مشخص‌کردن نام کش استفاده می‌شد؛ این متد به‌صورت
  // سراسری در همه‌ی کش‌های این origin (از جمله نسخه‌های قدیمی‌ای که هنوز activate آن‌ها را پاک
  // نکرده) جست‌وجو می‌کند و ممکن است یک پاسخِ قدیمی/ناهماهنگ از یک نسخه‌ی کش پیشین را برگرداند —
  // این دقیقاً همان چیزی است که می‌تواند باعث شود حتی بعد از ارتقای CACHE_NAME، مرورگر همچنان
  // نسخه‌ی قدیمیِ app.js/index.html را نشان دهد و دکمه‌ی ورود «بدون واکنش» به نظر برسد.
  // اصلاح: جست‌وجو را صریحاً به کشِ همین نسخه (CACHE_NAME) محدود می‌کنیم تا هرگز پاسخی از یک
  // نسخه‌ی قدیمی برگردانده نشود.
  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (cached) {
        var networkFetch = fetch(req).then(function (res) {
          if (res && res.ok) {
            var resClone = res.clone();
            cache.put(req, resClone);
          }
          return res;
        }).catch(function () {
          // >>> اصلاح شد: قبلاً اینجا فقط `cached` (که همین الان undefined بودنش را می‌دانیم،
          // چون به این catch فقط زمانی می‌رسیم که cached موجود نبوده) برگردانده می‌شد؛ یعنی
          // event.respondWith(undefined) اجرا می‌شد که مرورگر آن را یک خطای شبکه/ناوبری کامل
          // می‌بیند (همان صفحه‌ی پیش‌فرض «آفلاین» خودِ مرورگر) — نه صفحه‌ی اپ ما با منطق آفلاینِ
          // app.js. اصلاح: برای درخواست‌های ناوبری (باز کردن خودِ صفحه)، به‌جای undefined، پوسته‌ی
          // کش‌شده‌ی index.html برگردانده می‌شود تا اپ بالا بیاید و منطق آفلاینِ app.js/IndexedDB
          // کار خودش را انجام دهد؛ برای سایر درخواست‌ها یک پاسخ خطای واقعی (نه undefined) برگردانده می‌شود.
          if (req.mode === 'navigate') {
            return cache.match('./index.html').then(function (shell) {
              return shell || new Response('', { status: 503, statusText: 'Offline' });
            });
          }
          return new Response('', { status: 503, statusText: 'Offline' });
        });
        // <<< پایان بخش اصلاح‌شده

        return cached || networkFetch;
      });
    })
  );
  // <<< پایان بخش اصلاح‌شده
});
