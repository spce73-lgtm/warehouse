// =====================================================================
// اسکنر انبارگردانی - نسخه‌ی بدون اسکنر داخلی
// کیوآرکدها حالا مستقیم لینک همین برنامه‌اند (?id=CODE)؛ اسکن با دوربین
// پیش‌فرض خودِ گوشی (هر برند) انجام می‌شود، نه با یک اسکنر داخل صفحه.
// =====================================================================

// ===================== حافظه‌ی محلی =====================
var LS_SERVER = 'wh_scanner_server_url';
var LS_TOKEN = 'wh_scanner_token';
var LS_USER = 'wh_scanner_username';
var LS_ROLE = 'wh_scanner_role';
var LS_FULLNAME = 'wh_scanner_fullname';
var LS_WAREHOUSE = 'wh_scanner_warehouse_access';
// >>> افزوده شد: همگام‌سازی آفلاین — آخرین زمان همگام‌سازی موفق (رشته‌ی شمسی آماده از سرور)
var LS_LAST_SYNC = 'wh_scanner_last_sync';
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

function renderSyncBar() {
  var bar = document.getElementById('syncBar');
  if (!bar) return;
  var online = isOnline();
  var dotColor = online ? '#1a7f37' : '#c53030';
  var lastSync = localStorage.getItem(LS_LAST_SYNC) || '—';
  bar.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;padding:7px 12px;background:#f4f6f8;border-bottom:1px solid #e4e7ea;font-size:11.5px;flex-wrap:wrap;">' +
      '<span style="width:9px;height:9px;border-radius:50%;background:' + dotColor + ';display:inline-block;flex:none;"></span>' +
      '<span style="font-weight:700;color:' + dotColor + ';">' + (online ? 'آنلاین' : 'آفلاین') + '</span>' +
      (syncState.pendingCount ? '<span style="color:#a15c00;font-weight:700;">' + syncState.pendingCount + ' در صف ارسال</span>' : '') +
      '<span style="color:#5a6472;">آخرین همگام‌سازی: ' + escapeHtml(lastSync) + '</span>' +
      '<button type="button" id="syncNowBtn" onclick="syncNow()" style="margin-inline-start:auto;border:1px solid #0f4c81;color:#0f4c81;background:#fff;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;"' + (syncState.syncing ? ' disabled' : '') + '>' +
        (syncState.syncing ? 'در حال ارسال...' : 'همگام‌سازی اکنون') +
      '</button>' +
    '</div>';
}

function refreshPendingCount() {
  SyncDB.listQueue().then(function (items) {
    syncState.pendingCount = items.length;
    renderSyncBar();
  }).catch(function () {});
}

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
function syncNow() {
  if (syncState.syncing) return;
  if (!state.token) return; // هنوز وارد نشده
  if (!isOnline()) { showToast('اتصال اینترنت برقرار نیست', true); return; }

  SyncDB.listQueue().then(function (items) {
    if (!items.length) {
      showToast('چیزی برای همگام‌سازی نیست');
      refreshPendingCount();
      return;
    }
    syncState.syncing = true;
    renderSyncBar();

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
        if (okCount) showToast('✓ ' + okCount + ' مورد همگام‌سازی شد' + (failCount ? (' — ' + failCount + ' ناموفق') : ''));
        else if (failCount) showToast('همگام‌سازی ناموفق بود؛ دوباره تلاش می‌شود', true);
        // >>> افزوده شد: اگر همین لحظه صفحه‌ی «اخیر» باز است، نشان‌های «در انتظار» را بلافاصله به‌روز کن
        maybeRefreshRecentView();
        // <<< پایان بخش افزوده‌شده
        if (items.length > batch.length && isOnline()) setTimeout(syncNow, 400);
      });
    }).catch(function (err) {
      syncState.syncing = false;
      renderSyncBar();
      // >>> افزوده شد: اگر واقعاً اتصال قطع است، این یک خطای واقعی نیست — فقط باید صبر کرد تا اینترنت برگردد؛
      // پیام «تایم‌اوت سرور»/«پاسخ نداد» را در این حالت به کاربر نشان نمی‌دهیم. آیتم‌های صف همچنان دست‌نخورده باقی می‌مانند.
      if (isOnline()) {
        showToast('خطا در همگام‌سازی: ' + err.message, true);
      }
      // <<< پایان بخش افزوده‌شده
    });
  }).catch(function () {});
}
// ===================== پایان بخش همگام‌سازی آفلاین =====================

// ===================== ارتباط با سرور (JSONP - بدون نیاز به CORS) =====================
var jsonpCounter = 0;
function apiCall(action, params) {
  return new Promise(function (resolve, reject) {
    if (!state.serverUrl) { reject(new Error('آدرس سامانه تنظیم نشده.')); return; }

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
  var shelvesBtn = document.getElementById('shelvesNavBtn');
  if (shelvesBtn) shelvesBtn.style.display = state.warehouseAccess ? '' : 'none';
  showScreen('mainScreen');

  // >>> افزوده شد: نمایش نوار همگام‌سازی + تلاش خودکار برای ارسال هر عملیات باقیمانده از جلسه‌ی قبل
  renderSyncBar();
  refreshPendingCount();
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

function doSearch() {
  var raw = document.getElementById('searchInput').value.trim();
  if (!raw) { showToast('چیزی برای جست‌وجو تایپ کنید', true); return; }
  var q = extractItemCode(raw);

  var area = document.getElementById('resultArea');
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
      renderResultsList(results, q);
    }
  }).catch(function (err) {
    area.innerHTML = '<div class="empty-hint">' + escapeHtml(err.message) + '</div>';
  });
}

function renderResultsList(results, q) {
  var area = document.getElementById('resultArea');
  var html = '<div class="section-title">' + results.length + ' نتیجه برای «' + escapeHtml(q) + '»</div><div class="result-list">';
  results.forEach(function (r) {
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
function openItemDetail(code) {
  var area = document.getElementById('resultArea');
  area.innerHTML = '<div class="lookup-loading"><div class="spinner"></div> در حال دریافت مشخصات کالا...</div>';

  apiCall('apiLookup', { token: state.token, code: code }).then(function (res) {
    if (handleIfSessionExpired(res)) return;
    if (!res.success) {
      area.innerHTML =
        '<button class="back-link" onclick="backToSearch()">‹ بازگشت به جست‌وجو</button>' +
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
    SyncDB.cacheGet('item_' + code).then(function (rec) {
      if (rec && rec.value) {
        currentDetail = rec.value;
        showToast('نمایش نسخه‌ی ذخیره‌شده (آفلاین)', false);
        renderItemDetail(rec.value);
      } else {
        area.innerHTML = '<div class="empty-hint">' + escapeHtml(err.message) + '</div>';
      }
    }).catch(function () {
      area.innerHTML = '<div class="empty-hint">' + escapeHtml(err.message) + '</div>';
    });
    // <<< پایان بخش افزوده‌شده
  });
}

function renderItemDetail(item) {
  var area = document.getElementById('resultArea');
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

  // موجودی به‌تفکیک انبار (فقط اگر کالا در بیش از یک انبار ثبت شده باشد)
  var warehousesHtml = '';
  var warehouses = item.warehouses || [];
  if (warehouses.length > 1) {
    warehousesHtml = '<div class="section-title">موجودی به تفکیک انبار</div><div class="wh-grid">' +
      warehouses.map(function (w) {
        return '<div class="wh-item"><div class="k">' + escapeHtml(w.warehouse) + '</div><div class="v">' + escapeHtml(String(w.qty)) + '</div></div>';
      }).join('') + '</div>';
  }

  // آخرین شمارش ثبت‌شده (در یک سال اخیر)
  var lastCountHtml = '';
  if (item.lastCount) {
    var lc = item.lastCount;
    var diffTxt = (lc.diff === '' || lc.diff === null || lc.diff === undefined) ? '' :
      (' · اختلاف: ' + (Number(lc.diff) > 0 ? '+' : '') + escapeHtml(String(lc.diff)));
    lastCountHtml =
      '<div class="last-count-box">' +
        '<div class="k">آخرین شمارش ثبت‌شده</div>' +
        '<div class="v">' + escapeHtml(lc.date) + ' — موجودی فیزیکی: ' + escapeHtml(String(lc.physicalQty)) + diffTxt + '</div>' +
      '</div>';
  }

  // انتخاب انبار (فقط اگر کالا در بیش از یک انبار موجود باشد)
  var warehouseSelectHtml = '';
  if (warehouses.length > 1) {
    warehouseSelectHtml =
      '<label class="count-label">انتخاب انبار (برای ثبت شمارش)</label>' +
      '<select class="wh-select" id="countWarehouseSelect">' +
        '<option value="">— انتخاب کنید —</option>' +
        warehouses.map(function (w) {
          return '<option value="' + escapeHtml(w.warehouse) + '">' + escapeHtml(w.warehouse) + ' (موجودی سیستم: ' + escapeHtml(String(w.qty)) + ')</option>';
        }).join('') +
      '</select>';
  }

  // ===================== وزن و قفسه (فقط برای کاربران دارای دسترسی انبار) =====================
  // سرور فقط وقتی این فیلدها را برمی‌گرداند که کاربر دسترسی انبار داشته باشد؛ همان حضورِ
  // item.shelfDisplay اینجا به‌عنوان نشانه‌ی مجوز استفاده می‌شود (بدون تصمیم‌گیری سمت کلاینت).
  var weightShelfHtml = '';
  if (item.shelfDisplay !== undefined) {
    var activeShelves = item.activeShelves || [];
    var shelfOptionsHtml = '<option value="">— بدون قفسه —</option>' +
      activeShelves.map(function (s) {
        var label = s.code + (s.location ? ' — ' + s.location : '');
        return '<option value="' + escapeHtml(s.code) + '"' + (item.shelfCode === s.code ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
      }).join('');
    // اگر قفسه‌ی فعلی کالا دیگر در فهرست قفسه‌های فعال نیست (مثلاً غیرفعال شده)، باز هم نشان داده شود تا از دست نرود
    if (item.shelfCode && activeShelves.every(function (s) { return s.code !== item.shelfCode; })) {
      shelfOptionsHtml += '<option value="' + escapeHtml(item.shelfCode) + '" selected>' + escapeHtml(item.shelfCode) + ' (غیرفعال/نامعتبر)</option>';
    }
    // >>> افزوده شد: پنل فشرده‌ی ظرفیت قفسه — از همان محاسبات زنده‌ی سرور (item.shelfLoad) استفاده می‌شود
    var shelfCapacityHtml = '';
    if (item.shelfLoad) {
      var slColor = shelfLoadStatusColorClient_(item.shelfLoad.loadStatus);
      shelfCapacityHtml =
        '<div style="border-top:1px dashed #e4e7ea;margin:10px 0;padding-top:10px;">' +
          '<div style="font-size:12px;font-weight:800;color:#3f4750;margin-bottom:6px;">ظرفیت قفسه‌ی ' + escapeHtml(item.shelfCode) + '</div>' +
          '<div class="item-fields" style="margin-bottom:6px;">' +
            '<div class="item-field"><div class="k">حداکثر ظرفیت</div><div class="v">' + (item.shelfLoad.capacityKg === null ? '—' : escapeHtml(String(item.shelfLoad.capacityKg)) + ' kg') + '</div></div>' +
            '<div class="item-field"><div class="k">بار فعلی قفسه</div><div class="v">' + escapeHtml(String(item.shelfLoad.currentLoad)) + ' kg</div></div>' +
            '<div class="item-field"><div class="k">ظرفیت باقیمانده</div><div class="v">' + (item.shelfLoad.remainingCapacity === null ? '—' : escapeHtml(String(item.shelfLoad.remainingCapacity)) + ' kg') + '</div></div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
            shelfUsageBarHtmlClient_(item.shelfLoad.usagePercent, slColor) +
            '<span style="font-size:11px;font-weight:700;color:' + slColor + ';">' + escapeHtml(item.shelfLoad.loadStatus) + '</span>' +
          '</div>' +
        '</div>';
    }
    // <<< پایان بخش افزوده‌شده

    weightShelfHtml =
      '<div class="section-title">وزن و قفسه</div>' +
      '<div class="item-fields">' +
        '<div class="item-field"><div class="k">وزن واحد</div><div class="v" id="unitWeightView">' + escapeHtml(item.unitWeightDisplay) + '</div></div>' +
        '<div class="item-field"><div class="k">وزن کل موجودی</div><div class="v" id="totalWeightView">' + escapeHtml(item.totalWeightDisplay) + '</div></div>' +
        '<div class="item-field"><div class="k">قفسه</div><div class="v" id="shelfView">' + escapeHtml(item.shelfDisplay) + '</div></div>' +
      '</div>' +
      shelfCapacityHtml +
      '<button class="btn btn-secondary" id="toggleWeightShelfBtn" onclick="toggleWeightShelfEdit()">ویرایش وزن / قفسه</button>' +
      '<div class="weight-shelf-edit" id="weightShelfEditBox" style="display:none;">' +
        '<label class="count-label">وزن واحد (kg)</label>' +
        '<input type="number" class="qty-input" id="unitWeightInput" step="0.001" min="0" inputmode="decimal" value="' + (item.unitWeight === '' ? '' : escapeHtml(String(item.unitWeight))) + '" placeholder="مثلاً 2.5">' +
        '<label class="count-label">قفسه</label>' +
        '<select class="wh-select" id="shelfSelect">' + shelfOptionsHtml + '</select>' +
        '<button class="btn btn-primary" id="saveWeightShelfBtn" onclick="submitWeightShelf()">ذخیره تغییرات</button>' +
        '<div class="diff-preview" id="weightShelfMsg"></div>' +
      '</div>';
  }

  var html =
    '<div class="item-detail-card">' +
      '<button class="back-link" onclick="backToSearch()">‹ بازگشت به جست‌وجو</button>' +
      galleryHtml +
      '<div class="item-title">' + escapeHtml(item.name || '(بدون نام)') + '</div>' +
      '<div class="item-code-pill">' + escapeHtml(item.code) + '</div>' +
      fieldsHtml +
      warehousesHtml +
      lastCountHtml +
      weightShelfHtml +
      '<div class="sys-qty-row"><span class="k">موجودی سیستم' + (warehouses.length > 1 ? ' (مجموع کل انبارها)' : '') + '</span><span class="v">' + escapeHtml(item.systemQty !== '' && item.systemQty != null ? item.systemQty : '—') + '</span></div>' +
      '<div class="count-form-title">ثبت شمارش انبارگردانی</div>' +
      warehouseSelectHtml +
      '<div class="qty-row">' +
        '<button class="qty-step" onclick="stepQty(-1)">−</button>' +
        '<input type="number" class="qty-input" id="qtyInput" inputmode="decimal" placeholder="0" oninput="updateDiffPreview()">' +
        '<button class="qty-step" onclick="stepQty(1)">+</button>' +
      '</div>' +
      '<div class="diff-preview" id="diffPreview"></div>' +
      '<textarea class="note-input" id="noteInput" placeholder="توضیحات (اختیاری)..."></textarea>' +
      '<button class="btn btn-primary" id="submitCountBtn" onclick="submitCount()">ثبت شمارش</button>' +
    '</div>';

  area.innerHTML = html;
  setTimeout(function () {
    var q = document.getElementById('qtyInput');
    if (q) q.focus();
  }, 100);
}

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
  var sys = Number(currentDetail.systemQty);
  var phys = Number(qty);
  if (isNaN(sys) || isNaN(phys)) { el.textContent = ''; return; }
  var diff = phys - sys;
  if (diff === 0) { el.textContent = 'مطابق موجودی سیستم'; el.className = 'diff-preview ok'; }
  else if (diff > 0) { el.textContent = 'اضافه: +' + diff; el.className = 'diff-preview ok'; }
  else { el.textContent = 'کسری: ' + diff; el.className = 'diff-preview bad'; }
}

// >>> افزوده شد: صف‌کردن آفلاینِ یک شمارش (وقتی اینترنت قطع است یا ارسال آنلاین ناموفق بود)
function queueRecordCount(itemForRecent, qty, note, warehouse) {
  var clientOpId = genUuid();
  var op = {
    clientOpId: clientOpId, type: 'recordCount',
    code: itemForRecent.code, qty: qty, note: note, warehouse: warehouse,
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

function submitCount() {
  if (!currentDetail) return;
  var qtyEl = document.getElementById('qtyInput');
  var qty = qtyEl ? qtyEl.value : '';
  if (qty === '') { showToast('عدد شمارش را وارد کنید', true); if (qtyEl) qtyEl.focus(); return; }
  var whSelect = document.getElementById('countWarehouseSelect');
  var warehouse = whSelect ? whSelect.value : '';
  if (whSelect && !warehouse) { showToast('لطفاً ابتدا انبار را انتخاب کنید', true); whSelect.focus(); return; }
  var note = (document.getElementById('noteInput') || {}).value || '';
  var btn = document.getElementById('submitCountBtn');

  // >>> افزوده شد: اگر اینترنت قطع است، مستقیم در صف آفلاین ذخیره کن
  if (!isOnline()) {
    queueRecordCount(currentDetail, qty, note, warehouse).catch(function () {});
    return;
  }
  // <<< پایان بخش افزوده‌شده

  btn.disabled = true; btn.textContent = 'در حال ثبت...';
  var itemForRecent = currentDetail;
  var clientOpId = genUuid(); // >>> افزوده شد: شناسه‌ی یکتای عملیات، برای جلوگیری از ثبت تکراری سمت سرور

  apiCall('apiRecordCount', { token: state.token, code: currentDetail.code, qty: qty, note: note, warehouse: warehouse, clientOpId: clientOpId }).then(function (res) {
    btn.disabled = false; btn.textContent = 'ثبت شمارش';
    if (handleIfSessionExpired(res)) return;
    if (!res.success) { showToast(res.message || 'خطا در ثبت', true); return; }
    if (res.serverTime) localStorage.setItem(LS_LAST_SYNC, res.serverTime); // >>> افزوده شد
    addToRecent(currentDetail, qty, res.diff);
    showToast('✓ ثبت شد');
    document.getElementById('searchInput').value = '';
    lastSearchResults = null;
    currentDetail = null;
    renderScanNextScreen();
  }).catch(function () {
    // >>> افزوده شد: اتصال ناپایدار/قطع وسط ارسال — به‌جای نمایش خطا، در صف آفلاین ذخیره کن
    btn.disabled = false; btn.textContent = 'ثبت شمارش';
    queueRecordCount(itemForRecent, qty, note, warehouse).catch(function () {});
    // <<< پایان بخش افزوده‌شده
  });
}

// ===================== ویرایش وزن / قفسه (فقط کاربران دارای دسترسی انبار می‌بینند) =====================
function toggleWeightShelfEdit() {
  var box = document.getElementById('weightShelfEditBox');
  if (!box) return;
  var open = box.style.display !== 'none';
  box.style.display = open ? 'none' : 'block';
  var btn = document.getElementById('toggleWeightShelfBtn');
  if (btn) btn.textContent = open ? 'ویرایش وزن / قفسه' : 'انصراف از ویرایش';
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

function submitWeightShelf() {
  if (!currentDetail) return;
  var weightEl = document.getElementById('unitWeightInput');
  var shelfEl = document.getElementById('shelfSelect');
  var msg = document.getElementById('weightShelfMsg');
  var btn = document.getElementById('saveWeightShelfBtn');
  var unitWeight = weightEl ? weightEl.value : '';
  var shelfCode = shelfEl ? shelfEl.value : '';

  if (unitWeight !== '' && (isNaN(Number(unitWeight)) || Number(unitWeight) < 0)) {
    msg.textContent = 'وزن واحد باید عددی نامنفی باشد.'; msg.className = 'diff-preview bad'; return;
  }

  // >>> افزوده شد: اگر اینترنت قطع است، مستقیم در صف آفلاین ذخیره کن
  if (!isOnline()) {
    var codeOffline = currentDetail.code;
    queueUpdateWeightShelf(codeOffline, unitWeight, shelfCode).then(function () {
      msg.textContent = 'ذخیره شد؛ پس از اتصال اینترنت اعمال می‌شود.';
      msg.className = 'diff-preview ok';
      showToast('در صف ارسال قرار گرفت');
    }).catch(function () { /* پیام خطا قبلاً در queueUpdateWeightShelf نمایش داده شد */ });
    return;
  }
  // <<< پایان بخش افزوده‌شده

  btn.disabled = true; btn.textContent = 'در حال ذخیره...';
  msg.textContent = ''; msg.className = 'diff-preview';
  var codeForQueue = currentDetail.code;
  var clientOpId = genUuid(); // >>> افزوده شد: شناسه‌ی یکتای عملیات، برای جلوگیری از اعمال تکراری سمت سرور

  // توجه: محاسبه‌ی وزن کل و اعتبارسنجی قفسه فقط سمت سرور انجام می‌شود؛
  // اینجا فقط مقادیر خام کاربر ارسال و نتیجه‌ی آماده‌ی سرور نمایش داده می‌شود.
  apiCall('apiUpdateItemWeightShelf', { token: state.token, code: currentDetail.code, unitWeight: unitWeight, shelfCode: shelfCode, clientOpId: clientOpId }).then(function (res) {
    btn.disabled = false; btn.textContent = 'ذخیره تغییرات';
    if (handleIfSessionExpired(res)) return;
    if (!res.success) { msg.textContent = res.message || 'خطا در ذخیره.'; msg.className = 'diff-preview bad'; return; }
    if (res.serverTime) localStorage.setItem(LS_LAST_SYNC, res.serverTime); // >>> افزوده شد

    currentDetail.unitWeight = res.unitWeight;
    currentDetail.shelfCode = res.shelfCode;
    currentDetail.shelf = res.shelf;
    currentDetail.totalWeight = res.totalWeight;
    currentDetail.unitWeightDisplay = res.unitWeightDisplay;
    currentDetail.totalWeightDisplay = res.totalWeightDisplay;
    currentDetail.shelfDisplay = res.shelfDisplay;
    currentDetail.shelfLoad = res.shelfLoad; // پنل ظرفیت قفسه هم باید با بار تازه‌محاسبه‌شده به‌روز شود

    showToast('تغییرات ذخیره شد.', false);
    renderItemDetail(currentDetail); // بازسازی کامل صفحه‌ی جزئیات تا پنل ظرفیت قفسه هم تازه شود
  }).catch(function () {
    // >>> افزوده شد: اتصال ناپایدار/قطع وسط ارسال — به‌جای نمایش خطا، در صف آفلاین ذخیره کن
    btn.disabled = false; btn.textContent = 'ذخیره تغییرات';
    queueUpdateWeightShelf(codeForQueue, unitWeight, shelfCode).then(function () {
      msg.textContent = 'اتصال ناپایدار بود؛ در صف ارسال قرار گرفت.';
      msg.className = 'diff-preview ok';
    });
    // <<< پایان بخش افزوده‌شده
  });
}

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
  }
}

function openShelvesList() {
  shelvesViewState = 'list';
  currentShelfCode = null;
  showScreen('shelvesScreen');
  var area = document.getElementById('shelvesArea');
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

function renderShelvesList(shelves) {
  var area = document.getElementById('shelvesArea');
  if (!shelves.length) {
    area.innerHTML = '<div class="empty-hint">قفسه‌ای یافت نشد.</div>';
    return;
  }
  var html = '<div class="section-title">قفسه‌ها (' + shelves.length + ')</div><div class="result-list">';
  shelves.forEach(function (s) {
    var color = shelfLoadStatusColorClient_(s.loadStatus);
    html +=
      '<div class="result-row" style="border-inline-start:3px solid ' + color + ';" onclick="openShelfDetail(\'' + escapeHtml(s.code).replace(/'/g, "\\\\'") + '\')">' +
        '<div class="result-thumb">🗄️</div>' +
        '<div class="result-info">' +
          '<div class="result-name">' + escapeHtml(s.code) + (s.location ? ' — ' + escapeHtml(s.location) : '') + '</div>' +
          '<div class="result-meta">' +
            '<span style="color:' + color + ';font-weight:700;">' + escapeHtml(s.loadStatus) + '</span>' +
            '<span>بار: ' + escapeHtml(String(s.currentLoad)) + ' kg' + (s.capacityKg !== null ? (' از ' + escapeHtml(String(s.capacityKg)) + ' kg') : '') + '</span>' +
            '<span>' + s.itemCount + ' کالا</span>' +
          '</div>' +
          '<div style="margin-top:6px;">' + shelfUsageBarHtmlClient_(s.usagePercent, color) + '</div>' +
        '</div>' +
      '</div>';
  });
  html += '</div>';
  area.innerHTML = html;
}

function openShelfDetail(code) {
  shelvesViewState = 'detail';
  currentShelfCode = code;
  var area = document.getElementById('shelvesArea');
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
  openItemDetail(code);
}

// صفحه‌ی «آماده برای اسکن بعدی» - چون اسکنر داخلی نداریم، همین‌جا راهنمایی می‌کنیم
// که دوربین گوشی را روی برچسب بعدی بگیرند؛ جست‌وجوی دستی هم همیشه در دسترس است.
function renderScanNextScreen() {
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
