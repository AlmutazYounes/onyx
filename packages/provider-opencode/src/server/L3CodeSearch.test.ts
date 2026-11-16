import { describe, expect, it } from "vite-plus/test";

import { bestWindows, handleCodeSearchMcp, queryTerms, rankFiles } from "./L3CodeSearch.ts";

describe("Onyx code search", () => {
  it("splits identifiers and drops filler words", () => {
    expect(queryTerms("where is tokensPerSecond measured in the L3_MODEL meter")).toEqual([
      "tokenspersecond",
      "tokens",
      "per",
      "second",
      "measured",
      "l3_model",
      "model",
      "meter",
    ]);
    expect(queryTerms("how is it the")).toEqual([]);
  });

  it("ranks focused files above long or vendored files that mention every word", () => {
    const corpus = { files: 1000, averageBytes: 10_000 };
    const counts = (entries: Record<string, number>) => new Map(Object.entries(entries));
    const ranked = rankFiles(
      [
        // A huge component that mentions both words in passing.
        { path: "apps/web/Sidebar.tsx", bytes: 200_000, counts: counts({ token: 4, meter: 2 }) },
        { path: "src/server/TokenMeter.ts", bytes: 6_000, counts: counts({ token: 9, meter: 5 }) },
        { path: ".repos/lib/TokenMeter.ts", bytes: 6_000, counts: counts({ token: 9, meter: 5 }) },
        // Matches only one word, however often.
        { path: "src/tokens.ts", bytes: 6_000, counts: counts({ token: 40 }) },
      ],
      corpus,
      ["token", "meter"],
    );
    expect(ranked.map((file) => file.path)).toEqual([
      "src/server/TokenMeter.ts",
      ".repos/lib/TokenMeter.ts",
      "src/tokens.ts",
      "apps/web/Sidebar.tsx",
    ]);
  });

  it("returns the window with the matching definition, without overlapping repeats", () => {
    const text = [
      ...Array.from({ length: 40 }, (_, index) => `const filler${index} = ${index};`),
      "export function measureTokenRate(stream) {",
      "  return stream.tokens / stream.seconds;",
      "}",
    ].join("\n");
    const windows = bestWindows("meter.ts", text, ["token", "rate"], () => 1, 1);
    expect(windows[0]).toMatchObject({ path: "meter.ts", startLine: 16, endLine: 43 });
    expect(windows[0]!.lines.map((line) => line.number)).toEqual([41, 42]);
    expect(windows).toHaveLength(1);
  });

  it("speaks enough MCP for OpenCode to list and call the tool", async () => {
    expect(await handleCodeSearchMcp({ method: "notifications/initialized" })).toBeNull();
    expect(
      await handleCodeSearchMcp({ id: 1, method: "initialize", params: { protocolVersion: "x" } }),
    ).toMatchObject({ id: 1, result: { protocolVersion: "x", capabilities: { tools: {} } } });
    expect(await handleCodeSearchMcp({ id: 2, method: "tools/list" })).toMatchObject({
      result: { tools: [{ name: "codebase_search" }] },
    });
    // Without a directory the tool cannot know which project to search.
    expect(
      await handleCodeSearchMcp({
        id: 3,
        method: "tools/call",
        params: { name: "codebase_search", arguments: { query: "meter" } },
      }),
    ).toMatchObject({ result: { isError: true } });
    // Code Mode calls leave it out; Onyx then supplies the agent's working directory.
    const call = await handleCodeSearchMcp(
      {
        id: 4,
        method: "tools/call",
        params: { name: "codebase_search", arguments: { query: "meter" } },
      },
      () => "/nonexistent-onyx-search-dir",
    );
    expect(JSON.stringify(call)).toContain("Search failed");
  });
});
