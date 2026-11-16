import { expect, it } from "vite-plus/test";

import { liveModelStatus } from "./liveModelStatus.logic";

const live = {
  startedAt: 10_000,
  firstTokenAt: null,
  lastTokenAt: null,
  finishedAt: null,
  promptTokens: 25_400,
  tokens: 0,
};

it("says the model is reading the prompt until its first token, then counts what it writes", () => {
  expect(liveModelStatus(live, 22_000)).toBe("Reading the prompt · 25K tokens · 12s");
  expect(
    liveModelStatus({ ...live, firstTokenAt: 30_000, lastTokenAt: 40_000, tokens: 411 }, 43_000),
  ).toBe("Thinking · 411 tokens · 41 tok/s");
  expect(
    liveModelStatus(
      { ...live, firstTokenAt: 30_000, lastTokenAt: 60_000, tokens: 1_201 },
      61_000,
      "Writing",
    ),
  ).toBe("Writing · 1.2K tokens · 40 tok/s");
  // A finished request, or a thread Onyx has no numbers for, falls back to the plain label.
  expect(liveModelStatus({ ...live, finishedAt: 50_000 }, 60_000)).toBeNull();
  expect(liveModelStatus(undefined, 60_000)).toBeNull();
});
