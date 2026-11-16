import type { LocalModelInfo, LocalModelsSnapshot } from "@t3tools/contracts";

export type SpeedSource = "measured" | "in use" | "estimate";
export interface Speed {
  readonly tokensPerSecond: number;
  readonly source: SpeedSource;
}

/** A typical agent turn re-reads a prompt this long before it writes anything. */
export const AGENT_PROMPT_TOKENS = 15_000;
export const ANSWER_TOKENS = 1_000;

export function writingSpeed(model: LocalModelInfo): Speed | null {
  if (model.benchmark?.generationTokensPerSecond)
    return { tokensPerSecond: model.benchmark.generationTokensPerSecond, source: "measured" };
  if (model.inUse) return { tokensPerSecond: model.inUse.tokensPerSecond, source: "in use" };
  if (model.estimatedGenerationTokensPerSecond)
    return { tokensPerSecond: model.estimatedGenerationTokensPerSecond, source: "estimate" };
  return null;
}

export function readingSpeed(model: LocalModelInfo): Speed | null {
  if (model.benchmark?.promptTokensPerSecond)
    return { tokensPerSecond: model.benchmark.promptTokensPerSecond, source: "measured" };
  if (model.estimatedPromptTokensPerSecond)
    return { tokensPerSecond: model.estimatedPromptTokensPerSecond, source: "estimate" };
  return null;
}

export type MemoryFit = "fits" | "tight" | "too big";

/** Half of memory leaves room for a browser, an editor and chat apps; past the GPU budget it swaps. */
export function memoryFit(memoryBytes: number, host: LocalModelsSnapshot["host"]): MemoryFit {
  if (memoryBytes <= host.totalMemoryBytes / 2) return "fits";
  return memoryBytes <= host.gpuMemoryBudgetBytes ? "tight" : "too big";
}

export function formatDuration(seconds: number) {
  if (seconds < 1) return "under 1 s";
  if (seconds < 90) return `~${Math.round(seconds)} s`;
  return `~${Math.round(seconds / 60)} min`;
}

export function formatCount(count: number) {
  if (count >= 1e9) return `${(count / 1e9).toFixed(count >= 1e10 ? 1 : 2).replace(/\.?0+$/, "")}B`;
  if (count >= 1e6) return `${Math.round(count / 1e6)}M`;
  return `${Math.round(count / 1e3)}K`;
}

export const formatTokens = (tokens: number) =>
  tokens >= 1024 && tokens % 1024 === 0 ? `${tokens / 1024}K` : formatCount(tokens);

export const formatRate = (tokensPerSecond: number) =>
  tokensPerSecond >= 100 ? Math.round(tokensPerSecond / 10) * 10 : Math.round(tokensPerSecond);
