# Deploy `www.maixed.com/vertex` (Vercel + Railway)

This repo is now prepared to run the frontend under `/vertex` and proxy API calls to Railway.

## 1) Railway (backend)

1. Create a Railway project from this repo.
2. Set service root to repo root (where `main.py` is).
3. Start command:
   - `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add env vars:
   - `OPENAI_API_KEY=...`
   - `ALLOW_ORIGINS=https://www.maixed.com,https://maixed.com`
   - Optional:
     - `AZURE_SPEECH_KEY=...`
     - `AZURE_SPEECH_REGION=...`
5. Deploy and copy your Railway URL (example: `https://my-backend.up.railway.app`).

## 2) Vercel (frontend)

1. Import this repo in Vercel.
2. Set **Root Directory** to `client`.
3. In `client/vercel.json`, replace:
   - `https://REPLACE_WITH_YOUR_RAILWAY_HOST/$1`
   with your real Railway host, e.g. `https://my-backend.up.railway.app/$1`.
4. Redeploy.

## 3) Domain path on GoDaddy

In Vercel project:
- Add `www.maixed.com` domain.
- Ensure DNS points to Vercel as instructed by Vercel dashboard.

After DNS propagates, open:
- `https://www.maixed.com/vertex`

## OpenClaw handoff at /vertex

`/vertex` can act as an OpenClaw launcher page.
Set this in Vercel (frontend project env var):
- `REACT_APP_OPENCLAW_URL=https://<your-openclaw-webchat-or-control-url>`

When set, the `/vertex` page auto-redirects to OpenClaw and also shows a manual button fallback.

## 4) Quick checks

- Frontend loads: `https://www.maixed.com/vertex`
- Backend health: `https://www.maixed.com/vertex/api/health`
- Chat request route: `POST https://www.maixed.com/vertex/api/chat`

## Notes

- Frontend default API is now `${window.location.origin}/vertex/api/chat`.
- CRA `homepage` is set to `/vertex` so static assets load correctly under subpath.
