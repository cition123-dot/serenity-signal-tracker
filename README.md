# Serenity X Stock Monitor

Netlify-deployed dashboard for monitoring X posts from `@aleabitoreddit`, extracting US stock mentions, summarizing investment rationale, and showing mention frequency plus Finnhub market data.

## Architecture

- `Next.js + TypeScript` runs on Netlify.
- Neon Postgres stores posts, stock mentions, stock profiles, price snapshots, alerts, and collector health.
- A separate long-running Playwright worker collects X posts because Netlify Functions are not suitable for persistent logged-in browser sessions.
- DeepSeek extracts structured stock signals from posts through its OpenAI-compatible API.
- Finnhub supplies US equity quotes and candles.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Without `DATABASE_URL`, the dashboard renders realistic mock data. With `DATABASE_URL`, apply `database/schema.sql` to Neon first.

## Netlify

Set these environment variables in Netlify:

- `DATABASE_URL`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_BASE_URL`
- `FINNHUB_API_KEY`
- `WORKER_INGEST_SECRET`

The site deploys with `npm run build`. The worker is deployed separately to Fly.io, Render, or a VPS.

## Worker

```bash
npm run worker
```

The worker stores a persistent Playwright profile in `playwright-profile/`. Run it once locally or on the server with a visible browser to log into X, then keep the profile volume mounted for future runs.

For Fly.io deployment, see [worker/README.md](worker/README.md). The included `fly.worker.toml` and `worker/Dockerfile` run the Playwright collector with a persistent `/data` volume.

## Safety

This app is an analysis dashboard. It does not place trades, connect to a broker, or provide financial advice.
