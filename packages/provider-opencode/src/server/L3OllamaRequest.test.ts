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
});
