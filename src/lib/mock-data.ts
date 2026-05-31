import type { DashboardData } from "./types";

export const mockDashboard: DashboardData = {
  recentWindowHours: 168,
  collector: {
    status: "degraded",
    message: "Mock mode: configure DATABASE_URL and worker to enable live collection.",
    lastCheckedAt: new Date().toISOString(),
    lastSuccessAt: null
  },
  alerts: [
    {
      id: "mock-alert-1",
      ticker: "NVDA",
      severity: "warning",
      title: "New strong watch",
      message: "NVDA appeared in a fresh Serenity post with high-confidence bullish language.",
      createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString()
    }
  ],
  posts: [
    {
      id: "mock-post-1",
      xPostId: "mock-1",
      url: "https://x.com/aleabitoreddit/status/mock-1",
      body: "Watching $NVDA into earnings. Datacenter demand still looks underappreciated.",
      postedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      collectedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      summary: "Serenity is watching NVDA because datacenter demand may still be underestimated.",
      mentionedStocks: [
        {
          ticker: "NVDA",
          companyName: "NVIDIA",
          stance: "bullish",
          confidence: 0.82,
          reasons: ["Datacenter demand", "Earnings catalyst"],
          risks: ["Valuation sensitivity"],
          timeSensitivity: "soon",
          actionSignal: "strong_watch"
        }
      ]
    },
    {
      id: "mock-post-2",
      xPostId: "mock-2",
      url: "https://x.com/aleabitoreddit/status/mock-2",
      body: "$TSLA feels more event-driven than fundamental this week. Size carefully.",
      postedAt: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
      collectedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
      summary: "TSLA is framed as a short-term event trade with sizing caution.",
      mentionedStocks: [
        {
          ticker: "TSLA",
          companyName: "Tesla",
          stance: "mixed",
          confidence: 0.68,
          reasons: ["Event-driven setup"],
          risks: ["Position sizing", "Volatility"],
          timeSensitivity: "urgent",
          actionSignal: "watch"
        }
      ]
    }
  ],
  stocks: [
    {
      ticker: "NVDA",
      companyName: "NVIDIA",
      thesis: "Potential upside from datacenter demand and earnings momentum.",
      advantages: ["Datacenter demand", "AI infrastructure leadership", "Near-term earnings catalyst"],
      risks: ["Premium valuation", "Crowded positioning"],
      signalStrength: 86,
      lastMentionedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      recentMentionCount: 3,
      totalMentionCount: 9,
      watchState: "active",
      latestPrice: 142.63,
      change: 2.14,
      percentChange: 1.52
    },
    {
      ticker: "TSLA",
      companyName: "Tesla",
      thesis: "Short-term event setup, but Serenity's language is more cautious than outright bullish.",
      advantages: ["Event catalyst", "High liquidity"],
      risks: ["Volatility", "Execution uncertainty"],
      signalStrength: 58,
      lastMentionedAt: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
      recentMentionCount: 1,
      totalMentionCount: 4,
      watchState: "watchlist",
      latestPrice: 248.11,
      change: -3.92,
      percentChange: -1.56
    }
  ]
};
