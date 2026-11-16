/**
 * Ollama's OpenAI endpoint honors `max_tokens` but ignores `max_completion_tokens`, the field
 * OpenCode sends, so Onyx's configured output cap never reached the model and one reply ran to
 * 26K tokens of thinking. Copies the cap into the field Ollama reads; other bodies pass unchanged.
 */
export function ollamaChatRequestBody(body: Buffer): Buffer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return body;
  const request = parsed as Record<string, unknown>;
  if (typeof request.max_completion_tokens !== "number" || request.max_tokens !== undefined) {
    return body;
  }
  return Buffer.from(JSON.stringify({ ...request, max_tokens: request.max_completion_tokens }));
}
