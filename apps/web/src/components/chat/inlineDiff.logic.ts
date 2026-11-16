/** Lines of an edit's diff for the timeline, as Cursor shows them under "Edited styles.css +1 -1". */

export interface InlineDiffLine {
  /** Position in the diff, a stable key for the row. */
  readonly id: number;
  readonly kind: "add" | "del" | "ctx" | "gap";
  /** The line's number in the new file (old file for deletions); null where the diff gives none. */
  readonly number: number | null;
  readonly text: string;
}

export interface InlineDiff {
  readonly lines: ReadonlyArray<InlineDiffLine>;
  readonly additions: number;
  readonly deletions: number;
}

type UnnumberedLine = Omit<InlineDiffLine, "id">;
const numbered = (lines: ReadonlyArray<UnnumberedLine>): InlineDiffLine[] =>
  lines.map((line, id) => ({ id, ...line }));

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parses a unified diff; null when the text holds no hunks. */
export function parseUnifiedDiff(diff: string): InlineDiff | null {
  const lines: UnnumberedLine[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  let inHunk = false;
  let additions = 0;
  let deletions = 0;
  for (const raw of diff.replace(/\r\n/g, "\n").split("\n")) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      if (lines.length > 0) lines.push({ kind: "gap", number: null, text: "" });
      oldNumber = Number(hunk[1]);
      newNumber = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith("\\")) continue;
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    if (raw.startsWith("+")) {
      lines.push({ kind: "add", number: newNumber++, text: raw.slice(1) });
      additions++;
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "del", number: oldNumber++, text: raw.slice(1) });
      deletions++;
    } else if (raw.startsWith(" ") || raw === "") {
      lines.push({ kind: "ctx", number: newNumber, text: raw.slice(1) });
      oldNumber++;
      newNumber++;
    }
  }
  // A trailing empty line is the diff's final newline, not a context line.
  while (lines.at(-1)?.kind === "ctx" && lines.at(-1)?.text === "") lines.pop();
  return inHunk ? { lines: numbered(lines), additions, deletions } : null;
}

const MAX_DIFFED_LINES = 400;

/** A line diff of an edit's old and new text, for providers that send no patch. */
export function diffStrings(oldText: string, newText: string): InlineDiff {
  const before = oldText === "" ? [] : oldText.replace(/\r\n/g, "\n").split("\n");
  const after = newText === "" ? [] : newText.replace(/\r\n/g, "\n").split("\n");
  if (before.length * after.length > MAX_DIFFED_LINES * MAX_DIFFED_LINES) {
    return {
      lines: numbered([
        ...before.map((text) => ({ kind: "del" as const, number: null, text })),
        ...after.map((text) => ({ kind: "add" as const, number: null, text })),
      ]),
      additions: after.length,
      deletions: before.length,
    };
  }
  // Longest common subsequence, then walk it to interleave kept, removed and added lines.
  const table = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const lines: UnnumberedLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      lines.push({ kind: "ctx", number: null, text: before[i]! });
      i++;
      j++;
    } else if (j < after.length && (i === before.length || table[i]![j + 1]! > table[i + 1]![j]!)) {
      lines.push({ kind: "add", number: null, text: after[j]! });
      j++;
    } else {
      lines.push({ kind: "del", number: null, text: before[i]! });
      i++;
    }
  }
  return {
    lines: numbered(lines),
    additions: lines.filter((line) => line.kind === "add").length,
    deletions: lines.filter((line) => line.kind === "del").length,
  };
}

/** The diff an edit item can show inline, from its patch or else its old and new text. */
export function editInlineDiff(item: {
  readonly diffStr?: string | undefined;
  readonly oldStr?: string | undefined;
  readonly newStr?: string | undefined;
}): InlineDiff | null {
  const parsed = item.diffStr ? parseUnifiedDiff(item.diffStr) : null;
  if (parsed && parsed.lines.length > 0) return parsed;
  if (item.newStr === undefined) return null;
  const diff = diffStrings(item.oldStr ?? "", item.newStr);
  return diff.lines.length > 0 ? diff : null;
}
