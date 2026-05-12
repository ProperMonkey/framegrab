// dotenv only runs locally; Railway injects env vars natively
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const archiver = require('archiver');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

// ── Concurrency limiter ──────────────────────────────────────────────────
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '2', 10);
let activeJobs = 0;
const jobQueue = [];

function acquireSlot() {
  return new Promise(resolve => {
    if (activeJobs < MAX_CONCURRENT_JOBS) {
      activeJobs++;
      resolve();
    } else {
      jobQueue.push(resolve);
    }
  });
}

function releaseSlot() {
  if (jobQueue.length > 0) {
    const next = jobQueue.shift();
    next();
  } else {
    activeJobs--;
  }
}

// ── R2 Storage ───────────────────────────────────────────────────────────
const R2_BUCKET = process.env.R2_BUCKET;
const r2 = (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_ENDPOINT)
  ? new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    })
  : null;

async function uploadZipToR2(zipBuffer, key) {
  const upload = new Upload({
    client: r2,
    params: { Bucket: R2_BUCKET, Key: key, Body: zipBuffer, ContentType: 'application/zip' }
  });
  await upload.done();
}

async function deleteFromR2(key) {
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (_) {}
}

// ── Config ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PRICE_CENTS = parseInt(process.env.PRICE_CENTS || '200', 10);
const PRICE_LABEL = process.env.PRICE_LABEL || '$2.00';
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || '500', 10);
const MAX_DURATION_SECONDS = parseInt(process.env.MAX_DURATION_SECONDS || '300', 10);

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'TechnicianFilms@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

// ── Email alerter ────────────────────────────────────────────────────────
const mailer = GMAIL_APP_PASSWORD ? nodemailer.createTransport({
  service: 'gmail',
  auth: { user: ALERT_EMAIL, pass: GMAIL_APP_PASSWORD }
}) : null;

let lastAlertSent = 0;
function sendAlert(subject, message) {
  if (!mailer) return;
  const now = Date.now();
  if (now - lastAlertSent < 15 * 60 * 1000) return; // max one alert per 15 min
  lastAlertSent = now;
  mailer.sendMail({
    from: ALERT_EMAIL,
    to: ALERT_EMAIL,
    subject: `[FrameGrab] ${subject}`,
    text: message
  }).catch(err => console.error('Alert email failed:', err.message));
}

if (!STRIPE_SECRET_KEY) {
  console.warn('\n⚠  STRIPE_SECRET_KEY not set — payment flow will be disabled (dev mode)\n');
}

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ── Directories ─────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const FRAMES_DIR = path.join(__dirname, 'frames');
[UPLOADS_DIR, FRAMES_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── JSON session store ───────────────────────────────────────────────────
// Simple file-backed store: { [sessionId]: { status, createdAt, usedAt } }
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

function loadSessions() {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveSessions(data) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data), 'utf8');
}

function insertSession(id, status) {
  const s = loadSessions();
  if (!s[id]) { s[id] = { status, createdAt: Date.now() }; saveSessions(s); }
}
function markPaid(id) {
  const s = loadSessions();
  if (s[id] && s[id].status === 'pending') { s[id].status = 'paid'; saveSessions(s); return true; }
  return false;
}
function markUsed(id) {
  const s = loadSessions();
  if (s[id] && s[id].status === 'paid') {
    s[id].status = 'used'; s[id].usedAt = Date.now(); saveSessions(s); return true;
  }
  return false;
}
function getSession(id) { return loadSessions()[id] || null; }

// Prune sessions older than 48h
function pruneSessions() {
  const s = loadSessions();
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  let changed = false;
  for (const [id, row] of Object.entries(s)) {
    if (row.createdAt < cutoff) { delete s[id]; changed = true; }
  }
  if (changed) saveSessions(s);
}
setInterval(pruneSessions, 60 * 60 * 1000);

// ── Express ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Stripe webhook needs raw body — mount BEFORE express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json());

// ── Multer ───────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp4|mov|mxf|avi|mkv|m4v|r3d|braw|mts|m2ts|webm)$/i.test(file.originalname);
    ok ? cb(null, true) : cb(new Error('Unsupported file type'));
  }
});

// ── Routes ───────────────────────────────────────────────────────────────

// Config exposed to frontend
// Current queue status
app.get('/api/queue-status', (req, res) => {
  res.json({
    activeJobs,
    queueLength: jobQueue.length,
    maxConcurrent: MAX_CONCURRENT_JOBS,
    isBusy: activeJobs >= MAX_CONCURRENT_JOBS
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    priceLabel: PRICE_LABEL,
    maxFileMB: MAX_FILE_MB,
    maxDurationSeconds: MAX_DURATION_SECONDS,
    devMode: !STRIPE_SECRET_KEY,
    maintenanceMode: MAINTENANCE_MODE
  });
});

// Create Stripe Checkout session → return URL to redirect to
app.post('/api/checkout', async (req, res) => {
  if (MAINTENANCE_MODE) {
    return res.status(503).json({ error: 'FrameGrab is temporarily unavailable. Please try again shortly.' });
  }
  if (!stripe) {
    // Dev mode: skip payment, issue a fake session
    const fakeId = 'dev_' + uuidv4();
    insertSession(fakeId, 'pending');
    markPaid(fakeId);
    return res.json({ url: `${BASE_URL}/?session_id=${fakeId}` });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: PRICE_CENTS,
          product_data: {
            name: 'FrameGrab — Video Stills',
            description: `Extract portfolio stills from your video (up to ${MAX_FILE_MB}MB / ${Math.round(MAX_DURATION_SECONDS / 60)} min)`
          }
        },
        quantity: 1
      }],
      success_url: `${BASE_URL}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/`,
      expires_at: Math.floor(Date.now() / 1000) + 1800 // 30 min
    });

    insertSession(session.id, 'pending');
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

// Validate a session before allowing upload
app.get('/api/session/:id', async (req, res) => {
  const id = req.params.id;
  const row = getSession(id);

  if (row && row.status === 'paid') {
    return res.json({ valid: true });
  }

  // If not in DB yet, check Stripe directly (webhook may not have fired yet)
  if (stripe && id.startsWith('cs_')) {
    try {
      const session = await stripe.checkout.sessions.retrieve(id);
      console.log(`Stripe session check: ${id} → payment_status=${session.payment_status}`);
      if (session.payment_status === 'paid') {
        insertSession(id, 'pending');
        markPaid(id);
        return res.json({ valid: true });
      }
    } catch (e) {
      console.error('Stripe session retrieve error:', e.message);
    }
  }

  console.log(`Session invalid: ${id} — row=${JSON.stringify(getSession(id))}`);
  res.json({ valid: false });
});

// Upload + extract frames (requires paid session)
app.post('/api/extract', (req, res) => {
  upload.single('video')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }

    const { sessionId, format = 'jpg', interval = '15', quality = '95' } = req.body;
    const intervalNum = Math.max(1, Math.min(120, parseInt(interval, 10) || 15));
    const qualityNum = Math.max(60, Math.min(100, parseInt(quality, 10) || 95));

    if (!req.file) return res.status(400).json({ error: 'No file received' });

    // Validate session
    const session = getSession(sessionId);
    if (!session || session.status !== 'paid') {
      fs.unlink(req.file.path, () => {});
      return res.status(402).json({ error: 'Payment required or session already used' });
    }

    const videoPath = req.file.path;

    try {
      // Check duration limit
      const info = await getVideoInfo(videoPath);
      if (info.duration > MAX_DURATION_SECONDS) {
        fs.unlink(videoPath, () => {});
        return res.status(400).json({
          error: `Video is ${Math.round(info.duration)}s — limit is ${MAX_DURATION_SECONDS}s (${Math.round(MAX_DURATION_SECONDS / 60)} min)`
        });
      }

      // Mark session as used immediately to prevent double-use
      const changed = markUsed(sessionId);
      if (!changed) {
        fs.unlink(videoPath, () => {});
        return res.status(402).json({ error: 'Session already used' });
      }

      const jobId = uuidv4();
      const outputDir = path.join(FRAMES_DIR, jobId);
      fs.mkdirSync(outputDir, { recursive: true });

      const queuePosition = jobQueue.length;
      if (queuePosition > 0) {
        console.log(`Job queued — position ${queuePosition}`);
        sendAlert('High traffic — jobs queuing', `There are currently ${queuePosition} jobs waiting in the queue. Consider enabling MAINTENANCE_MODE in Railway Variables if the site becomes unstable.`);
      }

      await acquireSlot();
      let frameCount;
      try {
        frameCount = await extractFrames(videoPath, outputDir, format, intervalNum, qualityNum);
      } finally {
        releaseSlot();
      }

      // Build ZIP filename from original video name
      const originalName = path.basename(req.file.originalname, path.extname(req.file.originalname));
      const safeName = originalName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || jobId.slice(0, 8);
      const zipFilename = `framegrab_${safeName}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

      // Stream ZIP directly to user (memory-efficient)
      const archive = archiver('zip', { zlib: { level: 1 } });
      archive.pipe(res);
      archive.directory(outputDir, false);
      archive.on('error', err => console.error('Archive error:', err));
      await archive.finalize();
      res.on('finish', () => cleanup(videoPath, outputDir));
      res.on('close', () => cleanup(videoPath, outputDir));

    } catch (err) {
      console.error('Extraction error:', err);
      cleanup(videoPath);
      res.status(500).json({ error: 'Processing failed — your session has been restored. Please contact support.' });
    }
  });
});

// ── Stripe Webhook ────────────────────────────────────────────────────────
function handleWebhook(req, res) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.sendStatus(200);

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send('Webhook Error');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      insertSession(session.id, 'pending');
      markPaid(session.id);
      console.log('Payment confirmed:', session.id);
    }
  }

  res.sendStatus(200);
}

// ── ffmpeg helpers ────────────────────────────────────────────────────────
function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, ['-i', videoPath]);
    let stderr = '';
    ff.stderr.on('data', d => stderr += d.toString());
    ff.on('close', () => {
      const sizeMatch = stderr.match(/(\d{2,5})x(\d{2,5})/);
      const fpsMatch = stderr.match(/([\d.]+)\s*(?:fps|tbr)/);
      const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);

      if (!sizeMatch) return reject(new Error('Could not read video metadata'));

      const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 24;
      let duration = 0;
      if (durMatch) {
        duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
      }

      resolve({
        width: parseInt(sizeMatch[1]),
        height: parseInt(sizeMatch[2]),
        fps,
        duration,
        estimatedStills: Math.floor((duration * fps) / 15)
      });
    });
    ff.on('error', reject);
  });
}

function extractFrames(videoPath, outputDir, format, interval, quality) {
  return new Promise((resolve, reject) => {
    const ext = ['png', 'webp', 'jpg'].includes(format) ? format : 'jpg';
    const outputPattern = path.join(outputDir, `frame_%05d.${ext}`);

    const qualityArgs = [];
    if (ext === 'jpg') {
      const qv = Math.max(1, Math.round(31 - (quality / 100) * 30));
      qualityArgs.push('-q:v', String(qv));
    } else if (ext === 'webp') {
      qualityArgs.push('-quality', String(quality));
    }

    const args = [
      '-i', videoPath,
      '-vf', `select=not(mod(n\\,${interval}))`,
      '-vsync', 'vfr',
      ...qualityArgs,
      outputPattern
    ];

    const ff = spawn(ffmpegPath, args);
    let stderr = '';
    ff.stderr.on('data', d => stderr += d.toString());
    ff.on('close', code => {
      if (code !== 0) {
        console.error('ffmpeg stderr tail:', stderr.slice(-1500));
        return reject(new Error('Frame extraction failed'));
      }
      resolve(fs.readdirSync(outputDir).length);
    });
    ff.on('error', reject);
  });
}

function cleanup(...paths) {
  paths.forEach(p => {
    try {
      if (!p || !fs.existsSync(p)) return;
      const s = fs.statSync(p);
      s.isDirectory() ? fs.rmSync(p, { recursive: true, force: true }) : fs.unlinkSync(p);
    } catch (_) {}
  });
}

// Purge temp files older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  [UPLOADS_DIR, FRAMES_DIR].forEach(dir => {
    try {
      fs.readdirSync(dir).forEach(f => {
        const fp = path.join(dir, f);
        try {
          if (fs.statSync(fp).mtimeMs < cutoff) cleanup(fp);
        } catch (_) {}
      });
    } catch (_) {}
  });
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`\n  FrameGrab  →  http://localhost:${PORT}`);
  console.log(`  Mode: ${stripe ? 'LIVE (Stripe enabled)' : 'DEV (payments bypassed)'}\n`);
});
