export function extractTickers(text: string): string[];
export function isStockTicker(value: string): boolean;

export function toIsoDate(input?: string | Date | null): string;

export function summarizeMentionWindow(
  mentions: Array<{ ticker?: string; mentionedAt?: string; mentioned_at?: string }>,
  now?: Date,
  windowHours?: number
): Array<{
  ticker: string;
  totalMentionCount: number;
  recentMentionCount: number;
  lastMentionedAt: string | null;
}>;

export function mergeProfileWithMentions<T extends { ticker: string }>(
  profile: T,
  mentionStats: Array<{
    ticker: string;
    totalMentionCount: number;
    recentMentionCount: number;
    lastMentionedAt: string | null;
  }>
): T & {
  totalMentionCount: number;
  recentMentionCount: number;
  lastMentionedAt: string | null;
};

export function signalFromMention(mention: {
  confidence?: number;
  stance?: string;
  actionSignal?: string;
  action_signal?: string;
}): number;
