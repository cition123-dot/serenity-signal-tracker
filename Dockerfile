FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY worker ./worker
COPY src/lib/domain.mjs ./src/lib/domain.mjs

ENV NODE_ENV=production
ENV PLAYWRIGHT_PROFILE_DIR=/tmp/playwright-profile
ENV INGEST_URL=https://serenity-signal-tracker.serenity-signal-tracker.workers.dev/api/ingest
ENV COLLECTOR_INTERVAL_MS=1800000
ENV HEADLESS=true

CMD ["./node_modules/.bin/tsx", "worker/collector.ts"]
