// ===================== حافظه محلی =====================
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
var html5QrCode = null;

// Utility
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function showToast(msg, isErr) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : ' ok');
  setTimeout(function () { t.className = 'toast'; }, 2200);
}

// API Call
var jsonpCounter = 0;
function apiCall(action, params) {
  return new Promise(function (resolve, reject) {
    var cbName = 'whCb_' + Date.now();
    var script = document.createElement('script');
    window[cbName] = function (data) {
      delete window[cbName];
      script.remove();
      resolve(data);
    };
    var qs = 'action=' + encodeURIComponent(action) + '&callback=' + cbName;
    for (var k in params) {
      if (params[k] !== undefined && params[k] !== null) {
        qs += '&' + k + '=' + encodeURIComponent(params[k]);
      }
    }
    script.src = state.serverUrl + '?' + qs;
    document.body.appendChild(script);
  });
}

// ===================== ورود ساده =====================
function doLogin() {
  var serverUrl = document.getElementById('serverUrlInput').value.trim();
  var username = document.getElementById('loginUsername').value.trim();
  var password = document.getElementById('loginPassword').value;
  var msgBox = document.getElementById('loginMsg');

  if (!serverUrl || !username || !password) {
    msgBox.innerHTML = '<div class="msg err">لطفاً همه فیلدها را پر کنید</div>';
    return;
  }

  state.serverUrl = serverUrl;
  localStorage.setItem(LS_SERVER, state.serverUrl);

  apiCall('apiLogin', { username: username, password: password }).then(function (res) {
    if (res.success) {
      state.token = res.token;
      localStorage.setItem(LS_TOKEN, state.token);
      showScreen('mainScreen');
    } else {
      msgBox.innerHTML = '<div class="msg err">' + escapeHtml(res.message || 'ورود ناموفق') + '</div>';
    }
  }).catch(function () {
    msgBox.innerHTML = '<div class="msg err">خطا در اتصال به سرور</div>';
  });
}

function doLogout() {
  localStorage.clear();
  location.reload();
}

// ===================== اسکنر =====================
function openScanner() {
  document.getElementById('scannerOverlay').classList.add('open');
  var reader = document.getElementById('qrReader');
  reader.innerHTML = '';

  html5QrCode = new Html5Qrcode("qrReader");

  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 20, qrbox: 280, aspectRatio: 1 },
    function (decodedText) {
      closeScanner();
      document.getElementById('searchInput').value = decodedText;
      showToast("✅ کد خوانده شد: " + decodedText);
    },
    function () {}
  ).catch(function (err) {
    console.error(err);
    document.getElementById('camError').style.display = 'flex';
  });
}

function closeScanner() {
  if (html5QrCode) html5QrCode.stop().catch(() => {});
  document.getElementById('scannerOverlay').classList.remove('open');
}

// ===================== شروع =====================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

if (state.token) {
  showScreen('mainScreen');
} else {
  showScreen('loginScreen');
}