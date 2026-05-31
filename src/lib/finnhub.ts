export type Quote = {
  price: number | null;
  change: number | null;
  percentChange: number | null;
  marketTime: string | null;
  symbol?: string | null;
};

export type ResolvedQuote = Quote & {
  symbol: string;
  exchange: string | null;
};

type SymbolCandidate = {
  symbol: string;
  description?: string;
  displaySymbol?: string;
  type?: string;
};

const GLOBAL_SUFFIX_PRIORITY = [
  ".ST",
  ".TO",
  ".V",
  ".OL",
  ".CO",
  ".HE",
  ".PA",
  ".AS",
  ".BR",
  ".L",
  ".DE",
  ".F",
  ".MI",
  ".SW",
  ".MC",
  ".LS"
];

export async function fetchQuote(ticker: string): Promise<Quote> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return { price: null, change: null, percentChange: null, marketTime: null };
  }

  return fetchQuoteBySymbol(ticker, apiKey);
}

export async function fetchResolvedQuote(
  ticker: string,
  companyName?: string | null,
  storedSymbol?: string | null
): Promise<ResolvedQuote> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return { price: null, change: null, percentChange: null, marketTime: null, symbol: ticker, exchange: null };
  }

  const preferredSymbols = unique([storedSymbol, ticker, ...tickerVariants(ticker)]);
  for (const symbol of preferredSymbols) {
    const quote = await fetchQuoteBestEffort(symbol, apiKey);
    if (hasUsablePrice(quote)) return { ...quote, symbol, exchange: exchangeFromSymbol(symbol) };
  }

  const candidates = await searchSymbols(ticker, companyName, apiKey);
  for (const candidate of candidates.slice(0, 8)) {
    const quote = await fetchQuoteBestEffort(candidate.symbol, apiKey);
    if (hasUsablePrice(quote)) {
      return { ...quote, symbol: candidate.symbol, exchange: exchangeFromSymbol(candidate.symbol) };
    }
  }

  return { price: null, change: null, percentChange: null, marketTime: null, symbol: ticker, exchange: null };
}

async function fetchQuoteBySymbol(symbol: string, apiKey: string): Promise<Quote> {
  const url = new URL("https://finnhub.io/api/v1/quote");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", apiKey);
  const response = await fetch(url, { next: { revalidate: 60 } });
  if (!response.ok) {
    throw new Error(`Finnhub quote failed for ${symbol}: ${response.status}`);
  }
  const data = await response.json();
  return {
    price: typeof data.c === "number" ? data.c : null,
    change: typeof data.d === "number" ? data.d : null,
    percentChange: typeof data.dp === "number" ? data.dp : null,
    marketTime: typeof data.t === "number" && data.t > 0 ? new Date(data.t * 1000).toISOString() : null,
    symbol
  };
}

async function fetchQuoteBestEffort(symbol: string, apiKey: string): Promise<Quote> {
  try {
    const quote = await fetchQuoteBySymbol(symbol, apiKey);
    if (hasUsablePrice(quote)) return quote;
  } catch {
    // Some Finnhub plans can search international symbols but cannot quote them.
  }

  return fetchYahooQuote(symbol);
}

async function fetchYahooQuote(symbol: string): Promise<Quote> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "8d");
  url.searchParams.set("interval", "1d");
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 SerenitySignalTracker/1.0",
      "Accept": "application/json"
    },
    next: { revalidate: 60 * 15 }
  });
  if (!response.ok) return { price: null, change: null, percentChange: null, marketTime: null, symbol };

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter((value: unknown) => typeof value === "number") as number[];
  const price = typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : closes.at(-1) ?? null;
  const previous =
    typeof meta?.chartPreviousClose === "number"
      ? meta.chartPreviousClose
      : closes.length > 1
        ? closes[closes.length - 2]
        : null;
  const change = price !== null && previous !== null ? price - previous : null;
  const percentChange = change !== null && previous && previous > 0 ? (change / previous) * 100 : null;
  const marketTime =
    typeof meta?.regularMarketTime === "number" && meta.regularMarketTime > 0
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : null;

  return { price, change, percentChange, marketTime, symbol };
}

async function searchSymbols(ticker: string, companyName: string | null | undefined, apiKey: string) {
  const companyQuery = cleanCompanyQuery(companyName);
  const queries = unique([companyQuery, ticker, ticker.replace(".", "-"), ticker.replace("-", ".")]).filter(Boolean);
  const results: SymbolCandidate[] = [];

  for (const query of queries.slice(0, 2)) {
    const url = new URL("https://finnhub.io/api/v1/search");
    url.searchParams.set("q", query);
    url.searchParams.set("token", apiKey);
    const response = await fetch(url, { next: { revalidate: 60 * 60 * 12 } });
    if (!response.ok) continue;
    const data = await response.json();
    if (Array.isArray(data.result)) results.push(...data.result);
  }

  return uniqueCandidates(results)
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, ticker, companyName) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ candidate }) => candidate);
}

function scoreCandidate(candidate: SymbolCandidate, ticker: string, companyName: string | null | undefined) {
  const symbol = candidate.symbol.toUpperCase();
  const displaySymbol = candidate.displaySymbol?.toUpperCase() || "";
  const description = candidate.description?.toUpperCase() || "";
  const normalizedTicker = ticker.toUpperCase();
  const compactTicker = normalizedTicker.replace(/[.-]/g, "");
  const compactSymbol = symbol.replace(/[.-]/g, "");
  const compactDisplay = displaySymbol.replace(/[.-]/g, "");
  const exactTickerMatch = symbol === normalizedTicker || displaySymbol === normalizedTicker;
  const prefixedTickerMatch =
    symbol.startsWith(`${normalizedTicker}.`) ||
    symbol.startsWith(`${normalizedTicker}-`) ||
    displaySymbol.startsWith(`${normalizedTicker}.`) ||
    displaySymbol.startsWith(`${normalizedTicker}-`);
  const compactTickerMatch = compactTicker.length >= 3 && (compactSymbol.startsWith(compactTicker) || compactDisplay.startsWith(compactTicker));
  const tickerLike = exactTickerMatch || prefixedTickerMatch || compactTickerMatch;
  const companyWords = cleanCompanyWords(companyName);
  const companyMatches = companyWords.filter((word) => description.includes(word)).length;

  if (!tickerLike && companyMatches < Math.min(2, companyWords.length || 2)) return 0;
  if (compactTicker.length <= 3 && !exactTickerMatch && !prefixedTickerMatch) return 0;

  let score = 0;

  if (exactTickerMatch) score += 90;
  if (prefixedTickerMatch) score += 80;
  if (compactTickerMatch) score += 55;
  if (candidate.type?.toLowerCase().includes("common")) score += 12;
  if (candidate.type?.toLowerCase().includes("stock")) score += 12;

  const suffixIndex = GLOBAL_SUFFIX_PRIORITY.findIndex((suffix) => symbol.endsWith(suffix));
  if (suffixIndex >= 0) score += 35 - suffixIndex;

  score += companyMatches * 8;

  if (symbol.includes(":") || symbol.includes("=")) score -= 60;
  if (candidate.type?.toLowerCase().includes("crypto") || candidate.type?.toLowerCase().includes("forex")) score -= 60;

  return score;
}

function cleanCompanyQuery(companyName: string | null | undefined) {
  const words = cleanCompanyWords(companyName);
  return words.slice(0, 2).join(" ") || null;
}

function cleanCompanyWords(companyName: string | null | undefined) {
  if (!companyName || /^unknown/i.test(companyName)) return [];
  return companyName
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length > 3 && !["TICKER", "EQUITY", "STOCK", "COMPANY", "COMMON"].includes(word));
}

function tickerVariants(ticker: string) {
  return unique([
    ticker.replace(".", "-"),
    ticker.replace("-", "."),
    `${ticker}.ST`,
    `${ticker}.TO`,
    `${ticker.replace(".", "-")}.TO`,
    `${ticker}.L`,
    `${ticker}.DE`
  ]);
}

function exchangeFromSymbol(symbol: string) {
  const match = symbol.match(/\.([A-Z]+)$/i);
  return match ? match[1].toUpperCase() : null;
}

function hasUsablePrice(quote: Quote) {
  return typeof quote.price === "number" && quote.price > 0;
}

function unique<T>(items: Array<T | null | undefined>) {
  return Array.from(new Set(items.filter(Boolean) as T[]));
}

function uniqueCandidates(candidates: SymbolCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.symbol || seen.has(candidate.symbol)) return false;
    seen.add(candidate.symbol);
    return true;
  });
}
