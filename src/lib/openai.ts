import OpenAI from "openai";
import type { ActionSignal, PostAnalysis, Stance, StockMentionAnalysis } from "./types";
import { extractTickers, isStockTicker } from "./domain.mjs";

const schema = {
  name: "serenity_stock_post_analysis",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "mentionedStocks"],
    properties: {
      summary: { type: "string" },
      mentionedStocks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ticker", "companyName", "stance", "confidence", "reasons", "risks", "timeSensitivity", "actionSignal"],
          properties: {
            ticker: { type: "string" },
            companyName: { type: "string" },
            stance: { enum: ["bullish", "bearish", "neutral", "mixed"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reasons: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } },
            timeSensitivity: { enum: ["urgent", "soon", "normal", "long_term"] },
            actionSignal: { enum: ["watch", "strong_watch", "avoid", "context_only"] }
          }
        }
      }
    }
  },
  strict: true
} as const;

let aiDisabledUntil = 0;
const disabledModels = new Map<string, number>();

const stances: readonly Stance[] = ["bullish", "bearish", "neutral", "mixed"];
const timeSensitivities: readonly StockMentionAnalysis["timeSensitivity"][] = ["urgent", "soon", "normal", "long_term"];
const actionSignals: readonly ActionSignal[] = ["watch", "strong_watch", "avoid", "context_only"];

export async function analyzePost(body: string): Promise<PostAnalysis> {
  if (!process.env.DEEPSEEK_API_KEY || Date.now() < aiDisabledUntil) {
    return fallbackAnalysis(
      body,
      process.env.DEEPSEEK_API_KEY ? "DeepSeek is temporarily unavailable" : "DeepSeek API key is not configured"
    );
  }

  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    maxRetries: 1,
    timeout: Number(process.env.DEEPSEEK_TIMEOUT_MS || 20_000)
  });
  try {
    const text = await completeWithDeepSeekFallback(client, [
      {
        role: "system",
        content:
          `Extract stock mentions from Serenity's X post. Return cautious, decision-support analysis only. Do not claim this is financial advice. Important: CPO means co-packaged optics, an AI hardware/photonics concept, not a stock ticker; never include CPO in mentionedStocks. Return json only in this exact shape: ${JSON.stringify(schema.schema)}`
      },
      {
        role: "user",
        content: body
      }
    ], 1400);

    return normalizeAnalysis(JSON.parse(extractJson(text)));
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (status === 401 || code === "invalid_api_key") {
      aiDisabledUntil = Date.now() + 10 * 60 * 1000;
    }
    console.error("[deepseek] Falling back to rule-based analysis", {
      status: status || undefined,
      code: code || undefined
    });
    return fallbackAnalysis(body, "DeepSeek analysis failed; using rule-based fallback");
  }
}

async function completeWithDeepSeekFallback(
  client: OpenAI,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  maxTokens: number
) {
  let lastError: unknown;
  for (const model of deepSeekModels()) {
    const disabledUntil = disabledModels.get(model) || 0;
    if (Date.now() < disabledUntil) continue;

    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
        max_tokens: maxTokens
      });
      const content = response.choices[0]?.message?.content?.trim();
      if (content) return content;
      lastError = new Error(`${model} returned empty analysis content`);
      disabledModels.set(model, Date.now() + 10 * 60 * 1000);
      console.warn("[deepseek] Model returned empty content", { model });
    } catch (error) {
      lastError = error;
      console.warn("[deepseek] Model failed", {
        model,
        message: error instanceof Error ? error.message : "unknown"
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("DeepSeek analysis failed");
}

function deepSeekModels() {
  const configured = process.env.DEEPSEEK_MODEL?.trim();
  const fallbacks = ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat"];
  return Array.from(new Set([configured, ...fallbacks].filter((model): model is string => Boolean(model))));
}

function fallbackAnalysis(body: string, risk: string): PostAnalysis {
  const tickers = extractTickers(body);
  return {
    summary: body.length > 180 ? `${body.slice(0, 177)}...` : body,
    mentionedStocks: tickers.map((ticker) => ({
      ticker,
      companyName: "",
      stance: "neutral",
      confidence: 0.35,
      reasons: ["Ticker detected by rule-based fallback"],
      risks: [risk],
      timeSensitivity: "normal",
      actionSignal: "watch"
    }))
  };
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return extractJson(fenced[1]);

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  throw new Error("DeepSeek returned non-JSON content");
}

function normalizeAnalysis(value: unknown): PostAnalysis {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const stocks = Array.isArray(input.mentionedStocks) ? input.mentionedStocks : [];

  const mentionedStocks: StockMentionAnalysis[] = stocks
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      ticker: stringOr(item.ticker, "").replace(/^\$/, "").toUpperCase(),
      companyName: stringOr(item.companyName, ""),
      stance: enumOr(item.stance, stances, "neutral"),
      confidence: numberBetween(item.confidence, 0, 1, 0.5),
      reasons: stringArrayOr(item.reasons, ["AI identified this ticker in the post"]),
      risks: stringArrayOr(item.risks, ["Review the original post before making any decision"]),
      timeSensitivity: enumOr<StockMentionAnalysis["timeSensitivity"]>(
        item.timeSensitivity,
        timeSensitivities,
        "normal"
      ),
      actionSignal: enumOr(item.actionSignal, actionSignals, "watch")
    }))
    .filter((item) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(item.ticker) && isStockTicker(item.ticker));

  return {
    summary: stringOr(input.summary, "AI analysis did not include a summary."),
    mentionedStocks
  };
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArrayOr(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return strings.length ? strings.map((item) => item.trim()).slice(0, 8) : fallback;
}

function numberBetween(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
