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

// Utility
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showToast(msg, err) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : ' ok');
  setTimeout(() => t.className = 'toast', 2000);
}

// API
var jsonpCounter = 0;
function apiCall(action, params) {
  return new Promise((resolve, reject) => {
    var cb = 'cb' + Date.now();
    var script = document.createElement('script');
    window[cb] = d => { delete window[cb]; script.remove(); resolve(d); };
    var qs = `action=${action}&callback=${cb}`;
    Object.keys(params||{}).forEach(k => qs += `&${k}=${encodeURIComponent(params[k])}`);
    script.src = state.serverUrl + '?' + qs;
    document.body.appendChild(script);
  });
}

// ساده‌سازی کامل اسکنر
var html5QrCode = null;

function openScanner() {
  document.getElementById('scannerOverlay').classList.add('open');
  document.getElementById('camError').style.display = 'none';

  var reader = document.getElementById('qrReader');
  reader.innerHTML = '';

  html5QrCode = new Html5Qrcode("qrReader");

  html5QrCode.start(
    { facingMode: "environment" },
    {
      fps: 20,
      qrbox: 280,
      aspectRatio: 1.0,
      showTorchButton: true,
      showZoomSlider: true
    },
    (decodedText) => {
      closeScanner();
      document.getElementById('searchInput').value = decodedText.trim();
      doSearch();
      if (navigator.vibrate) navigator.vibrate([100]);
    },
    (error) => {}
  ).catch(e => {
    console.error(e);
    document.getElementById('camError').style.display = 'flex';
  });
}

function closeScanner() {
  if (html5QrCode) html5QrCode.stop().catch(()=>{});
  document.getElementById('scannerOverlay').classList.remove('open');
}

function doSearch() {
  var q = document.getElementById('searchInput').value.trim();
  if (q) showToast('جستجو: ' + q);
  // بقیه کد جستجو را بعدا اضافه کن
}

// شروع
if (state.token) {
  // enterApp
} else {
  showScreen('loginScreen');
}