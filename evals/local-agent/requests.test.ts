import { describe, expect, it } from "vite-plus/test";

import { reusedPrompt, summarizeRequests, type ModelRequest } from "./requests.ts";

const request = (overrides: Partial<ModelRequest>): ModelRequest => ({
  model: "onyx-qwen",
  messages: 2,
  tools: 13,
  reasoningEffort: null,
  promptChars: 50_000,
  sharedPrefixChars: 0,
  divergence: null,
  readMs: 12_000,
  writeMs: 2_000,
  promptTokens: 12_000,
  completionTokens: 100,
  thinkingCuts: 0,
  ...overrides,
});

describe("local agent request summary", () => {
  it("counts a prompt as reused only when it was read far faster than fresh tokens", () => {
    expect(reusedPrompt(request({ readMs: 12_000 }))).toBe(false);
    expect(reusedPrompt(request({ readMs: 300 }))).toBe(true);
    // Short prompts read fast either way, so they say nothing about the cache.
    expect(reusedPrompt(request({ promptTokens: 400, readMs: 10 }))).toBe(false);
    expect(reusedPrompt(request({ promptTokens: null }))).toBe(false);
  });

  it("counts long tool-less requests as compaction summaries, not titles", () => {
    expect(
      summarizeRequests([
        request({}),
        request({ tools: 0, promptTokens: 300 }),
        request({ tools: 0, promptTokens: 30_000 }),
      ]).compactions,
    ).toBe(1);
  });

  it("skips the first request, which has nothing to reuse", () => {
    expect(
      summarizeRequests([
        request({ readMs: 300 }),
        request({ readMs: 300 }),
        request({ readMs: 9_000 }),
      ]),
    ).toEqual({
      requests: 3,
      compactions: 0,
      maxPromptTokens: 12_000,
      maxCompletionTokens: 100,
      thinkingCuts: 0,
      reusedRequests: 1,
      readMs: 9_600,
      promptTokens: 36_000,
      completionTokens: 300,
      writeTokensPerSecond: 50,
    });
  });
});
