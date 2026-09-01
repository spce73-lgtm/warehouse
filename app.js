// =====================================================================
// اسکنر انبارگردانی - نسخه‌ی بدون اسکنر داخلی
// کیوآرکدها حالا مستقیم لینک همین برنامه‌اند (?id=CODE)؛ اسکن با دوربین
// پیش‌فرض خودِ گوشی (هر برند) انجام می‌شود، نه با یک اسکنر داخل صفحه.
// =====================================================================

// >>> افزوده شد: رفع قطعیِ باگِ کوچک‌شدنِ رابط در PWA نصب‌شده روی اندروید. راه‌حل CSS ‌محورِ
// قبلی (min-height:100dvh) فقط در Chrome/WebView نسخه‌ی ۱۰۸ به بعد پشتیبانی می‌شود؛ اگر دستگاه
// از یک WebView/Chrome قدیمی‌تر استفاده کند، dvh نادیده گرفته می‌شود و همان vh معیوب (که در
// حالت standalone بلندتر از صفحه‌ی واقعاً قابل‌مشاهده محاسبه می‌شود) دوباره فعال می‌ماند. این
// تابع، به‌جای تکیه بر نام‌واحدهای CSS، مستقیماً از window.innerHeight/visualViewport.height
// (که در هر نسخه‌ای از هر مرورگر، همیشه دقیقاً همان ارتفاع واقعاً قابل‌مشاهده است) یک متغیر
// CSS می‌سازد؛ این متغیر در style.css به‌عنوان آخرین و معتبرترین مقدار min-height استفاده
// می‌شود و روی هر تغییر اندازه (چرخش صفحه، ظاهر/پنهان‌شدن کیبورد، تغییر نوار آدرس) به‌روز
// می‌ماند. این یک رفع ریشه‌ای است، نه یک ترفند zoom.
function updateAppViewportHeight_() {
  var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  if (h) document.documentElement.style.setProperty('--app-vh', h + 'px');
}
updateAppViewportHeight_();
window.addEventListener('resize', updateAppViewportHeight_);
window.addEventListener('orientationchange', updateAppViewportHeight_);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateAppViewportHeight_);
}
// <<< پایان بخش افزوده‌شده

// ===================== حافظه‌ی محلی =====================
var LS_SERVER = 'wh_scanner_server_url';
var LS_TOKEN = 'wh_scanner_token';
var LS_USER = 'wh_scanner_username';
var LS_ROLE = 'wh_scanner_role';
var LS_FULLNAME = 'wh_scanner_fullname';
var LS_WAREHOUSE = 'wh_scanner_warehouse_access';
// >>> افزوده شد: همگام‌سازی آفلاین — آخرین زمان همگام‌سازی موفق (رشته‌ی شمسی آماده از سرور)
var LS_LAST_SYNC = 'wh_scanner_last_sync';
// >>> افزوده شد: آیا آخرین تلاش برای دانلود کامل داده‌ی آفلاین موفق بود؟ (برای نمایش وضعیت واقعی در نوار همگام‌سازی)
var LS_LAST_SYNC_OK = 'wh_scanner_last_sync_ok';
// <<< پایان بخش افزوده‌شده

var state = {
  serverUrl: localStorage.getItem(LS_SERVER) || '',
  token: localStorage.getItem(LS_TOKEN) || '',
  username: localStorage.getItem(LS_USER) || '',
  role: localStorage.getItem(LS_ROLE) || '',
  fullName: localStorage.getItem(LS_FULLNAME) || '',
  warehouseAccess: localStorage.getItem(LS_WAREHOUSE) === '1'
};

var recentItems = [];
var currentDetail = null;      // آخرین کالایی که جزئیاتش باز شده
var lastSearchResults = null;  // آخرین نتایج جست‌وجو (برای «بازگشت به جست‌وجو»)
var lastSearchQuery = '';
var pendingId = null;          // شناسه‌ای که از لینک کیوآرکد (?id=) آمده و هنوز باز نشده

// ===================== ابزارهای کمکی =====================
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function setText(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('active', s.id === id); });
  // >>> بازطراحی شد: نمایش/پنهان‌سازی ناوبری پایین سراسری — فقط در صفحاتی که کاربر وارد شده
  // (اصلی/قفسه‌ها) دیده می‌شود؛ در ورود/پیش‌نمایش عمومی پنهان است. صرفاً نمایشی است.
  var loggedInScreen = (id === 'mainScreen' || id === 'shelvesScreen' || id === 'remainingScreen');
  var nav = document.getElementById('bottomNav');
  if (nav) nav.style.display = loggedInScreen ? 'flex' : 'none';
  document.body.classList.toggle('has-bottom-nav', loggedInScreen);
  // <<< پایان بخش بازطراحی‌شده
}
function showToast(msg, isErr) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : ' ok');
  setTimeout(function () { t.className = 'toast'; }, 2200);
}

// شناسه‌ی کالا را از URL بردار (وقتی از کیوآرکد باز شده باشد)
function readIdFromLocation() {
  var params = new URLSearchParams(window.location.search);
  return params.get('id');
}
// اگر کسی به‌جای کد خام، یک لینک کامل داخل کادر جست‌وجو پیست کرده بود، کد را از آن دربیاور
/**
 * تبدیل ارقام فارسی/عربی به انگلیسی (مثلاً «۱۲۳۴» یا «١٢٣٤» به «1234»)
 * تا جست‌وجو و تشخیص کد با هر صفحه‌کلیدی درست کار کند.
 */
function normalizePersianDigits(str) {
  if (str === null || str === undefined) return str;
  var s = String(str);
  var persian = '۰۱۲۳۴۵۶۷۸۹';
  var arabic  = '٠١٢٣٤٥٦٧٨٩';
  s = s.replace(/[۰-۹]/g, function (d) { return String(persian.indexOf(d)); });
  s = s.replace(/[٠-٩]/g, function (d) { return String(arabic.indexOf(d)); });
  return s;
}

function extractItemCode(raw) {
  if (/^https?:\/\//i.test(raw)) {
    try {
      var u = new URL(raw);
      var idParam = u.searchParams.get('id');
      if (idParam) return normalizePersianDigits(idParam);
    } catch (e) {}
  }
  return normalizePersianDigits(raw);
}
// بعد از استفاده از id داخل آدرس، آن را از نوار آدرس پاک کن تا با رفرش دوباره تکرار نشود
function clearIdFromUrl() {
  try {
    var url = new URL(window.location.href);
    url.searchParams.delete('id');
    window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
  } catch (e) {}
}

// ===================== همگام‌سازی آفلاین (Offline-First Sync) =====================
// این بخش کاملاً افزوده است و هیچ تابع/رفتار موجودی را تغییر نمی‌دهد؛ فقط وقتی که
// اتصال قطع باشد یا ناپایدار باشد، وارد عمل می‌شود (ثبت شمارش + ویرایش وزن/قفسه).

// شناسه‌ی یکتای واقعی (UUID v4) برای هر عملیات — استفاده در صف آفلاین و idempotency سمت سرور
function genUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

function isOnline() {
  return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
}

// ---------- IndexedDB: صف عملیات آفلاین + کش کالا/قفسه ----------
var SyncDB = (function () {
  var DB_NAME = 'wh_scanner_sync_db';
  var DB_VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB در این مرورگر در دسترس نیست.')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'clientOpId' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function () { reject(req.error || new Error('خطا در باز کردن پایگاه‌داده‌ی محلی.')); };
    });
    return dbPromise;
  }

  function withStore(storeName, mode) {
    return open().then(function (db) {
      return db.transaction(storeName, mode).objectStore(storeName);
    });
  }

  function enqueue(op) {
    return withStore('queue', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.put(op);
        req.onsuccess = function () { resolve(op); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function removeFromQueue(clientOpId) {
    return withStore('queue', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.delete(clientOpId);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function listQueue() {
    return withStore('queue', 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var items = [];
        var req = store.openCursor();
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { items.push(cursor.value); cursor.continue(); } else resolve(items);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function cacheSet(key, value, ttlMs) {
    return withStore('cache', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.put({ key: key, value: value, expiresAt: Date.now() + (ttlMs || 0) });
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function cacheGet(key) {
    return withStore('cache', 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.get(key);
        req.onsuccess = function () {
          var rec = req.result;
          if (!rec) { resolve(null); return; }
          resolve({ value: rec.value, expired: !!(rec.expiresAt && rec.expiresAt < Date.now()) });
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  return {
    enqueue: enqueue,
    removeFromQueue: removeFromQueue,
    updateQueueItem: enqueue, // put جایگزین می‌کند، پس برای به‌روزرسانی هم کافی است
    listQueue: listQueue,
    cacheSet: cacheSet,
    cacheGet: cacheGet
  };
})();

// ---------- نوار وضعیت آنلاین/آفلاین + همگام‌سازی ----------
var syncState = { pendingCount: 0, syncing: false };

// >>> بازطراحی شد: قبلاً این تابع یک نوار جداگانه (#syncBar) را پر می‌کرد. حالا همان
// اطلاعات (آنلاین/آفلاین، تعداد در صف، آخرین زمان همگام‌سازی، وضعیت دانلود کامل) در دو محل
// جدید نمایش داده می‌شود: نقطه‌ی وضعیت + زیرنویس روی دکمه‌ی «همگام‌سازی» در هدر تیره‌ی بالا،
// و زیرنویس زیر آیتم «همگام‌سازی» در ناوبری پایین. state/localStorage و همه‌ی نقاط فراخوانی
// این تابع دقیقاً مثل قبل دست‌نخورده مانده‌اند — فقط خروجیِ نمایشی تغییر کرده است.
function renderSyncBar() {
  var online = isOnline();
  var lastSync = localStorage.getItem(LS_LAST_SYNC) || '—';
  var lastSyncOk = localStorage.getItem(LS_LAST_SYNC_OK);
  var pending = syncState.pendingCount;

  var dot = document.getElementById('headerSyncDot');
  if (dot) dot.style.background = !online ? '#ff6b6b' : (lastSyncOk === '0' ? '#e0a300' : '#3ddc84');

  var headerBtn = document.getElementById('headerSyncBtn');
  if (headerBtn) {
    headerBtn.classList.toggle('syncing', syncState.syncing);
    headerBtn.disabled = syncState.syncing;
  }

  var headerLastSyncText;
  if (syncState.syncing) headerLastSyncText = 'در حال همگام‌سازی...';
  else if (!online) headerLastSyncText = 'آفلاین' + (pending ? (' · ' + pending + ' در صف') : '');
  else if (lastSyncOk === '0') headerLastSyncText = '⚠ دریافت آخرین داده ناموفق بود';
  else headerLastSyncText = 'آخرین همگام‌سازی: ' + lastSync + (pending ? (' · ' + pending + ' در صف') : '');
  setText('headerLastSync', headerLastSyncText);

  var navShort;
  if (syncState.syncing) navShort = 'در حال ارسال...';
  else if (!online) navShort = 'آفلاین' + (pending ? (' (' + pending + ')') : '');
  else navShort = pending ? (pending + ' در صف') : lastSync;
  setText('navLastSync', navShort);
}

function refreshPendingCount() {
  SyncDB.listQueue().then(function (items) {
    syncState.pendingCount = items.length;
    renderSyncBar();
  }).catch(function () {});
}

// >>> افزوده شد: عنوان هدر تیره‌ی بالای صفحه (mainScreen/shelvesScreen) — صرفاً نمایشی
function setHeaderTitle(text) { setText('headerTitleMain', text); }
function setShelvesHeaderTitle(text) { setText('headerTitleShelves', text); }

// >>> افزوده شد: مدیریت آیتم فعالِ ناوبری پایین — صرفاً نمایشی، هیچ منطقی را عوض نمی‌کند
// (آیتم «خانه» دیگر در ناوبری پایین وجود ندارد؛ صفحه‌ی اصلی/جزئیات کالا از طریق «جستجو» یا
// لینک «بازگشت به جست‌وجو» در دسترس است — تابع navGoHome() برای استفاده‌ی داخلی دست‌نخورده مانده)
var currentNavName = 'home';
function setActiveNav(name) {
  currentNavName = name;
  ['navSearchBtn', 'navSyncBtn', 'navShelvesBtn'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var isActive = (id === 'navSearchBtn' && name === 'search') ||
      (id === 'navShelvesBtn' && name === 'shelves');
    el.classList.toggle('active', isActive);
  });
}

function navGoHome() {
  showScreen('mainScreen');
  renderRecentList();
  setActiveNav('home');
}
function navGoSearch() {
  showScreen('mainScreen');
  setActiveNav('search');
  var input = document.getElementById('searchInput');
  if (input) { input.focus(); }
}
function navGoSync() {
  syncNow(true);
}
function navGoShelves() {
  openShelvesList();
}
// <<< پایان بخش افزوده‌شده

// >>> افزوده شد: کش کامل داده‌ی آفلاین (کالاها + قفسه‌ها) — یک درخواست دسته‌ای، بدون تصویر
// این تابع فقط وقتی آنلاین هستیم و کاربر وارد شده اجرا می‌شود؛ در غیر این صورت بی‌اثر است
// و هیچ درخواست غیرضروری به سرور ارسال نمی‌کند.
// >>> اصلاح شد: قبلاً خطای این تابع کاملاً بی‌صدا بلعیده می‌شد (فقط .catch(function(){}))، یعنی
// اگر دانلود کامل داده به هر دلیلی (قطعی موقت، تایم‌اوت و...) شکست می‌خورد، کاربر هیچ نشانه‌ای
// نمی‌دید و تصور می‌کرد «داده‌ی آفلاین اصلاً ذخیره نمی‌شود» — این تابع حالا با موفقیت/شکست و
// تعداد آیتم‌های واقعاً ذخیره‌شده resolve/reject می‌شود تا syncNow() بتواند وضعیت واقعی را نشان دهد.
function refreshOfflineCache() {
  if (!state.token || !isOnline()) return Promise.resolve({ skipped: true });
  return apiCall('apiOfflineIndex', { token: state.token }).then(function (res) {
    if (!res || !res.success) throw new Error((res && res.message) || 'دریافت داده‌ی آفلاین ناموفق بود.');
    var tasks = [SyncDB.cacheSet('offline_items_index', res.items || [], 24 * 60 * 60 * 1000)];
    if (res.shelves) {
      tasks.push(SyncDB.cacheSet('shelves_list', res.shelves, 24 * 60 * 60 * 1000));
      // >>> افزوده شد: فهرست قفسه‌های «فعال» (کد+محل) — برای پر کردن کشویی قفسه در ویرایش
      // آفلاینِ وزن/قفسه، بدون نیاز به درخواست جداگانه‌ی apiListActiveShelves
      var activeShelvesList = res.shelves.filter(function (s) { return s.status === 'فعال'; })
        .map(function (s) { return { code: s.code, location: s.location || '' }; });
      tasks.push(SyncDB.cacheSet('active_shelves_list', activeShelvesList, 24 * 60 * 60 * 1000));
      // <<< پایان بخش افزوده‌شده
    }
    // >>> افزوده شد: جزئیات کامل هر قفسه (شامل فهرست کالاهای روی آن) — تا صفحه‌ی «قفسه‌ها» برای
    // هر قفسه‌ای (نه فقط قفسه‌های قبلاً بازشده) به‌طور کامل آفلاین در دسترس باشد
    if (res.shelfDetails && res.shelfDetails.length) {
      res.shelfDetails.forEach(function (sd) {
        tasks.push(SyncDB.cacheSet('shelf_' + sd.code, sd, 24 * 60 * 60 * 1000));
      });
    }
    // <<< پایان بخش افزوده‌شده
    return Promise.all(tasks).then(function () {
      if (res.serverTime) localStorage.setItem(LS_LAST_SYNC, res.serverTime);
      localStorage.setItem(LS_LAST_SYNC_OK, '1'); // >>> افزوده شد: آخرین تلاش موفق بود
      renderSyncBar();
      refreshRemainingCountBadge_(); // >>> افزوده شد: نشان «کالاهای باقیمانده» با هر بار به‌روزرسانی کش هماهنگ می‌ماند
      return { skipped: false, itemCount: (res.items || []).length, shelfCount: (res.shelves || []).length };
    });
  }).catch(function (err) {
    // >>> افزوده شد: برخلاف قبل، خطا اینجا بلعیده نمی‌شود — به بالا پاس داده می‌شود تا syncNow()
    // (وقتی کاربر خودش دکمه‌ی «همگام‌سازی» را زده) بتواند آن را واضح نشان دهد. برای فراخوانی‌های
    // خودکار (ورود به اپ، رویداد online، بازگشت از پس‌زمینه) که این خطا را نادیده می‌گیرند
    // (catch(function(){}) در همان محل فراخوانی)، رفتار قبلی (بی‌صدا) دقیقاً حفظ می‌شود.
    localStorage.setItem(LS_LAST_SYNC_OK, '0');
    renderSyncBar();
    throw err;
    // <<< پایان بخش افزوده‌شده
  });
}
// <<< پایان بخش افزوده‌شده

// >>> افزوده شد: فقط وقتی صفحه‌ی «آماده برای اسکن بعدی / لیست اخیر» باز است (نه فرم شمارش/جزئیات کالا)،
// پس از همگام‌سازی دوباره رندر می‌شود تا نشان «در انتظار همگام‌سازی» به‌موقع پاک شود
function maybeRefreshRecentView() {
  var mainScreen = document.getElementById('mainScreen');
  if (mainScreen && mainScreen.classList.contains('active') && !currentDetail && !lastSearchResults) {
    renderRecentList();
  }
}
// <<< پایان بخش افزوده‌شده

var MAX_SYNC_BATCH_SIZE = 20;
var MAX_SYNC_RETRY = 8;

// ارسال دسته‌ای صفِ عملیات‌های ذخیره‌شده‌ی محلی به سرور — یک درخواست به‌جای چند درخواست
// >>> اصلاح شد: پارامتر «manual» — وقتی کاربر خودش دکمه‌ی «همگام‌سازی» را می‌زند (manual=true)،
// نتیجه‌ی واقعیِ دانلودِ کامل داده (نه فقط ارسال صف) هم به‌وضوح نمایش داده می‌شود — طبق نیاز
// «نمایش پیشرفت/نتیجه‌ی همگام‌سازی». برای فراخوانی‌های خودکار (ورود به اپ، رویداد online،
// بازگشت از پس‌زمینه) رفتار قبلاً موجود (ساکت، بدون مزاحمت برای کاربر) دقیقاً حفظ می‌شود.
function syncNow(manual) {
  if (syncState.syncing) return;
  if (!state.token) return; // هنوز وارد نشده
  if (!isOnline()) { if (manual) showToast('اتصال اینترنت برقرار نیست', true); return; }

  syncState.syncing = true;
  renderSyncBar();

  // >>> افزوده شد: همراه با هر Sync (خودکار یا دستی)، ابتدا کش کامل داده‌ی آفلاین به‌روزرسانی
  // می‌شود (دانلود کامل کالاها/قفسه‌ها)، سپس صفِ عملیات‌های آفلاین ارسال می‌شود؛ نتیجه‌ی هر دو
  // بخش در پیام نهایی (برای sync دستی) لحاظ می‌شود.
  var downloadOk = null, downloadCount = 0, downloadErr = null;
  refreshOfflineCache().then(function (r) {
    downloadOk = !r || r.skipped ? null : true;
    downloadCount = (r && r.itemCount) || 0;
  }).catch(function (err) {
    downloadOk = false;
    downloadErr = err;
  }).then(function () {
    return SyncDB.listQueue();
  }).then(function (items) {
    // <<< پایان بخش افزوده‌شده
    if (!items.length) {
      syncState.syncing = false;
      refreshPendingCount();
      // >>> افزوده شد: پیام نهایی برای sync دستی، شامل نتیجه‌ی واقعیِ دانلود هم می‌شود
      if (manual) {
        if (downloadOk) showToast('✓ داده‌ی محلی به‌روز شد (' + downloadCount + ' کالا) — چیزی برای ارسال نبود');
        else if (downloadOk === false) showToast('خطا در دریافت داده‌ی کامل: ' + (downloadErr ? downloadErr.message : ''), true);
        else showToast('چیزی برای همگام‌سازی نیست');
      }
      // <<< پایان بخش افزوده‌شده
      renderSyncBar();
      return;
    }

    var batch = items.slice(0, MAX_SYNC_BATCH_SIZE);
    var ops = batch.map(function (op) {
      return {
        clientOpId: op.clientOpId, type: op.type, code: op.code,
        qty: op.qty, note: op.note, warehouse: op.warehouse,
        unitWeight: op.unitWeight, shelfCode: op.shelfCode
      };
    });

    apiCall('apiBatchSync', { token: state.token, ops: JSON.stringify(ops) }).then(function (res) {
      syncState.syncing = false;
      if (handleIfSessionExpired(res)) { renderSyncBar(); return; }
      if (!res.success) {
        showToast(res.message || 'خطا در همگام‌سازی', true);
        renderSyncBar();
        return;
      }
      var results = res.results || [];
      var okCount = 0, failCount = 0;
      var chain = Promise.resolve();
      results.forEach(function (r) {
        chain = chain.then(function () {
          if (r.success) {
            okCount++;
            // >>> افزوده شد: پاک‌کردن نشان «در انتظار همگام‌سازی» از ردیفِ متناظر در لیست اخیر
            var recentMatch = recentItems.filter(function (ri) { return ri.clientOpId === r.clientOpId; })[0];
            if (recentMatch) {
              recentMatch.pending = false;
              if (typeof r.diff !== 'undefined') recentMatch.diff = r.diff;
            }
            // <<< پایان بخش افزوده‌شده
            return SyncDB.removeFromQueue(r.clientOpId);
          }
          failCount++;
          var original = batch.filter(function (b) { return b.clientOpId === r.clientOpId; })[0];
          if (!original) return;
          original.retryCount = (original.retryCount || 0) + 1;
          original.lastError = r.message || '';
          if (original.retryCount >= MAX_SYNC_RETRY) original.failed = true;
          return SyncDB.updateQueueItem(original);
        });
      });
      chain.then(function () {
        if (res.serverTime) localStorage.setItem(LS_LAST_SYNC, res.serverTime);
        refreshPendingCount();
        // >>> افزوده شد: پیام نهایی حالا هم نتیجه‌ی دانلود و هم نتیجه‌ی ارسال صف را نشان می‌دهد
        var uploadMsg = okCount ? (okCount + ' مورد ارسال شد' + (failCount ? (' — ' + failCount + ' ناموفق') : '')) : (failCount ? 'ارسال ناموفق بود؛ دوباره تلاش می‌شود' : '');
        if (manual) {
          var dlMsg = downloadOk ? ('داده‌ی محلی به‌روز شد (' + downloadCount + ' کالا)') : (downloadOk === false ? 'دریافت داده‌ی کامل ناموفق بود' : '');
          var full = [dlMsg, uploadMsg].filter(Boolean).join(' — ');
          showToast((failCount || downloadOk === false ? '' : '✓ ') + (full || 'همگام‌سازی انجام شد'), !!(failCount || downloadOk === false));
        } else if (okCount || failCount) {
          showToast((okCount ? '✓ ' : '') + uploadMsg, !!failCount && !okCount);
        }
        // <<< پایان بخش افزوده‌شده
        maybeRefreshRecentView();
        if (items.length > batch.length && isOnline()) setTimeout(function () { syncNow(false); }, 400);
      });
    }).catch(function (err) {
      syncState.syncing = false;
      renderSyncBar();
      // اگر واقعاً اتصال قطع است، این یک خطای واقعی نیست — فقط باید صبر کرد تا اینترنت برگردد؛
      // پیام «تایم‌اوت سرور»/«پاسخ نداد» را در این حالت به کاربر نشان نمی‌دهیم. آیتم‌های صف همچنان دست‌نخورده باقی می‌مانند.
      if (isOnline()) {
        showToast('خطا در همگام‌سازی: ' + err.message, true);
      }
    });
  }).catch(function () { syncState.syncing = false; renderSyncBar(); });
}
// ===================== پایان بخش همگام‌سازی آفلاین =====================

// ===================== ارتباط با سرور (JSONP - بدون نیاز به CORS) =====================
var jsonpCounter = 0;
function apiCall(action, params) {
  return new Promise(function (resolve, reject) {
    // >>> اصلاح شد: قبلاً فقط کپیِ حافظه‌ای state.serverUrl بررسی می‌شد. اگر به هر دلیلی (مثلاً
    // در برخی مرورگرها/حالت PWA نصب‌شده روی گوشی) این کپی در حافظه خالی بماند درحالی‌که خودِ
    // localStorage — همان جایی که doLogin() آدرس را در آن ذخیره کرده — مقدار دارد، این باعث
        // می‌شد Full Sync (و هر apiCall دیگری) با «آدرس سامانه تنظیم نشده» شکست بخورد، با اینکه
        // کاربر واقعاً وارد شده و آدرس را قبلاً وارد کرده بود. اصلاح: همیشه از همان منبع واحد و
        // موجود (localStorage با همان کلید LS_SERVER که ورود استفاده می‌کند) به‌عنوان نسخه‌ی
        // پشتیبان بخوانیم — بدون هیچ تنظیم/کلید جدید، و بدون درخواست دوباره از کاربر.
    if (!state.serverUrl) {
      var storedServerUrl = localStorage.getItem(LS_SERVER);
      if (storedServerUrl) state.serverUrl = storedServerUrl;
    }
    if (!state.serverUrl) { reject(new Error('آدرس سامانه تنظیم نشده.')); return; }
    // <<< پایان بخش اصلاح‌شده

    var cbName = 'whCb_' + (jsonpCounter++) + '_' + Date.now();
    var script = document.createElement('script');
    var settled = false;

    var timeout = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('سرور در زمان مناسب پاسخ نداد. اتصال اینترنت را بررسی کنید.'));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (data) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data || {});
    };

    var qs = 'action=' + encodeURIComponent(action) + '&callback=' + cbName;
    for (var k in params) {
      if (params[k] !== undefined && params[k] !== null) qs += '&' + k + '=' + encodeURIComponent(params[k]);
    }
    script.src = state.serverUrl + '?' + qs;
    script.onerror = function () {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('اتصال به سرور برقرار نشد.'));
    };
    document.body.appendChild(script);
  });
}

// اگر پاسخ سرور بگوید نشست منقضی شده، همه‌جا یکسان رفتار کن
function handleIfSessionExpired(res) {
  if (res && res.needLogin) {
    showToast('نشست شما منقضی شده؛ دوباره وارد شوید.', true);
    doLogout();
    return true;
  }
  return false;
}

// ===================== ورود =====================
function doLogin() {
  var serverUrl = document.getElementById('serverUrlInput').value.trim();
  var username = document.getElementById('loginUsername').value.trim();
  var password = document.getElementById('loginPassword').value;
  var msgBox = document.getElementById('loginMsg');
  var btn = document.getElementById('loginBtn');
  msgBox.innerHTML = '';

  if (!serverUrl) {
    msgBox.innerHTML = '<div class="msg err">کادر «آدرس سامانه» خالی است. آدرس Apps Script (.../exec) را پیست کنید.</div>';
    return;
  }
  if (serverUrl.indexOf('http') !== 0) {
    msgBox.innerHTML = '<div class="msg err">آدرس سامانه باید با https:// شروع شود.</div>';
    return;
  }
  if (serverUrl.indexOf('github.io') !== -1) {
    msgBox.innerHTML = '<div class="msg err">این آدرس گیت‌هاب‌پیجز است (همین اپ)، نه آدرس Apps Script.</div>';
    return;
  }
  if (serverUrl.indexOf('/exec') === -1) {
    msgBox.innerHTML = '<div class="msg err">آدرس واردشده باید به exec ختم شود.</div>';
    return;
  }
  if (!username || !password) {
    msgBox.innerHTML = '<div class="msg err">نام کاربری و رمز عبور را وارد کنید.</div>';
    return;
  }

  state.serverUrl = serverUrl.replace(/\/$/, '');
  localStorage.setItem(LS_SERVER, state.serverUrl);

  btn.disabled = true; btn.textContent = 'در حال ورود...';
  apiCall('apiLogin', { username: username, password: password }).then(function (res) {
    btn.disabled = false; btn.textContent = 'ورود';
    if (!res.success) {
      msgBox.innerHTML = '<div class="msg err">' + escapeHtml(res.message || 'ورود ناموفق بود.') + '</div>';
      return;
    }
    state.token = res.token; state.username = res.username; state.role = res.role; state.fullName = res.fullName;
    state.warehouseAccess = res.warehouseAccess === true;
    localStorage.setItem(LS_TOKEN, state.token);
    localStorage.setItem(LS_USER, state.username);
    localStorage.setItem(LS_ROLE, state.role);
    localStorage.setItem(LS_FULLNAME, state.fullName);
    localStorage.setItem(LS_WAREHOUSE, state.warehouseAccess ? '1' : '0');
    enterApp();
  }).catch(function (err) {
    btn.disabled = false; btn.textContent = 'ورود';
    msgBox.innerHTML = '<div class="msg err">' + escapeHtml(err.message) + '</div>';
  });
}

function doLogout() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
  localStorage.removeItem(LS_ROLE);
  localStorage.removeItem(LS_FULLNAME);
  localStorage.removeItem(LS_WAREHOUSE);
  state.token = ''; state.username = ''; state.role = ''; state.fullName = ''; state.warehouseAccess = false;
  showScreen('loginScreen');
}

function enterApp() {
  setText('whoLabel', state.fullName || state.username);
  setText('whoSub', state.role || '');
  // >>> بازطراحی شد: دکمه‌ی «قفسه‌ها» از هدر به ناوبری پایین منتقل شد (navShelvesBtn)
  var shelvesBtn = document.getElementById('navShelvesBtn');
  if (shelvesBtn) shelvesBtn.style.display = state.warehouseAccess ? '' : 'none';
  // <<< پایان بخش بازطراحی‌شده
  showScreen('mainScreen');
  setActiveNav('home');

  // >>> افزوده شد: نمایش نوار همگام‌سازی + تلاش خودکار برای ارسال هر عملیات باقیمانده از جلسه‌ی قبل
  renderSyncBar();
  refreshPendingCount();
  refreshRemainingCountBadge_(); // >>> افزوده شد: نشان تعداد «کالاهای باقیمانده» زیر نوار جست‌وجو
  if (isOnline()) syncNow();
  // <<< پایان بخش افزوده‌شده

  if (pendingId) {
    var idToOpen = pendingId;
    pendingId = null;
    clearIdFromUrl();
    openItemDetail(idToOpen);
  } else {
    renderRecentList();
  }
}

// ===================== جست‌وجو =====================
var searchInputEl = document.getElementById('searchInput');
if (searchInputEl) {
  searchInputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });
}

// >>> افزوده شد: جست‌وجوی محلی از کش آفلاین IndexedDB (وقتی اینترنت نیست یا apiSearch شکست بخورد)
function searchOfflineIndex(q) {
  var area = document.getElementById('resultArea');
  SyncDB.cacheGet('offline_items_index').then(function (rec) {
    var items = (rec && rec.value) ? rec.value : [];
    if (!items.length) {
      area.innerHTML = '<div class="empty-hint">اتصال اینترنت برقرار نیست و داده‌ای برای جست‌وجوی آفلاین ذخیره نشده است. لطفاً یک‌بار وقتی آنلاین هستید وارد شوید.</div>';
      return;
    }
    var qNorm = String(q || '').trim().toLowerCase();
    var results = items.filter(function (it) {
      return (it.code && String(it.code).toLowerCase().indexOf(qNorm) !== -1) ||
             (it.name && String(it.name).toLowerCase().indexOf(qNorm) !== -1);
    }).slice(0, 50).map(function (it) {
      return { code: it.code, name: it.name, qty: it.systemQty, lastCount: it.lastCount || null };
    });
    lastSearchResults = results;
    lastSearchQuery = q;
    if (!results.length) {
      area.innerHTML = '<div class="empty-hint">چیزی با «' + escapeHtml(q) + '» در داده‌ی محلی (آفلاین) پیدا نشد.</div>';
    } else if (results.length === 1) {
      openItemDetail(results[0].code);
    } else {
      renderResultsList(results, q);
      showToast('نمایش نتایج از داده‌ی محلی (آفلاین)', false);
    }
  }).catch(function () {
    area.innerHTML = '<div class="empty-hint">اتصال اینترنت برقرار نیست.</div>';
  });
}
// <<< پایان بخش افزوده‌شده

// >>> افزوده شد: نتایج جست‌وجوی آنلاین (apiSearch) شامل «آخرین شمارش» نیستند؛ این فیلد را
// از همان کش آفلاینِ کالاها (offline_items_index) — که از قبل برای پشتیبانی آفلاین موجود
// است — می‌خوانیم. اگر کش هنوز موجود نباشد (مثلاً قبل از اولین Sync)، به‌سادگی تاریخی نشان
// داده نمی‌شود؛ هرگز تاریخ ساختگی/فرضی نمایش داده نمی‌شود.
function attachLastCountToResults_(results) {
  return SyncDB.cacheGet('offline_items_index').then(function (rec) {
    var items = (rec && rec.value) ? rec.value : [];
    var map = {};
    items.forEach(function (it) { if (it && it.code != null) map[String(it.code)] = it; });
    results.forEach(function (r) {
      var found = map[String(r.code)];
      if (found && found.lastCount) r.lastCount = found.lastCount;
    });
    return results;
  }).catch(function () { return results; });
}
// <<< پایان بخش افزوده‌شده

function doSearch() {
  var raw = document.getElementById('searchInput').value.trim();
  if (!raw) { showToast('چیزی برای جست‌وجو تایپ کنید', true); return; }
  var q = extractItemCode(raw);

  var area = document.getElementById('resultArea');

  // >>> افزوده شد: اگر اینترنت قطع است، مستقیم از کش آفلاین جست‌وجو کن (بدون تلاش برای apiCall)
  if (!isOnline()) {
    searchOfflineIndex(q);
    return;
  }
  // <<< پایان بخش افزوده‌شده

  area.innerHTML = '<div class="lookup-loading"><div class="spinner"></div> در حال جست‌وجو...</div>';

  apiCall('apiSearch', { token: state.token, q: q }).then(function (res) {
    if (handleIfSessionExpired(res)) return;
    if (!res.success) {
      area.innerHTML = '<div class="empty-hint">' + escapeHtml(res.message || 'خطا در جست‌وجو') + '</div>';
      return;
    }
    var results = res.results || [];
    lastSearchResults = results;
    lastSearchQuery = q;
    if (results.length === 0) {
      area.innerHTML = '<div class="empty-hint">چیزی با «' + escapeHtml(q) + '» پیدا نشد.</div>';
    } else if (results.length === 1) {
      openItemDetail(results[0].code);
    } else {
      // >>> افزوده شد: تکمیل «آخرین شمارش» از کش آفلاین قبل از نمایش فهرست نتایج
      attachLastCountToResults_(results).then(function (enriched) {
        renderResultsList(enriched, q);
      });
      // <<< پایان بخش افزوده‌شده
    }
  }).catch(function () {
    // >>> افزوده شد: اتصال ناپایدار/قطع وسط جست‌وجو — به‌جای نمایش خطا، از کش آفلاین جست‌وجو کن
    searchOfflineIndex(q);
    // <<< پایان بخش افزوده‌شده
  });
}

function renderResultsList(results, q) {
  setHeaderTitle('نتایج جست‌وجو');
  var area = document.getElementById('resultArea');
  var html = '<div class="section-title">' + results.length + ' نتیجه برای «' + escapeHtml(q) + '»</div><div class="result-list">';
  results.forEach(function (r) {
    // >>> افزوده شد: آخرین تاریخ شمارشِ این کالا (فقط تاریخ، بدون ساعت، برای سبک ماندن نتیجه)
    // — از داده‌ی واقعیِ تاریخچه‌ی شمارش (lastCount) که از قبل در کش آفلاین موجود است؛ اگر
    // کالا تا به حال شمارش نشده باشد، هیچ خطی اضافه نمی‌شود (سنگین‌تر نشدن نتیجه).
    var lastCountDateOnly = (r.lastCount && r.lastCount.date) ? String(r.lastCount.date).split(' ')[0] : '';
    var lastCountHtml = lastCountDateOnly ? ('<div class="result-lastcount">آخرین شمارش: ' + escapeHtml(lastCountDateOnly) + '</div>') : '';
    // <<< پایان بخش افزوده‌شده
    html +=
      '<div class="result-row" onclick="openItemDetail(\'' + escapeHtml(r.code).replace(/'/g, "\\'") + '\')">' +
        '<div class="result-thumb">' + (r.thumb ? '<img src="' + escapeHtml(r.thumb) + '">' : '📦') + '</div>' +
        '<div class="result-info">' +
          '<div class="result-name">' + escapeHtml(r.name || '(بدون نام)') + '</div>' +
          '<div class="result-meta">' +
            '<span class="code-pill-sm">' + escapeHtml(r.code) + '</span>' +
            (r.category ? '<span>' + escapeHtml(r.category) + '</span>' : '') +
            (r.qty !== '' && r.qty != null ? '<span>موجودی: ' + escapeHtml(r.qty) + '</span>' : '') +
          '</div>' +
          lastCountHtml +
        '</div>' +
      '</div>';
  });
  html += '</div>';
  area.innerHTML = html;
}

function backToSearch() {
  currentDetail = null;
  if (lastSearchResults && lastSearchResults.length > 1) {
    renderResultsList(lastSearchResults, lastSearchQuery);
  } else {
    renderRecentList();
  }
}

// ===================== کالاهای باقیمانده (هنوز شمارش نشده) =====================
// >>> افزوده شد: این بخش کاملاً افزودنی است — هیچ تابع/رفتار موجودی را تغییر نمی‌دهد.
// داده از همان کش آفلاینِ کالاها (offline_items_index) خوانده می‌شود که refreshOfflineCache()
// (همان تابعی که سایر بخش‌های اپ — جست‌وجوی آفلاین، جزئیات کالا — از آن استفاده می‌کنند) پر
// می‌کند؛ یعنی هیچ درخواست/فیلد جدیدی به سرور اضافه نشده (فقط فیلد افزودنیِ everCounted که
// از قبل در پاسخ apiOfflineIndex قرار گرفته استفاده می‌شود). بنابراین هم آنلاین و هم آفلاین
// کار می‌کند، دقیقاً مثل «لیست قفسه‌ها».
var remainingItemsData_ = [];      // آخرین فهرست کالاهای باقیمانده (بدون فیلتر)
var remainingItemsLoaded_ = false; // آیا حداقل یک‌بار در این جلسه بارگذاری شده؟ (برای بازگشت سریع از جزئیات کالا)
var remainingSort_ = { key: '', dir: 1 };

// کالاهایی که تا به حال (بدون محدودیت زمانی) شمارش نشده‌اند — دقیقاً همان تعریفِ
// «کالاهای باقیمانده» در پنل مدیریتی (getCountCoverage)
function filterRemainingFromIndex_(items) {
  return (items || []).filter(function (it) { return !it.everCounted; });
}

// >>> افزوده شد: به‌روزرسانی نشان تعداد روی دکمه‌ی ورودی، زیر نوار جست‌وجو — از همان کش
// موجود می‌خواند (بدون درخواست جدید)؛ اگر هنوز هیچ کشی موجود نباشد (مثلاً قبل از اولین ورود
// آنلاین)، دکمه پنهان می‌ماند تا عدد نادرست/فرضی نشان داده نشود.
function refreshRemainingCountBadge_() {
  SyncDB.cacheGet('offline_items_index').then(function (rec) {
    var items = (rec && rec.value) ? rec.value : [];
    if (!items.length) { var btn0 = document.getElementById('remainingEntryBtn'); if (btn0) btn0.style.display = 'none'; return; }
    var remaining = filterRemainingFromIndex_(items);
    var badge = document.getElementById('remainingCountBadge');
    if (badge) badge.textContent = String(remaining.length);
    var btn = document.getElementById('remainingEntryBtn');
    if (btn) btn.style.display = remaining.length ? '' : 'none';
  }).catch(function () {});
}

function remainingBack() {
  showScreen('mainScreen');
  setActiveNav('search');
}

// preferCache=true: اگر قبلاً در همین جلسه بارگذاری شده، بدون درخواست جدید همان را دوباره نشان بده
// (برای بازگشت سریع از جزئیات کالا با «بازگشت به لیست» — تجربه‌ی کاربری روان‌تر، بدون تاخیر شبکه)
function openRemainingItemsList(preferCache) {
  showScreen('remainingScreen');
  setActiveNav('search');
  setText('headerTitleRemaining', 'کالاهای باقیمانده');
  var area = document.getElementById('remainingArea');

  if (preferCache && remainingItemsLoaded_) {
    renderRemainingItemsList();
    return;
  }

  area.innerHTML = '<div class="lookup-loading"><div class="spinner"></div> در حال بارگذاری فهرست کالاهای باقیمانده...</div>';

  // آفلاین: مستقیم از کش موجود بخوان (بدون تلاش برای apiCall) — دقیقاً مثل openShelvesList
  if (!isOnline()) {
    SyncDB.cacheGet('offline_items_index').then(function (rec) {
      var items = (rec && rec.value) ? rec.value : [];
      if (!items.length) {
        area.innerHTML = '<div class="empty-hint">اتصال اینترنت برقرار نیست و داده‌ای برای کالاها ذخیره نشده است. لطفاً یک‌بار وقتی آنلاین هستید وارد شوید.</div>';
        return;
      }
      showToast('نمایش داده‌ی محلی (آفلاین)', false);
      remainingItemsData_ = filterRemainingFromIndex_(items);
      remainingItemsLoaded_ = true;
      renderRemainingItemsList();
    }).catch(function () {
      area.innerHTML = '<div class="empty-hint">اتصال اینترنت برقرار نیست.</div>';
    });
    return;
  }

  // آنلاین: از همان refreshOfflineCache() استفاده می‌شود (همان apiOfflineIndex که Sync هم
  // استفاده می‌کند) تا کش هم به‌روز شود و هم بلافاصله برای این صفحه استفاده گردد — بدون
  // هیچ درخواست/منطق تکراری.
  refreshOfflineCache().then(function () {
    return SyncDB.cacheGet('offline_items_index');
  }).then(function (rec) {
    var items = (rec && rec.value) ? rec.value : [];
    remainingItemsData_ = filterRemainingFromIndex_(items);
    remainingItemsLoaded_ = true;
    renderRemainingItemsList();
    refreshRemainingCountBadge_();
  }).catch(function (err) {
    // اگر دانلود کامل شکست بخورد (مثلاً اتصال ناپایدار)، تلاش برای نمایش آخرین نسخه‌ی کش‌شده
    SyncDB.cacheGet('offline_items_index').then(function (rec) {
      var items = (rec && rec.value) ? rec.value : [];
      if (items.length) {
        showToast('نمایش نسخه‌ی ذخیره‌شده (آفلاین)', false);
        remainingItemsData_ = filterRemainingFromIndex_(items);
        remainingItemsLoaded_ = true;
        renderRemainingItemsList();
      } else {
        area.innerHTML = '<div class="empty-hint">خطا: ' + escapeHtml(err.message) + '</div>';
      }
    }).catch(function () {
      area.innerHTML = '<div class="empty-hint">خطا: ' + escapeHtml(err.message) + '</div>';
    });
  });
}

// ستون‌های جدول: [کلید، عنوان، نوعِ فیلتر ('text' یا استخراج‌شده از fields)]
var REMAINING_COLUMNS_ = [
  { key: 'name', label: 'نام کالا' },
  { key: 'code', label: 'کد کالا' },
  { key: 'qty', label: 'تعداد' },
  { key: 'unit', label: 'واحد سنجش' },
  { key: 'whcode', label: 'کد انبار' },
  { key: 'spec', label: 'مشخصات فنی' }
];

// یک ردیفِ خام کش‌شده را به مقادیر نمایشیِ ستون‌های جدول تبدیل می‌کند — از همان item.fields
// موجود (بدون هیچ فیلد جدید سمت سرور)، دقیقاً با همان روش findUnitFromFields_ استفاده‌شده
// در بقیه‌ی اپ برای «واحد سنجش».
function remainingRowValues_(it) {
  var unit = findUnitFromFields_(it);
  var whcode = findFieldValue_(it, 'کد انبار');
  if (whcode === '' && it.warehouses && it.warehouses.length) whcode = it.warehouses[0].warehouse || '';
  var spec = findFieldValue_(it, 'TechnicalSpecification');
  return {
    name: it.name || '', code: it.code || '',
    qty: (it.systemQty === '' || it.systemQty == null) ? '' : it.systemQty,
    unit: unit || '', whcode: whcode || '', spec: spec || ''
  };
}

function renderRemainingItemsList() {
  var area = document.getElementById('remainingArea');
  if (!remainingItemsData_.length) {
    area.innerHTML = '<div class="empty-hint">🎉 همه‌ی کالاها حداقل یک‌بار شمارش شده‌اند.</div>';
    return;
  }

  var filterCellsHtml = REMAINING_COLUMNS_.map(function (c) {
    return '<th class="shelf-th sortable-th" onclick="sortRemainingBy_(\'' + c.key + '\')">' +
      '<span class="sortable-th-label">' + escapeHtml(c.label) + '<span class="sort-arrow" id="sortArrow_' + c.key + '"></span></span>' +
      '<input class="shelf-filter-input" id="rflt_' + c.key + '" onclick="event.stopPropagation();" oninput="applyRemainingFilter_()" placeholder="جست‌وجو...">' +
    '</th>';
  }).join('');

  var html =
    '<div class="section-title">کالاهای باقیمانده (<span id="remainingListCountLabel">' + remainingItemsData_.length + '</span>)</div>' +
    '<div class="table-wrap"><table class="data-table" id="remainingListTable"><thead><tr>' + filterCellsHtml + '</tr></thead>' +
    '<tbody id="remainingListBody">' + buildRemainingRowsHtml_(remainingItemsData_) + '</tbody></table></div>';
  area.innerHTML = html;
}

function buildRemainingRowsHtml_(list) {
  if (!list.length) return '<tr><td colspan="' + REMAINING_COLUMNS_.length + '"><div class="empty-hint">کالایی با این فیلتر یافت نشد.</div></td></tr>';
  return list.map(function (it) {
    var v = remainingRowValues_(it);
    var safeCode = escapeHtml(String(it.code)).replace(/'/g, "\\'");
    return '<tr class="clickable" onclick="viewItemFromRemainingList(\'' + safeCode + '\')">' +
      '<td>' + escapeHtml(v.name || '—') + '</td>' +
      '<td class="code-cell">' + escapeHtml(v.code) + '</td>' +
      '<td class="num-cell">' + escapeHtml(v.qty === '' ? '—' : String(v.qty)) + '</td>' +
      '<td>' + escapeHtml(v.unit || '—') + '</td>' +
      '<td>' + escapeHtml(v.whcode || '—') + '</td>' +
      '<td>' + escapeHtml(v.spec || '—') + '</td>' +
    '</tr>';
  }).join('');
}

// فیلتر لحظه‌ای، روی همان آرایه‌ی موجود در حافظه (remainingItemsData_) — بدون درخواست جدید
// به سرور و بدون رفرش صفحه، مثل applyShelvesFilter_
function applyRemainingFilter_() {
  var filters = {};
  REMAINING_COLUMNS_.forEach(function (c) {
    var el = document.getElementById('rflt_' + c.key);
    filters[c.key] = el ? el.value.trim().toLowerCase() : '';
  });

  var filtered = remainingItemsData_.filter(function (it) {
    var v = remainingRowValues_(it);
    return REMAINING_COLUMNS_.every(function (c) {
      if (!filters[c.key]) return true;
      return String(v[c.key] == null ? '' : v[c.key]).toLowerCase().indexOf(filters[c.key]) !== -1;
    });
  });

  filtered = sortRemainingList_(filtered);

  var body = document.getElementById('remainingListBody');
  if (body) body.innerHTML = buildRemainingRowsHtml_(filtered);
  var countLabel = document.getElementById('remainingListCountLabel');
  if (countLabel) countLabel.textContent = filtered.length + (filtered.length !== remainingItemsData_.length ? ' از ' + remainingItemsData_.length : '');
}

function sortRemainingList_(list) {
  if (!remainingSort_.key) return list;
  var key = remainingSort_.key, dir = remainingSort_.dir;
  var copy = list.slice();
  copy.sort(function (a, b) {
    var va = remainingRowValues_(a)[key], vb = remainingRowValues_(b)[key];
    var na = Number(va), nb = Number(vb);
    var cmp;
    if (va !== '' && vb !== '' && !isNaN(na) && !isNaN(nb)) cmp = na - nb;
    else cmp = String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'fa');
    return cmp * dir;
  });
  return copy;
}

// کلیک روی عنوان ستون: مرتب‌سازی صعودی/نزولی (کلیک دوباره جهت را برعکس می‌کند)
function sortRemainingBy_(key) {
  if (remainingSort_.key === key) remainingSort_.dir *= -1;
  else { remainingSort_.key = key; remainingSort_.dir = 1; }
  REMAINING_COLUMNS_.forEach(function (c) {
    var el = document.getElementById('sortArrow_' + c.key);
    if (!el) return;
    el.textContent = (c.key === key) ? (remainingSort_.dir === 1 ? ' ▲' : ' ▼') : '';
  });
  applyRemainingFilter_();
}

// کلیک روی یک ردیف: همان مسیر همیشگیِ باز کردن جزئیات کالا (بدون هیچ منطق تکراری)، فقط با
// نشانه‌ای که به کارت جزئیات می‌گوید لینک «بازگشت» باید به همین لیست برگردد.
function viewItemFromRemainingList(code) {
  openItemDetail(code, 'remaining');
}

function backToRemainingList_() {
  currentDetail = null;
  openRemainingItemsList(true);
}
// ===================== پایان بخش کالاهای باقیمانده =====================

// ===================== پیش‌نمایش عمومی کالا (قبل از ورود) =====================
// کش محلی فایل items.json (تا وقتی صفحه باز است، دوباره دانلود نمی‌شود)
var itemsJsonCache = null;

function openPublicItemPreview(code) {
  showScreen('publicItemScreen');
  var area = document.getElementById('publicItemArea');
  area.innerHTML = '<div class="lookup-loading"><div class="spinner"></div> در حال دریافت مشخصات کالا...</div>';
  renderPublicLoginBar(code);

  loadItemsJson().then(function (items) {
    var normalizedCode = normalizePersianDigits(String(code).trim());
    var found = items.filter(function (it) { return normalizePersianDigits(String(it.code).trim()) === normalizedCode; })[0];
    if (!found) {
      area.innerHTML = '<div class="empty-hint">کالایی با این کد پیدا نشد.<br>ممکن است فایل کالاها هنوز به‌روزرسانی نشده باشد.</div>';
      return;
    }
    renderPublicItemPreview(found, code);
  }).catch(function (err) {
    area.innerHTML = '<div class="empty-hint">خطا در بارگذاری فایل کالاها: ' + escapeHtml(err.message) + '</div>';
  });
}

/**
 * نوار «ورود کاربر» بالای صفحه‌ی پیش‌نمایش — همیشه نمایش داده می‌شود،
 * چه کالا پیدا شود چه نشود (مثلاً هنگام خطای items.json).
 */
function renderPublicLoginBar(code) {
  var bar = document.getElementById('publicLoginBar');
  if (!bar) return;
  bar.innerHTML =
    '<button class="btn btn-secondary public-login-btn" id="publicLoginBarBtn">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>' +
      ' ورود کاربر' +
    '</button>';
  document.getElementById('publicLoginBarBtn').addEventListener('click', function () { goLoginKeepPending(code); });
}

/**
 * فایل استاتیک items.json را از همین ریپوی گیت‌هاب می‌خواند (بدون هیچ تماسی با گوگل).
 * این فایل به‌صورت دوره‌ای توسط اسکریپت گوگل‌شیت روی گیت‌هاب به‌روزرسانی می‌شود.
 */
function loadItemsJson() {
  if (itemsJsonCache) return Promise.resolve(itemsJsonCache);
  return fetch('./items.json', { cache: 'no-store' })
    .then(function (resp) {
      if (!resp.ok) throw new Error('فایل items.json پیدا نشد (کد ' + resp.status + ')');
      return resp.json();
    })
    .then(function (data) {
      itemsJsonCache = data;
      // >>> افزوده شد: کش محلی برای دسترسی آفلاین به پیش‌نمایش کالا
      SyncDB.cacheSet('items_json', data, 24 * 60 * 60 * 1000).catch(function () {});
      // <<< پایان بخش افزوده‌شده
      return data;
    })
    .catch(function (err) {
      // >>> افزوده شد: در صورت قطع اینترنت یا خطای شبکه، بازیابی از کش محلی
      return SyncDB.cacheGet('items_json').then(function (rec) {
        if (rec && rec.value) { itemsJsonCache = rec.value; return rec.value; }
        throw err;
      });
      // <<< پایان بخش افزوده‌شده
    });
}

function renderPublicItemPreview(item, code) {
  var area = document.getElementById('publicItemArea');
  var images = item.images || [];
  var fields = item.fields || [];

  var galleryHtml;
  if (images.length) {
    galleryHtml = '<div class="item-gallery">' + images.map(function (src) {
      return '<img src="' + escapeHtml(src) + '" onerror="this.style.display=\'none\'">';
    }).join('') + '</div>';
  } else {
    galleryHtml = '<div class="item-noimg">تصویری ثبت نشده</div>';
  }

  var fieldsHtml = '';
  if (fields.length) {
    fieldsHtml = '<div class="item-fields">' + fields.map(function (f) {
      return '<div class="item-field"><div class="k">' + escapeHtml(f[0]) + '</div><div class="v">' + escapeHtml(f[1]) + '</div></div>';
    }).join('') + '</div>';
  }

  area.innerHTML =
    '<div class="item-detail-card">' +
      galleryHtml +
      '<div class="item-title">' + escapeHtml(item.name || '(بدون نام)') + '</div>' +
      '<div class="item-code-pill">' + escapeHtml(item.code) + '</div>' +
      fieldsHtml +
      '<div class="public-login-note">برای دیدن موجودی و ثبت شمارش این کالا، ابتدا وارد سامانه شوید.</div>' +
      '<button class="btn btn-primary" id="publicItemLoginBtn">ورود و ثبت شمارش این کالا</button>' +
    '</div>';
  var loginBtn = document.getElementById('publicItemLoginBtn');
  if (loginBtn) loginBtn.addEventListener('click', function () { goLoginKeepPending(code); });
}

function goLoginKeepPending(code) {
  pendingId = code; // بعد از ورود موفق، مستقیم همین کالا باز می‌شود
  showScreen('loginScreen');
}

// ===================== جزئیات کامل کالا =====================
// >>> افزوده شد: نمایش جزئیات کالا از کش آفلاین — اول جزئیات کامل قبلاً کش‌شده (item_<code>)،
// در نبود آن از خلاصه‌ی فهرست آفلاینِ کالاها (offline_items_index) که در refreshOfflineCache
// ذخیره شده استفاده می‌شود (پس حتی کالایی که هرگز قبلاً باز نشده هم آفلاین قابل مشاهده است).
function showItemFromOfflineCache(code, area, fallbackMsg) {
  SyncDB.cacheGet('item_' + code).then(function (rec) {
    if (rec && rec.value) {
      currentDetail = rec.value;
      showToast('نمایش نسخه‌ی ذخیره‌شده (آفلاین)', false);
      renderItemDetail(rec.value);
      return;
    }
    SyncDB.cacheGet('offline_items_index').then(function (idxRec) {
      var items = (idxRec && idxRec.value) ? idxRec.value : [];
      var found = items.filter(function (it) { return String(it.code) === String(code); })[0];
      if (!found) {
        area.innerHTML =
          detailBackLinkHtml_() +
          '<div class="empty-hint">' + escapeHtml(fallbackMsg || 'اتصال اینترنت برقرار نیست و این کالا در داده‌ی محلی موجود نیست.') + '</div>';
        return;
      }
      // >>> افزوده شد: فیلدهای توصیفی و آخرین شمارش حالا در offline_items_index موجودند
      // (فقط تصویر ندارند، طبق نیاز — تصاویر آفلاین لازم نیستند)
      var minimal = {
        success: true, code: found.code, name: found.name, systemQty: found.systemQty,
        images: [], fields: found.fields || [], warehouses: found.warehouses || [], lastCount: found.lastCount || null
      };
      // <<< پایان بخش افزوده‌شده
      // فیلدهای وزن/قفسه فقط برای کاربرانی که دسترسی انبار دارند در فهرست آفلاین ذخیره شده‌اند
      if (state.warehouseAccess && found.shelfCode !== undefined) {
        minimal.unitWeight = found.unitWeight;
        minimal.shelfCode = found.shelfCode;
        minimal.shelf = null;
        minimal.totalWeight = null;
        minimal.unitWeightDisplay = (found.unitWeight !== '' && found.unitWeight != null) ? (String(found.unitWeight) + ' kg') : 'ثبت‌نشده';
        minimal.totalWeightDisplay = '—';
        minimal.shelfDisplay = found.shelfCode || 'تعیین‌نشده';
        minimal.shelfLoad = null; // آفلاین: بار زنده‌ی قفسه قابل محاسبه نیست، فقط پس از اتصال به‌روز می‌شود
        minimal.activeShelves = [];
        minimal.shelves = found.shelves || []; // >>> افزوده شد: چند قفسه‌ای هم آفلاین در دسترس باشد
      }
      // >>> افزوده شد: پر کردن کشویی قفسه در حالت آفلاین از کش «فهرست قفسه‌های فعال»
      if (state.warehouseAccess && found.shelfCode !== undefined) {
        SyncDB.cacheGet('active_shelves_list').then(function (asRec) {
          minimal.activeShelves = (asRec && asRec.value) ? asRec.value : [];
          currentDetail = minimal;
          showToast('نمایش نسخه‌ی خلاصه از داده‌ی محلی (آفلاین)', false);
          renderItemDetail(minimal);
        }).catch(function () {
          currentDetail = minimal;
          showToast('نمایش نسخه‌ی خلاصه از داده‌ی محلی (آفلاین)', false);
          renderItemDetail(minimal);
        });
        return;
      }
      // <<< پایان بخش افزوده‌شده
      currentDetail = minimal;
      showToast('نمایش نسخه‌ی خلاصه از داده‌ی محلی (آفلاین)', false);
      renderItemDetail(minimal);
    }).catch(function () {
      area.innerHTML = '<div class="empty-hint">' + escapeHtml(fallbackMsg || 'اتصال اینترنت برقرار نیست.') + '</div>';
    });
  }).catch(function () {
    area.innerHTML = '<div class="empty-hint">' + escapeHtml(fallbackMsg || 'اتصال اینترنت برقرار نیست.') + '</div>';
  });
}
// <<< پایان بخش افزوده‌شده

// >>> افزوده شد: از کجا کاربر وارد جزئیات کالا شده؟ ('search' یا 'remaining') — فقط برای
// تصمیم‌گیری در مورد متن/رفتار لینک «بازگشت» بالای کارت جزئیات استفاده می‌شود؛ هیچ منطق
// دیگری (نمایش/ثبت شمارش) به این مقدار وابسته نیست.
var itemDetailBackTarget = 'search';
function detailBackLinkHtml_() {
  if (itemDetailBackTarget === 'remaining') {
    return '<button class="back-link" onclick="backToRemainingList_()">‹ بازگشت به لیست</button>';
  }
  return '<button class="back-link" onclick="backToSearch()">‹ بازگشت به جست‌وجو</button>';
}
// <<< پایان بخش افزوده‌شده

function openItemDetail(code, backTarget) {
  itemDetailBackTarget = (backTarget === 'remaining') ? 'remaining' : 'search';
  var area = document.getElementById('resultArea');

  // >>> افزوده شد: اگر اینترنت قطع است، مستقیم از کش آفلاین بخوان (بدون تلاش برای apiCall)
  if (!isOnline()) {
    area.innerHTML = '<div class="lookup-loading"><div class="spinner"></div> در حال بارگذاری از داده‌ی محلی...</div>';
    showItemFromOfflineCache(code, area);
    return;
  }
  // <<< پایان بخش افزوده‌شده

  area.innerHTML = '<div class="lookup-loading"><div class="spinner"></div> در حال دریافت مشخصات کالا...</div>';

  apiCall('apiLookup', { token: state.token, code: code }).then(function (res) {
    if (handleIfSessionExpired(res)) return;
    if (!res.success) {
      area.innerHTML =
        detailBackLinkHtml_() +
        '<div class="empty-hint">' + escapeHtml(res.message || 'کالا پیدا نشد.') + '</div>';
      return;
    }
    currentDetail = res;
    // >>> افزوده شد: کش محلی جزئیات کالا برای دسترسی آفلاین بعدی
    SyncDB.cacheSet('item_' + code, res, 24 * 60 * 60 * 1000).catch(function () {});
    // <<< پایان بخش افزوده‌شده
    renderItemDetail(res);
  }).catch(function (err) {
    // >>> افزوده شد: در صورت قطع/ناپایداری اینترنت، تلاش برای نمایش آخرین نسخه‌ی کش‌شده
    showItemFromOfflineCache(code, area, isOnline() ? err.message : null);
    // <<< پایان بخش افزوده‌شده
  });
}

// >>> افزوده شد: آیکون‌های کوچک استفاده‌شده در هدر کارت‌های جزئیات کالا (بازطراحی بصری)
var ICON_WAREHOUSE_ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-8h6v8"/></svg>';
var ICON_SHELF_ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/></svg>';
var ICON_CAPACITY_ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>';
var ICON_WEIGHT_ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3"/><path d="M6 8H4L3 20h18L20 8h-2"/></svg>';
var ICON_COUNT_ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6v4H9z"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><path d="M9 12h6M9 16h6"/></svg>';
var ICON_EDIT_ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
var ICON_TRASH_ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

// نگاشت کد قفسه -> نام/محل قفسه، از همان فهرست قفسه‌های فعالِ همراه پاسخ apiLookup
function buildShelfNameMap_(item) {
  var map = {};
  (item.activeShelves || []).forEach(function (s) { map[s.code] = s.location || ''; });
  return map;
}
// واحد شمارش کالا از میان فیلدهای توصیفی موجود (مثلاً «واحد: عدد») — بدون فرض/ساخت داده‌ی جدید
function findUnitFromFields_(item) {
  var f = item.fields || [];
  for (var i = 0; i < f.length; i++) {
    if (String(f[i][0]).indexOf('واحد') !== -1) return f[i][1];
  }
  return '';
}

// >>> افزوده شد: مقدار یک فیلد توصیفی بر اساس بخشی از عنوان آن (مثلاً «کد انبار» یا
// «TechnicalSpecification») — همان آرایه‌ی fields موجود، بدون هیچ فیلد/درخواست جدید.
function findFieldValue_(item, keyword) {
  var f = item.fields || [];
  for (var i = 0; i < f.length; i++) {
    if (String(f[i][0]).indexOf(keyword) !== -1) return f[i][1];
  }
  return '';
}
// <<< پایان بخش افزوده‌شده

// >>> افزوده شد: انتخاب دومرحله‌ایِ قفسه (نام قفسه → کد قفسه) — در همه‌جا (پنل وزن/تخصیص قفسه،
// ردیف‌های شمارش) از همین دو تابع استفاده می‌شود. منبع داده دقیقاً همان activeShelves موجود
// (از شیت «قفسه‌ها») است؛ فقط بر اساس ستون «محل» (به‌عنوان «نام قفسه») گروه‌بندی می‌شود — هیچ
// داده‌ی جدید/تکراری ساخته نمی‌شود.
function groupShelvesByName_(activeShelves) {
  var groups = {}; var order = [];
  (activeShelves || []).forEach(function (s) {
    // >>> بازطراحی شد: اولویت با فیلد category (سمت سرور، از شیت «قفسه‌ها» محاسبه می‌شود —
    // نام‌های واقعی مثل A, B, C...)؛ location/code فقط برای سازگاری با کش آفلاینِ قدیمی‌تر
    // (قبل از این نسخه) که هنوز فیلد category را نداشت، به‌عنوان جایگزین نگه داشته شده‌اند.
    var name = s.category || s.location || s.code;
    // <<< پایان بخش بازطراحی‌شده
    if (!groups[name]) { groups[name] = []; order.push(name); }
    groups[name].push(s);
  });
  return { groups: groups, order: order };
}

var shelfCascadeGroups_ = {}; // idِ سلکت «نام قفسه» -> گروه‌بندی مربوطه (برای onShelfNameCascadeChange_)

// جفت سلکتِ عمودی (با برچسب) برای فرم‌های پنل وزن/تخصیص قفسه — id سلکتِ «کد» همان چیزی است
// که کد قبلی/سرور انتظار دارد (مثلاً shelfSelect یا newShelfSelect)، تا هیچ منطق دیگری لازم
// نباشد تغییر کند.
function buildShelfCascadeHtml_(codeSelectId, activeShelves, selectedCode, emptyCodeLabel) {
  var g = groupShelvesByName_(activeShelves);
  var nameSelectId = codeSelectId + 'Name';
  shelfCascadeGroups_[nameSelectId] = g;

  var selectedName = '';
  if (selectedCode) {
    for (var i = 0; i < g.order.length; i++) {
      if (g.groups[g.order[i]].some(function (s) { return s.code === selectedCode; })) { selectedName = g.order[i]; break; }
    }
  }

  var nameOptions = '<option value="">— انتخاب نام قفسه —</option>' + g.order.map(function (nm) {
    return '<option value="' + escapeHtml(nm) + '"' + (nm === selectedName ? ' selected' : '') + '>' + escapeHtml(nm) + '</option>';
  }).join('');

  var codeOptions = '<option value="">' + escapeHtml(emptyCodeLabel || '— ابتدا نام قفسه را انتخاب کنید —') + '</option>';
  if (selectedName && g.groups[selectedName]) {
    codeOptions += g.groups[selectedName].map(function (s) {
      return '<option value="' + escapeHtml(s.code) + '"' + (s.code === selectedCode ? ' selected' : '') + '>' + escapeHtml(s.code) + '</option>';
    }).join('');
  }
  if (selectedCode && (!selectedName || g.groups[selectedName].every(function (s) { return s.code !== selectedCode; }))) {
    codeOptions += '<option value="' + escapeHtml(selectedCode) + '" selected>' + escapeHtml(selectedCode) + ' (غیرفعال/نامعتبر)</option>';
  }

  return '<label class="count-label">نام قفسه</label>' +
    '<select class="wh-select shelf-name-select" id="' + nameSelectId + '" data-code-target="' + codeSelectId + '" onchange="onShelfNameCascadeChange_(this)" style="margin-bottom:8px;">' + nameOptions + '</select>' +
    '<label class="count-label">کد قفسه</label>' +
    '<select class="wh-select shelf-code-select" id="' + codeSelectId + '">' + codeOptions + '</select>';
}

// جفت سلکتِ افقیِ فشرده برای ردیف‌های «ثبت شمارش انبارگردانی» — سلکتِ کد همچنان کلاس
// count-row-shelf را دارد تا submitAll() بدون هیچ تغییری همان‌طور که بود کار کند.
function buildCountRowShelfCascadeHtml_(codeSelectId, activeShelves, selectedCode) {
  var g = groupShelvesByName_(activeShelves);
  var nameSelectId = codeSelectId + 'Name';
  shelfCascadeGroups_[nameSelectId] = g;

  var selectedName = '';
  if (selectedCode) {
    for (var i = 0; i < g.order.length; i++) {
      if (g.groups[g.order[i]].some(function (s) { return s.code === selectedCode; })) { selectedName = g.order[i]; break; }
    }
  }

  var nameOptions = '<option value="">— نام قفسه —</option>' + g.order.map(function (nm) {
    return '<option value="' + escapeHtml(nm) + '"' + (nm === selectedName ? ' selected' : '') + '>' + escapeHtml(nm) + '</option>';
  }).join('');
  var codeOptions = '<option value="">— کد قفسه —</option>';
  if (selectedName && g.groups[selectedName]) {
    codeOptions += g.groups[selectedName].map(function (s) {
      return '<option value="' + escapeHtml(s.code) + '"' + (s.code === selectedCode ? ' selected' : '') + '>' + escapeHtml(s.code) + '</option>';
    }).join('');
  }

  return '<select class="count-row-shelf-name" id="' + nameSelectId + '" data-code-target="' + codeSelectId + '" onchange="onShelfNameCascadeChange_(this)">' + nameOptions + '</select>' +
    '<select class="count-row-shelf" id="' + codeSelectId + '" onchange="onCountRowCodeChange_(this)">' + codeOptions + '</select>';
}

// وقتی «نام قفسه» عوض شود، گزینه‌های «کد قفسه»‌ی متناظر (از همان گروه‌بندیِ activeShelves) پر می‌شود
function onShelfNameCascadeChange_(nameSel) {
  var codeSelId = nameSel.getAttribute('data-code-target');
  var codeSel = document.getElementById(codeSelId);
  if (!codeSel) return;
  var g = shelfCascadeGroups_[nameSel.id];
  var name = nameSel.value;
  if (!g || !name || !g.groups[name]) {
    codeSel.innerHTML = '<option value="">— ابتدا نام قفسه را انتخاب کنید —</option>';
  } else {
    codeSel.innerHTML = '<option value="">— انتخاب کد —</option>' + g.groups[name].map(function (s) {
      return '<option value="' + escapeHtml(s.code) + '">' + escapeHtml(s.code) + '</option>';
    }).join('');
  }
  // >>> افزوده شد: با تغییر نام قفسه، انتخاب کد باطل می‌شود؛ پس «موجودی فعلی» هم باید ریست شود
  updateCountRowCurrentQtyBadge_(codeSel, '');
  // <<< پایان بخش افزوده‌شده
}

// >>> افزوده شد: نمایش «موجودی فعلی» — وقتی کاربر یک کد قفسه را انتخاب می‌کند، اگر آن قفسه از
// قبل روی این کالا موجودیِ ثبت‌شده دارد (currentDetail.shelves)، همان مقدار نشان داده می‌شود؛
// در غیر این‌صورت («قفسه‌ی تازه») چیزی برای نمایش نیست.
function onCountRowCodeChange_(selectEl) {
  updateCountRowCurrentQtyBadge_(selectEl, selectEl.value);
}
function updateCountRowCurrentQtyBadge_(codeSelectEl, shelfCode) {
  var row = codeSelectEl.closest('.count-row');
  if (!row) return;
  var badge = row.querySelector('.count-row-current-qty');
  if (!badge) return;
  var match = shelfCode && currentDetail ? (currentDetail.shelves || []).filter(function (s) { return s.shelfCode === shelfCode; })[0] : null;
  var val = (match && match.qty !== '' && match.qty !== null && match.qty !== undefined) ? match.qty : null;
  badge.textContent = val === null ? '—' : String(val);
}
// <<< پایان بخش افزوده‌شده

function renderItemDetail(item) {
  setHeaderTitle('جزئیات کالا');
  var area = document.getElementById('resultArea');
  var images = item.images || [];
  var fields = item.fields || [];
  var warehouses = item.warehouses || [];
  var shelves = item.shelves || [];
  var hasWarehouseAccess = item.shelfDisplay !== undefined; // همان معیار قبلی سرور برای نمایش بخش وزن/قفسه
  var shelfNameMap = buildShelfNameMap_(item);
  var unit = findUnitFromFields_(item);

  var galleryHtml = images.length
    ? '<div class="item-gallery">' + images.map(function (src) { return '<img src="' + escapeHtml(src) + '" onerror="this.style.display=\'none\'">'; }).join('') + '</div>'
    : '<div class="item-noimg">تصویری ثبت نشده</div>';

  var fieldsHtml = fields.length
    ? '<div class="item-fields">' + fields.map(function (f) { return '<div class="item-field"><div class="k">' + escapeHtml(f[0]) + '</div><div class="v">' + escapeHtml(f[1]) + '</div></div>'; }).join('') + '</div>'
    : '';

  // ---------- کارت اصلی ----------
  var mainCard =
    '<div class="detail-card"><div class="detail-card-body">' +
      detailBackLinkHtml_() +
      galleryHtml +
      '<div class="item-title">' + escapeHtml(item.name || '(بدون نام)') + '</div>' +
      '<div class="item-code-pill">' + escapeHtml(item.code) + '</div>' +
      fieldsHtml +
    '</div></div>';

  // ---------- موجودی به تفکیک انبار (همیشه نمایش داده می‌شود؛ حتی بدون هیچ انباری) ----------
  var warehousesCard =
    '<div class="detail-card">' +
      '<div class="detail-card-header"><span class="t">موجودی به تفکیک انبار</span><span class="ic">' + ICON_WAREHOUSE_ + '</span></div>' +
      '<div class="detail-card-body">' +
        (warehouses.length > 0
          ? '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              (unit ? '<th>واحد</th>' : '') + '<th>موجودی</th><th>نام انبار</th>' +
            '</tr></thead><tbody>' +
              warehouses.map(function (w) {
                return '<tr>' + (unit ? '<td>' + escapeHtml(unit) + '</td>' : '') +
                  '<td class="num-cell">' + escapeHtml(w.qty === '' || w.qty == null ? '—' : String(w.qty)) + '</td>' +
                  '<td>' + escapeHtml(w.warehouse) + '</td></tr>';
              }).join('') +
            '</tbody></table></div>'
          : '<div class="empty-hint">این کالا در هیچ انباری ثبت نشده است.</div>') +
      '</div>' +
    '</div>';

  // ---------- موجودی به تفکیک قفسه (همیشه نمایش داده می‌شود) ----------
  var shelvesCard =
    '<div class="detail-card">' +
      '<div class="detail-card-header"><span class="t">موجودی به تفکیک قفسه</span><span class="ic">' + ICON_SHELF_ + '</span></div>' +
      '<div class="detail-card-body">' +
        (!hasWarehouseAccess
          ? '<div class="empty-hint">مشاهده‌ی قفسه‌ها نیازمند دسترسی انبار است.</div>'
          : shelves.length > 0
            ? '<div class="table-wrap"><table class="data-table"><thead><tr>' +
                '<th>موجودی قفسه</th><th>نام قفسه</th><th>کد قفسه</th>' +
              '</tr></thead><tbody>' +
                shelves.map(function (s) {
                  var loc = (s.shelfName && s.shelfName.trim()) ? s.shelfName : (shelfNameMap[s.shelfCode] || '—');
                  return '<tr><td class="num-cell">' + escapeHtml(s.qty === '' || s.qty == null ? '—' : String(s.qty)) + '</td>' +
                    '<td>' + escapeHtml(loc) + '</td><td class="code-cell">' + escapeHtml(s.shelfCode) + '</td></tr>';
                }).join('') +
              '</tbody></table></div>'
            : '<div class="empty-hint">این کالا هنوز به هیچ قفسه‌ای تخصیص داده نشده است.</div>') +
      '</div>' +
    '</div>';

  // ---------- آخرین شمارش ----------
  var lastCountHtml = '';
  if (item.lastCount) {
    var lc = item.lastCount;
    var diffTxt = (lc.diff === '' || lc.diff === null || lc.diff === undefined) ? '' :
      (' · اختلاف: ' + (Number(lc.diff) > 0 ? '+' : '') + escapeHtml(String(lc.diff)));
    lastCountHtml =
      '<div class="last-count-box"><div class="k">آخرین شمارش ثبت‌شده</div>' +
      '<div class="v">' + escapeHtml(lc.date) + ' — موجودی فیزیکی: ' + escapeHtml(String(lc.physicalQty)) + diffTxt + '</div></div>';
  }

  // ---------- ظرفیت قفسه (همیشه نمایش داده می‌شود؛ برای قفسه‌های موجود، async بارگذاری می‌شود) ----------
  var capacityCard =
    '<div class="detail-card" id="shelfCapacityCard">' +
      '<div class="detail-card-header"><span class="t">ظرفیت قفسه</span><span class="ic">' + ICON_CAPACITY_ + '</span></div>' +
      '<div class="detail-card-body" id="shelfCapacityBody">' +
        (!hasWarehouseAccess
          ? '<div class="empty-hint">مشاهده‌ی ظرفیت قفسه نیازمند دسترسی انبار است.</div>'
          : shelves.length > 0
            ? '<div class="lookup-loading"><div class="spinner"></div> در حال بارگذاری ظرفیت قفسه‌ها...</div>'
            : '<div class="empty-hint">این کالا به قفسه‌ای تخصیص ندارد؛ ظرفیتی برای نمایش نیست.</div>') +
      '</div>' +
    '</div>';

  // ---------- وزن (بازطراحی شد: مداد فقط وزن را ویرایش‌پذیر می‌کند — بدون قفسه) ----------
  var weightCard;
  if (!hasWarehouseAccess) {
    weightCard =
      '<div class="detail-card">' +
        '<div class="detail-card-header"><span class="t">وزن</span><span class="ic">' + ICON_WEIGHT_ + '</span></div>' +
        '<div class="detail-card-body"><div class="empty-hint">مشاهده و ویرایش وزن نیازمند دسترسی انبار است.</div></div>' +
      '</div>';
  } else {
    weightCard =
      '<div class="detail-card">' +
        '<div class="detail-card-header"><span class="t">وزن</span><span class="ic">' + ICON_WEIGHT_ + '</span></div>' +
        '<div class="detail-card-body">' +
          '<div class="weight-row">' +
            '<div class="weight-cell"><div class="k">واحد</div><div class="v">kg</div></div>' +
            '<div class="weight-cell"><div class="k">وزن فعلی</div><div class="v" id="unitWeightView">' + escapeHtml(item.unitWeightDisplay) + '</div></div>' +
            '<button class="weight-edit-btn" id="toggleWeightBtn" onclick="toggleWeightEdit()" title="ویرایش وزن">' +
              '<span class="weight-edit-label">ویرایش</span>' + ICON_EDIT_ +
            '</button>' +
          '</div>' +
          '<div class="weight-meta-line">وزن کل موجودی: <b id="totalWeightView">' + escapeHtml(item.totalWeightDisplay) + '</b></div>' +
          '<div class="weight-edit" id="weightEditBox" style="display:none;margin-top:14px;">' +
            '<label class="count-label">وزن واحد (kg)</label>' +
            '<input type="number" class="qty-input" id="unitWeightInput" step="0.001" min="0" inputmode="decimal" value="' + (item.unitWeight === '' ? '' : escapeHtml(String(item.unitWeight))) + '" placeholder="مثلاً 2.5">' +
            '<div class="diff-preview" id="weightMsg"></div>' +
            '<div class="diff-preview" style="color:var(--muted);font-weight:500;">با دکمه‌ی «ثبت» پایین صفحه (در بخش «ثبت شمارش انبارگردانی») ذخیره می‌شود.</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // >>> بازطراحی شد: کارت جداگانه‌ی «تخصیص قفسه» کاملاً حذف شد — تخصیص/ویرایش قفسه از قبل و
  // به‌طور خودکار از طریق «ثبت شمارش انبارگردانی» انجام می‌شود (هر ردیف شمارش، نام‌قفسه→کدقفسه
  // را از همان فهرست کامل شیت «قفسه‌ها» انتخاب می‌کند؛ اگر آن قفسه هنوز به کالا تخصیص نیافته
  // باشد، submitAll()/ensureShelfAssignmentStep_ پیش از ثبت شمارش، تخصیص را خودش می‌سازد —
  // دقیقاً همان مکانیزم قبلی، بدون هیچ سامانه‌ی موازی/تکراری جدید). توابع
  // updateShelfAssignment/removeShelfAssignment/addShelfAssignment برای سازگاری عقب‌رو دست‌نخورده
  // در app.js باقی مانده‌اند، فقط دیگر از این‌جا (رابط کاربری) صدا زده نمی‌شوند.
  // <<< پایان بخش بازطراحی‌شده

  // ---------- ثبت شمارش انبارگردانی (چندردیفی — منبع قفسه‌ها: فهرست کامل شیت «قفسه‌ها») ----------
  var countRowsInit = buildInitialCountRows_(item);
  var countRowsHtml = countRowsInit.map(function (r) { return buildCountRowHtml_(r, warehouses, item.activeShelves || []); }).join('');

  // >>> افزوده شد: سرستون‌های واضح، دقیقاً هم‌راستا با دو خطِ هر ردیف (خط اول: انبار/نام‌قفسه،
  // خط دوم: کدقفسه/موجودی‌فعلی/تعداد)
  var countHeaderHtml =
    '<div class="count-row-header">' +
      '<div class="count-row-line1">' +
        (warehouses.length ? '<span>نام انبار</span>' : '') +
        (item.activeShelves && item.activeShelves.length ? '<span>نام قفسه</span>' : '') +
      '</div>' +
      '<div class="count-row-line2">' +
        (item.activeShelves && item.activeShelves.length ? '<span class="hdr-code">کد قفسه</span><span class="hdr-cur">موجودی فعلی</span>' : '') +
        '<span class="hdr-qty">تعداد/مقدار شمارش</span>' +
      '</div>' +
    '</div>';
  // <<< پایان بخش افزوده‌شده

  var countCard =
    '<div class="detail-card">' +
      '<div class="detail-card-header"><span class="t">ثبت شمارش انبارگردانی</span><span class="ic">' + ICON_COUNT_ + '</span></div>' +
      '<div class="detail-card-body">' +
        lastCountHtml +
        '<div class="sys-qty-row"><span class="k">موجودی سیستم' + (warehouses.length > 1 ? ' (مجموع کل انبارها)' : '') + '</span><span class="v">' + escapeHtml(item.systemQty !== '' && item.systemQty != null ? item.systemQty : '—') + '</span></div>' +
        countHeaderHtml +
        '<div class="count-rows" id="countRowsBox">' + countRowsHtml + '</div>' +
        '<button type="button" class="add-row-btn" onclick="addCountRow()">+ افزودن ردیف</button>' +
        '<textarea class="note-input" id="noteInput" placeholder="توضیحات (اختیاری)..."></textarea>' +
        '<button class="btn btn-primary" id="submitCountBtn" onclick="submitAll()">ثبت</button>' +
      '</div>' +
    '</div>';

  area.innerHTML = mainCard + warehousesCard + shelvesCard + capacityCard + weightCard + countCard;

  if (hasWarehouseAccess && shelves.length > 0) {
    loadShelfCapacitySection(item.code, shelves.map(function (s) { return s.shelfCode; }));
  }
}

// >>> بازطراحی شد: ردیف‌های اولیه‌ی فرم شمارش — یک ردیف به‌ازای هر قفسه‌ی از قبل تخصیص‌یافته
// (مقدار پیش‌فرض = موجودی فعلی همان قفسه)، یا در نبود هیچ قفسه‌ای، یک ردیف خالی که همچنان
// کشوی «نام قفسه» را از فهرست کاملِ شیت «قفسه‌ها» پر می‌کند تا کاربر بتواند قفسه را انتخاب کند.
// >>> بازطراحی شد: مقدار «تعداد/مقدار شمارش» دیگر از قبل با موجودیِ فعلی پر نمی‌شود (خالی
// شروع می‌شود) — چون حالا «موجودی فعلی» به‌طور جداگانه نمایش داده می‌شود (نه در همان فیلدِ
// ورودی)، و چون کاربر باید بتواند فقط یکی از قفسه‌ها را بشمارد و بقیه را خالی بگذارد (ردیف‌های
// خالی هنگام ثبت نادیده گرفته می‌شوند، نه اینکه مانع ثبت شوند).
function buildInitialCountRows_(item) {
  var warehouses = item.warehouses || [];
  var shelves = item.shelves || [];
  var defaultWh = warehouses.length ? warehouses[0].warehouse : '';
  if (shelves.length > 0) {
    return shelves.map(function (s, i) {
      return { id: 'r' + i, warehouse: defaultWh, shelfCode: s.shelfCode, qty: '', currentQty: (s.qty === '' || s.qty == null) ? '' : s.qty };
    });
  }
  return [{ id: 'r0', warehouse: defaultWh, shelfCode: '', qty: '', currentQty: (item.systemQty === '' || item.systemQty == null) ? '' : item.systemQty }];
}
// <<< پایان بخش بازطراحی‌شده

// activeShelves: فهرست کاملِ قفسه‌های فعال (از همان شیت «قفسه‌ها»، همراه پاسخ apiLookup) —
// نه فقط قفسه‌های از قبل تخصیص‌یافته به این کالا. این یعنی حتی کالای بدون قفسه هم می‌تواند
// نام/کد قفسه را از این فهرست انتخاب کند (بدون هیچ درخواست یا منبع داده‌ی جدید). انتخاب قفسه
// دو مرحله‌ای است: اول «نام قفسه»، سپس فقط کدهای همان نام در «کد قفسه» نمایش داده می‌شود.
// >>> بازطراحی شد: یک سلول جدید «موجودی فعلی» (فقط‌خواندنی) بین کد قفسه و ورودیِ شمارش اضافه
// شد — مقدار واقعیِ ثبت‌شده‌ی همان قفسه (اگر باشد)، برای مقایسه‌ی سریع هنگام شمارش.
function buildCountRowHtml_(row, warehouses, activeShelves) {
  var whHtml = '';
  if (warehouses.length) {
    whHtml = '<select class="count-row-wh">' + warehouses.map(function (w) {
      return '<option value="' + escapeHtml(w.warehouse) + '"' + (w.warehouse === row.warehouse ? ' selected' : '') + '>' + escapeHtml(w.warehouse) + '</option>';
    }).join('') + '</select>';
  }
  var shelfCascadeHtml = '';
  if (activeShelves.length) {
    var codeSelectId = 'shelfCode_' + row.id;
    shelfCascadeHtml = buildCountRowShelfCascadeHtml_(codeSelectId, activeShelves, row.shelfCode);
  }
  var currentQtyText = (row.currentQty === '' || row.currentQty == null) ? '—' : escapeHtml(String(row.currentQty));
  return '<div class="count-row" data-row-id="' + escapeHtml(row.id) + '">' +
    '<div class="count-row-line1">' + whHtml + shelfCascadeHtml + '</div>' +
    '<div class="count-row-line2">' +
      '<span class="count-row-current-qty" title="موجودی فعلی">' + currentQtyText + '</span>' +
      '<input type="number" class="count-row-qty" inputmode="decimal" placeholder="مقدار شمارش" value="' + (row.qty === '' || row.qty == null ? '' : escapeHtml(String(row.qty))) + '">' +
      '<button type="button" class="count-row-del" onclick="removeCountRow(this)" title="حذف ردیف">' + ICON_TRASH_ + '</button>' +
    '</div>' +
  '</div>';
}
// <<< پایان بخش بازطراحی‌شده

var countRowSeq_ = 0;
function addCountRow() {
  if (!currentDetail) return;
  var box = document.getElementById('countRowsBox');
  if (!box) return;
  countRowSeq_++;
  var warehouses = currentDetail.warehouses || [];
  var activeShelves = currentDetail.activeShelves || [];
  var row = { id: 'nr' + countRowSeq_, warehouse: warehouses.length ? warehouses[0].warehouse : '', shelfCode: '', qty: '', currentQty: '' };
  box.insertAdjacentHTML('beforeend', buildCountRowHtml_(row, warehouses, activeShelves));
}

function removeCountRow(btn) {
  var box = document.getElementById('countRowsBox');
  if (!box) return;
  if (box.querySelectorAll('.count-row').length <= 1) { showToast('حداقل یک ردیف لازم است', true); return; }
  var row = btn.closest('.count-row');
  if (row) row.remove();
}

// >>> افزوده شد: بارگذاریِ async جدول «ظرفیت قفسه» — از همان endpoint/کشِ apiGetShelfDetail
// که پیش‌تر فقط در صفحه‌ی «قفسه‌ها» استفاده می‌شد؛ اینجا صرفاً برای همه‌ی قفسه‌های این کالا هم
// فراخوانی می‌شود تا محاسبات ظرفیت (که فقط سمت سرور انجام می‌گیرد) هم در جزئیات کالا دیده شود.
function loadShelfCapacitySection(itemCode, shelfCodes) {
  var body = document.getElementById('shelfCapacityBody');
  if (!body) return;
  var fallback = function (code) { return { code: code, capacityKg: null, currentLoad: null, remainingCapacity: null, usagePercent: null, loadStatus: '—' }; };

  var promises = shelfCodes.map(function (code) {
    if (!isOnline()) {
      return SyncDB.cacheGet('shelf_' + code).then(function (rec) { return (rec && rec.value) ? rec.value : fallback(code); }).catch(function () { return fallback(code); });
    }
    return apiCall('apiGetShelfDetail', { token: state.token, shelf: code }).then(function (res) {
      if (res && res.success && res.shelf) {
        SyncDB.cacheSet('shelf_' + code, res.shelf, 24 * 60 * 60 * 1000).catch(function () {});
        return res.shelf;
      }
      throw new Error('no data');
    }).catch(function () {
      return SyncDB.cacheGet('shelf_' + code).then(function (rec) { return (rec && rec.value) ? rec.value : fallback(code); }).catch(function () { return fallback(code); });
    });
  });

  Promise.all(promises).then(function (list) {
    // اگر کاربر قبل از پایان بارگذاری به کالای دیگری رفته، این نتیجه را نادیده بگیر
    if (!currentDetail || currentDetail.code !== itemCode) return;
    var freshBody = document.getElementById('shelfCapacityBody');
    if (!freshBody) return;
    if (!list.length) { freshBody.innerHTML = '<div class="empty-hint">قفسه‌ای برای نمایش ظرفیت نیست.</div>'; return; }
    var html = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      '<th>وضعیت</th><th>درصد پربودن</th><th>ظرفیت باقی‌مانده</th><th>بار موجود</th><th>حداکثر ظرفیت</th><th>کد قفسه</th>' +
      '</tr></thead><tbody>';
    list.forEach(function (s) {
      var color = shelfLoadStatusColorClient_(s.loadStatus);
      html += '<tr>' +
        '<td><span class="status-chip" style="background:' + color + '1e;color:' + color + ';"><span class="dot"></span>' + escapeHtml(s.loadStatus || '—') + '</span></td>' +
        '<td>' + (s.usagePercent === null || s.usagePercent === undefined
          ? '<span style="color:#8b94a0;">—</span>'
          : '<div class="cap-bar-cell"><div class="cap-bar-track"><div class="cap-bar-fill" style="width:' + Math.max(0, Math.min(100, s.usagePercent)) + '%;background:' + color + ';"></div></div><span style="color:' + color + ';font-weight:800;">' + escapeHtml(String(s.usagePercent)) + '%</span></div>') +
        '</td>' +
        '<td>' + (s.remainingCapacity === null || s.remainingCapacity === undefined ? '—' : escapeHtml(String(s.remainingCapacity)) + ' kg') + '</td>' +
        '<td>' + (s.currentLoad === null || s.currentLoad === undefined ? '—' : escapeHtml(String(s.currentLoad)) + ' kg') + '</td>' +
        '<td>' + (s.capacityKg === null || s.capacityKg === undefined ? '—' : escapeHtml(String(s.capacityKg)) + ' kg') + '</td>' +
        '<td class="code-cell">' + escapeHtml(s.code) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
    freshBody.innerHTML = html;
  });
}
// <<< پایان بخش افزوده‌شده

function stepQty(delta) {
  var i = document.getElementById('qtyInput');
  if (!i) return;
  i.value = Math.max(0, (parseFloat(i.value || '0') || 0) + delta);
  updateDiffPreview();
}

function updateDiffPreview() {
  var el = document.getElementById('diffPreview');
  if (!el || !currentDetail) return;
  var qtyEl = document.getElementById('qtyInput');
  var qty = qtyEl ? qtyEl.value : '';
  if (qty === '') { el.textContent = ''; el.className = 'diff-preview'; return; }

  // >>> افزوده شد: اگر کالا چند قفسه دارد، «موجودی سیستم» برای مقایسه از قفسه‌ی انتخاب‌شده
  // خوانده می‌شود (نه موجودی کل کالا) — دقیقاً هم‌الگو با انتخاب انبار
  var sys;
  var shelves = currentDetail.shelves || [];
  var shelfSelectEl = document.getElementById('countShelfSelect');
  if (shelves.length > 1 && shelfSelectEl) {
    var chosenCode = shelfSelectEl.value;
    if (!chosenCode) { el.textContent = ''; el.className = 'diff-preview'; return; }
    var chosenShelf = shelves.filter(function (s) { return s.shelfCode === chosenCode; })[0];
    sys = chosenShelf ? Number(chosenShelf.qty) : NaN;
  } else {
    sys = Number(currentDetail.systemQty);
  }
  // <<< پایان بخش افزوده‌شده

  var phys = Number(qty);
  if (isNaN(sys) || isNaN(phys)) { el.textContent = ''; return; }
  var diff = phys - sys;
  if (diff === 0) { el.textContent = 'مطابق موجودی سیستم'; el.className = 'diff-preview ok'; }
  else if (diff > 0) { el.textContent = 'اضافه: +' + diff; el.className = 'diff-preview ok'; }
  else { el.textContent = 'کسری: ' + diff; el.className = 'diff-preview bad'; }
}

// >>> افزوده شد: صف‌کردن آفلاینِ یک شمارش (وقتی اینترنت قطع است یا ارسال آنلاین ناموفق بود)
function queueRecordCount(itemForRecent, qty, note, warehouse, shelfCode) {
  var clientOpId = genUuid();
  var op = {
    clientOpId: clientOpId, type: 'recordCount',
    code: itemForRecent.code, qty: qty, note: note, warehouse: warehouse, shelfCode: shelfCode,
    ts: Date.now(), retryCount: 0
  };
  return SyncDB.enqueue(op).then(function () {
    addToRecent(itemForRecent, qty, '', true, clientOpId); // pending=true تا برچسب «در انتظار همگام‌سازی» نمایش داده شود
    showToast('ذخیره شد؛ پس از اتصال اینترنت ارسال می‌شود');
    document.getElementById('searchInput').value = '';
    lastSearchResults = null;
    currentDetail = null;
    renderScanNextScreen();
    refreshPendingCount();
  }).catch(function (err) {
    // >>> افزوده شد: اگر خودِ IndexedDB هم در دسترس نبود (مثلاً حالت خصوصی مرورگر)، این را واقعاً به کاربر بگوییم
    // تا داده گم نشود بدون اطلاع — به‌جای بلعیدن خطا به‌صورت خاموش
    showToast('ذخیره‌ی محلی ناموفق بود: ' + err.message, true);
    throw err;
    // <<< پایان بخش افزوده‌شده
  });
}
// <<< پایان بخش افزوده‌شده

// >>> افزوده شد: ثبت شمارش به‌صورت Promise (بخشی از دکمه‌ی یکپارچه‌ی «ذخیره و تایید»)؛
// دقیقاً همان رفتار قبلیِ submitCount را دارد (آنلاین/آفلاین/بازگشت به صف در قطعی اتصال)،
// فقط به‌شکل یک مرحله در زنجیره‌ی submitAll بازنویسی شده تا دکمه‌ی جدا و ارسال تکراری نداشته باشیم.
function saveCountStep_(itemForRecent, qty, note, warehouse, shelfCode) {
  if (!isOnline()) {
    return queueRecordCount(itemForRecent, qty, note, warehouse, shelfCode);
  }
  var clientOpId = genUuid(); // شناسه‌ی یکتای عملیات، برای جلوگیری از ثبت تکراری سمت سرور

  return apiCall('apiRecordCount', { token: state.token, code: itemForRecent.code, qty: qty, note: note, warehouse: warehouse, clientOpId: clientOpId, shelfCode: shelfCode }).then(function (res) {
    if (handleIfSessionExpired(res)) { var e = new Error('نشست منقضی شده'); e.stopChain = true; throw e; }
    if (!res.success) {
      showToast(res.message || 'خطا در ثبت', true);
      var e2 = new Error(res.message || 'خطا در ثبت'); e2.stopChain = true; throw e2;
    }
    if (res.serverTime) localStorage.setItem(LS_LAST_SYNC, res.serverTime);
    addToRecent(itemForRecent, qty, res.diff);
    showToast('✓ ذخیره و تایید شد');
    document.getElementById('searchInput').value = '';
    lastSearchResults = null;
    currentDetail = null;
    renderScanNextScreen();
  }).catch(function (err) {
    if (err && err.stopChain) throw err; // رد صریح سرور — دیگر صف نشود، پیام خطا قبلاً نمایش داده شده
    // اتصال ناپایدار/قطع وسط ارسال — به‌جای نمایش خطا، در صف آفلاین ذخیره کن
    return queueRecordCount(itemForRecent, qty, note, warehouse, shelfCode);
  });
}
// <<< پایان بخش افزوده‌شده

// ===================== ویرایش وزن / قفسه (فقط کاربران دارای دسترسی انبار می‌بینند) =====================
// >>> بازطراحی شد: مداد فقط جعبه‌ی ویرایش وزن (weightEditBox) را باز/بسته می‌کند — دیگر قفسه
// در این پنل نیست؛ ویرایش قفسه در کارت جدا و همیشه‌نمایانِ «تخصیص قفسه» انجام می‌شود.
function toggleWeightEdit() {
  var box = document.getElementById('weightEditBox');
  if (!box) return;
  var open = box.style.display !== 'none';
  box.style.display = open ? 'none' : 'block';
  var btn = document.getElementById('toggleWeightBtn');
  if (btn) {
    btn.classList.toggle('open', !open);
    var label = btn.querySelector('.weight-edit-label');
    if (label) label.textContent = open ? 'ویرایش' : 'بستن';
    btn.title = open ? 'ویرایش وزن' : 'انصراف از ویرایش';
  }
}

// >>> افزوده شد: صف‌کردن آفلاینِ ویرایش وزن/قفسه (وقتی اینترنت قطع است یا ارسال آنلاین ناموفق بود)
// چون محاسبه‌ی وزن کل و بار قفسه فقط سمت سرور انجام می‌شود، در حالت آفلاین نمی‌توان صفحه‌ی
// جزئیات را با مقادیر نهایی به‌روز کرد؛ فقط عملیات صف می‌شود تا پس از اتصال روی سرور اعمال شود.
function queueUpdateWeightShelf(itemCode, unitWeight, shelfCode) {
  var clientOpId = genUuid();
  var op = {
    clientOpId: clientOpId, type: 'updateWeightShelf',
    code: itemCode, unitWeight: unitWeight, shelfCode: shelfCode,
    ts: Date.now(), retryCount: 0
  };
  return SyncDB.enqueue(op).then(function () {
    refreshPendingCount();
  }).catch(function (err) {
    // >>> افزوده شد: عدم بلعیدن خاموشِ خطا — اگر ذخیره‌ی محلی هم شکست بخورد باید به کاربر گفته شود
    showToast('ذخیره‌ی محلی ناموفق بود: ' + err.message, true);
    throw err;
    // <<< پایان بخش افزوده‌شده
  });
}
// <<< پایان بخش افزوده‌شده

// >>> افزوده شد: ذخیره‌ی وزن/قفسه به‌صورت Promise (بخشی از دکمه‌ی یکپارچه‌ی «ذخیره و تایید»)؛
// دقیقاً همان رفتار قبلیِ submitWeightShelf را دارد، با این تفاوت که دیگر صفحه را دوباره رندر
// نمی‌کند (چون بلافاصله شمارش هم در همین زنجیره ثبت و صفحه به لیست اخیر منتقل می‌شود) و روی
// currentDetail فقط به‌صورت خاموش به‌روزرسانی انجام می‌دهد.
function saveWeightShelfStep_(code, unitWeight, shelfCode) {
  var msgEl = document.getElementById('weightShelfMsg');
  if (!isOnline()) {
    return queueUpdateWeightShelf(code, unitWeight, shelfCode).then(function () {
      if (msgEl) { msgEl.textContent = 'وزن/قفسه ذخیره شد؛ پس از اتصال اینترنت اعمال می‌شود.'; msgEl.className = 'diff-preview ok'; }
    });
  }
  var clientOpId = genUuid(); // شناسه‌ی یکتای عملیات، برای جلوگیری از اعمال تکراری سمت سرور

  // توجه: محاسبه‌ی وزن کل و اعتبارسنجی قفسه فقط سمت سرور انجام می‌شود؛
  // اینجا فقط مقادیر خام کاربر ارسال و نتیجه‌ی آماده‌ی سرور روی currentDetail اعمال می‌شود.
  return apiCall('apiUpdateItemWeightShelf', { token: state.token, code: code, unitWeight: unitWeight, shelfCode: shelfCode, clientOpId: clientOpId }).then(function (res) {
    if (handleIfSessionExpired(res)) { var e = new Error('نشست منقضی شده'); e.stopChain = true; throw e; }
    if (!res.success) {
      if (msgEl) { msgEl.textContent = res.message || 'خطا در ذخیره‌ی وزن/قفسه.'; msgEl.className = 'diff-preview bad'; }
      showToast(res.message || 'خطا در ذخیره‌ی وزن/قفسه', true);
      var e2 = new Error(res.message || 'خطا در ذخیره‌ی وزن/قفسه'); e2.stopChain = true; throw e2;
    }
    if (res.serverTime) localStorage.setItem(LS_LAST_SYNC, res.serverTime);
    if (currentDetail && currentDetail.code === code) {
      currentDetail.unitWeight = res.unitWeight;
      currentDetail.shelfCode = res.shelfCode;
      currentDetail.shelf = res.shelf;
      currentDetail.totalWeight = res.totalWeight;
      currentDetail.unitWeightDisplay = res.unitWeightDisplay;
      currentDetail.totalWeightDisplay = res.totalWeightDisplay;
      currentDetail.shelfDisplay = res.shelfDisplay;
      currentDetail.shelfLoad = res.shelfLoad;
    }
  }).catch(function (err) {
    if (err && err.stopChain) throw err; // رد صریح سرور یا نشست منقضی — ادامه نده، شمارش هم ثبت نشود
    // اتصال ناپایدار/قطع وسط ارسال — به‌جای نمایش خطا، در صف آفلاین ذخیره کن و اجازه بده شمارش هم ثبت شود
    return queueUpdateWeightShelf(code, unitWeight, shelfCode).then(function () {
      if (msgEl) { msgEl.textContent = 'اتصال ناپایدار بود؛ وزن/قفسه در صف ارسال قرار گرفت.'; msgEl.className = 'diff-preview ok'; }
    });
  });
}
// <<< پایان بخش افزوده‌شده

// >>> افزوده شد: پشتیبانی از «چند قفسه برای یک کالا» — افزودن/ویرایش/حذفِ یک تخصیص قفسه.
// این سه تابع مستقل از دکمه‌ی «ذخیره و تایید» عمل می‌کنند (دقیقاً مثل «ذخیره تغییرات» قدیمیِ
// وزن/قفسه)، چون افزودن/حذف قفسه یک اقدام مدیریتی جداست، نه بخشی از ثبت شمارش.

// صف‌کردن آفلاینِ افزودن/ویرایش/حذفِ یک تخصیص قفسه (وقتی اینترنت قطع است یا ارسال ناموفق بود)
function queueUpdateShelfQty(itemCode, shelfCode, qty) {
  var clientOpId = genUuid();
  var op = {
    clientOpId: clientOpId, type: 'updateShelfQty',
    code: itemCode, shelfCode: shelfCode, qty: qty,
    ts: Date.now(), retryCount: 0
  };
  return SyncDB.enqueue(op).then(function () {
    refreshPendingCount();
  }).catch(function (err) {
    showToast('ذخیره‌ی محلی ناموفق بود: ' + err.message, true);
    throw err;
  });
}

// منطق مشترک افزودن/ویرایش/حذف — qty === '' یعنی حذفِ آن تخصیص قفسه
function submitShelfAssignment_(shelfCode, qty) {
  if (!currentDetail) return;
  var msg = document.getElementById('shelfAssignMsg');
  var code = currentDetail.code;

  if (qty !== '' && (isNaN(Number(qty)) || Number(qty) < 0)) {
    if (msg) { msg.textContent = 'موجودی قفسه باید عددی نامنفی باشد.'; msg.className = 'diff-preview bad'; }
    showToast('موجودی قفسه نامعتبر است', true);
    return;
  }

  if (!isOnline()) {
    queueUpdateShelfQty(code, shelfCode, qty).then(function () {
      showToast('در صف ارسال قرار گرفت؛ پس از اتصال اینترنت اعمال می‌شود.');
    }).catch(function () {});
    return;
  }

  var clientOpId = genUuid();
  apiCall('apiUpdateItemShelfQty', { token: state.token, code: code, shelfCode: shelfCode, qty: qty, clientOpId: clientOpId }).then(function (res) {
    if (handleIfSessionExpired(res)) return;
    if (!res.success) {
      if (msg) { msg.textContent = res.message || 'خطا در ذخیره‌ی قفسه.'; msg.className = 'diff-preview bad'; }
      showToast(res.message || 'خطا در ذخیره‌ی قفسه', true);
      return;
    }
    if (res.serverTime) localStorage.setItem(LS_LAST_SYNC, res.serverTime);
    currentDetail.shelves = res.shelves || [];
    showToast('قفسه‌های کالا به‌روزرسانی شد.');
    renderItemDetail(currentDetail); // بازسازی کامل صفحه تا فهرست قفسه‌ها/ظرفیت هم تازه شود
  }).catch(function () {
    queueUpdateShelfQty(code, shelfCode, qty).then(function () {
      if (msg) { msg.textContent = 'اتصال ناپایدار بود؛ در صف ارسال قرار گرفت.'; msg.className = 'diff-preview ok'; }
    });
  });
}

function updateShelfAssignment(shelfCode) {
  var safeId = 'sq_' + shelfCode.replace(/[^a-zA-Z0-9آ-ی]/g, '_');
  var el = document.getElementById(safeId);
  var qty = el ? el.value : '';
  if (qty === '') { showToast('موجودی جدید را وارد کنید', true); if (el) el.focus(); return; }
  submitShelfAssignment_(shelfCode, qty);
}

function removeShelfAssignment(shelfCode) {
  submitShelfAssignment_(shelfCode, '');
}

function addShelfAssignment() {
  var selectEl = document.getElementById('newShelfSelect');
  var qtyEl = document.getElementById('newShelfQty');
  var shelfCode = selectEl ? selectEl.value : '';
  var qty = qtyEl ? qtyEl.value : '';
  if (!shelfCode) { showToast('قفسه را انتخاب کنید', true); return; }
  if (qty === '') { showToast('موجودی قفسه‌ی جدید را وارد کنید', true); if (qtyEl) qtyEl.focus(); return; }
  submitShelfAssignment_(shelfCode, qty);
}
// <<< پایان بخش افزوده‌شده

// >>> افزوده شد: دکمه‌ی یکپارچه‌ی «ذخیره و تایید» — به‌جای دو دکمه‌ی جدا («ذخیره تغییرات» برای
// وزن/قفسه و «ثبت شمارش»)، این تابع در صورت باز بودن پنل ویرایش وزن/قفسه، ابتدا آن را ذخیره
// می‌کند و سپس شمارش را ثبت می‌کند — هر دو با یک کلیک، بدون ایجاد عملیات یا ارسال تکراری
// (هر بخش دقیقاً همان یک عملیات/صف قبلی خودش را دارد، فقط پشت یک دکمه قرار گرفته‌اند).
// >>> افزوده شد: تخصیص خودکار قفسه‌ی «تازه» قبل از ثبت شمارشِ همان ردیف — سرور (recordCount)
// فقط وقتی کالا از قبل ۲+ قفسه دارد به shelfCode ارسالی توجه می‌کند و آن را باید در میان
// تخصیص‌های موجود پیدا کند؛ برای کالای بدون‌قفسه/تک‌قفسه‌ای shelfCode ارسالی را نادیده می‌گیرد.
// پس اگر کاربر در فرم شمارش، قفسه‌ای را انتخاب کند که هنوز به این کالا تخصیص نیافته، ابتدا باید
// همان تخصیص ساخته شود — دقیقاً با همان endpoint/صفِ آفلاینی که پنل «وزن» برای افزودن قفسه
// استفاده می‌کند (apiUpdateItemShelfQty) — تا سرور بتواند شمارش را به همان قفسه نسبت دهد.
function ensureShelfAssignmentStep_(itemCode, shelfCode, qty) {
  if (!isOnline()) {
    return queueUpdateShelfQty(itemCode, shelfCode, qty);
  }
  var clientOpId = genUuid();
  return apiCall('apiUpdateItemShelfQty', { token: state.token, code: itemCode, shelfCode: shelfCode, qty: qty, clientOpId: clientOpId }).then(function (res) {
    if (handleIfSessionExpired(res)) { var e = new Error('نشست منقضی شده'); e.stopChain = true; throw e; }
    if (!res.success) {
      showToast(res.message || 'خطا در تخصیص قفسه', true);
      var e2 = new Error(res.message || 'خطا در تخصیص قفسه'); e2.stopChain = true; throw e2;
    }
    if (res.serverTime) localStorage.setItem(LS_LAST_SYNC, res.serverTime);
    if (currentDetail && currentDetail.code === itemCode) {
      currentDetail.shelves = res.shelves || currentDetail.shelves;
    }
  }).catch(function (err) {
    if (err && err.stopChain) throw err;
    return queueUpdateShelfQty(itemCode, shelfCode, qty);
  });
}
// <<< پایان بخش افزوده‌شده

// >>> بازطراحی شد: فرم شمارش حالا چندردیفی است (یک ردیف به‌ازای هر انبار/قفسه). این تابع
// همان مراحل قبلی (ابتدا در صورت نیاز ذخیره‌ی وزن/قفسه، سپس ثبت شمارش) را حفظ می‌کند؛ تنها
// تفاوت این است که به‌جای یک شمارش، برای هر ردیفِ فرم یک‌بار saveCountStep_ فراخوانی می‌شود
// (پشت سرهم، با همان زنجیره‌ی Promise قبلی) — یعنی دقیقاً همان رفتار ذخیره/صف‌آفلاین/toast
// قبلی، فقط به تعداد ردیف‌ها تکرار می‌شود. برای کالایی با یک انبار/قفسه، این دقیقاً معادل
// همان یک ردیفِ قبلی است. اگر ردیفی قفسه‌ی تازه‌ای (هنوز تخصیص‌نیافته) انتخاب کرده باشد، پیش
// از ثبت شمارشِ همان ردیف، تخصیص آن قفسه هم به‌صورت خودکار انجام می‌شود.
function submitAll() {
  if (!currentDetail) return;

  var weightEl = document.getElementById('unitWeightInput');
  // >>> بازطراحی شد: کارت «تخصیص قفسه» (و به‌همراه آن #shelfSelect) کاملاً حذف شد؛ قفسه‌ی اصلیِ
  // فعلیِ کالا دیگر از یک عنصر فرم خوانده نمی‌شود، بلکه همان مقدار شناخته‌شده‌ی currentDetail
  // استفاده می‌شود تا ذخیره‌ی وزن هرگز قفسه‌ی موجود را به‌اشتباه خالی نکند.
  var shelfEl = document.getElementById('shelfSelect'); // معمولاً دیگر در DOM نیست؛ null-safe
  var wsMsg = document.getElementById('weightShelfMsg');
  var weightMsgEl = document.getElementById('weightMsg');
  var unitWeight = weightEl ? weightEl.value : '';
  var shelfCode = shelfEl ? shelfEl.value : (currentDetail.shelfCode || '');

  // مداد فقط جعبه‌ی وزن را باز/بسته می‌کند؛ قفسه دیگر از این فرم قابل‌تغییر نیست (تخصیص قفسه
  // از طریق ردیف‌های «ثبت شمارش انبارگردانی» انجام می‌شود) — پس با مقایسه با مقدار اصلیِ کالا
  // تشخیص داده می‌شود که آیا وزن واقعاً تغییر کرده تا لازم باشد ذخیره شود.
  var origUnitWeight = (currentDetail.unitWeight === '' || currentDetail.unitWeight == null) ? '' : String(currentDetail.unitWeight);
  var origShelfCode = currentDetail.shelfCode || '';
  var weightChanged = !!weightEl && String(unitWeight) !== origUnitWeight;
  var shelfChanged = !!shelfEl && String(shelfCode) !== origShelfCode;
  var hasWeightShelfEdit = weightChanged || shelfChanged;

  if (weightChanged && unitWeight !== '' && (isNaN(Number(unitWeight)) || Number(unitWeight) < 0)) {
    if (weightMsgEl) { weightMsgEl.textContent = 'وزن واحد باید عددی نامنفی باشد.'; weightMsgEl.className = 'diff-preview bad'; }
    showToast('وزن واحد نامعتبر است', true);
    return;
  }
  // <<< پایان بخش بازطراحی‌شده

  var rowsEls = document.querySelectorAll('#countRowsBox .count-row');
  if (!rowsEls.length) { showToast('حداقل یک ردیف شمارش لازم است', true); return; }

  var warehouses = currentDetail.warehouses || [];
  var existingShelfCodes = (currentDetail.shelves || []).map(function (s) { return s.shelfCode; });
  var rows = [];
  // >>> بازطراحی شد: ردیف‌هایی که کاربر مقداری برایشان وارد نکرده، نادیده گرفته می‌شوند (نه
  // اینکه کل ثبت را مسدود کنند) — کاربر باید بتواند فقط یک قفسه را بشمارد و بقیه را خالی
  // بگذارد. فقط برای ردیف‌هایی که واقعاً مقدار دارند، انبار/قفسه اعتبارسنجی می‌شود.
  for (var i = 0; i < rowsEls.length; i++) {
    var rEl = rowsEls[i];
    var whSel = rEl.querySelector('.count-row-wh');
    var shSel = rEl.querySelector('.count-row-shelf');
    var qtyInput = rEl.querySelector('.count-row-qty');
    var qty = qtyInput ? qtyInput.value : '';
    if (qty === '') continue; // ردیف خالی — نادیده گرفته می‌شود، مانع ثبت بقیه نمی‌شود
    var warehouse = whSel ? whSel.value : '';
    if (warehouses.length && !warehouse) { showToast('لطفاً انبار را برای ردیف‌های دارای مقدار انتخاب کنید', true); if (whSel) whSel.focus(); return; }
    var rowShelfCode = shSel ? shSel.value : '';
    if (shSel && !rowShelfCode) { showToast('لطفاً نام/کد قفسه‌ی ردیف‌های دارای مقدار را انتخاب کنید', true); shSel.focus(); return; }
    var isNewShelf = !!(rowShelfCode && existingShelfCodes.indexOf(rowShelfCode) === -1);
    rows.push({ warehouse: warehouse, shelfCode: rowShelfCode, qty: qty, isNewShelf: isNewShelf });
    if (isNewShelf) existingShelfCodes.push(rowShelfCode); // یک ردیف تکراری برای همان قفسه‌ی تازه، دوباره تخصیص نسازد
  }
  if (!rows.length) { showToast('حداقل برای یک ردیف، مقدار شمارش را وارد کنید', true); return; }
  // <<< پایان بخش بازطراحی‌شده

  var note = (document.getElementById('noteInput') || {}).value || '';

  var btn = document.getElementById('submitCountBtn');
  var itemForRecent = currentDetail;
  var itemCode = currentDetail.code;

  if (btn) { btn.disabled = true; btn.textContent = 'در حال ذخیره...'; }
  if (wsMsg) { wsMsg.textContent = ''; wsMsg.className = 'diff-preview'; }

  var chain = Promise.resolve();
  if (hasWeightShelfEdit) {
    chain = chain.then(function () { return saveWeightShelfStep_(itemCode, unitWeight, shelfCode); });
  }
  rows.forEach(function (row) {
    if (row.isNewShelf) {
      chain = chain.then(function () { return ensureShelfAssignmentStep_(itemCode, row.shelfCode, row.qty); });
    }
    chain = chain.then(function () { return saveCountStep_(itemForRecent, row.qty, note, row.warehouse, row.shelfCode); });
  });
  chain.catch(function () {
    // خطا قبلاً به‌صورت پیام/toast مناسب نمایش داده شده؛ فقط دکمه را برای تلاش دوباره فعال کن
    if (btn) { btn.disabled = false; btn.textContent = 'ثبت'; }
  });
}
// <<< پایان بخش بازطراحی‌شده

// ===================== قفسه‌ها — نظارت خودکار بار قفسه (فقط دسترسی انبار) =====================
// توجه معماری: تمام محاسبات (بار فعلی، باقیمانده، درصد استفاده، وضعیت) روی سرور
// انجام می‌شود؛ این بخش فقط همان مقادیر آماده را می‌گیرد و نمایش می‌دهد.
var shelvesViewState = 'list'; // 'list' یا 'detail'
var currentShelfCode = null;

function shelvesBack() {
  if (shelvesViewState === 'detail') {
    openShelvesList();
  } else {
    showScreen('mainScreen');
    setActiveNav('home');
  }
}

function openShelvesList() {
  shelvesViewState = 'list';
  currentShelfCode = null;
  showScreen('shelvesScreen');
  setActiveNav('shelves');
  setShelvesHeaderTitle('لیست قفسه‌ها');
  var area = document.getElementById('shelvesArea');

  // >>> افزوده شد: اگر اینترنت قطع است، مستقیم از کش آفلاین بخوان (بدون تلاش برای apiCall).
  // قبلاً این تابع بر خلاف جست‌وجو/جزئیات کالا، این بررسی را نداشت و همیشه اول تلاش برای
  // درخواست شبکه می‌کرد — که وقتی واقعاً آفلاین بود، تا timeout (۱۵ ثانیه) طول می‌کشید و پیام
  // خطای «اتصال اینترنت را بررسی کنید» به‌جای داده‌ی محلیِ موجود نمایش داده می‌شد.
  if (!isOnline()) {
    area.innerHTML = '<div class="empty-hint">در حال بارگذاری از داده‌ی محلی...</div>';
    SyncDB.cacheGet('shelves_list').then(function (rec) {
      if (rec && rec.value && rec.value.length) {
        showToast('نمایش داده‌ی محلی (آفلاین)', false);
        renderShelvesList(rec.value);
      } else {
        area.innerHTML = '<div class="empty-hint">اتصال اینترنت برقرار نیست و داده‌ای برای قفسه‌ها ذخیره نشده است. لطفاً یک‌بار وقتی آنلاین هستید وارد شوید.</div>';
      }
    }).catch(function () {
      area.innerHTML = '<div class="empty-hint">اتصال اینترنت برقرار نیست.</div>';
    });
    return;
  }
  // <<< پایان بخش افزوده‌شده

  area.innerHTML = '<div class="empty-hint">در حال بارگذاری فهرست قفسه‌ها...</div>';
  apiCall('apiListShelvesWithLoad', { token: state.token }).then(function (res) {
    if (handleIfSessionExpired(res)) return;
    if (!res.success) { area.innerHTML = '<div class="empty-hint">' + escapeHtml(res.message || 'خطا در دریافت اطلاعات قفسه‌ها.') + '</div>'; return; }
    // >>> افزوده شد: کش محلی فهرست قفسه‌ها برای دسترسی آفلاین
    SyncDB.cacheSet('shelves_list', res.shelves || [], 24 * 60 * 60 * 1000).catch(function () {});
    // <<< پایان بخش افزوده‌شده
    renderShelvesList(res.shelves || []);
  }).catch(function (err) {
    // >>> افزوده شد: در صورت قطع اینترنت، تلاش برای نمایش آخرین نسخه‌ی کش‌شده‌ی فهرست قفسه‌ها
    SyncDB.cacheGet('shelves_list').then(function (rec) {
      if (rec && rec.value) {
        showToast('نمایش نسخه‌ی ذخیره‌شده (آفلاین)', false);
        renderShelvesList(rec.value);
      } else {
        area.innerHTML = '<div class="empty-hint">خطا: ' + escapeHtml(err.message) + '</div>';
      }
    }).catch(function () {
      area.innerHTML = '<div class="empty-hint">خطا: ' + escapeHtml(err.message) + '</div>';
    });
    // <<< پایان بخش افزوده‌شده
  });
}

// رنگ متن/نوار بر اساس وضعیتِ آماده‌شده‌ی سرور (فقط نگاشت رنگ، بدون هیچ محاسبه‌ای)
function shelfLoadStatusColorClient_(status) {
  if (status === 'اضافه‌بار') return '#c53030';
  if (status === 'بحرانی') return '#b25400';
  if (status === 'هشدار') return '#a15c00';
  if (status === 'عادی') return '#1a7f37';
  return '#8b94a0';
}

function shelfUsageBarHtmlClient_(usagePercent, color) {
  if (usagePercent === null || usagePercent === undefined) return '<span style="color:#8b94a0;font-size:12px;">—</span>';
  var visualPct = Math.max(0, Math.min(100, usagePercent));
  return '<div style="display:flex;align-items:center;gap:7px;">' +
    '<div style="background:#e9edf2;border-radius:6px;height:6px;width:90px;overflow:hidden;"><div style="height:100%;width:' + visualPct + '%;background:' + color + ';"></div></div>' +
    '<span style="font-size:11.5px;color:' + color + ';font-weight:700;">' + usagePercent + '%</span>' +
  '</div>';
}

// >>> بازطراحی شد: «لیست قفسه‌ها» حالا یک جدول حرفه‌ای (مثل جدول قابل‌فیلترِ خودِ Apps Script)
// با فیلتر لحظه‌ای روی هر ستون است، به‌جای فهرست کارت‌ها. داده دقیقاً همان پاسخ
// apiListShelvesWithLoad قبلی است (بدون هیچ فراخوانی/فیلد جدید)؛ فیلتر کردن هم کاملاً سمت
// کلاینت و روی همان آرایه‌ی موجود در حافظه انجام می‌شود، بدون رفرش صفحه یا درخواست جدید.
var shelvesListData_ = [];

function renderShelvesList(shelves) {
  shelvesListData_ = shelves || [];
  var area = document.getElementById('shelvesArea');
  if (!shelvesListData_.length) {
    area.innerHTML = '<div class="empty-hint">قفسه‌ای یافت نشد.</div>';
    return;
  }

  var statusSet = {};
  shelvesListData_.forEach(function (s) { if (s.loadStatus) statusSet[s.loadStatus] = true; });
  var statusOptions = '<option value="">همه</option>' + Object.keys(statusSet).map(function (st) {
    return '<option value="' + escapeHtml(st) + '">' + escapeHtml(st) + '</option>';
  }).join('');

  var html =
    '<div class="section-title">قفسه‌ها (<span id="shelvesCountLabel">' + shelvesListData_.length + '</span>)</div>' +
    '<div class="table-wrap"><table class="data-table" id="shelvesListTable"><thead><tr>' +
      '<th class="shelf-th">وضعیت<br><select class="shelf-filter-select" id="flt_status" onchange="applyShelvesFilter_()">' + statusOptions + '</select></th>' +
      '<th class="shelf-th">درصد پر بودن<br><input class="shelf-filter-input" id="flt_usagePercent" oninput="applyShelvesFilter_()" placeholder="مثلاً 80"></th>' +
      '<th class="shelf-th">ظرفیت باقی‌مانده<br><input class="shelf-filter-input" id="flt_remainingCapacity" oninput="applyShelvesFilter_()" placeholder="kg"></th>' +
      '<th class="shelf-th">بار موجود<br><input class="shelf-filter-input" id="flt_currentLoad" oninput="applyShelvesFilter_()" placeholder="kg"></th>' +
      '<th class="shelf-th">حداکثر ظرفیت<br><input class="shelf-filter-input" id="flt_capacityKg" oninput="applyShelvesFilter_()" placeholder="kg"></th>' +
      '<th class="shelf-th">کد قفسه<br><input class="shelf-filter-input" id="flt_code" oninput="applyShelvesFilter_()" placeholder="جست‌وجو..."></th>' +
      '<th class="shelf-th">نام قفسه<br><input class="shelf-filter-input" id="flt_location" oninput="applyShelvesFilter_()" placeholder="جست‌وجو..."></th>' +
    '</tr></thead><tbody id="shelvesListBody">' + buildShelvesRowsHtml_(shelvesListData_) + '</tbody></table></div>';
  area.innerHTML = html;
}

function buildShelvesRowsHtml_(list) {
  if (!list.length) return '<tr><td colspan="7"><div class="empty-hint">قفسه‌ای با این فیلتر یافت نشد.</div></td></tr>';
  return list.map(function (s) {
    var color = shelfLoadStatusColorClient_(s.loadStatus);
    var safeCode = escapeHtml(s.code).replace(/'/g, "\\'");
    return '<tr class="clickable" onclick="openShelfDetail(\'' + safeCode + '\')">' +
      '<td><span class="status-chip" style="background:' + color + '1e;color:' + color + ';"><span class="dot"></span>' + escapeHtml(s.loadStatus || '—') + '</span></td>' +
      '<td>' + (s.usagePercent === null || s.usagePercent === undefined
        ? '<span style="color:#8b94a0;">—</span>'
        : '<div class="cap-bar-cell"><div class="cap-bar-track"><div class="cap-bar-fill" style="width:' + Math.max(0, Math.min(100, s.usagePercent)) + '%;background:' + color + ';"></div></div><span style="color:' + color + ';font-weight:800;">' + escapeHtml(String(s.usagePercent)) + '%</span></div>') +
      '</td>' +
      '<td>' + (s.remainingCapacity === null || s.remainingCapacity === undefined ? '—' : escapeHtml(String(s.remainingCapacity)) + ' kg') + '</td>' +
      '<td>' + (s.currentLoad === null || s.currentLoad === undefined ? '—' : escapeHtml(String(s.currentLoad)) + ' kg') + '</td>' +
      '<td>' + (s.capacityKg === null || s.capacityKg === undefined ? '—' : escapeHtml(String(s.capacityKg)) + ' kg') + '</td>' +
      '<td class="code-cell">' + escapeHtml(s.code) + '</td>' +
      '<td>' + escapeHtml(s.location || '—') + '</td>' +
    '</tr>';
  }).join('');
}

// فیلتر لحظه‌ای — روی همان آرایه‌ی موجود در حافظه (shelvesListData_) اجرا می‌شود؛ بدون
// درخواست جدید به سرور و بدون رفرش صفحه، فقط tbody دوباره ساخته می‌شود.
function applyShelvesFilter_() {
  var getVal = function (id) { var el = document.getElementById(id); return el ? el.value.trim().toLowerCase() : ''; };
  var fLocation = getVal('flt_location');
  var fCode = getVal('flt_code');
  var fCapacity = getVal('flt_capacityKg');
  var fCurrent = getVal('flt_currentLoad');
  var fRemaining = getVal('flt_remainingCapacity');
  var fUsage = getVal('flt_usagePercent');
  var fStatusEl = document.getElementById('flt_status');
  var fStatus = fStatusEl ? fStatusEl.value : '';

  var filtered = shelvesListData_.filter(function (s) {
    if (fLocation && String(s.location || '').toLowerCase().indexOf(fLocation) === -1) return false;
    if (fCode && String(s.code || '').toLowerCase().indexOf(fCode) === -1) return false;
    if (fCapacity && String(s.capacityKg == null ? '' : s.capacityKg).toLowerCase().indexOf(fCapacity) === -1) return false;
    if (fCurrent && String(s.currentLoad == null ? '' : s.currentLoad).toLowerCase().indexOf(fCurrent) === -1) return false;
    if (fRemaining && String(s.remainingCapacity == null ? '' : s.remainingCapacity).toLowerCase().indexOf(fRemaining) === -1) return false;
    if (fUsage && String(s.usagePercent == null ? '' : s.usagePercent).toLowerCase().indexOf(fUsage) === -1) return false;
    if (fStatus && s.loadStatus !== fStatus) return false;
    return true;
  });

  var body = document.getElementById('shelvesListBody');
  if (body) body.innerHTML = buildShelvesRowsHtml_(filtered);
  var countLabel = document.getElementById('shelvesCountLabel');
  if (countLabel) countLabel.textContent = filtered.length + (filtered.length !== shelvesListData_.length ? ' از ' + shelvesListData_.length : '');
}
// <<< پایان بخش بازطراحی‌شده

function openShelfDetail(code) {
  shelvesViewState = 'detail';
  currentShelfCode = code;
  setShelvesHeaderTitle('قفسه‌ی ' + code);
  var area = document.getElementById('shelvesArea');

  // >>> افزوده شد: اگر اینترنت قطع است، مستقیم از کش آفلاین بخوان (همان الگوی openShelvesList/openItemDetail)
  if (!isOnline()) {
    area.innerHTML = '<div class="empty-hint">در حال بارگذاری از داده‌ی محلی...</div>';
    SyncDB.cacheGet('shelf_' + code).then(function (rec) {
      if (rec && rec.value) {
        showToast('نمایش داده‌ی محلی (آفلاین)', false);
        renderShelfDetail(rec.value);
      } else {
        area.innerHTML = '<div class="empty-hint">اتصال اینترنت برقرار نیست و جزئیات این قفسه در داده‌ی محلی موجود نیست.</div>';
      }
    }).catch(function () {
      area.innerHTML = '<div class="empty-hint">اتصال اینترنت برقرار نیست.</div>';
    });
    return;
  }
  // <<< پایان بخش افزوده‌شده

  area.innerHTML = '<div class="empty-hint">در حال بارگذاری جزئیات قفسه...</div>';
  apiCall('apiGetShelfDetail', { token: state.token, shelf: code }).then(function (res) {
    if (handleIfSessionExpired(res)) return;
    if (!res.success) { area.innerHTML = '<div class="empty-hint">' + escapeHtml(res.message || 'خطا در دریافت جزئیات قفسه.') + '</div>'; return; }
    // >>> افزوده شد: کش محلی جزئیات قفسه برای دسترسی آفلاین
    SyncDB.cacheSet('shelf_' + code, res.shelf, 24 * 60 * 60 * 1000).catch(function () {});
    // <<< پایان بخش افزوده‌شده
    renderShelfDetail(res.shelf);
  }).catch(function (err) {
    // >>> افزوده شد: در صورت قطع اینترنت، تلاش برای نمایش آخرین نسخه‌ی کش‌شده‌ی جزئیات قفسه
    SyncDB.cacheGet('shelf_' + code).then(function (rec) {
      if (rec && rec.value) {
        showToast('نمایش نسخه‌ی ذخیره‌شده (آفلاین)', false);
        renderShelfDetail(rec.value);
      } else {
        area.innerHTML = '<div class="empty-hint">خطا: ' + escapeHtml(err.message) + '</div>';
      }
    }).catch(function () {
      area.innerHTML = '<div class="empty-hint">خطا: ' + escapeHtml(err.message) + '</div>';
    });
    // <<< پایان بخش افزوده‌شده
  });
}

function renderShelfDetail(shelf) {
  var area = document.getElementById('shelvesArea');
  var color = shelfLoadStatusColorClient_(shelf.loadStatus);

  var html =
    '<a style="display:inline-block;margin-bottom:10px;color:#0f4c81;font-size:13px;font-weight:700;text-decoration:none;" onclick="openShelvesList();return false;" href="#">‹ بازگشت به فهرست قفسه‌ها</a>' +
    '<div class="section-title">قفسه‌ی ' + escapeHtml(shelf.code) + (shelf.location ? ' — ' + escapeHtml(shelf.location) : '') + '</div>' +
    '<div class="item-fields">' +
      '<div class="item-field"><div class="k">حداکثر ظرفیت</div><div class="v">' + (shelf.capacityKg === null ? '—' : escapeHtml(String(shelf.capacityKg)) + ' kg') + '</div></div>' +
      '<div class="item-field"><div class="k">بار فعلی</div><div class="v">' + escapeHtml(String(shelf.currentLoad)) + ' kg</div></div>' +
      '<div class="item-field"><div class="k">ظرفیت باقیمانده</div><div class="v">' + (shelf.remainingCapacity === null ? '—' : escapeHtml(String(shelf.remainingCapacity)) + ' kg') + '</div></div>' +
      '<div class="item-field"><div class="k">وضعیت بار</div><div class="v" style="color:' + color + ';font-weight:700;">' + escapeHtml(shelf.loadStatus) + '</div></div>' +
    '</div>' +
    '<div style="margin:10px 0 16px;">' + shelfUsageBarHtmlClient_(shelf.usagePercent, color) + '</div>';

  html += '<div class="section-title">کالاهای این قفسه (' + shelf.items.length + ')</div>';
  if (!shelf.items.length) {
    html += '<div class="empty-hint">کالایی با وزن ثبت‌شده روی این قفسه نیست.</div>';
  } else {
    html += '<div class="result-list">';
    shelf.items.forEach(function (it) {
      html +=
        '<div class="result-row" onclick="viewItemFromShelf(\'' + escapeHtml(it.code).replace(/'/g, "\\\\'") + '\')">' +
          '<div class="result-thumb">📦</div>' +
          '<div class="result-info">' +
            '<div class="result-name">' + escapeHtml(it.name || '(بدون نام)') + '</div>' +
            '<div class="result-meta">' +
              '<span class="code-pill-sm">' + escapeHtml(it.code) + '</span>' +
              '<span>تعداد: ' + escapeHtml(String(it.qty)) + '</span>' +
              '<span>وزن واحد: ' + escapeHtml(String(it.unitWeight)) + ' kg</span>' +
              '<span><b>وزن کل: ' + escapeHtml(String(it.totalWeight)) + ' kg</b></span>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
  }
  area.innerHTML = html;
}

// از داخل جزئیات قفسه، مستقیم به جزئیات همان کالا برو (در صفحه‌ی اصلی)
function viewItemFromShelf(code) {
  showScreen('mainScreen');
  setActiveNav('home');
  openItemDetail(code);
}

// صفحه‌ی «آماده برای اسکن بعدی» - چون اسکنر داخلی نداریم، همین‌جا راهنمایی می‌کنیم
// که دوربین گوشی را روی برچسب بعدی بگیرند؛ جست‌وجوی دستی هم همیشه در دسترس است.
function renderScanNextScreen() {
  setHeaderTitle('خانه');
  var area = document.getElementById('resultArea');
  area.innerHTML =
    '<div class="scan-ready-banner">' +
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-1.6c.3-.5.9-.9 1.5-.9h4c.6 0 1.2.4 1.5.9L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z"/><circle cx="12" cy="13" r="3.2"/></svg>' +
      '<div class="title">آماده‌ی اسکن کالای بعدی</div>' +
      '<div class="sub">دوربین گوشی را روی کیوآرکد بعدی بگیرید — این صفحه خودکار باز می‌شود.<br>یا کد/نام را در کادر بالا تایپ کنید.</div>' +
    '</div>';
  var recentHtml = buildRecentListHtml();
  area.innerHTML += '<div class="section-title">آخرین موارد ثبت‌شده در این جلسه</div>' + recentHtml;
  document.getElementById('searchInput').focus();
}

// ===================== لیست اخیر =====================
// >>> افزوده شد: پارامترهای pending/clientOpId — برای نمایش «در انتظار همگام‌سازی» و
// به‌روزرسانی همین ردیف پس از موفقیت همگام‌سازی (بدون تغییر رفتار فراخوانی‌های قبلی)
function addToRecent(item, qty, diff, pending, clientOpId) {
  recentItems.unshift({ name: item.name, code: item.code, qty: qty, diff: diff, pending: !!pending, clientOpId: clientOpId || null });
  if (recentItems.length > 15) recentItems.pop();
}
// <<< پایان بخش افزوده‌شده

function buildRecentListHtml() {
  if (recentItems.length === 0) {
    return '<div class="empty-hint">هنوز چیزی ثبت نشده؛ کد کالا را تایپ کنید یا دوربین گوشی را روی کیوآرکد بگیرید.</div>';
  }
  var html = '';
  recentItems.forEach(function (it) {
    var diffTxt = '';
    var diffClass = '';
    if (it.diff !== '' && it.diff != null) {
      if (it.diff > 0) { diffTxt = '+' + it.diff; diffClass = 'plus'; }
      else if (it.diff < 0) { diffTxt = String(it.diff); diffClass = 'minus'; }
      else { diffTxt = '۰'; }
    }
    // >>> افزوده شد: نشان «در انتظار همگام‌سازی» برای موارد ذخیره‌شده‌ی آفلاین که هنوز به سرور نرسیده‌اند
    var pendingBadge = it.pending ? ' <span style="color:#a15c00;font-weight:700;font-size:11px;">(در انتظار همگام‌سازی)</span>' : '';
    // <<< پایان بخش افزوده‌شده
    html += '<div class="recent-item"><span><b>' + escapeHtml(it.name) + '</b> — ' + escapeHtml(it.code) + '</span>' +
      '<span>شمارش: ' + escapeHtml(it.qty) + (diffTxt ? ' <span class="diff ' + diffClass + '">(' + diffTxt + ')</span>' : '') + pendingBadge + '</span></div>';
  });
  return html;
}

function renderRecentList() {
  currentDetail = null;
  setHeaderTitle('خانه');
  var area = document.getElementById('resultArea');
  area.innerHTML = '<div class="section-title">آخرین موارد ثبت‌شده در این جلسه</div>' + buildRecentListHtml();
}

// ===================== شروع برنامه =====================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(function () {});
}

// >>> افزوده شد: نمایش خودکار وضعیت آنلاین/آفلاین + تلاش خودکار برای ارسال صف هنگام بازگشت اینترنت
window.addEventListener('online', function () {
  renderSyncBar();
  syncNow();
});
window.addEventListener('offline', function () {
  renderSyncBar();
});
// بازگشت به اپ پس از پس‌زمینه (مثلاً کاربر برنامه را مینیمایز کرده و برگشته) — تلاش برای Sync/تازه‌سازی کش
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && state.token && isOnline()) syncNow();
});
// <<< پایان بخش افزوده‌شده

pendingId = readIdFromLocation();

if (state.serverUrl) {
  var serverInput = document.getElementById('serverUrlInput');
  if (serverInput) serverInput.value = state.serverUrl;
}

if (state.token && state.username) {
  enterApp();
} else if (pendingId) {
  // از کیوآرکد آمده ولی هنوز وارد نشده: پیش‌نمایش کالا (بدون موجودی) نشان داده می‌شود
  openPublicItemPreview(pendingId);
} else {
  showScreen('loginScreen');
}
