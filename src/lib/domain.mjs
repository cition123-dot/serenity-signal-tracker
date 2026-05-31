const CASHTAG_RE = /\$([A-Z]{1,5})(?![A-Z])/g;
const TICKER_RE = /\b(?:NASDAQ|NYSE|AMEX)?:?\s*([A-Z]{1,5})\b/g;
const COMMON_WORDS = new Set([
  "A", "AI", "AM", "AN", "AND", "ARE", "AS", "AT", "BE", "BY", "CAN", "CEO", "CFO",
  "DO", "EPS", "ETF", "FOR", "GDP", "HAS", "I", "IF", "IN", "IPO", "IS", "IT", "ME",
  "NEW", "NO", "NOT", "OF", "ON", "OR", "PE", "PM", "Q", "QQQ", "ROE", "ROI", "RSI",
  "SEC", "SO", "SPY", "THE", "TO", "US", "USA", "USD", "VERY", "WE", "YOY"
]);
const NON_STOCK_CONCEPTS = new Set([
  "CPO", "RISC", "RISCV"
]);

export function isStockTicker(value) {
  const ticker = String(value || "").replace(/^\$/, "").toUpperCase();
  return Boolean(ticker && !COMMON_WORDS.has(ticker) && !NON_STOCK_CONCEPTS.has(ticker));
}

export function extractTickers(text) {
  const tickers = new Set();
  let match;

  while ((match = CASHTAG_RE.exec(text)) !== null) {
    const ticker = match[1].toUpperCase();
    if (isStockTicker(ticker)) tickers.add(ticker);
  }

  while ((match = TICKER_RE.exec(text)) !== null) {
    const ticker = match[1].toUpperCase();
    if (isStockTicker(ticker) && ticker.length > 1) {
      tickers.add(ticker);
    }
  }

  return Array.from(tickers).sort();
}

export function toIsoDate(input) {
  if (!input) return new Date().toISOString();
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function summarizeMentionWindow(mentions, now = new Date(), windowHours = 168) {
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;
  const byTicker = new Map();

  for (const mention of mentions) {
    const ticker = String(mention.ticker || "").toUpperCase();
    if (!ticker) continue;
    const mentionedAt = new Date(mention.mentionedAt || mention.mentioned_at);
    if (Number.isNaN(mentionedAt.getTime())) continue;

    const current = byTicker.get(ticker) || {
      ticker,
      totalMentionCount: 0,
      recentMentionCount: 0,
      lastMentionedAt: null
    };

    current.totalMentionCount += 1;
    if (mentionedAt.getTime() >= cutoff) current.recentMentionCount += 1;
    if (!current.lastMentionedAt || mentionedAt > new Date(current.lastMentionedAt)) {
      current.lastMentionedAt = mentionedAt.toISOString();
    }
    byTicker.set(ticker, current);
  }

  return Array.from(byTicker.values()).sort((a, b) => {
    return new Date(b.lastMentionedAt).getTime() - new Date(a.lastMentionedAt).getTime();
  });
}

export function mergeProfileWithMentions(profile, mentionStats) {
  const stats = mentionStats.find((item) => item.ticker === profile.ticker);
  return {
    ...profile,
    recentMentionCount: stats?.recentMentionCount ?? profile.recentMentionCount ?? 0,
    totalMentionCount: stats?.totalMentionCount ?? profile.totalMentionCount ?? 0,
    lastMentionedAt: stats?.lastMentionedAt ?? profile.lastMentionedAt ?? null
  };
}

export function signalFromMention(mention) {
  const confidence = Number(mention.confidence || 0);
  const stance = String(mention.stance || "neutral");
  const action = String(mention.actionSignal || mention.action_signal || "watch");
  let score = Math.round(confidence * 60);
  if (stance === "bullish") score += 20;
  if (action === "strong_watch") score += 15;
  if (action === "avoid") score -= 30;
  return Math.max(0, Math.min(100, score));
}
