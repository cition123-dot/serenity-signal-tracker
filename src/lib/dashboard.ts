import { mockDashboard } from "./mock-data";
import { hasDatabase, sql } from "./db";
import type { DashboardData, StockProfile, SerenityPost, AlertItem, CollectorStatus } from "./types";

type QueryRows = Record<string, any>[];

export async function getDashboardData(windowHours = 168): Promise<DashboardData> {
  if (!hasDatabase()) return { ...mockDashboard, recentWindowHours: windowHours };

  const db = sql();
  const [postRows, stockRows, alertRows, collectorRows] = await Promise.all([
    db`
      select p.*, coalesce(
        json_agg(json_build_object(
          'ticker', sm.ticker,
          'companyName', sm.company_name,
          'stance', sm.stance,
          'confidence', sm.confidence,
          'reasons', sm.reasons,
          'risks', sm.risks,
          'timeSensitivity', sm.time_sensitivity,
          'actionSignal', sm.action_signal
        )) filter (where sm.id is not null), '[]'
      ) as mentioned_stocks
      from posts p
      left join stock_mentions sm on sm.post_id = p.id
      where p.posted_at >= now() - (${windowHours} || ' hours')::interval
      group by p.id
      order by p.posted_at desc
      limit 40
    `,
    db`
      with recent_mentions as (
        select ticker, count(*)::int as recent_count
        from stock_mentions
        where mentioned_at >= now() - (${windowHours} || ' hours')::interval
        group by ticker
      ),
      latest_prices as (
        select distinct on (ticker) ticker, price, change, percent_change
        from price_snapshots
        order by ticker, captured_at desc
      ),
      daily_prices as (
        select distinct on (ticker, market_day)
          ticker,
          market_day,
          price
        from (
          select
            ticker,
            price,
            (coalesce(market_time, captured_at) at time zone 'America/New_York')::date as market_day,
            coalesce(market_time, captured_at) as snapshot_time,
            captured_at
          from price_snapshots
          where price is not null and price > 0
        ) snapshots
        order by ticker, market_day, snapshot_time desc, captured_at desc
      ),
      ranked_daily_prices as (
        select
          ticker,
          market_day,
          price,
          row_number() over (partition by ticker order by market_day desc) as trading_day_rank
        from daily_prices
      ),
      return_snapshots as (
        select
          current_day.ticker,
          case when prev_1.price > 0 then ((current_day.price - prev_1.price) / prev_1.price) * 100 end as change_1d,
          case when prev_3.price > 0 then ((current_day.price - prev_3.price) / prev_3.price) * 100 end as change_3d,
          case when prev_7.price > 0 then ((current_day.price - prev_7.price) / prev_7.price) * 100 end as change_1w,
          case when prev_30.price > 0 then ((current_day.price - prev_30.price) / prev_30.price) * 100 end as change_1m
        from ranked_daily_prices current_day
        left join ranked_daily_prices prev_1
          on prev_1.ticker = current_day.ticker
          and prev_1.trading_day_rank = current_day.trading_day_rank + 1
        left join ranked_daily_prices prev_3
          on prev_3.ticker = current_day.ticker
          and prev_3.trading_day_rank = current_day.trading_day_rank + 3
        left join ranked_daily_prices prev_7
          on prev_7.ticker = current_day.ticker
          and prev_7.trading_day_rank = current_day.trading_day_rank + 7
        left join ranked_daily_prices prev_30
          on prev_30.ticker = current_day.ticker
          and prev_30.trading_day_rank = current_day.trading_day_rank + 30
        where current_day.trading_day_rank = 1
      )
      select sp.*, coalesce(rm.recent_count, 0)::int as recent_mention_count,
        lp.price, lp.change, lp.percent_change,
        rs.change_1d, rs.change_3d, rs.change_1w, rs.change_1m
      from stock_profiles sp
      left join recent_mentions rm on rm.ticker = sp.ticker
      left join latest_prices lp on lp.ticker = sp.ticker
      left join return_snapshots rs on rs.ticker = sp.ticker
      where sp.watch_state <> 'ignored'
        and coalesce(rm.recent_count, 0) > 0
      order by sp.last_mentioned_at desc nulls last
      limit 80
    `,
    db`
      select *
      from alerts
      where acknowledged_at is null
      order by created_at desc
      limit 20
    `,
    db`select * from collector_status where id = 1`
  ]);

  return {
    posts: mapPosts(postRows as QueryRows),
    stocks: mapStocks(stockRows as QueryRows),
    alerts: mapAlerts(alertRows as QueryRows),
    collector: mapCollector((collectorRows as QueryRows)[0]),
    recentWindowHours: windowHours
  };
}

function mapPosts(rows: QueryRows): SerenityPost[] {
  return rows.map((row) => ({
    id: row.id,
    xPostId: row.x_post_id,
    url: row.url,
    body: row.body,
    bodyZh: row.body_zh || null,
    postedAt: row.posted_at,
    collectedAt: row.collected_at,
    summary: row.summary || "",
    summaryZh: row.summary_zh || null,
    mentionedStocks: row.mentioned_stocks || []
  }));
}

function mapStocks(rows: QueryRows): StockProfile[] {
  return rows.map((row) => ({
    ticker: row.ticker,
    companyName: row.company_name || undefined,
    thesis: row.thesis || "",
    thesisZh: row.thesis_zh || null,
    advantages: row.advantages || [],
    advantagesZh: row.advantages_zh || [],
    risks: row.risks || [],
    risksZh: row.risks_zh || [],
    signalStrength: Number(row.signal_strength || 0),
    lastMentionedAt: row.last_mentioned_at,
    recentMentionCount: Number(row.recent_mention_count || 0),
    totalMentionCount: Number(row.total_mention_count || 0),
    watchState: row.watch_state || "active",
    quoteSymbol: row.quote_symbol || null,
    quoteExchange: row.quote_exchange || null,
    latestPrice: row.price === null ? null : Number(row.price),
    change: row.change === null ? null : Number(row.change),
    percentChange: row.percent_change === null ? null : Number(row.percent_change),
    change1d: row.change_1d === null ? null : Number(row.change_1d),
    change3d: row.change_3d === null ? null : Number(row.change_3d),
    change1w: row.change_1w === null ? null : Number(row.change_1w),
    change1m: row.change_1m === null ? null : Number(row.change_1m)
  }));
}

function mapAlerts(rows: QueryRows): AlertItem[] {
  return rows.map((row) => ({
    id: row.id,
    ticker: row.ticker,
    severity: row.severity,
    title: row.title,
    message: row.message,
    createdAt: row.created_at
  }));
}

function mapCollector(row: Record<string, any> | undefined): CollectorStatus {
  if (!row) {
    return { status: "unknown", message: "No collector status has been written yet." };
  }
  return {
    status: row.status,
    message: row.message,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at
  };
}
