/* =========================================================================
 * اسکنر انبارگردانی موبایل — منطق برنامه
 * این صفحه به‌طور کامل مستقل از گوگل‌اسکریپت میزبانی می‌شود (مثلاً GitHub
 * Pages) تا محدودیت دسترسی به دوربین که در iframe داخلی گوگل‌اسکریپت وجود
 * دارد، دور زده شود. ارتباط با سرور فقط از طریق چند اکشن سبک JSON/JSONP
 * انجام می‌شود که به Code.gs اضافه شده‌اند (apiLogin / apiLookup / apiRecordCount).
 * ========================================================================= */

var LS_SERVER = 'wh_scanner_server_url';
var LS_TOKEN = 'wh_scanner_token';
var LS_USER = 'wh_scanner_user';
var LS_ROLE = 'wh_scanner_role';
var LS_FULLNAME = 'wh_scanner_fullname';

var state = {
  serverUrl: localStorage.getItem(LS_SERVER) || '',
  token: localStorage.getItem(LS_TOKEN) || '',
  username: localStorage.getItem(LS_USER) || '',
  role: localStorage.getItem(LS_ROLE) || '',
  fullName: localStorage.getItem(LS_FULLNAME) || '',
  html5Qrcode: null,
  cameraRunning: false,
  torchOn: false,
  recent: []
};

// ---------------------------------------------------------------------
// ارتباط با سرور (JSONP — برای اینکه هیچ محدودیت CORS در هیچ مرورگری مشکل ایجاد نکند)
// ---------------------------------------------------------------------
function apiCall(action, params) {
  return new Promise(function (resolve, reject) {
    if (!state.serverUrl) { reject(new Error('آدرس سامانه تنظیم نشده است.')); return; }
    var cbName = 'whcb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    var done = false;
    window[cbName] = function (data) {
      done = true;
      resolve(data);
      cleanup();
    };
    var qs = 'action=' + encodeURIComponent(action);
    Object.keys(params || {}).forEach(function (k) { qs += '&' + k + '=' + encodeURIComponent(params[k] == null ? '' : params[k]); });
    qs += '&callback=' + cbName;

    var sep = state.serverUrl.indexOf('?') >= 0 ? '&' : '?';
    var script = document.createElement('script');
    script.src = state.serverUrl + sep + qs;
    function cleanup() {
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    script.onerror = function () {
      if (!done) { reject(new Error('اتصال به سرور برقرار نشد. آدرس سامانه و اینترنت را بررسی کنید.')); cleanup(); }
    };
    document.body.appendChild(script);
    setTimeout(function () {
      if (!done) { reject(new Error('سرور در زمان مناسب پاسخ نداد.')); cleanup(); }
    }, 15000);
  });
}

// ---------------------------------------------------------------------
// UI کمکی‌ها
// ---------------------------------------------------------------------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
}

function toast(msg, kind) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind ? (' ' + kind) : '');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(function () { t.classList.remove('show'); }, 2600);
}

function vibrate(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms || 60); } catch (e) {} } }

// ---------------------------------------------------------------------
// ورود / خروج
// ---------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', function () {
  document.getElementById('serverUrlInput').value = state.serverUrl;
  if (state.serverUrl && state.token && state.username) {
    enterApp();
  }
  document.getElementById('loginPassword').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') doLogin();
  });
  document.getElementById('manualCode').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') lookupManual();
  });
});

function cleanUrlInput(raw) {
  // کیبورد بعضی گوشی‌ها در صفحات راست‌به‌چپ، یک کاراکتر نامرئی جهت‌دهی متن
  // (مثل U+200F) در ابتدای متن انگلیسی/آدرس اضافه می‌کند که باعث می‌شود
  // آدرس با http شروع نشود، هرچند به چشم همان‌طور دیده می‌شود. این تابع
  // چنین کاراکترهای نامرئی و فاصله‌های اضافه را پاک می‌کند.
  return String(raw || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim();
}

function doLogin() {
  var serverUrl = cleanUrlInput(document.getElementById('serverUrlInput').value).replace(/\/$/, '');
  var username = document.getElementById('loginUsername').value.trim();
  var password = document.getElementById('loginPassword').value;
  var msgBox = document.getElementById('loginMsg');
  msgBox.innerHTML = '';

  if (!serverUrl) {
    msgBox.innerHTML = '<div class="msg err">آدرس سامانه را وارد کنید.</div>';
    return;
  }
  if (serverUrl.toLowerCase().indexOf('http') !== 0) {
    msgBox.innerHTML = '<div class="msg err">آدرس باید با http:// یا https:// شروع شود. آدرس را دوباره کپی/پیست کنید.</div>';
    return;
  }
  if (serverUrl.indexOf('XXXXX') !== -1 || serverUrl.indexOf('macros/s/') === -1) {
    msgBox.innerHTML = '<div class="msg err">این آدرسِ نمونه (راهنما) است، نه آدرس واقعی. لینک وب‌اپ گوگل‌اسکریپت خودتان را که با «.../exec» تمام می‌شود جای‌گذاری کنید.</div>';
    return;
  }
  if (!username || !password) {
    msgBox.innerHTML = '<div class="msg err">نام کاربری و رمز عبور را وارد کنید.</div>';
    return;
  }

  state.serverUrl = serverUrl;
  localStorage.setItem(LS_SERVER, serverUrl);

  var btn = document.getElementById('loginBtn');
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
  stopScanner();
  state.token = '';
  localStorage.removeItem(LS_TOKEN);
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginMsg').innerHTML = '';
  showScreen('loginScreen');
}

function enterApp() {
  document.getElementById('whoLabel').textContent = state.fullName || state.username;
  document.getElementById('whoSub').textContent = state.role || '';
  showScreen('scanScreen');
  startScanner();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------------------------------------------------------------------
// دوربین / اسکن بارکد
// ---------------------------------------------------------------------
function startScanner() {
  document.getElementById('camError').style.display = 'none';
  document.getElementById('scanFrame').style.display = 'block';

  if (!window.isSecureContext) {
    showCamError('این صفحه باید با HTTPS باز شود تا دوربین در دسترس باشد.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCamError('مرورگر شما از دسترسی به دوربین پشتیبانی نمی‌کند. لطفاً از Chrome یا Safari بروزرسانی‌شده استفاده کنید، یا کد را دستی وارد کنید.');
    return;
  }

  if (!state.html5Qrcode) {
    state.html5Qrcode = new Html5Qrcode('qrReader', /* verbose= */ false);
  }
  if (state.cameraRunning) return;

  var config = {
    fps: 12,
    qrbox: function (viewfinderWidth, viewfinderHeight) {
      var w = Math.floor(Math.min(viewfinderWidth, 420) * 0.78);
      var h = Math.floor(w * 0.56);
      return { width: w, height: h };
    },
    aspectRatio: 1.4,
    formatsToSupport: (window.Html5QrcodeSupportedFormats ? [
      Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.CODABAR, Html5QrcodeSupportedFormats.ITF
    ] : undefined)
  };

  state.html5Qrcode.start(
    { facingMode: 'environment' },
    config,
    onScanSuccess,
    function onScanFailure() { /* فریم‌هایی که چیزی در آن‌ها پیدا نشد؛ نیازی به کاری نیست */ }
  ).then(function () {
    state.cameraRunning = true;
    detectTorchSupport();
  }).catch(function (err) {
    // اگر دوربین پشت گیر نیاورد (مثلاً تبلت/لپ‌تاپ)، دوربین جلو را امتحان کن
    state.html5Qrcode.start(
      { facingMode: 'user' }, config, onScanSuccess, function () {}
    ).then(function () {
      state.cameraRunning = true;
    }).catch(function (err2) {
      handleCameraError(err2 || err);
    });
  });
}

function handleCameraError(err) {
  var msg = 'دسترسی به دوربین ممکن نشد.';
  var name = (err && (err.name || err.message || String(err))) || '';
  if (/NotAllowedError|Permission/i.test(name)) {
    msg = 'اجازه‌ی دسترسی به دوربین داده نشده است. از تنظیمات مرورگر (آیکون قفل کنار آدرس) دسترسی دوربین را برای این سایت فعال کنید.';
  } else if (/NotFoundError/i.test(name)) {
    msg = 'هیچ دوربینی روی این دستگاه پیدا نشد.';
  } else if (/NotReadableError/i.test(name)) {
    msg = 'دوربین توسط برنامه‌ی دیگری در حال استفاده است. بقیه‌ی برنامه‌های دوربین را ببندید و دوباره تلاش کنید.';
  } else if (/https|secure/i.test(name)) {
    msg = 'این صفحه باید با HTTPS باز شود.';
  }
  showCamError(msg);
}

function showCamError(msg) {
  document.getElementById('camErrorText').textContent = msg;
  document.getElementById('camError').style.display = 'flex';
  document.getElementById('scanFrame').style.display = 'none';
}

function stopScanner() {
  if (state.html5Qrcode && state.cameraRunning) {
    state.html5Qrcode.stop().then(function () {
      state.cameraRunning = false;
    }).catch(function () { state.cameraRunning = false; });
  }
}

function detectTorchSupport() {
  try {
    var caps = state.html5Qrcode.getRunningTrackCapabilities();
    if (caps && caps.torch) document.getElementById('torchBtn').style.display = 'flex';
  } catch (e) {}
}

function toggleTorch() {
  if (!state.html5Qrcode) return;
  state.torchOn = !state.torchOn;
  state.html5Qrcode.applyVideoConstraints({ advanced: [{ torch: state.torchOn }] }).catch(function () {
    toast('چراغ‌قوه روی این دستگاه پشتیبانی نمی‌شود.', 'err');
    state.torchOn = false;
  });
}

var lastScanCode = '', lastScanAt = 0;
function onScanSuccess(decodedText) {
  var now = Date.now();
  if (decodedText === lastScanCode && (now - lastScanAt) < 2500) return; // جلوگیری از ثبت تکراری فوری
  lastScanCode = decodedText; lastScanAt = now;
  vibrate(50);
  openCountModal(decodedText);
}

function lookupManual() {
  var code = document.getElementById('manualCode').value.trim();
  if (!code) return;
  document.getElementById('manualCode').value = '';
  openCountModal(code);
}

// ---------------------------------------------------------------------
// پاپ‌آپ جستجو + ثبت شمارش
// ---------------------------------------------------------------------
var currentLookupCode = null;

function openCountModal(code) {
  currentLookupCode = code;
  document.getElementById('countOverlay').classList.add('open');
  document.getElementById('lookupLoading').style.display = 'flex';
  document.getElementById('lookupResult').style.display = 'none';
  document.getElementById('lookupError').style.display = 'none';

  apiCall('apiLookup', { token: state.token, code: code }).then(function (res) {
    document.getElementById('lookupLoading').style.display = 'none';
    if (res.needLogin) { closeCountModal(); doLogout(); toast('نشست شما منقضی شده؛ دوباره وارد شوید.', 'err'); return; }
    if (!res.success) {
      document.getElementById('lookupError').style.display = 'block';
      document.getElementById('lookupErrorMsg').textContent = res.message || 'کالا پیدا نشد.';
      vibrate([40, 60, 40]);
      return;
    }
    document.getElementById('lookupResult').style.display = 'block';
    document.getElementById('itemNameLbl').textContent = res.name || '(بدون نام)';
    document.getElementById('itemCodeLbl').textContent = res.code;
    document.getElementById('itemSysQty').textContent = (res.systemQty === '' || res.systemQty == null) ? '—' : res.systemQty;
    var qtyEl = document.getElementById('qtyInput');
    qtyEl.value = '';
    document.getElementById('noteInput').value = '';
    setTimeout(function () { qtyEl.focus(); }, 200);
  }).catch(function (err) {
    document.getElementById('lookupLoading').style.display = 'none';
    document.getElementById('lookupError').style.display = 'block';
    document.getElementById('lookupErrorMsg').textContent = err.message;
  });
}

function closeCountModal() {
  document.getElementById('countOverlay').classList.remove('open');
  currentLookupCode = null;
}

function stepQty(delta) {
  var el = document.getElementById('qtyInput');
  var v = Number(el.value) || 0;
  v = Math.max(0, v + delta);
  el.value = v;
}

function submitCount() {
  var qty = document.getElementById('qtyInput').value;
  var note = document.getElementById('noteInput').value.trim();
  if (qty === '' || isNaN(Number(qty))) {
    toast('لطفاً تعداد را وارد کنید.', 'err');
    return;
  }
  var btn = document.getElementById('submitCountBtn');
  btn.disabled = true; btn.textContent = 'در حال ثبت...';

  apiCall('apiRecordCount', { token: state.token, code: currentLookupCode, qty: qty, note: note }).then(function (res) {
    btn.disabled = false; btn.textContent = 'ثبت و بعدی';
    if (res.needLogin) { closeCountModal(); doLogout(); toast('نشست شما منقضی شده؛ دوباره وارد شوید.', 'err'); return; }
    if (!res.success) {
      toast(res.message || 'خطا در ثبت.', 'err');
      return;
    }
    var itemName = document.getElementById('itemNameLbl').textContent;
    var diffTxt = (res.diff === '' || res.diff == null) ? '' : (Number(res.diff) > 0 ? '+' + res.diff : String(res.diff));
    addRecent(itemName, currentLookupCode, qty, res.diff);
    vibrate(80);
    toast('«' + itemName + '» ثبت شد' + (diffTxt ? (' (' + diffTxt + ')') : ''), 'ok');
    closeCountModal();
  }).catch(function (err) {
    btn.disabled = false; btn.textContent = 'ثبت و بعدی';
    toast(err.message, 'err');
  });
}

function addRecent(name, code, qty, diff) {
  state.recent.unshift({ name: name, code: code, qty: qty, diff: diff });
  if (state.recent.length > 8) state.recent.pop();
  renderRecent();
}

function renderRecent() {
  var box = document.getElementById('recentList');
  if (!state.recent.length) { box.innerHTML = '<div class="recent-empty">هنوز چیزی ثبت نشده.</div>'; return; }
  box.innerHTML = state.recent.map(function (r) {
    var d = Number(r.diff);
    var cls = (!isNaN(d) && d > 0) ? 'plus' : ((!isNaN(d) && d < 0) ? 'minus' : '');
    var diffTxt = (r.diff === '' || r.diff == null) ? '' : (d > 0 ? '+' + r.diff : r.diff);
    return '<div class="recent-item"><span><b>' + escapeHtml(r.name) + '</b> · ' + escapeHtml(r.qty) + ' عدد</span>' +
      (diffTxt ? ('<span class="diff ' + cls + '">' + escapeHtml(diffTxt) + '</span>') : '') + '</div>';
  }).join('');
}

// ثبت Service Worker برای نصب واقعیِ اپ روی اندروید (اختیاری، در صورت وجود فایل)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
