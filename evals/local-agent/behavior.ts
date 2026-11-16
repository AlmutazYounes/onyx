/**
 * How the agent worked, from OpenCode's JSON events: what it cost in tool output and where it
 * wasted effort, so two runs with the same score can still be told apart.
 */

export interface ToolUse {
  readonly tool: string;
  readonly status: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: string;
}

export function toolUsesFromEvents(stdout: string): ToolUse[] {
  const uses: ToolUse[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        part?: {
          tool?: string;
          state?: { status?: string; input?: unknown; output?: unknown; error?: unknown };
        };
      };
      const part = event.part;
      if (event.type !== "tool_use" || !part?.tool) continue;
      const input = part.state?.input;
      const output = part.state?.output ?? part.state?.error;
      uses.push({
        tool: part.tool,
        status: part.state?.status ?? "unknown",
        input:
          typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {},
        output: typeof output === "string" ? output : "",
      });
    } catch {}
  }
  return uses;
}

const pathOf = (input: Readonly<Record<string, unknown>>) => {
  const path = input.path ?? input.filePath ?? input.file;
  return typeof path === "string" ? path : null;
};

// A file this long is worth a grep and a range read instead of reading it all.
const LONG_FILE_LINES = 400;

export function summarizeBehavior(uses: ReadonlyArray<ToolUse>) {
  const readsSinceChange = new Map<string, Set<string>>();
  let repeatReads = 0;
  let longWholeReads = 0;
  for (const use of uses) {
    const path = pathOf(use.input);
    if (path === null) continue;
    if (use.tool === "edit" || use.tool === "write") {
      readsSinceChange.delete(path);
      continue;
    }
    if (use.tool !== "read" || use.status !== "completed") continue;
    const range = `${use.input.offset ?? ""}:${use.input.limit ?? ""}`;
    const seen = readsSinceChange.get(path) ?? new Set<string>();
    if (seen.has(range)) repeatReads++;
    seen.add(range);
    readsSinceChange.set(path, seen);
    const lines = /^Read file [^\n]*?, lines 1-(\d+)/.exec(use.output);
    if (range === ":" && lines && Number(lines[1]) > LONG_FILE_LINES) longWholeReads++;
  }
  return {
    toolCalls: uses.length,
    failedToolCalls: uses.filter((use) => use.status === "error").length,
    toolOutputChars: uses.reduce((sum, use) => sum + use.output.length, 0),
    /** The same read again with no edit to the file in between. */
    repeatReads,
    /** Unranged reads that returned more than LONG_FILE_LINES lines. */
    longWholeReads,
  };
}
