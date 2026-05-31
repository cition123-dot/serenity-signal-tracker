import { Clock3, Languages, MessageCircle, Moon, Radio, Search, ShieldAlert, Sun, TrendingDown, TrendingUp } from "lucide-react";
import { getDashboardData } from "@/lib/dashboard";
import { needsChineseTranslation, translateToChinese } from "@/lib/translate";
import type { SerenityPost, StockProfile } from "@/lib/types";

const windows = [
  { label: "24小时", hours: 24 },
  { label: "7天", hours: 168 },
  { label: "30天", hours: 720 }
];

type QueryParams = {
  window?: string;
  sort?: string;
  dir?: string;
  selected?: string;
  lang?: string;
  original?: string;
  posts?: string;
  stocks?: string;
  theme?: string;
};

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: Promise<QueryParams>;
}) {
  const params = (await searchParams) || {};
  const windowHours = Number(params.window || 168);
  const sort = params.sort || "lastMentionedAt";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const lang = params.lang === "en" ? "en" : "zh";
  const theme = params.theme === "night" ? "night" : "day";
  const originalPostId = params.original || "";
  const data = await getDashboardData(windowHours);
  const stocks = sortStocks(data.stocks, sort, dir);
  const selected = stocks.find((stock) => stock.ticker === params.selected) || stocks[0];
  const showAllPosts = params.posts === "all";
  const showAllStocks = params.stocks === "all";
  const visiblePosts = showAllPosts ? data.posts : data.posts.slice(0, 5);
  const visibleStocks = showAllStocks ? stocks : stocks.slice(0, 20);
  const recentStocks = recentMentionedStocks(data.stocks);
  const translations = lang === "zh" ? await buildTranslations(data.posts, stocks, selected) : new Map<string, string>();

  return (
    <main className={`shell theme-${theme}`} id="page-top">
      <a className="mobile-top-hit" href="#page-top" aria-label="回到页面顶部" />
      <header className="topbar">
        <div className="brand-lockup">
          <a className="brand-avatar" href="/" aria-label="回到 Serenity 信号跟踪主页">
            <img className="brand-logo" src="/aleabitoreddit-avatar.jpg" alt="@aleabitoreddit 头像" />
            <span className="avatar-lens" aria-hidden="true">
              <Search size={18} />
            </span>
          </a>
          <div>
            <p className="eyebrow">X monitor / @aleabitoreddit</p>
            <h1>Serenity 信号跟踪</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <nav className="language-switch" aria-label="语言选择">
            <Languages size={16} />
            <a className={lang === "zh" ? "active" : ""} href={href({ params, lang: "zh", original: "" })}>中文</a>
            <a className={lang === "en" ? "active" : ""} href={href({ params, lang: "en", original: "" })}>English</a>
          </nav>
          <div className={`collector collector-${data.collector.status}`}>
            <Radio size={18} />
            <span>{collectorText(data.collector.status)}</span>
          </div>
          <a className="theme-switch" href={href({ params, theme: theme === "night" ? "" : "night" })}>
            {theme === "night" ? <Sun size={16} /> : <Moon size={16} />}
            <span>{theme === "night" ? "标准模式" : "夜晚模式"}</span>
          </a>
        </div>
      </header>

      <section className="market-strip" aria-label="近期看好的股票">
        {recentStocks.map((stock) => (
          <a className="market-chip" href={href({ params, selected: stock.ticker })} key={stock.ticker}>
            <strong>{stock.ticker}</strong>
            <span>{money(stock.latestPrice)}</span>
            <em className={Number(stock.percentChange || 0) >= 0 ? "up" : "down"}>{percent(stock.percentChange)}</em>
          </a>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel feed">
          <div className="panel-heading feed-heading">
            <div className="heading-lockup">
              <span className="heading-icon"><MessageCircle size={18} /></span>
              <div>
                <h2>最新推文</h2>
                <p>按发布时间实时滚动</p>
              </div>
            </div>
            <span>{data.posts.length ? `最近更新 ${data.posts.length} 条` : "等待更新"}</span>
          </div>
          <div className="post-list">
            {data.posts.length ? (
              visiblePosts.map((post) => (
                <article key={post.id} className="post-card">
                  <div className="post-meta">
                    <Clock3 size={14} />
                    <time>{relativeTime(post.postedAt)}</time>
                  </div>
                  <p className="post-body">{postDisplayText(post, lang, originalPostId, translations)}</p>
                  {shouldShowOriginalToggle(post, lang) ? (
                    <div className="post-tools">
                      <a href={href({ params, lang, original: originalPostId === post.xPostId ? "" : post.xPostId })}>
                        {originalPostId === post.xPostId ? "收起原文" : "查看原文"}
                      </a>
                    </div>
                  ) : lang === "en" ? (
                    <div className="post-tools">
                      <a href={post.url} target="_blank" rel="noreferrer">打开 X</a>
                    </div>
                  ) : null}
                  <div className="ticker-row">
                    {post.mentionedStocks.map((stock) => (
                      <span key={stock.ticker}>${stock.ticker}</span>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <strong>等待 X 采集 worker</strong>
                <span>数据库已连接；worker 登录 X 并写入新帖后，这里会出现 Serenity 原文。</span>
              </div>
            )}
            {data.posts.length > 5 ? (
              <a className="show-more" href={href({ params, posts: showAllPosts ? "" : "all" })}>
                {showAllPosts ? "收起推文" : `显示更多 ${data.posts.length - 5} 条`}
              </a>
            ) : null}
          </div>
        </aside>

        <section className="panel stocks">
          <div className="panel-heading stock-heading">
            <div>
              <h2>股票一览</h2>
              <p>涨跌幅、价格、近期提及和总提及用于快速判断 Serenity 的关注密度。</p>
            </div>
            <div className="stock-controls">
              <div className="control-group">
                <span>提及范围</span>
                <nav className="window-tabs" aria-label="近期提及窗口">
                  {windows.map((item) => (
                    <a key={item.hours} className={item.hours === windowHours ? "active" : ""} href={href({ params, window: String(item.hours) })}>
                      {item.label}
                    </a>
                  ))}
                </nav>
              </div>
            </div>
          </div>

          <div className="stock-table">
            <div className="stock-row stock-row-head">
              <a href={sortHref(params, sort, dir, "name")}>股票名{sortMark(sort, dir, "name")}</a>
              <a href={sortHref(params, sort, dir, "lastMentionedAt")}>最近提及时间{sortMark(sort, dir, "lastMentionedAt")}</a>
              <a href={sortHref(params, sort, dir, "price")}>价格{sortMark(sort, dir, "price")}</a>
              <a href={sortHref(params, sort, dir, "weekReturn")}>近7天涨幅{sortMark(sort, dir, "weekReturn")}</a>
              <a href={sortHref(params, sort, dir, "recentMentionCount")}>近期次数{sortMark(sort, dir, "recentMentionCount")}</a>
              <a href={sortHref(params, sort, dir, "totalMentionCount")}>总次数{sortMark(sort, dir, "totalMentionCount")}</a>
            </div>
            {stocks.length ? (
              visibleStocks.map((stock) => (
                <a
                  className={`stock-row ${selected?.ticker === stock.ticker ? "selected" : ""}`}
                  href={href({ params, selected: stock.ticker })}
                  key={stock.ticker}
                >
                  <span>
                    <strong>{stock.ticker}</strong>
                    <small>{stock.companyName || stock.quoteSymbol || "US equity"}</small>
                    {stock.quoteSymbol && stock.quoteSymbol !== stock.ticker ? <small>行情: {stock.quoteSymbol}</small> : null}
                  </span>
                  <span>{relativeTime(stock.lastMentionedAt)}</span>
                  <span>
                    {money(stock.latestPrice)}
                    <small className={Number(stock.percentChange || 0) >= 0 ? "up" : "down"}>
                      {percent(stock.percentChange)}
                    </small>
                  </span>
                  <span className={Number(stock.change1w || 0) >= 0 ? "up return-cell" : "down return-cell"}>
                    {percent(stock.change1w)}
                    <small>{stock.change1w === null || stock.change1w === undefined ? "需7个交易日" : "7个交易日"}</small>
                  </span>
                  <span className="count">{stock.recentMentionCount}</span>
                  <span className="count">{stock.totalMentionCount}</span>
                </a>
              ))
            ) : (
              <div className="table-empty">
                暂无股票信号。采集到包含 ticker 的帖子后，会显示最近提及、近期次数和总次数。
              </div>
            )}
            {stocks.length > 20 ? (
              <a className="show-more stock-more" href={href({ params, stocks: showAllStocks ? "" : "all" })}>
                {showAllStocks ? "收起股票池" : `显示更多 ${stocks.length - 20} 只`}
              </a>
            ) : null}
          </div>
        </section>

        <aside className="panel detail">
          {selected ? (
            <StockDetail
              stock={selected}
              posts={data.posts}
              lang={lang}
              originalPostId={originalPostId}
              params={params}
              translations={translations}
            />
          ) : <EmptyDetail />}
        </aside>
      </section>
    </main>
  );
}

function StockDetail({
  stock,
  posts,
  lang,
  originalPostId,
  params,
  translations
}: {
  stock: StockProfile;
  posts: SerenityPost[];
  lang: "zh" | "en";
  originalPostId: string;
  params: QueryParams;
  translations: Map<string, string>;
}) {
  const trendUp = Number(stock.percentChange || 0) >= 0;
  const relatedPosts = posts
    .filter((post) => post.mentionedStocks.some((mention) => mention.ticker === stock.ticker))
    .slice(0, 6);

  return (
    <>
      <div className="detail-hero">
        <div>
          <p className="eyebrow">Selected signal</p>
          <h2>{stock.ticker}</h2>
          <span>{stock.companyName || "US equity"}</span>
        </div>
        <div className={trendUp ? "price up" : "price down"}>
          {trendUp ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
          <strong>{percent(stock.percentChange)}</strong>
        </div>
      </div>

      <section className="detail-block">
        <h3>近期 AI 总结</h3>
        <p className="ai-thesis">{stockText(stock, "thesis", lang, translations) || "暂无总结，等待 Serenity 新帖进入系统。"}</p>
        <div className="ai-note-grid">
          <div>
            <span>近期提及</span>
            <strong>{stock.recentMentionCount}</strong>
          </div>
          <div>
            <span>总提及</span>
            <strong>{stock.totalMentionCount}</strong>
          </div>
        </div>
      </section>

      <section className="detail-block source-block">
        <h3>近期相关原文</h3>
        <div className="source-list">
          {relatedPosts.length ? (
            relatedPosts.map((post) => (
              <article className="source-card" key={post.id}>
                <div className="post-meta">
                  <Clock3 size={14} />
                  <time>{relativeTime(post.postedAt)}</time>
                </div>
                <blockquote>{postDisplayText(post, lang, originalPostId, translations)}</blockquote>
                {shouldShowOriginalToggle(post, lang) ? (
                  <a className="source-toggle" href={href({ params, original: originalPostId === post.xPostId ? "" : post.xPostId })}>
                    {originalPostId === post.xPostId ? "收起原文" : "查看原文"}
                  </a>
                ) : null}
              </article>
            ))
          ) : (
            <article className="source-card">
              <div className="post-meta">暂无近期原文</div>
            </article>
          )}
        </div>
      </section>

      <section className="detail-block">
          <h3>优势特点</h3>
          <ul>
          {stock.advantages.length ? stock.advantages.map((item, index) => (
            <li key={item}>{stockListText(stock, "advantage", item, index, lang, translations)}</li>
          )) : <li>暂无优势摘要</li>}
        </ul>
      </section>

      <section className="detail-block">
        <h3>主要风险</h3>
        <ul>
          {stock.risks.length ? stock.risks.map((item, index) => (
            <li key={item}>{stockListText(stock, "risk", item, index, lang, translations)}</li>
          )) : <li>暂无风险摘要</li>}
        </ul>
      </section>

      <section className="metric-grid">
        <div>
          <span>最近提及</span>
          <strong>{relativeTime(stock.lastMentionedAt)}</strong>
        </div>
        <div>
          <span>近期提及</span>
          <strong>{stock.recentMentionCount}</strong>
        </div>
        <div>
          <span>总提及</span>
          <strong>{stock.totalMentionCount}</strong>
        </div>
        <div>
          <span>当日涨跌</span>
          <strong className={trendUp ? "up" : "down"}>{percent(stock.percentChange)}</strong>
        </div>
      </section>
    </>
  );
}

function EmptyDetail() {
  return (
    <div className="empty">
      <ShieldAlert size={28} />
      <p>等待股票信号进入系统。</p>
    </div>
  );
}

function sortStocks(stocks: StockProfile[], sort: string, dir: "asc" | "desc") {
  const direction = dir === "asc" ? 1 : -1;
  return [...stocks].sort((a, b) => {
    if (sort === "name") return a.ticker.localeCompare(b.ticker) * direction;
    if (sort === "recentMentionCount") return (a.recentMentionCount - b.recentMentionCount) * direction;
    if (sort === "totalMentionCount") return (a.totalMentionCount - b.totalMentionCount) * direction;
    if (sort === "dayReturn") return (Number(a.percentChange || 0) - Number(b.percentChange || 0)) * direction;
    if (sort === "weekReturn") return (Number(a.change1w || 0) - Number(b.change1w || 0)) * direction;
    if (sort === "price") return (Number(a.latestPrice || 0) - Number(b.latestPrice || 0)) * direction;
    return (new Date(a.lastMentionedAt || 0).getTime() - new Date(b.lastMentionedAt || 0).getTime()) * direction;
  });
}

function href({
  params,
  ...updates
}: {
  params: QueryParams;
  window?: string;
  sort?: string;
  dir?: string;
  selected?: string;
  lang?: string;
  original?: string;
  posts?: string;
  stocks?: string;
  theme?: string;
}) {
  const next = new URLSearchParams();
  Object.entries({ ...params, ...updates }).forEach(([key, value]) => {
    if (value) next.set(key, value);
  });
  const query = next.toString();
  return query ? `/?${query}` : "/";
}

async function buildTranslations(posts: SerenityPost[], stocks: StockProfile[], selected?: StockProfile) {
  const relatedPosts = selected
    ? posts.filter((post) => post.mentionedStocks.some((mention) => mention.ticker === selected.ticker)).slice(0, 6)
    : [];
  const items = [
    ...posts.slice(0, 5).filter((post) => !post.bodyZh).map((post) => ({ id: `post:${post.xPostId}:body`, text: tidyPost(post.body) })),
    ...relatedPosts.filter((post) => !post.bodyZh).map((post) => ({ id: `post:${post.xPostId}:body`, text: tidyPost(post.body) })),
    ...stocks.slice(0, 20).filter((stock) => !stock.thesisZh).map((stock) => ({ id: `stock:${stock.ticker}:thesis`, text: stock.thesis })),
    ...(selected && !selected.thesisZh ? [{ id: `stock:${selected.ticker}:thesis`, text: selected.thesis }] : []),
    ...(selected
      ? [
          ...selected.advantages.flatMap((text, index) =>
            selected.advantagesZh?.[index] ? [] : [{ id: `stock:${selected.ticker}:advantage:${index}`, text }]
          ),
          ...selected.risks.flatMap((text, index) =>
            selected.risksZh?.[index] ? [] : [{ id: `stock:${selected.ticker}:risk:${index}`, text }]
          )
        ]
      : [])
  ];

  return translateToChinese(items);
}

function postDisplayText(post: SerenityPost, lang: "zh" | "en", originalPostId: string, translations: Map<string, string>) {
  if (lang === "en" || originalPostId === post.xPostId) return tidyPost(post.body);
  if (!needsChineseTranslation(tidyPost(post.body))) return tidyPost(post.body);
  if (post.bodyZh) return tidyPost(post.bodyZh);
  return translatedText(`post:${post.xPostId}:body`, post.body, lang, translations);
}

function shouldShowOriginalToggle(post: SerenityPost, lang: "zh" | "en") {
  return lang === "zh" && needsChineseTranslation(tidyPost(post.body));
}

function translatedText(id: string, fallback: string, lang: "zh" | "en", translations: Map<string, string>) {
  if (lang === "en") return tidyPost(fallback);
  return translations.get(id) || tidyPost(fallback);
}

function stockText(stock: StockProfile, field: "thesis", lang: "zh" | "en", translations: Map<string, string>) {
  if (lang === "en") return tidyPost(stock.thesis);
  if (field === "thesis" && stock.thesisZh) return tidyPost(stock.thesisZh);
  return translatedText(`stock:${stock.ticker}:thesis`, stock.thesis, lang, translations);
}

function stockListText(
  stock: StockProfile,
  field: "advantage" | "risk",
  fallback: string,
  index: number,
  lang: "zh" | "en",
  translations: Map<string, string>
) {
  if (lang === "en") return tidyPost(fallback);
  const cached = field === "advantage" ? stock.advantagesZh?.[index] : stock.risksZh?.[index];
  if (cached) return tidyPost(cached);
  return translatedText(`stock:${stock.ticker}:${field}:${index}`, fallback, lang, translations);
}

function tidyPost(text: string) {
  return text
    .replace(/^·\d+[hm]\s*/i, "")
    .replace(/Show more/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relativeTime(value?: string | null) {
  if (!value) return "暂无";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function money(value?: number | null) {
  if (value === null || value === undefined) return "--";
  return `$${value.toFixed(2)}`;
}

function percent(value?: number | null) {
  if (value === null || value === undefined) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function collectorText(status: string) {
  if (status === "healthy") return "采集正常";
  if (status === "login_required") return "需要重新登录 X";
  if (status === "degraded") return "采集降级";
  return "等待采集状态";
}

function recentMentionedStocks(stocks: StockProfile[]) {
  return [...stocks]
    .filter((stock) => stock.recentMentionCount > 0 && stock.lastMentionedAt)
    .sort((a, b) =>
      new Date(b.lastMentionedAt || 0).getTime() - new Date(a.lastMentionedAt || 0).getTime() ||
      b.recentMentionCount - a.recentMentionCount ||
      b.signalStrength - a.signalStrength
    )
    .slice(0, 8);
}

function sortHref(params: QueryParams, currentSort: string, currentDir: string, nextSort: string) {
  const defaultDir = nextSort === "name" ? "asc" : "desc";
  const nextDir = currentSort === nextSort ? (currentDir === "desc" ? "asc" : "desc") : defaultDir;
  return href({ params, sort: nextSort, dir: nextDir });
}

function sortMark(currentSort: string, currentDir: string, key: string) {
  if (currentSort !== key) return "";
  return currentDir === "asc" ? " ↑" : " ↓";
}
