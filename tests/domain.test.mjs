import test from "node:test";
import assert from "node:assert/strict";
import { extractTickers, summarizeMentionWindow, signalFromMention } from "../src/lib/domain.mjs";

test("extractTickers prefers cashtags and filters common words", () => {
  assert.deepEqual(extractTickers("Watching $NVDA and $TSLA. THE setup is not GDP."), ["NVDA", "TSLA"]);
});

test("extractTickers treats CPO as a concept, not a stock", () => {
  assert.deepEqual(extractTickers("$SIVE benefits from the CPO cycle, but $CPO is not a stock."), ["SIVE"]);
});

test("extractTickers treats RISC-V as a chip architecture, not a stock", () => {
  assert.deepEqual(extractTickers("$AAOI mentions RISC-V, but $RISC and RISCV are not stocks."), ["AAOI"]);
});

test("summarizeMentionWindow counts recent and total mentions", () => {
  const now = new Date("2026-05-29T12:00:00Z");
  const stats = summarizeMentionWindow(
    [
      { ticker: "NVDA", mentionedAt: "2026-05-29T11:00:00Z" },
      { ticker: "NVDA", mentionedAt: "2026-05-20T11:00:00Z" },
      { ticker: "TSLA", mentionedAt: "2026-05-28T11:00:00Z" }
    ],
    now,
    168
  );

  assert.equal(stats.find((item) => item.ticker === "NVDA").totalMentionCount, 2);
  assert.equal(stats.find((item) => item.ticker === "NVDA").recentMentionCount, 1);
  assert.equal(stats.find((item) => item.ticker === "TSLA").recentMentionCount, 1);
});

test("signalFromMention maps bullish confidence to bounded score", () => {
  assert.equal(signalFromMention({ confidence: 0.9, stance: "bullish", actionSignal: "strong_watch" }), 89);
  assert.equal(signalFromMention({ confidence: 0.5, stance: "bearish", actionSignal: "avoid" }), 0);
});
