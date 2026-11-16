import { describe, expect, it } from "vite-plus/test";

import { repairReadArguments, repairSseLine } from "./L3ToolCallRepair.ts";

describe("repairReadArguments", () => {
  it.each([
    [
      { path: "a.ts", start: "140", end: "160" },
      { path: "a.ts", offset: 140, limit: 21 },
    ],
    [
      { path: "a.ts", startLine: 10, endLine: 12 },
      { path: "a.ts", offset: 10, limit: 3 },
    ],
    [
      { path: "a.ts", lines: "5-9" },
      { path: "a.ts", offset: 5, limit: 5 },
    ],
    [
      { path: "a.ts", offset: "40", limit: "20" },
      { path: "a.ts", offset: 40, limit: 20 },
    ],
    [
      { filePath: "a.ts", start: 3 },
      { path: "a.ts", offset: 3 },
    ],
    [
      { path: "a.ts", end: 50 },
      { path: "a.ts", limit: 50 },
    ],
  ])("maps %j to offset and limit", (input, expected) => {
    expect(repairReadArguments(input)).toEqual(expected);
  });

  it("leaves calls OpenCode already understands", () => {
    expect(repairReadArguments({ path: "a.ts" })).toBeNull();
    expect(repairReadArguments({ path: "a.ts", offset: 5, limit: 10 })).toBeNull();
  });

  it("drops an end before the start rather than guessing a length", () => {
    expect(repairReadArguments({ path: "a.ts", start: 90, end: 10 })).toEqual({
      path: "a.ts",
      offset: 90,
    });
  });
});

const sseCall = (name: string, args: string) =>
  `data: ${JSON.stringify({
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { id: "c1", index: 0, type: "function", function: { name, arguments: args } },
          ],
        },
      },
    ],
  })}`;

describe("repairSseLine", () => {
  it("rewrites a streamed read call", () => {
    const line = repairSseLine(sseCall("read", '{"path":"a.ts","start":"140","end":"160"}'));
    const args = JSON.parse(line.slice(5)).choices[0].delta.tool_calls[0].function.arguments;
    expect(JSON.parse(args)).toEqual({ path: "a.ts", offset: 140, limit: 21 });
  });

  it("passes other lines through byte for byte", () => {
    const grep = sseCall("grep", '{"pattern":"x","start":"1"}');
    const fragment = sseCall("read", '{"path":"a.ts","sta');
    const text = 'data: {"choices":[{"delta":{"content":"hi"}}]}';
    expect(repairSseLine(grep)).toBe(grep);
    expect(repairSseLine(fragment)).toBe(fragment);
    expect(repairSseLine(text)).toBe(text);
    expect(repairSseLine("data: [DONE]")).toBe("data: [DONE]");
  });
});
