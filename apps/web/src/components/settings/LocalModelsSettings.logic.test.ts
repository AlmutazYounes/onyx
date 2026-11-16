import type { LocalModelInfo } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatCount,
  formatDuration,
  formatTokens,
  memoryFit,
  readingSpeed,
  writingSpeed,
} from "./LocalModelsSettings.logic";

const model = (overrides: Partial<LocalModelInfo>) =>
  ({
    benchmark: null,
    inUse: null,
    estimatedGenerationTokensPerSecond: null,
    estimatedPromptTokensPerSecond: null,
    ...overrides,
  }) as LocalModelInfo;
const benchmark = {
  measuredAt: 1,
  promptTokensPerSecond: 900,
  generationTokensPerSecond: 50,
  promptTokens: 4000,
  generatedTokens: 256,
  loadMs: 0,
};

describe("speeds", () => {
  it("prefers a measurement, then what agents saw, then an estimate", () => {
    const inUse = { measuredAt: 1, tokensPerSecond: 40 };
    expect(writingSpeed(model({ benchmark, inUse }))).toEqual({
      tokensPerSecond: 50,
      source: "measured",
    });
    expect(writingSpeed(model({ inUse, estimatedGenerationTokensPerSecond: 60 }))).toEqual({
      tokensPerSecond: 40,
      source: "in use",
    });
    expect(writingSpeed(model({ estimatedGenerationTokensPerSecond: 60 }))?.source).toBe(
      "estimate",
    );
    expect(writingSpeed(model({}))).toBeNull();
    expect(readingSpeed(model({ estimatedPromptTokensPerSecond: 700 }))).toEqual({
      tokensPerSecond: 700,
      source: "estimate",
    });
  });
});

it("rates memory fit against half of memory and the GPU budget", () => {
  const host = { chip: "", totalMemoryBytes: 32e9, gpuMemoryBudgetBytes: 21e9 };
  expect(memoryFit(14e9, host)).toBe("fits");
  expect(memoryFit(20e9, host)).toBe("tight");
  expect(memoryFit(24e9, host)).toBe("too big");
});

it("formats counts, context sizes and durations", () => {
  expect(formatCount(34_660_610_688)).toBe("34.7B");
  expect(formatCount(3_454_988_928)).toBe("3.45B");
  expect(formatCount(8e9)).toBe("8B");
  expect(formatTokens(65_536)).toBe("64K");
  expect(formatDuration(0.4)).toBe("under 1 s");
  expect(formatDuration(15.4)).toBe("~15 s");
  expect(formatDuration(200)).toBe("~3 min");
});
