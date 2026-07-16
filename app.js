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
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showToast(msg, isErr) {
  var t = document.getElementById('toast');
  if (t) {
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : ' ok');
    setTimeout(() => t.className = 'toast', 2200);
  }
}

// API Call
var jsonpCounter = 0;
function apiCall(action, params) {
  return new Promise((resolve, reject) => {
    var cbName = 'whCb' + Date.now();
    var script = document.createElement('script');
    window[cbName] = (data) => {
      delete window[cbName];
      script.remove();
      resolve(data);
    };
    var qs = `action=${encodeURIComponent(action)}&callback=${cbName}`;
    Object.keys(params || {}).forEach(k => {
      if (params[k] != null) qs += `&${k}=${encodeURIComponent(params[k])}`;
    });
    script.src = state.serverUrl + '?' + qs;
    document.body.appendChild(script);
  });
}

// ===================== اسکنر نهایی (بهینه شده) =====================
function openScanner() {
  document.getElementById('scannerOverlay').classList.add('open');
  document.getElementById('camError').style.display = 'none';

  var reader = document.getElementById('qrReader');
  reader.innerHTML = '';

  html5QrCode = new Html5Qrcode("qrReader", { experimentalFeatures: { useBarCodeDetectorIfSupported: true } });

  const config = {
    fps: 25,
    qrbox: { width: 300, height: 300 },
    aspectRatio: 1.0,
    showTorchButton: true,
    showZoomSlider: true,
    defaultZoomValueIfSupported: 1.5,
    videoConstraints: {
      facingMode: "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };

  html5QrCode.start(
    { facingMode: "environment" },
    config,
    (decodedText) => {
      closeScanner();
      document.getElementById('searchInput').value = decodedText.trim();
      doSearch();
      if (navigator.vibrate) navigator.vibrate(80);
      showToast("✅ کد خوانده شد", false);
    },
    () => {}
  ).catch(err => {
    console.error("Camera error:", err);
    document.getElementById('camError').style.display = 'flex';
  });
}

function closeScanner() {
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {});
  }
  document.getElementById('scannerOverlay').classList.remove('open');
}

function doSearch() {
  var q = document.getElementById('searchInput').value.trim();
  if (q) {
    showToast("جستجو برای: " + q);
    // اینجا کد جستجوی اصلی خودت رو اضافه کن
  }
}

// شروع برنامه
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
if (state.serverUrl) document.getElementById('serverUrlInput').value = state.serverUrl;
if (state.token && state.username) {
  // enterApp();
} else {
  showScreen('loginScreen');
}