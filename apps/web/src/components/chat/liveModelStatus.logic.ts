import type { ModelContextBreakdown } from "@t3tools/contracts";

type LiveRequest = NonNullable<ModelContextBreakdown["live"]>;

const compact = (count: number) =>
  count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}K` : String(count);

/**
 * What the local model is doing in this thread right now: reading the prompt before its first
 * token, then writing at a measured rate. Null once the request has finished.
 */
export function liveModelStatus(
  live: LiveRequest | undefined,
  now: number,
  writingLabel = "Thinking",
): string | null {
  if (!live || live.finishedAt !== null) return null;
  if (live.firstTokenAt === null) {
    const seconds = Math.max(0, Math.round((now - live.startedAt) / 1000));
    return `Reading the prompt · ${compact(live.promptTokens)} tokens · ${seconds}s`;
  }
  // The server's own token times: the count reaches the client a few seconds late.
  const span = (live.lastTokenAt ?? live.firstTokenAt) - live.firstTokenAt;
  const rate = live.tokens > 1 && span > 0 ? Math.round(((live.tokens - 1) * 1000) / span) : 0;
  return `${writingLabel} · ${compact(live.tokens)} tokens${rate > 0 ? ` · ${rate} tok/s` : ""}`;
}
