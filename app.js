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
var currentDetail = null; // آخرین کالایی که جزئیاتش باز شده
var lastSearchResults = null; // آخرین نتایج جست‌وجو (برای «بازگشت به جست‌وجو»)
var lastSearchQuery = '';

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function setText(id, value) {
  var el = document.getElementById(id);
  if (!el) { console.warn('عنصر با آی‌دی "' + id + '" پیدا نشد.'); return; }
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

// ===================== ارتباط با سرور (JSONP - بدون نیاز به CORS) =====================
var jsonpCounter = 0;
function apiCall(action, params) {
  return new Promise(function (resolve, reject) {
    var cbName = 'whCb_' + (jsonpCounter++) + '_' + Date.now();
    var script = document.createElement('script');
    var timeout = setTimeout(function () {
      cleanup();
      reject(new Error('سرور در زمان مناسب پاسخ نداد.'));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (data) {
      cleanup();
      resolve(data);
    };

    var qs = 'action=' + encodeURIComponent(action) + '&callback=' + cbName;
    for (var k in params) {
      if (params[k] !== undefined && params[k] !== null) qs += '&' + k + '=' + encodeURIComponent(params[k]);
    }
    script.src = state.serverUrl + '?' + qs;
    script.onerror = function () { cleanup(); reject(new Error('اتصال به سرور برقرار نشد.')); };
    document.body.appendChild(script);
  });
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
  closeScanner();
  showScreen('loginScreen');
}

function enterApp() {
  setText('whoLabel', state.fullName || state.username);
  setText('whoSub', state.role || '');
  showScreen('mainScreen');
  renderRecentList();
}

// ===================== جست‌وجو (دستی یا اسکن‌شده - دقیقاً یک مسیر مشترک) =====================
var searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });
}

function doSearch() {
  var q = document.getElementById('searchInput').value.trim();
  if (!q) { showToast('چیزی برای جست‌وجو تایپ یا اسکن کنید', true); return; }
  var area = document.getElementById('resultArea');
  area.innerHTML = '<div class="lookup-loading"><div class="spinner"></div> در حال جست‌وجو...</div>';

  apiCall('apiSearch', { token: state.token, q: q }).then(function (res) {
    if (!res.success) {
      if (res.needLogin) { doLogout(); return; }
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

// ===================== جزئیات کامل کالا (مثل صفحه‌ی جست‌وجوی سامانه‌ی اصلی) =====================
function openItemDetail(code) {
  var area = document.getElementById('resultArea');
  area.innerHTML = '<div class="lookup-loading"><div class="spinner"></div> در حال دریافت مشخصات کالا...</div>';

  apiCall('apiLookup', { token: state.token, code: code }).then(function (res) {
    if (!res.success) {
      if (res.needLogin) { doLogout(); return; }
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

  var html =
    '<div class="item-detail-card">' +
      '<button class="back-link" onclick="backToSearch()">‹ بازگشت به جست‌وجو</button>' +
      galleryHtml +
      '<div class="item-title">' + escapeHtml(item.name || '(بدون نام)') + '</div>' +
      '<div class="item-code-pill">' + escapeHtml(item.code) + '</div>' +
      fieldsHtml +
      '<div class="sys-qty-row"><span class="k">موجودی سیستم</span><span class="v">' + escapeHtml(item.systemQty !== '' && item.systemQty != null ? item.systemQty : '—') + '</span></div>' +
      '<div class="count-form-title">ثبت شمارش انبارگردانی</div>' +
      '<div class="qty-row">' +
        '<button class="qty-step" onclick="stepQty(-1)">−</button>' +
        '<input type="number" class="qty-input" id="qtyInput" inputmode="decimal" placeholder="0" oninput="updateDiffPreview()">' +
        '<button class="qty-step" onclick="stepQty(1)">+</button>' +
      '</div>' +
      '<div class="diff-preview" id="diffPreview"></div>' +
      '<textarea class="note-input" id="noteInput" placeholder="توضیحات (اختیاری)..."></textarea>' +
      '<button class="btn btn-primary" id="submitCountBtn" onclick="submitCount()">ثبت و بازگشت به جست‌وجو</button>' +
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
    btn.disabled = false; btn.textContent = 'ثبت و بازگشت به جست‌وجو';
    if (!res.success) { showToast(res.message || 'خطا در ثبت', true); return; }
    addToRecent(currentDetail, qty, res.diff);
    showToast('✓ ثبت شد');
    document.getElementById('searchInput').value = '';
    lastSearchResults = null;
    renderRecentList();
  }).catch(function (err) {
    btn.disabled = false; btn.textContent = 'ثبت و بازگشت به جست‌وجو';
    showToast(err.message, true);
  });
}

// ===================== لیست اخیر =====================
function addToRecent(item, qty, diff) {
  recentItems.unshift({ name: item.name, code: item.code, qty: qty, diff: diff });
  if (recentItems.length > 15) recentItems.pop();
}

function backToSearch() {
  currentDetail = null;
  if (lastSearchResults && lastSearchResults.length > 1) {
    renderResultsList(lastSearchResults, lastSearchQuery);
  } else {
    renderRecentList();
  }
}

function renderRecentList() {
  currentDetail = null;
  var area = document.getElementById('resultArea');
  var html = '<div class="section-title">آخرین موارد ثبت‌شده در این جلسه</div>';
  if (recentItems.length === 0) {
    html += '<div class="empty-hint">هنوز چیزی ثبت نشده؛ کد کالا را تایپ یا اسکن کنید.</div>';
  } else {
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
  }
  area.innerHTML = html;
}

// ===================== اسکنر (فقط با زدن آیکون دوربین باز می‌شود) =====================
var html5QrCode = null;
var scannerRunning = false;

function openScanner() {
  document.getElementById('scannerOverlay').classList.add('open');
  document.getElementById('camError').style.display = 'none';
  if (!html5QrCode) html5QrCode = new Html5Qrcode('qrReader', { experimentalFeatures: { useBarCodeDetectorIfSupported: true } });

  // کادر اسکن حالا مربعی و متناسب با اندازه‌ی صفحه است (نه یک مستطیل کشیده که
  // باعث می‌شد کیوآرکد مربعی به‌سختی و از فاصله‌ی دور داخلش جا شود)
  function computeQrbox(viewfinderWidth, viewfinderHeight) {
    var minEdge = Math.min(viewfinderWidth, viewfinderHeight);
    var size = Math.floor(minEdge * 0.78);
    return { width: size, height: size };
  }

  html5QrCode.start(
    { facingMode: 'environment' },
    {
      fps: 12,
      qrbox: computeQrbox,
      aspectRatio: 1.0,
      videoConstraints: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1920 },
        advanced: [{ focusMode: 'continuous' }]
      }
    },
    function onScanSuccess(decodedText) {
      onCodeDetected(decodedText);
    },
    function onScanFailure() {}
  ).then(function () {
    scannerRunning = true;
  }).catch(function () {
    document.getElementById('camError').style.display = 'flex';
  });
}

function closeScanner() {
  document.getElementById('scannerOverlay').classList.remove('open');
  if (html5QrCode && scannerRunning) {
    html5QrCode.stop().then(function () { scannerRunning = false; }).catch(function () { scannerRunning = false; });
  }
}

function extractItemCode(raw) {
  if (/^https?:\/\//i.test(raw)) {
    try {
      var u = new URL(raw);
      var idParam = u.searchParams.get('id');
      if (idParam) return idParam;
    } catch (e) {}
  }
  return raw;
}

var lastScanned = null, lastScanTime = 0;
function onCodeDetected(raw) {
  var now = Date.now();
  if (raw === lastScanned && (now - lastScanTime) < 2500) return;
  lastScanned = raw; lastScanTime = now;
  var code = extractItemCode(raw);
  closeScanner();
  // دقیقاً همان مسیر جست‌وجوی دستی: کد اسکن‌شده در کادر جست‌وجو گذاشته و جست‌وجو می‌شود
  document.getElementById('searchInput').value = code;
  doSearch();
}

// ===================== شروع برنامه =====================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(function () {});
}

if (state.serverUrl) {
  document.getElementById('serverUrlInput').value = state.serverUrl;
}
if (state.token && state.username) {
  enterApp();
} else {
  showScreen('loginScreen');
}
