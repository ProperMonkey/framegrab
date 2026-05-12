/* FrameGrab — frontend */

let config = { priceLabel: '$1.99', maxFileMB: 500, maxDurationSeconds: 300, devMode: false };
let sessionId = null;
let selectedFile = null;
let selectedFormat = 'jpg';

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('/api/config');
    config = await res.json();
  } catch (_) {}

  // Maintenance mode — disable pay button and show message
  if (config.maintenanceMode) {
    const btn = document.getElementById('payBtn');
    btn.disabled = true;
    btn.textContent = 'Temporarily unavailable — please check back shortly';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  }

  // Populate UI text (guarded — elements may not exist)
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setText('heroPrice', config.priceLabel);
  setText('payBtnPrice', config.priceLabel);
  setText('payBtnPrice2', config.priceLabel);
  setText('heroMaxMb', config.maxFileMB);
  setText('heroMaxMin', Math.round(config.maxDurationSeconds / 60));

  // Check if returning from Stripe
  const params = new URLSearchParams(window.location.search);
  const sid = params.get('session_id');
  if (sid) {
    // Clean the URL immediately
    window.history.replaceState({}, '', '/');
    await verifyAndShowUpload(sid);
    return;
  }

  showView('landing');
}

async function verifyAndShowUpload(sid) {
  showView('processing');
  setProcessing('Verifying payment…', 20);

  // Retry up to 5 times with 2 second delays to handle webhook timing
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`/api/session/${encodeURIComponent(sid)}`);
      const data = await res.json();

      if (data.valid) {
        sessionId = sid;
        showView('upload');
        return;
      }
    } catch (_) {}

    if (attempt < 5) {
      setProcessing(`Verifying payment… (${attempt}/5)`, 20 + attempt * 10);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  showView('landing');
  showToast('Payment could not be verified. If you were charged, please contact support at TechnicianFilms@gmail.com');
}

// ── Pre-pay compatibility check (optional, filename-only) ────────────────
try {
  const SUPPORTED_EXT = ['mp4', 'mov', 'mkv', 'avi', 'mxf', 'webm', 'm4v', 'mts', 'm2ts'];
  const RAW_EXT = ['r3d', 'braw', 'ari', 'arri', 'crm', 'cdng', 'dng'];

  const precheckInput = document.getElementById('precheckInput');
  const precheckResult = document.getElementById('precheckResult');

  if (precheckInput && precheckResult) {
    precheckInput.addEventListener('change', () => {
      const file = precheckInput.files && precheckInput.files[0];
      if (!file) return;
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);

      precheckResult.classList.remove('ok', 'bad');

      if (RAW_EXT.includes(ext)) {
        precheckResult.classList.add('bad');
        precheckResult.innerHTML = `✗ <strong>${escapeHTML(file.name)}</strong> — ${ext.toUpperCase()} files aren't compatible. Transcode to ProRes or H.264 in your editor first, then come back.`;
      } else if (SUPPORTED_EXT.includes(ext)) {
        const sizeWarning = file.size > 2 * 1024 * 1024 * 1024
          ? ` (${sizeMB}MB exceeds the 2GB limit — trim or compress)`
          : '';
        precheckResult.classList.add(sizeWarning ? 'bad' : 'ok');
        precheckResult.innerHTML = sizeWarning
          ? `✗ <strong>${escapeHTML(file.name)}</strong>${sizeWarning}`
          : `✓ <strong>${escapeHTML(file.name)}</strong> (${sizeMB}MB) — extension looks good. Pay to upload and process.`;
      } else {
        precheckResult.classList.add('bad');
        precheckResult.innerHTML = `✗ <strong>${escapeHTML(file.name)}</strong> — not a supported video format. Supported: MP4, MOV, MKV, AVI, MXF, WebM.`;
      }
    });
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
} catch (e) {
  console.warn('Pre-check init failed (non-fatal):', e);
}

// ── Payment ───────────────────────────────────────────────────────────────
document.getElementById('payBtn').addEventListener('click', async () => {
  const btn = document.getElementById('payBtn');
  btn.disabled = true;
  btn.textContent = 'Redirecting to Stripe…';

  // Retry checkout up to 4 times if server returns 503 (rate-limited)
  let lastError = 'Checkout failed';
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch('/api/checkout', { method: 'POST' });

      if (res.status === 503 && attempt < 4) {
        btn.textContent = `High traffic — retrying… (${attempt}/4)`;
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
        continue;
      }

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      lastError = data.error || 'Checkout failed';
      break;
    } catch (err) {
      lastError = err.message;
      if (attempt < 4) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
    }
  }

  showToast(lastError);
  btn.disabled = false;
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Pay ${config.priceLabel} &amp; Upload`;
});

// ── Drop zone ─────────────────────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  const maxBytes = config.maxFileMB * 1024 * 1024;
  if (file.size > maxBytes) {
    showToast(`File is ${formatBytes(file.size)} — limit is ${config.maxFileMB}MB`);
    return;
  }

  selectedFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatBytes(file.size);
  document.getElementById('fileInfo').classList.remove('hidden');
  document.getElementById('optionsPanel').classList.remove('hidden');
}

// ── Format buttons ────────────────────────────────────────────────────────
document.getElementById('fmtBtns').addEventListener('click', e => {
  const btn = e.target.closest('.fmt-btn');
  if (!btn) return;
  document.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedFormat = btn.dataset.fmt;

  // Hide quality slider for PNG (lossless)
  document.getElementById('qualityGroup').style.opacity = selectedFormat === 'png' ? '0.35' : '1';
  document.getElementById('qualitySlider').disabled = selectedFormat === 'png';
});

// Quality slider label
const qualitySlider = document.getElementById('qualitySlider');
const qualityVal = document.getElementById('qualityVal');
qualitySlider.addEventListener('input', () => { qualityVal.textContent = qualitySlider.value; });

// ── Extract ───────────────────────────────────────────────────────────────
document.getElementById('extractBtn').addEventListener('click', async () => {
  if (!selectedFile || !sessionId) return;

  const btn = document.getElementById('extractBtn');
  const label = document.getElementById('extractLabel');
  const spinner = document.getElementById('extractSpinner');

  btn.disabled = true;
  label.textContent = 'Uploading…';
  spinner.classList.remove('hidden');

  showView('processing');
  setProcessing('Uploading video…', 15);

  const formData = new FormData();
  formData.append('video', selectedFile);
  formData.append('sessionId', sessionId);
  formData.append('format', selectedFormat);
  formData.append('quality', qualitySlider.value);
  formData.append('interval', '5');

  try {
    // Check if there's an actual queue before deciding what message to show
    let willBeQueued = false;
    try {
      const qRes = await fetch('/api/queue-status');
      const qData = await qRes.json();
      willBeQueued = qData.isBusy;
    } catch (_) {}

    const uploadTimeout = setTimeout(() => {
      if (willBeQueued) {
        setProcessing('Your video is queued — you\'re next in line…', 30);
        setTimeout(() => setProcessing('Processing your frames…', 40), 8000);
      } else {
        setProcessing('Processing your frames…', 35);
      }
    }, 4000);

    // Fake progress during upload/processing
    const progressTick = fakeProgress(15, 85, 40000);

    const res = await fetch('/api/extract', {
      method: 'POST',
      body: formData
    });

    clearInterval(progressTick);
    clearTimeout(uploadTimeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Processing failed' }));
      throw new Error(err.error || 'Processing failed');
    }

    setProcessing('Packaging stills…', 92);
    await new Promise(r => setTimeout(r, 400));
    setProcessing('Almost done…', 99);

    // The response IS the ZIP — blob it and trigger download
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const disposition = res.headers.get('Content-Disposition') || '';
    const nameMatch = disposition.match(/filename="([^"]+)"/);
    const filename = nameMatch ? nameMatch[1] : 'framegrab_stills.zip';

    // Estimate frame count from filename or just show file size
    const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
    document.getElementById('doneSub').textContent = `${sizeMB} MB ZIP ready to download`;

    const link = document.getElementById('downloadLink');
    link.href = url;
    link.download = filename;

    // Reveal "extract another" only after they click download
    const anotherBtn = document.getElementById('anotherBtn');
    anotherBtn.classList.add('hidden');
    link.addEventListener('click', () => {
      setTimeout(() => anotherBtn.classList.remove('hidden'), 1500);
    }, { once: true });

    showView('done');

    // Clean up object URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 60000);

  } catch (err) {
    showView('upload');
    btn.disabled = false;
    label.textContent = 'Extract Frames';
    spinner.classList.add('hidden');
    showToast(err.message);
  }
});

// ── Another video ─────────────────────────────────────────────────────────
document.getElementById('anotherBtn').addEventListener('click', () => {
  // Session is used up — send back to pay again
  sessionId = null;
  selectedFile = null;
  document.getElementById('fileInfo').classList.add('hidden');
  document.getElementById('optionsPanel').classList.add('hidden');
  document.getElementById('fileInput').value = '';
  showView('landing');
});

// ── Helpers ───────────────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
}

function setProcessing(label, pct) {
  document.getElementById('procLabel').textContent = label;
  document.getElementById('progBar').style.width = pct + '%';
}

function fakeProgress(from, to, durationMs) {
  const start = Date.now();
  return setInterval(() => {
    const elapsed = Date.now() - start;
    const t = Math.min(elapsed / durationMs, 1);
    const eased = 1 - Math.pow(1 - t, 2); // ease out quad
    const pct = from + (to - from) * eased;
    document.getElementById('progBar').style.width = pct.toFixed(1) + '%';
    if (t >= 1) setProcessing('Processing frames…', to);
  }, 200);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

init();
