import OpenAI from "openai";

type TranslationItem = {
  id: string;
  text: string;
};

type TranslationResult = {
  id: string;
  zh: string;
};

const cache = new Map<string, string>();
const disabledModels = new Map<string, number>();

export async function translateToChinese(items: TranslationItem[]) {
  const output = new Map<string, string>();
  const pending = items
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter((item) => item.text && needsChineseTranslation(item.text));

  for (const item of pending) {
    const cached = cache.get(item.text);
    if (cached) output.set(item.id, cached);
  }

  const uncached = pending.filter((item) => !output.has(item.id)).slice(0, 40);
  if (!uncached.length || !process.env.DEEPSEEK_API_KEY) return output;

  try {
    const client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      maxRetries: 1,
      timeout: Number(process.env.DEEPSEEK_TIMEOUT_MS || 20_000)
    });

    const content = await completeWithDeepSeekFallback(client, [
      {
        role: "system",
        content:
          "Translate the provided X stock-monitoring text into concise, natural Simplified Chinese. Preserve ticker symbols, company names, percentages, numbers, and URLs. Return JSON only: {\"items\":[{\"id\":\"...\",\"zh\":\"...\"}]}"
      },
      {
        role: "user",
        content: JSON.stringify({ items: uncached })
      }
    ], 3000);

    let parsed: { items?: TranslationResult[] };
    try {
      parsed = JSON.parse(extractJson(content)) as { items?: TranslationResult[] };
    } catch (error) {
      console.warn("[translate] Batch translation returned invalid JSON; retrying items individually", {
        message: error instanceof Error ? error.message : "unknown"
      });
      await translateIndividually(client, uncached, output);
      return output;
    }

    for (const item of parsed.items || []) {
      if (!item.id || !item.zh) continue;
      const source = uncached.find((entry) => entry.id === item.id)?.text;
      if (source) cache.set(source, item.zh.trim());
      output.set(item.id, item.zh.trim());
    }
  } catch (error) {
    console.error("[translate] Chinese translation failed", {
      message: error instanceof Error ? error.message : "unknown"
    });
  }

  return output;
}

async function translateIndividually(
  client: OpenAI,
  items: TranslationItem[],
  output: Map<string, string>
) {
  for (const item of items) {
    try {
      const content = await completeWithDeepSeekFallback(client, [
        {
          role: "system",
          content:
            "Translate the provided X stock-monitoring text into concise, natural Simplified Chinese. Preserve ticker symbols, company names, percentages, numbers, and URLs. Return JSON only: {\"items\":[{\"id\":\"...\",\"zh\":\"...\"}]}"
        },
        {
          role: "user",
          content: JSON.stringify({ items: [item] })
        }
      ], 800);
      const parsed = JSON.parse(extractJson(content)) as { items?: TranslationResult[] };
      const translated = parsed.items?.find((entry) => entry.id === item.id)?.zh?.trim();
      if (!translated) continue;
      cache.set(item.text, translated);
      output.set(item.id, translated);
    } catch (error) {
      console.warn("[translate] Individual translation failed", {
        id: item.id,
        message: error instanceof Error ? error.message : "unknown"
      });
    }
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
      lastError = new Error(`${model} returned empty translation content`);
      disabledModels.set(model, Date.now() + 10 * 60 * 1000);
      console.warn("[translate] DeepSeek model returned empty content", { model });
    } catch (error) {
      lastError = error;
      console.warn("[translate] DeepSeek model failed", {
        model,
        message: error instanceof Error ? error.message : "unknown"
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("DeepSeek translation failed");
}

function deepSeekModels() {
  const configured = process.env.DEEPSEEK_MODEL?.trim();
  const fallbacks = ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat"];
  return Array.from(new Set([configured, ...fallbacks].filter((model): model is string => Boolean(model))));
}

export function needsChineseTranslation(text: string) {
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return latin > 4 && latin > han * 1.5;
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return extractJson(fenced[1]);

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  throw new Error("Translation returned non-JSON content");
}
