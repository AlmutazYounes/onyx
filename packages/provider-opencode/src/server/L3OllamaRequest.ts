/**
 * Fits OpenCode's chat requests to Ollama: copies `max_completion_tokens` (ignored by Ollama) into
 * `max_tokens`, and sends compaction requests without tools or thinking. Laguna kept working instead
 * of summarizing (2 of 6 replays valid without tools, 10 of 10 with thinking off too).
 */
export function ollamaChatRequestBody(body: Buffer): Buffer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return body;
  let request = parsed as Record<string, unknown>;
  let changed = false;
  if (typeof request.max_completion_tokens === "number" && request.max_tokens === undefined) {
    request = { ...request, max_tokens: request.max_completion_tokens };
    changed = true;
  }
  if (request.tools !== undefined && isCompactionRequest(request)) {
    request = { ...request, reasoning_effort: "none" };
    delete request.tools;
    delete request.tool_choice;
    delete request.parallel_tool_calls;
    changed = true;
  }
  return changed ? Buffer.from(JSON.stringify(request)) : body;
}

// OpenCode 2.3's compaction prompts: a first summary, an update of an earlier one, and its retry.
const COMPACTION_PROMPTS = [
  "You MUST summarize the conversation above into a structured summary",
  "Update the existing checkpoint in the conversation above into one consolidated summary",
  "The previous response did not fill in the required summary template",
];

/** Whether the request's last message is OpenCode asking for a summary of the thread. */
function isCompactionRequest(request: Record<string, unknown>): boolean {
  const messages = request.messages;
  if (!Array.isArray(messages)) return false;
  const last: unknown = messages.at(-1);
  if (typeof last !== "object" || last === null) return false;
  const { role, content } = last as { role?: unknown; content?: unknown };
  if (role !== "user") return false;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part: unknown) =>
              typeof part === "object" && part !== null && "text" in part
                ? String((part as { text: unknown }).text)
                : "",
            )
            .join("")
        : "";
  return COMPACTION_PROMPTS.some((prompt) => text.trimStart().startsWith(prompt));
}
