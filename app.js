// ===================== اسکنر QR کد (نسخه بهبودیافته) =====================
var html5QrCode = null;
var scannerRunning = false;
var scannerMode = null;
var nativeDetector = null, nativeStream = null, nativeVideoEl = null, nativeRAF = null;

var SCAN_FORMATS = ['qr_code'];

function openScanner() {
  document.getElementById('scannerOverlay').classList.add('open');
  document.getElementById('camError').style.display = 'none';
  
  console.log('🔍 باز کردن اسکنر...');

  if ('BarcodeDetector' in window) {
    openNativeScanner();
  } else {
    openHtml5QrScanner();
  }
}

function openNativeScanner() {
  try {
    nativeDetector = new BarcodeDetector({ formats: SCAN_FORMATS });
  } catch (e) {
    console.warn('BarcodeDetector پشتیبانی نمی‌شود، به html5-qrcode برمی‌گردیم');
    openHtml5QrScanner();
    return;
  }

  var reader = document.getElementById('qrReader');
  reader.innerHTML = '';
  nativeVideoEl = document.createElement('video');
  nativeVideoEl.setAttribute('playsinline', 'true');
  nativeVideoEl.muted = true;
  nativeVideoEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
  reader.appendChild(nativeVideoEl);

  navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      advanced: [{ focusMode: 'continuous' }]
    }
  }).then(function (stream) {
    nativeStream = stream;
    nativeVideoEl.srcObject = stream;
    return nativeVideoEl.play();
  }).then(function () {
    scannerMode = 'native';
    scannerRunning = true;
    nativeScanLoop();
    console.log('✅ Native BarcodeDetector فعال شد');
  }).catch(function (err) {
    console.error('خطای دوربین native:', err);
    openHtml5QrScanner();
  });
}

function nativeScanLoop() {
  if (scannerMode !== 'native' || !scannerRunning) return;
  nativeDetector.detect(nativeVideoEl).then(function (codes) {
    if (codes && codes.length > 0) {
      console.log('✅ Native تشخیص داد:', codes[0].rawValue);
      onCodeDetected(codes[0].rawValue);
      return;
    }
    nativeRAF = requestAnimationFrame(nativeScanLoop);
  }).catch(function () {
    nativeRAF = requestAnimationFrame(nativeScanLoop);
  });
}

function openHtml5QrScanner() {
  scannerMode = 'html5qr';
  var reader = document.getElementById('qrReader');
  reader.innerHTML = '';

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode('qrReader', { 
      experimentalFeatures: { useBarCodeDetectorIfSupported: true } 
    });
  }

  function computeQrbox(viewfinderWidth, viewfinderHeight) {
    var minEdge = Math.min(viewfinderWidth, viewfinderHeight);
    var size = Math.floor(minEdge * 0.78); // کمی کوچکتر برای دقت بیشتر
    return { width: size, height: size };
  }

  html5QrCode.start(
    { facingMode: 'environment' },
    {
      fps: 20,                    // افزایش سرعت
      qrbox: computeQrbox,
      aspectRatio: 1.0,
      disableFlip: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      videoConstraints: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        advanced: [{ focusMode: 'continuous' }]
      }
    },
    function onScanSuccess(decodedText) {
      console.log('✅ html5-qrcode تشخیص داد:', decodedText);
      onCodeDetected(decodedText);
    },
    function onScanFailure(error) {
      // فقط خطاهای مهم رو لاگ کن
      if (error && error.indexOf && error.indexOf('No MultiFormat Readers') === -1) {
        console.debug('اسکن ناموفق:', error);
      }
    }
  ).then(function () {
    scannerRunning = true;
    console.log('✅ html5-qrcode با موفقیت شروع شد');
  }).catch(function (err) {
    console.error('خطای شروع html5-qrcode:', err);
    document.getElementById('camError').style.display = 'flex';
    document.getElementById('camErrorText').textContent = 'خطا در دسترسی به دوربین: ' + err.message;
  });
}

function closeScanner() {
  document.getElementById('scannerOverlay').classList.remove('open');
  scannerRunning = false;

  if (nativeRAF) { cancelAnimationFrame(nativeRAF); nativeRAF = null; }
  if (nativeStream) { 
    nativeStream.getTracks().forEach(t => t.stop()); 
    nativeStream = null; 
  }
  if (nativeVideoEl) { 
    nativeVideoEl.pause(); 
    nativeVideoEl.srcObject = null; 
    nativeVideoEl = null; 
  }
  if (scannerMode === 'html5qr' && html5QrCode) {
    html5QrCode.stop().catch(() => {});
  }
  scannerMode = null;
}

function extractItemCode(raw) {
  if (/^https?:\/\//i.test(raw)) {
    try {
      var u = new URL(raw);
      var idParam = u.searchParams.get('id');
      if (idParam) return idParam;
    } catch (e) {}
  }
  return raw.trim();
}

var lastScanned = null, lastScanTime = 0;
function onCodeDetected(raw) {
  var now = Date.now();
  if (raw === lastScanned && (now - lastScanTime) < 2000) return;
  
  lastScanned = raw;
  lastScanTime = now;

  var code = extractItemCode(raw);
  console.log('📱 کد اسکن‌شده:', code);

  closeScanner();
  document.getElementById('searchInput').value = code;
  doSearch();
}