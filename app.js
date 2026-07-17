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

// ===================== API =====================
var jsonpCounter = 0;
function apiCall(action, params) {
  return new Promise(function (resolve, reject) {
    var cbName = 'whCb_' + (jsonpCounter++) + '_' + Date.now();
    var script = document.createElement('script');
    var timeout = setTimeout(function () { cleanup(); reject(new Error('سرور پاسخ نداد')); }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (data) { cleanup(); resolve(data); };

    var qs = 'action=' + encodeURIComponent(action) + '&callback=' + cbName;
    for (var k in params) {
      if (params[k] !== undefined && params[k] !== null) qs += '&' + k + '=' + encodeURIComponent(params[k]);
    }
    script.src = state.serverUrl + '?' + qs;
    script.onerror = function () { cleanup(); reject(new Error('اتصال برقرار نشد')); };
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

  if (!serverUrl || !username || !password) {
    msgBox.innerHTML = '<div class="msg err">همه فیلدها را پر کنید</div>';
    return;
  }

  state.serverUrl = serverUrl.replace(/\/$/, '');
  localStorage.setItem(LS_SERVER, state.serverUrl);

  btn.disabled = true; btn.textContent = 'در حال ورود...';
  apiCall('apiLogin', { username: username, password: password }).then(function (res) {
    btn.disabled = false; btn.textContent = 'ورود';
    if (!res.success) {
      msgBox.innerHTML = '<div class="msg err">' + escapeHtml(res.message || 'ورود ناموفق') + '</div>';
      return;
    }
    state.token = res.token; state.username = res.username; state.role = res.role; state.fullName = res.fullName || username;
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
  localStorage.clear();
  state = {serverUrl:'', token:'', username:'', role:'', fullName:''};
  showScreen('loginScreen');
}

function enterApp() {
  setText('whoLabel', state.fullName || state.username);
  setText('whoSub', state.role || '');
  showScreen('mainScreen');
  renderRecentList();
}

// ===================== جست‌وجو =====================
function doSearch() {
  var q = document.getElementById('searchInput').value.trim();
  if (!q) return showToast('کد یا نام کالا را وارد کنید', true);

  var area = document.getElementById('resultArea');
  area.innerHTML = '<div class="lookup-loading"><div class="spinner"></div> در حال جست‌وجو...</div>';

  apiCall('apiSearch', { token: state.token, q: q }).then(function (res) {
    if (!res.success) {
      if (res.needLogin) { doLogout(); return; }
      area.innerHTML = '<div class="empty-hint">' + escapeHtml(res.message || 'خطا') + '</div>';
      return;
    }
    var results = res.results || [];
    lastSearchResults = results;
    lastSearchQuery = q;
    if (results.length === 0) {
      area.innerHTML = '<div class="empty-hint">چیزی پیدا نشد</div>';
    } else if (results.length === 1) {
      openItemDetail(results[0].code);
    } else {
      renderResultsList(results, q);
    }
  }).catch(function (err) {
    area.innerHTML = '<div class="empty-hint">' + escapeHtml(err.message) + '</div>';
  });
}

// بقیه توابع renderResultsList, openItemDetail, renderItemDetail, submitCount را از فایل قبلی خودتان نگه دارید یا کپی کنید.
// برای brevity اینجا فقط بخش اسکنر جدید را کامل می‌دهم.

function openScanner() {
  var returnUrl = encodeURIComponent(window.location.origin + window.location.pathname + '?scanned={CODE}');
  var intentUrl = 'intent://scan/?ret=' + returnUrl + '#Intent;scheme=zxing;package=com.google.zxing.client.android;end';
  
  var link = document.createElement('a');
  link.href = intentUrl;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(function() {
    if (!document.hidden) alert('اسکنر گوشی باز نشد. کد را دستی وارد کنید.');
  }, 800);
}

function handleScanReturn() {
  var params = new URLSearchParams(window.location.search);
  var scanned = params.get('scanned');
  if (scanned) {
    history.replaceState(null, '', window.location.pathname);
    document.getElementById('searchInput').value = scanned;
    doSearch();
  }
}

window.onload = function() {
  if (state.serverUrl) document.getElementById('serverUrlInput').value = state.serverUrl;
  if (state.token && state.username) enterApp();
  else showScreen('loginScreen');
  handleScanReturn();
};