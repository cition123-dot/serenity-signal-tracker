create extension if not exists pgcrypto;

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  x_post_id text not null unique,
  author_handle text not null default 'aleabitoreddit',
  url text not null,
  body text not null,
  body_zh text,
  posted_at timestamptz not null,
  collected_at timestamptz not null default now(),
  summary text,
  summary_zh text,
  analysis jsonb not null default '{}'::jsonb,
  processed_at timestamptz
);

alter table posts add column if not exists body_zh text;
alter table posts add column if not exists summary_zh text;

create table if not exists stock_mentions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  ticker text not null,
  company_name text,
  stance text not null default 'neutral',
  confidence numeric not null default 0,
  reasons text[] not null default '{}',
  risks text[] not null default '{}',
  time_sensitivity text not null default 'normal',
  action_signal text not null default 'watch',
  mentioned_at timestamptz not null,
  unique (post_id, ticker)
);

create table if not exists stock_profiles (
  ticker text primary key,
  company_name text,
  thesis text not null default '',
  thesis_zh text,
  advantages text[] not null default '{}',
  advantages_zh text[] not null default '{}',
  risks text[] not null default '{}',
  risks_zh text[] not null default '{}',
  signal_strength integer not null default 0,
  last_mentioned_at timestamptz,
  total_mention_count integer not null default 0,
  watch_state text not null default 'active',
  quote_symbol text,
  quote_exchange text,
  updated_at timestamptz not null default now()
);

alter table stock_profiles add column if not exists quote_symbol text;
alter table stock_profiles add column if not exists quote_exchange text;
alter table stock_profiles add column if not exists thesis_zh text;
alter table stock_profiles add column if not exists advantages_zh text[] not null default '{}';
alter table stock_profiles add column if not exists risks_zh text[] not null default '{}';

create table if not exists price_snapshots (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  price numeric,
  change numeric,
  percent_change numeric,
  market_time timestamptz,
  captured_at timestamptz not null default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  ticker text,
  post_id uuid references posts(id) on delete cascade,
  severity text not null default 'info',
  title text not null,
  message text not null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists collector_status (
  id integer primary key default 1,
  target_handle text not null default 'aleabitoreddit',
  status text not null default 'unknown',
  message text not null default '',
  last_checked_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint singleton_collector_status check (id = 1)
);

create index if not exists idx_stock_mentions_ticker_time on stock_mentions (ticker, mentioned_at desc);
create index if not exists idx_posts_posted_at on posts (posted_at desc);
create index if not exists idx_alerts_created_at on alerts (created_at desc);
create index if not exists idx_price_snapshots_ticker_time on price_snapshots (ticker, captured_at desc);
