// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalFetch:off
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import { describe, expect, it } from "vite-plus/test";

import { makeThinkingWatch, streamChatCompletion, withoutThinking } from "./L3ChatStream.ts";

const sse = (delta: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;

describe("makeThinkingWatch", () => {
  it("trips once thinking passes the budget with no answer", () => {
    const watch = makeThinkingWatch(3);
    expect(watch.push(sse({ reasoning: "a" }) + sse({ reasoning: "b" }))).toBe(false);
    expect(watch.push(sse({ reasoning: "c" }))).toBe(false);
    expect(watch.push(sse({ reasoning: "d" }))).toBe(true);
  });

  it("never trips once the reply starts answering", () => {
    const watch = makeThinkingWatch(1);
    expect(watch.push(sse({ reasoning: "a" }) + sse({ content: "Hi" }))).toBe(false);
    expect(watch.push(sse({ reasoning: "b" }) + sse({ reasoning: "c" }))).toBe(false);
  });
});

it("withoutThinking asks for the same reply with reasoning off", () => {
  const body = Buffer.from(JSON.stringify({ model: "m", messages: [], reasoning_effort: "high" }));
  expect(JSON.parse(withoutThinking(body)!.toString())).toEqual({
    model: "m",
    messages: [],
    reasoning_effort: "none",
  });
});

/** A model that thinks without end unless asked not to, then answers with a tool call. */
async function withFakeModel<T>(run: (upstream: URL, bodies: string[]) => Promise<T>) {
  const bodies: string[] = [];
  const model = NodeHttp.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      bodies.push(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (JSON.parse(body).reasoning_effort === "none") {
        response.end(
          sse({
            tool_calls: [
              { index: 0, function: { name: "read", arguments: '{"path":"a","start":2,"end":3}' } },
            ],
          }) + "data: [DONE]\n\n",
        );
        return;
      }
      const timer = setInterval(() => response.write(sse({ reasoning: "hmm" })), 1);
      response.on("close", () => clearInterval(timer));
    });
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  try {
    return await run(
      new URL(`http://127.0.0.1:${(model.address() as NodeNet.AddressInfo).port}/v1`),
      bodies,
    );
  } finally {
    model.closeAllConnections();
    model.close();
  }
}

describe("streamChatCompletion", () => {
  it("cuts runaway thinking and streams a reply without thinking in its place", async () => {
    await withFakeModel(async (upstream, bodies) => {
      let cuts = 0;
      const proxy = NodeHttp.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () =>
          streamChatCompletion({
            upstream,
            request,
            response,
            body: Buffer.concat(chunks),
            thinkingBudget: 20,
            onThinkingCut: () => cuts++,
          }),
        );
      });
      await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      try {
        const port = (proxy.address() as NodeNet.AddressInfo).port;
        const reply = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: "POST",
          body: JSON.stringify({ model: "m", messages: [] }),
        }).then((response) => response.text());
        expect(cuts).toBe(1);
        expect(bodies.map((body) => JSON.parse(body).reasoning_effort)).toEqual([
          undefined,
          "none",
        ]);
        // Every event still parses, and the retried read call arrives repaired.
        const events = reply.split("\n").filter((line) => line.startsWith("data: {"));
        for (const event of events) expect(() => JSON.parse(event.slice(6))).not.toThrow();
        expect(reply).toContain('\\"offset\\":2,\\"limit\\":2');
        expect(reply.trimEnd().endsWith("data: [DONE]")).toBe(true);
      } finally {
        proxy.close();
      }
    });
  });
});
