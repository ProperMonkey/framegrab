# FrameGrab — Setup Guide

## Running locally tonight (dev mode, no payment)

```bash
cd framegrab
npm install
node server.js
```

Open http://localhost:3000 — payments are bypassed in dev mode (no `.env` needed).

---

## Going live with real payments

### 1. Stripe account
1. Sign up at https://stripe.com (free)
2. Go to **Developers → API keys**
3. Copy your **Secret key** (`sk_live_...`) and **Publishable key** (`pk_live_...`)

### 2. Create your `.env` file
```bash
cp .env.example .env
```
Fill in the values in `.env`.

### 3. Deploy to Railway (recommended — ~$5/month)
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```
Railway gives you a URL like `https://framegrab-production.up.railway.app`.

### 4. Add Stripe webhook
1. Go to **Stripe → Developers → Webhooks → Add endpoint**
2. URL: `https://YOUR-RAILWAY-URL.railway.app/webhook`
3. Events: select **`checkout.session.completed`**
4. Copy the **Signing secret** (`whsec_...`) into your `.env` as `STRIPE_WEBHOOK_SECRET`
5. In Railway dashboard → your service → Variables, add all your `.env` values

### 5. Update BASE_URL
In `.env` (and Railway environment variables), set:
```
BASE_URL=https://YOUR-RAILWAY-URL.railway.app
```

---

## Pricing
- Default: **$2.00 per video**
- Change `PRICE_CENTS` in `.env` (in cents, so 200 = $2.00)
- Stripe takes ~2.9% + $0.30 per transaction

## File limits
- Default max: **500MB**, **5 minutes**
- Change `MAX_FILE_MB` and `MAX_DURATION_SECONDS` in `.env`

## Supported formats
MP4, MOV, MXF, AVI, MKV, M4V, MTS, M2TS, WebM
(R3D and BRAW work if ffmpeg can decode them — standard ffmpeg-static handles most)
