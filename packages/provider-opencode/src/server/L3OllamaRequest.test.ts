import { describe, expect, it } from "vite-plus/test";

import { ollamaChatRequestBody } from "./L3OllamaRequest.ts";

const body = (value: unknown) => Buffer.from(JSON.stringify(value));
const parsed = (buffer: Buffer) => JSON.parse(buffer.toString("utf8"));

describe("ollamaChatRequestBody", () => {
  it("copies OpenCode's output cap into the field Ollama reads", () => {
    const request = { model: "onyx-qwen", messages: [], max_completion_tokens: 16_384 };
    expect(parsed(ollamaChatRequestBody(body(request)))).toEqual({
      ...request,
      max_tokens: 16_384,
    });
  });

  it("leaves bodies that already set max_tokens, or set no cap, byte for byte", () => {
    for (const request of [
      body({ model: "m", max_tokens: 10, max_completion_tokens: 20 }),
      body({ model: "m", messages: [] }),
      Buffer.from("not json"),
    ]) {
      expect(ollamaChatRequestBody(request)).toBe(request);
    }
  });

  it("sends OpenCode's compaction requests without tools or thinking", () => {
    const tools = [{ type: "function", function: { name: "read" } }];
    const history = [
      { role: "user", content: "Document the server files" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function" }] },
      { role: "tool", tool_call_id: "c1", content: "Read file a.ts, lines 1-20" },
    ];
    for (const prompt of [
      "You MUST summarize the conversation above into a structured summary that will be given…",
      "Update the existing checkpoint in the conversation above into one consolidated summary.",
      "The previous response did not fill in the required summary template. Do not call tools.",
    ]) {
      const request = {
        model: "onyx-laguna",
        messages: [...history, { role: "user", content: [{ type: "text", text: prompt }] }],
        tools,
        tool_choice: "auto",
      };
      const { tools: _, tool_choice: __, ...rest } = request;
      expect(parsed(ollamaChatRequestBody(body(request)))).toEqual({
        ...rest,
        reasoning_effort: "none",
      });
    }
    const working = body({ model: "m", messages: history, tools });
    expect(ollamaChatRequestBody(working)).toBe(working);
  });
});
