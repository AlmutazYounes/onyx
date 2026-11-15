import { describe, expect, it } from "vite-plus/test";

import { makeSseTokenParser, makeTokenRateMeter } from "./L3ModelMeter.ts";

const chunk = (delta: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

describe("L3 model meter", () => {
  it("rates streamed tokens live, then keeps the finished stream's rate", () => {
    const meter = makeTokenRateMeter();
    let now = 1_000;
    const parser = makeSseTokenParser(meter.begin(), () => now);

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
  });

  it("sums concurrent streams", () => {
    const meter = makeTokenRateMeter();
    const first = meter.begin();
    const second = meter.begin();
    for (const at of [0, 100, 200]) first.token(at);
    for (const at of [0, 50, 100, 150, 200]) second.token(at);
    expect(meter.read(200)).toEqual({ generating: true, tokensPerSecond: 30 });
  });
});
