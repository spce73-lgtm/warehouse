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
var currentDetail = null;
var lastSearchResults = null;
var lastSearchQuery = '';
var pendingId = null;

// ===================== ابزارهای کمکی =====================
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
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

function readIdFromLocation() {
  var params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function extractItemCode(raw) {
  if (/^https?:///i.test(raw)) {
    try {
      var u = new URL(raw);
      var idParam = u.searchParams.get('id');
      if (idParam) return idParam;
    } catch (e) {}
  }
  return raw;
}

function clearIdFromUrl() {
  try {
    var url = new URL(window.location.href);
    url.searchParams.delete('id');
    window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
  } catch (e) {}
}

// ===================== ارتباط با سرور (JSONP) =====================
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
  
  if (state.role === 'admin') {
    document.getElementById('importBtn').style.display = 'flex';
  }
  
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
  var inventory = item.inventory || [];
  
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
  
  var inventoryHtml = '';
  if (inventory.length > 0) {
    inventoryHtml = '<div class="inventory-section"><div class="inventory-title">موجودی تفکیکی انبارها</div>';
    inventory.forEach(function (inv) {
      inventoryHtml += '<div class="inventory-row">';
      inventoryHtml += '<span class="inv-warehouse">🏭 ' + escapeHtml(inv.warehouse_name) + '</span>';
      inventoryHtml += '<span class="inv-qty">' + inv.qty + ' عدد</span>';
      inventoryHtml += '</div>';
    });
    inventoryHtml += '<div class="inventory-total">';
    inventoryHtml += '<span>جمع کل موجودی سیستم</span>';
    inventoryHtml += '<span>' + item.systemQty + ' عدد</span>';
    inventoryHtml += '</div>';
    inventoryHtml += '</div>';
  } else {
    inventoryHtml = '<div class="sys-qty-row"><span class="k">موجودی سیستم</span><span class="v">' + 
      (item.systemQty !== '' && item.systemQty != null ? item.systemQty : '—') + '</span></div>';
  }
  
  var html =
    '<div class="item-detail-card">' +
    '<button class="back-link" onclick="backToSearch()">‹ بازگشت به جست‌وجو</button>' +
    galleryHtml +
    '<div class="item-title">' + escapeHtml(item.name || '(بدون نام)') + '</div>' +
    '<div class="item-code-pill">' + escapeHtml(item.code) + '</div>' +
    fieldsHtml +
    inventoryHtml +
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

// ===================== Import از اکسل =====================
var importData = null;
var importMapping = null;

function showImportScreen() {
  if (state.role !== 'admin') {
    showToast('فقط ادمین مجاز به آپدیت موجودی است', true);
    return;
  }
  
  setText('importWhoLabel', state.fullName || state.username);
  showScreen('importScreen');
  resetImport();
}

function resetImport() {
  importData = null;
  importMapping = null;
  document.getElementById('importFileInput').value = '';
  document.getElementById('importPreviewArea').style.display = 'none';
  document.getElementById('importResultArea').style.display = 'none';
}

document.getElementById('importFileInput').addEventListener('change', function(e) {
  var file = e.target.files[0];
  if (!file) return;
  
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = e.target.result;
      var workbook = XLSX.read(data, { type: 'binary' });
      var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      var jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
      
      importData = jsonData;
      loadImportPreview();
    } catch (err) {
      showToast('خطا در خواندن فایل: ' + err.message, true);
    }
  };
  reader.readAsBinaryString(file);
});

function loadImportPreview() {
  apiCall('apiGetImportConfig', { token: state.token }).then(function(res) {
    if (handleIfSessionExpired(res)) return;
    
    var config = res.config || {};
    apiCall('apiImportPreview', {
      token: state.token,
      data: JSON.stringify(importData),
      config: JSON.stringify(config)
    }).then(function(res) {
      if (handleIfSessionExpired(res)) return;
      
      if (!res.success) {
        showToast(res.message || 'خطا در پیش‌نمایش', true);
        return;
      }
      
      importMapping = res.mapping;
      renderImportMapping(config, res.mapping);
      renderImportPreviewTable(res.preview);
      renderImportStats(res.totalRows);
      
      document.getElementById('importPreviewArea').style.display = 'block';
    }).catch(function(err) {
      showToast(err.message, true);
    });
  });
}

function renderImportMapping(config, mapping) {
  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">';
  
  var fields = [
    { key: 'col_code', label: 'کد کالا' },
    { key: 'col_name', label: 'نام کالا' },
    { key: 'col_category', label: 'دسته‌بندی' },
    { key: 'col_qty', label: 'موجودی' },
    { key: 'col_warehouse', label: 'انبار' },
    { key: 'col_image', label: 'تصویر' },
    { key: 'col_unit', label: 'واحد' },
    { key: 'col_description', label: 'توضیحات' }
  ];
  
  fields.forEach(function(f) {
    var colIndex = mapping[f.key];
    var colName = colIndex !== -1 && importData[0] ? importData[0][colIndex] : '(انتخاب نشده)';
    html += '<div style="padding:8px;background:var(--surface);border-radius:8px;font-size:12px;">';
    html += '<div style="color:var(--muted);margin-bottom:4px;">' + f.label + '</div>';
    html += '<div style="font-weight:700;">' + escapeHtml(colName) + '</div>';
    html += '</div>';
  });
  
  html += '</div>';
  document.getElementById('importMappingArea').innerHTML = html;
}

function renderImportPreviewTable(preview) {
  if (preview.length === 0) {
    document.getElementById('importPreviewTable').innerHTML = '<div class="empty-hint">داده‌ای برای نمایش وجود ندارد</div>';
    return;
  }
  
  var html = '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
  html += '<thead><tr style="background:var(--accent);color:#fff;">';
  html += '<th style="padding:8px;text-align:right;">کد</th>';
  html += '<th style="padding:8px;text-align:right;">نام</th>';
  html += '<th style="padding:8px;text-align:right;">موجودی</th>';
  html += '<th style="padding:8px;text-align:right;">انبار</th>';
  html += '</tr></thead><tbody>';
  
  preview.forEach(function(item) {
    html += '<tr style="border-bottom:1px solid var(--border);">';
    html += '<td style="padding:6px;">' + escapeHtml(item.code || '') + '</td>';
    html += '<td style="padding:6px;">' + escapeHtml(item.name || '') + '</td>';
    html += '<td style="padding:6px;">' + escapeHtml(item.qty || '') + '</td>';
    html += '<td style="padding:6px;">' + escapeHtml(item.warehouse || '') + '</td>';
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  document.getElementById('importPreviewTable').innerHTML = html;
}

function renderImportStats(totalRows) {
  document.getElementById('importStats').innerHTML = 
    '📊 تعداد کل ردیف‌ها: <b>' + totalRows + '</b><br>' +
    '⚠️ کالاهای موجود به‌روز می‌شوند و کالاهای جدید اضافه می‌شوند.';
}

function confirmImport() {
  var btn = document.getElementById('importConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'در حال همگام‌سازی...';
  
  apiCall('apiImportConfirm', {
    token: state.token,
    data: JSON.stringify(importData),
    mapping: JSON.stringify(importMapping)
  }).then(function(res) {
    btn.disabled = false;
    btn.textContent = 'شروع همگام‌سازی';
    
    if (handleIfSessionExpired(res)) return;
    
    if (!res.success) {
      showToast(res.message || 'خطا در همگام‌سازی', true);
      return;
    }
    
    var html = '<div style="padding:16px;background:var(--surface);border-radius:12px;">';
    html += '<div style="font-size:14px;font-weight:700;margin-bottom:12px;">✓ همگام‌سازی با موفقیت انجام شد</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    html += '<div style="padding:12px;background:#fff;border-radius:8px;text-align:center;">';
    html += '<div style="font-size:24px;font-weight:800;color:var(--accent);">' + res.updated + '</div>';
    html += '<div style="font-size:11px;color:var(--muted);">کالای به‌روزشده</div>';
    html += '</div>';
    html += '<div style="padding:12px;background:#fff;border-radius:8px;text-align:center;">';
    html += '<div style="font-size:24px;font-weight:800;color:var(--ok);">' + res.added + '</div>';
    html += '<div style="font-size:11px;color:var(--muted);">کالای جدید</div>';
    html += '</div>';
    html += '</div>';
    
    if (res.errors && res.errors.length > 0) {
      html += '<div style="margin-top:12px;padding:10px;background:#fdeeee;border-radius:8px;font-size:11px;color:var(--bad);">';
      html += '<b>خطاها:</b><br>' + res.errors.slice(0, 5).join('<br>');
      if (res.errors.length > 5) html += '<br>... و ' + (res.errors.length - 5) + ' خطای دیگر';
      html += '</div>';
    }
    
    html += '</div>';
    
    document.getElementById('importResultContent').innerHTML = html;
    document.getElementById('importPreviewArea').style.display = 'none';
    document.getElementById('importResultArea').style.display = 'block';
    
    showToast('✓ همگام‌سازی موفق');
  }).catch(function(err) {
    btn.disabled = false;
    btn.textContent = 'شروع همگام‌سازی';
    showToast(err.message, true);
  });
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
} else {
  showScreen('loginScreen');
}