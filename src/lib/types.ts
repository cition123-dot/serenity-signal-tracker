export type Stance = "bullish" | "bearish" | "neutral" | "mixed";
export type ActionSignal = "watch" | "strong_watch" | "avoid" | "context_only";
export type WatchState = "active" | "watchlist" | "ignored";

export type StockMentionAnalysis = {
  ticker: string;
  companyName?: string;
  stance: Stance;
  confidence: number;
  reasons: string[];
  risks: string[];
  timeSensitivity: "urgent" | "soon" | "normal" | "long_term";
  actionSignal: ActionSignal;
};

export type PostAnalysis = {
  summary: string;
  mentionedStocks: StockMentionAnalysis[];
};

export type SerenityPost = {
  id: string;
  xPostId: string;
  url: string;
  body: string;
  bodyZh?: string | null;
  postedAt: string;
  collectedAt: string;
  summary: string;
  summaryZh?: string | null;
  mentionedStocks: StockMentionAnalysis[];
};

export type StockProfile = {
  ticker: string;
  companyName?: string;
  thesis: string;
  thesisZh?: string | null;
  advantages: string[];
  advantagesZh?: string[];
  risks: string[];
  risksZh?: string[];
  signalStrength: number;
  lastMentionedAt: string | null;
  recentMentionCount: number;
  totalMentionCount: number;
  watchState: WatchState;
  quoteSymbol?: string | null;
  quoteExchange?: string | null;
  latestPrice?: number | null;
  change?: number | null;
  percentChange?: number | null;
  change1d?: number | null;
  change3d?: number | null;
  change1w?: number | null;
  change1m?: number | null;
};

export type AlertItem = {
  id: string;
  ticker?: string | null;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  createdAt: string;
};

export type CollectorStatus = {
  status: "healthy" | "degraded" | "login_required" | "unknown";
  message: string;
  lastCheckedAt?: string | null;
  lastSuccessAt?: string | null;
};

export type DashboardData = {
  posts: SerenityPost[];
  stocks: StockProfile[];
  alerts: AlertItem[];
  collector: CollectorStatus;
  recentWindowHours: number;
};
