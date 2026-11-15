import type {
  ModelContextBreakdown,
  ModelContextCategoryId,
  ModelContextTool,
} from "@t3tools/contracts";

/**
 * Splits one OpenCode chat request into the parts that fill the model's context. OpenCode sends
 * everything in each request: the system prompt (with the skills catalog, instruction files and
 * the Code Mode tool catalog), the direct tool definitions, and the conversation.
 */
export interface ChatRequestShape {
  readonly charsByCategory: Readonly<Record<ModelContextCategoryId, number>>;
  readonly tools: ReadonlyArray<ModelContextTool>;
  readonly toolGroups: ModelContextBreakdown["toolGroups"];
  readonly memoryFiles: ReadonlyArray<string>;
  readonly outputReserveTokens: number;
  /** The thread's own T3 MCP server, `t3-code-<thread>`, names the thread. */
  readonly threadKey: string | null;
}

const T3_MCP_PREFIX = "t3-code-";
const GROUP_HEADER = /^\n?- (\S+) \((\d+) tools?(?:, \d+ shown)?\)/;
const GROUP_SPLIT = /(?=\n- \S+ \(\d+ tools?(?:, \d+ shown)?\))/;
const TOOL_ENTRY = /^ {2}- tools(?:\.[^.\s([]+|\["[^"]+"\])\.([A-Za-z0-9_]+)\(/gm;
const BUILT_IN_CODE_MODE_GROUP = "opencode";

const contentText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((part) =>
            typeof part === "object" && part !== null && "text" in part
              ? String((part as { text: unknown }).text)
              : JSON.stringify(part),
          )
          .join("\n")
      : content == null
        ? ""
        : JSON.stringify(content);

/** Removes `[start, end)` blocks found by `find` from `text`, returning the blocks and the rest. */
function cut(
  text: string,
  find: (text: string) => ReadonlyArray<{ start: number; end: number }>,
): { readonly blocks: ReadonlyArray<string>; readonly rest: string } {
  const ranges = find(text);
  let rest = "";
  let at = 0;
  for (const range of ranges) {
    rest += text.slice(at, range.start);
    at = range.end;
  }
  return {
    blocks: ranges.map((range) => text.slice(range.start, range.end)),
    rest: rest + text.slice(at),
  };
}

const skillsRanges = (text: string) => {
  const start = text.indexOf("<available_skills>");
  const end = text.indexOf("</available_skills>");
  return start === -1 || end === -1 ? [] : [{ start, end: end + "</available_skills>".length }];
};

const codeModeRanges = (text: string) => {
  const start = text.indexOf("## Code Mode tools");
  if (start === -1) return [];
  // The catalog runs until the next prose section, which starts with a blank line and no indent.
  const next = /\n\n(?![ -])/.exec(text.slice(start + 1));
  return [{ start, end: next ? start + 1 + next.index : text.length }];
};

const memoryRanges = (text: string) => {
  const ranges: Array<{ start: number; end: number }> = [];
  const marker = /^Instructions from: .+$/gm;
  for (let match = marker.exec(text); match; match = marker.exec(text)) {
    const rest = text.slice(match.index + match[0].length);
    const stop = /\nInstructions from: |\n\nToday's date:|\n<env>/.exec(rest);
    ranges.push({
      start: match.index,
      end: match.index + match[0].length + (stop ? stop.index : rest.length),
    });
  }
  return ranges;
};

export function analyzeChatRequest(body: unknown): ChatRequestShape | null {
  if (typeof body !== "object" || body === null) return null;
  const request = body as {
    messages?: ReadonlyArray<{ role?: string; content?: unknown }>;
    tools?: ReadonlyArray<{ function?: { name?: string; description?: string } }>;
    max_completion_tokens?: number;
    max_tokens?: number;
  };
  // Side requests (goal checks, titles, compaction summaries) carry no tools; they are not the
  // agent's context, so the panel keeps showing the last real turn.
  if (!Array.isArray(request.messages) || !request.tools?.length) return null;

  let systemText = "";
  let messageChars = 0;
  for (const message of request.messages) {
    // Non-system messages count whole, so tool calls and their results are included.
    if (message.role === "system") systemText += `${contentText(message.content)}\n`;
    else messageChars += JSON.stringify(message).length;
  }

  const skills = cut(systemText, skillsRanges);
  const codeMode = cut(skills.rest, codeModeRanges);
  const memory = cut(codeMode.rest, memoryRanges);

  const tools: ModelContextTool[] = [];
  let systemToolChars = 0;
  for (const tool of request.tools ?? []) {
    const name = tool.function?.name;
    if (!name) continue;
    systemToolChars += JSON.stringify(tool).length;
    tools.push({ name, kind: "system" });
  }

  // Code Mode groups: "- group (N tools[, M shown]) // ..." then "  - tools.group.name(..." or
  // '  - tools["group"].name(...'. Tools a group does not show load only when the model asks.
  let mcpToolChars = 0;
  let threadKey: string | null = null;
  const toolGroups: Array<ModelContextBreakdown["toolGroups"][number]> = [];
  for (const block of codeMode.blocks) {
    for (const group of block.split(GROUP_SPLIT)) {
      const header = GROUP_HEADER.exec(group);
      const name = header?.[1];
      if (!header || !name) {
        systemToolChars += group.length;
        continue;
      }
      const builtIn = name === BUILT_IN_CODE_MODE_GROUP;
      if (builtIn) systemToolChars += group.length;
      else mcpToolChars += group.length;
      if (name.startsWith(T3_MCP_PREFIX)) threadKey = name.slice(T3_MCP_PREFIX.length);
      let loaded = 0;
      for (const call of group.matchAll(TOOL_ENTRY)) {
        loaded++;
        tools.push({ name: `${name}.${call[1]}`, kind: builtIn ? "system" : "mcp", group: name });
      }
      toolGroups.push({ name, kind: builtIn ? "system" : "mcp", tools: Number(header[2]), loaded });
    }
  }

  for (const block of skills.blocks) {
    for (const id of block.matchAll(/<id>([^<]+)<\/id>/g)) {
      tools.push({ name: id[1]!.trim(), kind: "skill" });
    }
  }

  const memoryFiles = memory.blocks
    .map((block) => /^Instructions from: (.+)$/m.exec(block)?.[1]?.trim())
    .filter((path): path is string => path !== undefined);

  return {
    charsByCategory: {
      systemPrompt: memory.rest.length,
      systemTools: systemToolChars,
      mcpTools: mcpToolChars,
      skills: skills.blocks.reduce((sum, block) => sum + block.length, 0),
      memoryFiles: memory.blocks.reduce((sum, block) => sum + block.length, 0),
      messages: messageChars,
    },
    tools,
    toolGroups,
    memoryFiles,
    outputReserveTokens: request.max_completion_tokens ?? request.max_tokens ?? 0,
    threadKey,
  };
}

// Without a usage report, assume this many characters per token.
const CHARS_PER_TOKEN = 3.5;

/** Turns a request's shape plus the API's prompt token count into the panel's breakdown. */
export function toContextBreakdown(input: {
  readonly shape: ChatRequestShape;
  readonly promptTokens: number | null;
  readonly contextTokens: number;
  readonly measuredAt: number;
}): ModelContextBreakdown {
  const entries = Object.entries(input.shape.charsByCategory) as Array<
    [ModelContextCategoryId, number]
  >;
  const totalChars = entries.reduce((sum, [, chars]) => sum + chars, 0);
  const promptTokens = input.promptTokens ?? Math.round(totalChars / CHARS_PER_TOKEN);
  // Shares of the real token count, so the parts always add up to what the model saw.
  const categories = entries.map(([id, chars]) => ({
    id,
    tokens: totalChars > 0 ? Math.round((promptTokens * chars) / totalChars) : 0,
  }));
  return {
    measuredAt: input.measuredAt,
    exact: input.promptTokens !== null,
    contextTokens: input.contextTokens,
    usedTokens: promptTokens,
    outputReserveTokens: input.shape.outputReserveTokens,
    categories,
    tools: input.shape.tools,
    toolGroups: input.shape.toolGroups,
    memoryFiles: input.shape.memoryFiles,
  };
}

/** The same `t3-code-<thread>` key OpenCode sees, for threads whose ids fit in 64 characters. */
export const threadKeyOf = (threadId: string) => threadId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
