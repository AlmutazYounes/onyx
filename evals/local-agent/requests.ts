export interface ModelRequest {
  readonly model: string;
  readonly messages: number;
  readonly tools: number;
  /** What the request asked of the model's reasoning, when it said. */
  readonly reasoningEffort: string | null;
  readonly promptChars: number;
  /** Characters this prompt shares with the previous request's, from the start. */
  readonly sharedPrefixChars: number;
  /** Text where this prompt first differs from the previous one, when it rewrote earlier history. */
  readonly divergence: string | null;
  readMs: number | null;
  writeMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Replies cut for thinking too long and asked again without thinking. */
  thinkingCuts: number;
}

// Reading a fresh prompt runs near 1,000 tok/s on Apple Silicon; a reused prefix is far faster.
const REUSED_READ_TOKENS_PER_SECOND = 4_000;

/** A request reused the cached prompt when Ollama read it much faster than fresh tokens allow. */
export const reusedPrompt = (request: ModelRequest) =>
  request.promptTokens !== null &&
  request.readMs !== null &&
  request.promptTokens > 500 &&
  (request.promptTokens * 1000) / Math.max(1, request.readMs) >= REUSED_READ_TOKENS_PER_SECOND;

/** Compaction summaries carry no tools and a long prompt; titles carry no tools and a short one. */
export const isCompaction = (request: ModelRequest) =>
  request.tools === 0 && (request.promptTokens ?? 0) > 4_000;

export function summarizeRequests(requests: ReadonlyArray<ModelRequest>) {
  const written = requests.reduce((sum, request) => sum + (request.completionTokens ?? 0), 0);
  const writeMs = requests.reduce((sum, request) => sum + (request.writeMs ?? 0), 0);
  return {
    requests: requests.length,
    compactions: requests.filter(isCompaction).length,
    maxPromptTokens: Math.max(0, ...requests.map((request) => request.promptTokens ?? 0)),
    /** The longest single reply; a runaway one can eat the whole time limit. */
    maxCompletionTokens: Math.max(0, ...requests.map((request) => request.completionTokens ?? 0)),
    thinkingCuts: requests.reduce((sum, request) => sum + (request.thinkingCuts ?? 0), 0),
    // The first request has nothing to reuse.
    reusedRequests: requests.slice(1).filter(reusedPrompt).length,
    readMs: requests.reduce((sum, request) => sum + (request.readMs ?? 0), 0),
    promptTokens: requests.reduce((sum, request) => sum + (request.promptTokens ?? 0), 0),
    completionTokens: written,
    writeTokensPerSecond: writeMs > 0 ? (written * 1000) / writeMs : null,
  };
}
