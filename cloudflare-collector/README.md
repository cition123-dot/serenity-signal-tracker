# Serenity X Cloudflare Collector

This is the Cloudflare Workers + Browser Rendering version of the X collector.

It is intentionally separate from the Next.js/OpenNext web Worker so the web app can stay stable while collection is tested.

## Deploy

```bash
npx wrangler deploy --config cloudflare-collector/wrangler.jsonc
```

## Required secrets

```bash
npx wrangler secret put WORKER_INGEST_SECRET --config cloudflare-collector/wrangler.jsonc
npx wrangler secret put X_AUTH_TOKEN --config cloudflare-collector/wrangler.jsonc
npx wrangler secret put X_CT0 --config cloudflare-collector/wrangler.jsonc
```

## Schedule

The worker runs every 30 minutes:

```txt
*/30 * * * *
```

## Notes

Cloudflare Browser Rendering does not share Fly's persistent Playwright profile. It seeds X cookies on every run. If X invalidates the cookies, refresh `X_AUTH_TOKEN` and `X_CT0`.

Keep the Fly worker running until this collector reports healthy status from production.
