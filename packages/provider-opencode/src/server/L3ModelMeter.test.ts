import { describe, expect, it } from "vite-plus/test";

import { threadKeyOf } from "./L3ContextBreakdown.ts";
import {
  planL3ModelRenames,
  readL3ModelContext,
  recordChatRequest,
  isOllamaModelLoaded,
  keepWarmTarget,
  makeSseTokenParser,
  makeTokenRateMeter,
  readL3WorkingDirectory,
  recordWorkingDirectory,
} from "./L3ModelMeter.ts";

const chunk = (delta: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

describe("Onyx model meter", () => {
  it("rates streamed tokens live, then keeps the finished stream's rate", () => {
    const meter = makeTokenRateMeter();
    let now = 1_000;
    const ends: unknown[] = [];
    const parser = makeSseTokenParser(
      meter.begin(),
      () => now,
      (usage) => ends.push(usage),
    );

    // Prompt processing: no tokens yet, so nothing is generating.
    parser.push(": keep-alive\n\n");
    expect(meter.read(now)).toEqual({ generating: false, tokensPerSecond: null });

    // Reasoning, content and tool-call deltas each count; split lines still parse.
    parser.push(chunk({ reasoning: "Let" }));
    now += 100;
    parser.push(chunk({ content: "Hi" }).slice(0, 10));
    parser.push(chunk({ content: "Hi" }).slice(10));
    now += 100;
    parser.push(chunk({ tool_calls: [{ index: 0 }] }));
    parser.push(chunk({ role: "assistant" }));
    expect(meter.read(now)).toEqual({ generating: true, tokensPerSecond: 10 });

    // A stream waiting on a tool is not generating.
    expect(meter.read(now + 2_000).generating).toBe(false);

    // The final usage count wins over counted chunks.
    parser.push(`data: ${JSON.stringify({ choices: [], usage: { completion_tokens: 5 } })}\n\n`);
    parser.push("data: [DONE]\n\n");
    parser.end();
    expect(meter.read(now + 5_000)).toEqual({ generating: false, tokensPerSecond: 20 });
    expect(ends).toEqual([{ promptTokens: null, tokens: 5, tokensPerSecond: 20 }]);
  });

  it("sums concurrent streams", () => {
    const meter = makeTokenRateMeter();
    const first = meter.begin();
    const second = meter.begin();
    for (const at of [0, 100, 200]) first.token(at);
    for (const at of [0, 50, 100, 150, 200]) second.token(at);
    expect(meter.read(200)).toEqual({ generating: true, tokensPerSecond: 30 });
  });

  it("knows the agent's directory only while one project is active", () => {
    const request = (directory: string) => ({
      messages: [{ role: "system", content: `<env>\n  Working directory: ${directory}\n</env>` }],
    });
    recordWorkingDirectory(request("/work/app"), 0);
    expect(readL3WorkingDirectory(1_000)).toBe("/work/app");
    // Two projects at once: a tool call cannot say which one it belongs to.
    recordWorkingDirectory(request("/work/site"), 2_000);
    expect(readL3WorkingDirectory(3_000)).toBeNull();
    // Ten minutes later only the newer project is still active.
    expect(readL3WorkingDirectory(2_000 + 10 * 60_000)).toBe("/work/site");
  });

  it("keeps the model warm only for half an hour after agents last used it", () => {
    expect(keepWarmTarget(null, 0)).toBeNull();
    const last = { model: "onyx-qwen", at: 1_000 };
    expect(keepWarmTarget(last, 1_000 + 29 * 60_000)).toBe("onyx-qwen");
    expect(keepWarmTarget(last, 1_000 + 31 * 60_000)).toBeNull();
    // A model the user unloaded is not reloaded behind their back.
    expect(isOllamaModelLoaded({ models: [{ name: "onyx-qwen:latest" }] }, "onyx-qwen")).toBe(true);
    expect(isOllamaModelLoaded({ models: [] }, "onyx-qwen")).toBe(false);
    // Loaded before the rename, it still runs under its old name.
    expect(isOllamaModelLoaded({ models: [{ name: "l3-coder:latest" }] }, "onyx-qwen")).toBe(true);
    expect(isOllamaModelLoaded(null, "onyx-qwen")).toBe(false);
  });

  it("renames old installs without touching models already moved", () => {
    expect(planL3ModelRenames(new Set(["l3-coder", "l3-laguna"]))).toEqual([
      { legacy: "l3-coder", current: "onyx-qwen", copy: true },
      { legacy: "l3-laguna", current: "onyx-laguna", copy: true },
    ]);
    // A half-finished rename only drops the old name; a fresh install has nothing to do.
    expect(planL3ModelRenames(new Set(["l3-coder", "onyx-qwen"]))).toEqual([
      { legacy: "l3-coder", current: "onyx-qwen", copy: false },
    ]);
    expect(planL3ModelRenames(new Set(["onyx-qwen"]))).toEqual([]);
  });

  it("follows a thread's request from reading the prompt to the last token", () => {
    const threadId = "thread:live-1";
    const hooks = recordChatRequest({
      model: "onyx-qwen",
      messages: [
        {
          role: "system",
          content: [
            "# Code Mode",
            "",
            "## Code Mode tools (call only inside `execute`)",
            "",
            `- t3-code-${threadKeyOf(threadId)} (1 tools, 1 shown)`,
            `  - tools.t3-code-${threadKeyOf(threadId)}.list_threads({}): Promise<void>`,
            "",
          ].join("\n"),
        },
        { role: "user", content: "Hi." },
      ],
      tools: [{ type: "function", function: { name: "read" } }],
    });
    expect(readL3ModelContext(threadId)?.live).toMatchObject({ firstTokenAt: null, tokens: 0 });
    hooks.onToken?.(5_000);
    hooks.onToken?.(5_100);
    expect(readL3ModelContext(threadId)?.live).toMatchObject({
      firstTokenAt: 5_000,
      lastTokenAt: 5_100,
      tokens: 2,
    });
    hooks.onEnd({ promptTokens: 1_234, tokens: 40, tokensPerSecond: 20 });
    expect(readL3ModelContext(threadId)?.live).toMatchObject({ promptTokens: 1_234, tokens: 40 });
    expect(readL3ModelContext(threadId)?.live?.finishedAt).not.toBeNull();
  });
});
