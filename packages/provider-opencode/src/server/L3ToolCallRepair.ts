/**
 * Local models ask for line ranges with names other harnesses use (`start`/`end`, `startLine`,
 * `lines: "140-160"`). OpenCode's read tool takes `offset` and `limit` and drops unknown keys, so
 * such a call silently returns the whole file. These rewrite read calls as they stream from Ollama.
 */

const START_KEYS = [
  "start",
  "startLine",
  "start_line",
  "lineStart",
  "line_start",
  "fromLine",
  "from",
  "line",
];
const END_KEYS = ["end", "endLine", "end_line", "lineEnd", "line_end", "toLine", "to"];
const RANGE_KEYS = ["lines", "range", "lineRange", "line_range"];
const PATH_KEYS = ["filePath", "file_path", "file", "filename"];

const lineNumber = (value: unknown): number | undefined => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\s*\d+\s*$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(number) && number > 0 ? number : undefined;
};

const firstLineNumber = (args: Record<string, unknown>, keys: ReadonlyArray<string>) => {
  for (const key of keys) {
    const value = lineNumber(args[key]);
    if (value !== undefined) return value;
  }
  return undefined;
};

const parseRange = (value: unknown): readonly [number, number] | undefined => {
  if (typeof value !== "string") return undefined;
  const match = /^\s*(\d+)\s*(?:-|–|:|to|\.\.)\s*(\d+)\s*$/.exec(value);
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return start > 0 && end >= start ? [start, end] : undefined;
};

/** The read call OpenCode understands, or null when the arguments need no change. */
export function repairReadArguments(
  args: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  const aliases = [...START_KEYS, ...END_KEYS, ...RANGE_KEYS];
  const range = RANGE_KEYS.map((key) => parseRange(args[key])).find((value) => value);
  const start = range?.[0] ?? firstLineNumber(args, START_KEYS);
  const end = range?.[1] ?? firstLineNumber(args, END_KEYS);
  const offset = lineNumber(args.offset) ?? start;
  const limit =
    lineNumber(args.limit) ??
    (end !== undefined && end >= (offset ?? 1) ? end - (offset ?? 1) + 1 : undefined);
  const path =
    typeof args.path === "string" && args.path.trim()
      ? args.path
      : PATH_KEYS.map((key) => args[key]).find(
          (value): value is string => typeof value === "string" && value.trim() !== "",
        );

  const repaired: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (aliases.includes(key) || PATH_KEYS.includes(key)) continue;
    if (key === "offset" || key === "limit" || key === "path") continue;
    repaired[key] = value;
  }
  if (path !== undefined) repaired.path = path;
  if (offset !== undefined) repaired.offset = offset;
  if (limit !== undefined) repaired.limit = limit;
  // Keys OpenCode would drop and values it would reject are the only reasons to rewrite.
  const unchanged =
    repaired.path === args.path &&
    repaired.offset === args.offset &&
    repaired.limit === args.limit &&
    Object.keys(repaired).length === Object.keys(args).length;
  return unchanged ? null : repaired;
}

interface StreamedToolCall {
  function?: { name?: unknown; arguments?: unknown };
}

/** Rewrites one SSE line when it carries a read call with arguments OpenCode would misread. */
export function repairSseLine(line: string): string {
  if (!line.startsWith("data:") || !line.includes('"tool_calls"')) return line;
  let chunk: { choices?: Array<{ delta?: { tool_calls?: StreamedToolCall[] } }> };
  try {
    chunk = JSON.parse(line.slice(5));
  } catch {
    return line;
  }
  let changed = false;
  for (const choice of chunk.choices ?? []) {
    for (const call of choice.delta?.tool_calls ?? []) {
      const fn = call.function;
      if (fn?.name !== "read" || typeof fn.arguments !== "string") continue;
      let args: unknown;
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        // Ollama sends a whole call per chunk; a fragment is some other server's, so leave it.
        continue;
      }
      if (typeof args !== "object" || args === null || Array.isArray(args)) continue;
      const repaired = repairReadArguments(args as Record<string, unknown>);
      if (repaired === null) continue;
      fn.arguments = JSON.stringify(repaired);
      changed = true;
    }
  }
  return changed ? `data: ${JSON.stringify(chunk)}` : line;
}
