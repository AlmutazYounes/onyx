import { describe, expect, it } from "vite-plus/test";

import { analyzeChatRequest, threadKeyOf, toContextBreakdown } from "./L3ContextBreakdown.ts";

const threadId = "thread:7f3c-01";
const system = [
  "You are an AI agent running in OpenCode.",
  "",
  "# Code Mode",
  "",
  "## Code Mode tools (call only inside `execute`)",
  "",
  "- opencode (1 tools) // Built in.",
  "  - tools.opencode.session_move({",
  "  directory: string,",
  "}): Promise<void> // Move a session.",
  `- t3-code-${threadKeyOf(threadId)} (71 tools, 2 shown)`,
  `  - tools.t3-code-${threadKeyOf(threadId)}.open_preview({ url: string }): Promise<void>`,
  `  - tools["t3-code-${threadKeyOf(threadId)}"].list_threads({}): Promise<void>`,
  "",
  "Skills provide specialized instructions.",
  "<available_skills>",
  "  <skill>",
  "    <id>pdf</id>",
  "    <description>Work with PDF files.</description>",
  "  </skill>",
  "</available_skills>",
  "",
  "Instructions from: /repo/AGENTS.md",
  "# Rules",
  "Be brief.",
  "",
  "",
  "Today's date: Sun Nov 15 2026",
  "<env>",
  "  Working directory: /repo",
  "</env>",
].join("\n");

const body = {
  model: "l3-coder",
  max_completion_tokens: 16_384,
  messages: [
    { role: "system", content: system },
    { role: "user", content: "Fix the bug." },
    { role: "assistant", content: "", tool_calls: [{ function: { name: "read" } }] },
  ],
  tools: [
    { type: "function", function: { name: "read", description: "Read a file." } },
    { type: "function", function: { name: "shell", description: "Run a command." } },
  ],
};

describe("analyzeChatRequest", () => {
  it("names the thread and sorts tools, skills and instruction files", () => {
    const shape = analyzeChatRequest(body)!;
    expect(shape.threadKey).toBe(threadKeyOf(threadId));
    expect(shape.outputReserveTokens).toBe(16_384);
    expect(shape.memoryFiles).toEqual(["/repo/AGENTS.md"]);
    expect(shape.toolGroups).toEqual([
      { name: "opencode", kind: "system", tools: 1, loaded: 1 },
      { name: `t3-code-${threadKeyOf(threadId)}`, kind: "mcp", tools: 71, loaded: 2 },
    ]);
    expect(shape.tools).toEqual([
      { name: "read", kind: "system" },
      { name: "shell", kind: "system" },
      { name: "opencode.session_move", kind: "system", group: "opencode" },
      {
        name: `t3-code-${threadKeyOf(threadId)}.open_preview`,
        kind: "mcp",
        group: `t3-code-${threadKeyOf(threadId)}`,
      },
      {
        name: `t3-code-${threadKeyOf(threadId)}.list_threads`,
        kind: "mcp",
        group: `t3-code-${threadKeyOf(threadId)}`,
      },
      { name: "pdf", kind: "skill" },
    ]);
    // Each part of the system prompt lands in exactly one category.
    const { charsByCategory } = shape;
    expect(charsByCategory.skills).toBeGreaterThan(0);
    expect(charsByCategory.memoryFiles).toBeGreaterThan(0);
    expect(charsByCategory.mcpTools).toBeGreaterThan(0);
    expect(
      charsByCategory.systemPrompt +
        charsByCategory.skills +
        charsByCategory.memoryFiles +
        charsByCategory.mcpTools +
        charsByCategory.systemTools -
        JSON.stringify(body.tools[0]).length -
        JSON.stringify(body.tools[1]).length,
    ).toBe(system.length + 1);
  });

  it("splits the reported prompt tokens so the parts add up", () => {
    const shape = analyzeChatRequest(body)!;
    const breakdown = toContextBreakdown({
      shape,
      promptTokens: 1_000,
      contextTokens: 65_536,
      measuredAt: 0,
    });
    expect(breakdown.exact).toBe(true);
    const sum = breakdown.categories.reduce((total, category) => total + category.tokens, 0);
    expect(Math.abs(sum - 1_000)).toBeLessThanOrEqual(breakdown.categories.length);
  });

  it("ignores requests that are not agent turns", () => {
    expect(analyzeChatRequest({ prompt: "hi" })).toBeNull();
    expect(analyzeChatRequest({ ...body, tools: [] })).toBeNull();
  });
});
