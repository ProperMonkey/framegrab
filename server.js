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
const { Redis } = require('@upstash/redis');

// ── Redis Session Store ──────────────────────────────────────────────────
const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    })
  : null;

const SESSION_TTL_SECONDS = 48 * 60 * 60; // 48 hours

async function redisInsertSession(id, status) {
  if (!redis) return false;
  // NX = only set if not exists, EX = expire after 48h
  await redis.set(`session:${id}`, JSON.stringify({ status, createdAt: Date.now() }), {
    nx: true,
    ex: SESSION_TTL_SECONDS
  });
  return true;
}

async function redisGetSession(id) {
  if (!redis) return null;
  const raw = await redis.get(`session:${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function redisMarkPaid(id) {
  if (!redis) return false;
  // Use a Lua-style check by getting + setting only if pending
  const cur = await redisGetSession(id);
  if (!cur) {
    await redis.set(`session:${id}`, JSON.stringify({ status: 'paid', createdAt: Date.now() }), {
      ex: SESSION_TTL_SECONDS
    });
    return true;
  }
  if (cur.status === 'pending') {
    await redis.set(`session:${id}`, JSON.stringify({ ...cur, status: 'paid' }), {
      ex: SESSION_TTL_SECONDS
    });
    return true;
  }
  return cur.status === 'paid';
}

async function redisMarkUsed(id) {
  if (!redis) return false;
  // Atomic check-and-set: only mark used if currently paid
  // Using a simple approach — Redis SET with conditional check via Lua would be safer
  // but Upstash REST doesn't support Lua. We'll use a separate "used" flag with NX.
  const result = await redis.set(`session:${id}:used`, '1', { nx: true, ex: SESSION_TTL_SECONDS });
  if (result !== 'OK') return false; // Already marked used
  const cur = await redisGetSession(id);
  if (!cur || cur.status !== 'paid') {
    // Rollback: shouldn't happen normally
    await redis.del(`session:${id}:used`);
    return false;
  }
  await redis.set(`session:${id}`, JSON.stringify({ ...cur, status: 'used', usedAt: Date.now() }), {
    ex: SESSION_TTL_SECONDS
  });
  return true;
}

// Restore a session back to 'paid' if processing failed after markUsed
async function restoreSession(id) {
  if (redis) {
    await redis.del(`session:${id}:used`);
    const cur = await redisGetSession(id);
    if (cur) {
      const { usedAt, ...rest } = cur;
      await redis.set(`session:${id}`, JSON.stringify({ ...rest, status: 'paid' }), {
        ex: SESSION_TTL_SECONDS
      });
    }
    return;
  }
  const s = _loadFile();
  if (s[id]) {
    s[id].status = 'paid';
    delete s[id].usedAt;
    _saveFile(s);
  }
}

// ── Concurrency limiter ──────────────────────────────────────────────────
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '8', 10);
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

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, {
  maxNetworkRetries: 3,  // SDK auto-retry on network errors
  timeout: 20000          // 20s timeout
}) : null;

// Retry helper for Stripe rate-limit errors (HTTP 429)
async function withStripeRetry(fn, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRateLimit = err.statusCode === 429 || /rate limit/i.test(err.message || '');
      if (!isRateLimit || attempt === maxAttempts) throw err;
      // Exponential backoff with jitter: 200ms, 400ms, 800ms, 1600ms
      const wait = 200 * Math.pow(2, attempt - 1) + Math.random() * 200;
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ── Directories ─────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const FRAMES_DIR = path.join(__dirname, 'frames');
[UPLOADS_DIR, FRAMES_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── Session store (Redis with JSON fallback for local dev) ───────────────
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

function _loadFile() {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (_) { return {}; }
}
function _saveFile(data) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data), 'utf8');
}

async function insertSession(id, status) {
  if (redis) {
    return redisInsertSession(id, status);
  }
  const s = _loadFile();
  if (!s[id]) { s[id] = { status, createdAt: Date.now() }; _saveFile(s); }
}

async function markPaid(id) {
  if (redis) {
    return redisMarkPaid(id);
  }
  const s = _loadFile();
  if (s[id] && s[id].status === 'pending') { s[id].status = 'paid'; _saveFile(s); return true; }
  return false;
}

async function markUsed(id) {
  if (redis) {
    return redisMarkUsed(id);
  }
  const s = _loadFile();
  if (s[id] && s[id].status === 'paid') {
    s[id].status = 'used'; s[id].usedAt = Date.now(); _saveFile(s); return true;
  }
  return false;
}

async function getSession(id) {
  if (redis) {
    return redisGetSession(id);
  }
  return _loadFile()[id] || null;
}

// ── Express ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Clean URLs for legal pages
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));

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
    if (/\.(r3d|braw|arri|ari|crm|cdng|dng)$/i.test(file.originalname)) {
      return cb(new Error('Camera RAW files (R3D, BRAW, ARRIRAW) are not supported. Please transcode to ProRes, H.264, or H.265 first.'));
    }
    const ok = /\.(mp4|mov|mxf|avi|mkv|m4v|mts|m2ts|webm)$/i.test(file.originalname);
    ok ? cb(null, true) : cb(new Error('Unsupported file type. Supported: MP4, MOV, MKV, AVI, MXF, WebM.'));
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
    await insertSession(fakeId, 'pending');
    await markPaid(fakeId);
    return res.json({ url: `${BASE_URL}/?session_id=${fakeId}` });
  }

  try {
    const session = await withStripeRetry(() => stripe.checkout.sessions.create({
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
    }));

    await insertSession(session.id, 'pending');
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    const isRateLimit = err.statusCode === 429 || /rate limit/i.test(err.message || '');
    res.status(isRateLimit ? 503 : 500).json({
      error: isRateLimit
        ? 'Lots of traffic right now — please try again in a few seconds.'
        : 'Could not create checkout session'
    });
  }
});

// Validate a session before allowing upload
app.get('/api/session/:id', async (req, res) => {
  const id = req.params.id;
  const row = await getSession(id);

  if (row && row.status === 'paid') {
    return res.json({ valid: true });
  }

  // If not in DB yet, check Stripe directly (webhook may not have fired yet)
  if (stripe && id.startsWith('cs_')) {
    try {
      const session = await withStripeRetry(() => stripe.checkout.sessions.retrieve(id));
      console.log(`Stripe session check: ${id} → payment_status=${session.payment_status}`);
      if (session.payment_status === 'paid') {
        await insertSession(id, 'pending');
        await markPaid(id);
        return res.json({ valid: true });
      }
    } catch (e) {
      console.error('Stripe session retrieve error:', e.message);
    }
  }

  const finalRow = await getSession(id);
  console.log(`Session invalid: ${id} — row=${JSON.stringify(finalRow)}`);
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
    const session = await getSession(sessionId);
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

      // Mark session as used immediately to prevent double-use (atomic in Redis)
      const changed = await markUsed(sessionId);
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
      let streamComplete = false;
      archive.pipe(res);
      archive.directory(outputDir, false);
      archive.on('error', err => console.error('Archive error:', err));
      await archive.finalize();
      res.on('finish', () => { streamComplete = true; cleanup(videoPath, outputDir); });
      res.on('close', async () => {
        cleanup(videoPath, outputDir);
        // If connection dropped before stream finished, restore the session
        if (!streamComplete) {
          console.log(`Connection closed early — restoring session ${sessionId}`);
          try { await restoreSession(sessionId); } catch (e) { console.error('Restore failed:', e.message); }
        }
      });

    } catch (err) {
      console.error('Extraction error:', err);
      cleanup(videoPath);
      // Restore the session so the user can try again
      try { await restoreSession(sessionId); } catch (e) { console.error('Restore failed:', e.message); }
      if (!res.headersSent) {
        res.status(500).json({ error: 'Processing failed — your session has been restored. You can upload again.' });
      }
    }
  });
});

// ── Stripe Webhook ────────────────────────────────────────────────────────
async function handleWebhook(req, res) {
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
      try {
        await insertSession(session.id, 'pending');
        await markPaid(session.id);
        console.log('Payment confirmed:', session.id);
      } catch (err) {
        console.error('Webhook session write failed:', err.message);
      }
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
    // Pixel format conversion — critical for 10-bit 4:2:2 sources (Canon XF-AVC Intra, etc.)
    // Forces output to standard 8-bit pixel format so encoders don't stall
    if (ext === 'jpg') {
      const qv = Math.max(1, Math.round(31 - (quality / 100) * 30));
      qualityArgs.push('-q:v', String(qv), '-pix_fmt', 'yuvj420p');
    } else if (ext === 'webp') {
      qualityArgs.push('-quality', String(quality), '-pix_fmt', 'yuv420p');
    } else if (ext === 'png') {
      qualityArgs.push('-pix_fmt', 'rgb24');
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

    // Safety timeout — kill ffmpeg if it hangs (e.g., codec incompatibility stall)
    const timeoutMs = 4 * 60 * 1000; // 4 minutes
    const killTimer = setTimeout(() => {
      console.error('ffmpeg timeout — killing process');
      try { ff.kill('SIGKILL'); } catch (_) {}
      reject(new Error('Processing took too long — file may use an incompatible codec'));
    }, timeoutMs);

    ff.on('close', code => {
      clearTimeout(killTimer);
      if (code !== 0) {
        console.error('ffmpeg stderr tail:', stderr.slice(-1500));
        return reject(new Error('Frame extraction failed'));
      }
      resolve(fs.readdirSync(outputDir).length);
    });
    ff.on('error', err => {
      clearTimeout(killTimer);
      reject(err);
    });
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
