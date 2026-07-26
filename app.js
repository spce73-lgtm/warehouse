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

var state = {
  serverUrl: localStorage.getItem(LS_SERVER) || '',
  token: localStorage.getItem(LS_TOKEN) || '',
  username: localStorage.getItem(LS_USER) || '',
  role: localStorage.getItem(LS_ROLE) || '',
  fullName: localStorage.getItem(LS_FULLNAME) || ''
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
    localStorage.setItem(LS_TOKEN, state.token);
    localStorage.setItem(LS_USER, state.username);
    localStorage.setItem(LS_ROLE, state.role);
    localStorage.setItem(LS_FULLNAME, state.fullName);
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
  state.token = ''; state.username = ''; state.role = ''; state.fullName = '';
  showScreen('loginScreen');
}

function enterApp() {
  setText('whoLabel', state.fullName || state.username);
  setText('whoSub', state.role || '');
  showScreen('mainScreen');

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
      return data;
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
    renderItemDetail(res);
  }).catch(function (err) {
    area.innerHTML = '<div class="empty-hint">' + escapeHtml(err.message) + '</div>';
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

  var html =
    '<div class="item-detail-card">' +
      '<button class="back-link" onclick="backToSearch()">‹ بازگشت به جست‌وجو</button>' +
      galleryHtml +
      '<div class="item-title">' + escapeHtml(item.name || '(بدون نام)') + '</div>' +
      '<div class="item-code-pill">' + escapeHtml(item.code) + '</div>' +
      fieldsHtml +
      warehousesHtml +
      lastCountHtml +
      '<div class="sys-qty-row"><span class="k">موجودی سیستم' + (warehouses.length > 1 ? ' (مجموع کل انبارها)' : '') + '</span><span class="v">' + escapeHtml(item.systemQty !== '' && item.systemQty != null ? item.systemQty : '—') + '</span></div>' +
      '<div class="count-form-title">ثبت شمارش انبارگردانی</div>' +
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

function submitCount() {
  if (!currentDetail) return;
  var qtyEl = document.getElementById('qtyInput');
  var qty = qtyEl ? qtyEl.value : '';
  if (qty === '') { showToast('عدد شمارش را وارد کنید', true); if (qtyEl) qtyEl.focus(); return; }
  var note = (document.getElementById('noteInput') || {}).value || '';
  var btn = document.getElementById('submitCountBtn');
  btn.disabled = true; btn.textContent = 'در حال ثبت...';

  apiCall('apiRecordCount', { token: state.token, code: currentDetail.code, qty: qty, note: note }).then(function (res) {
    btn.disabled = false; btn.textContent = 'ثبت شمارش';
    if (handleIfSessionExpired(res)) return;
    if (!res.success) { showToast(res.message || 'خطا در ثبت', true); return; }
    addToRecent(currentDetail, qty, res.diff);
    showToast('✓ ثبت شد');
    document.getElementById('searchInput').value = '';
    lastSearchResults = null;
    currentDetail = null;
    renderScanNextScreen();
  }).catch(function (err) {
    btn.disabled = false; btn.textContent = 'ثبت شمارش';
    showToast(err.message, true);
  });
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
function addToRecent(item, qty, diff) {
  recentItems.unshift({ name: item.name, code: item.code, qty: qty, diff: diff });
  if (recentItems.length > 15) recentItems.pop();
}

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
    html += '<div class="recent-item"><span><b>' + escapeHtml(it.name) + '</b> — ' + escapeHtml(it.code) + '</span>' +
      '<span>شمارش: ' + escapeHtml(it.qty) + (diffTxt ? ' <span class="diff ' + diffClass + '">(' + diffTxt + ')</span>' : '') + '</span></div>';
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
