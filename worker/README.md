# Serenity X Collector Worker

This worker still runs outside the web host because it needs a long-lived Playwright browser profile for X.

## Fly.io deployment

```bash
flyctl auth login
flyctl apps create serenity-x-collector
flyctl volumes create serenity_x_data --region sjc --size 1 --app serenity-x-collector
flyctl secrets set WORKER_INGEST_SECRET=<same value as Cloudflare Worker> --app serenity-x-collector
flyctl deploy --config fly.worker.toml --app serenity-x-collector
```

The worker points to:

```txt
https://serenity-signal-tracker.serenity-signal-tracker.workers.dev/api/ingest
```

## Render deployment

This repo includes `render.yaml` for a Render Background Worker on the free plan.

1. Push the repository to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Render will detect `render.yaml` and create `serenity-x-collector`.
4. Add the required secret environment variables:

```txt
WORKER_INGEST_SECRET=<same value as Cloudflare Worker>
X_AUTH_TOKEN=<X auth_token cookie>
X_CT0=<X ct0 cookie>
```

The Render worker uses the same Docker image as Fly, mounts a 1 GB persistent disk at `/data`, and runs every 30 minutes through the long-lived process loop:

```txt
COLLECTOR_INTERVAL_MS=1800000
PLAYWRIGHT_PROFILE_DIR=/data/playwright-profile
INGEST_URL=https://serenity-signal-tracker.serenity-signal-tracker.workers.dev/api/ingest
```

After Render reports a successful deploy, check the dashboard collector status. A Render run will still report `latest: ...` because it uses the long-lived Node worker. Once Render has written a fresh `last_checked_at` and ingests successfully, the Fly worker can be stopped.

## X login

The worker can only collect posts that X exposes to the browser session. If X requires login, run the worker once with a visible browser and the same profile directory, complete login, then redeploy or restart with the persisted `/data` volume.

## Local run

```bash
WORKER_INGEST_SECRET=<secret> \
INGEST_URL=https://serenity-signal-tracker.serenity-signal-tracker.workers.dev/api/ingest \
HEADLESS=false \
npm run worker
```
