import { describe, expect, it } from "vite-plus/test";

import { diffStrings, editInlineDiff, parseUnifiedDiff } from "./inlineDiff.logic";

describe("parseUnifiedDiff", () => {
  it("numbers lines from the hunk header and counts changes", () => {
    const diff = [
      "Index: styles.css",
      "--- styles.css",
      "+++ styles.css",
      "@@ -110,4 +110,4 @@",
      "   position: sticky;",
      "   top: 0;",
      "-  background: color-mix(in srgb, var(--paper) 90%, transparent);",
      "+  background: #f6f6f3;",
      "   border-bottom: 1px solid transparent;",
      "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toMatchObject({
      additions: 1,
      deletions: 1,
      lines: [
        { kind: "ctx", number: 110, text: "  position: sticky;" },
        { kind: "ctx", number: 111, text: "  top: 0;" },
        {
          kind: "del",
          number: 112,
          text: "  background: color-mix(in srgb, var(--paper) 90%, transparent);",
        },
        { kind: "add", number: 112, text: "  background: #f6f6f3;" },
        { kind: "ctx", number: 113, text: "  border-bottom: 1px solid transparent;" },
      ],
    });
  });

  it("marks the gap between hunks and ignores text with no hunk", () => {
    const diff = "@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d\n";
    expect(parseUnifiedDiff(diff)!.lines.map((line) => line.kind)).toEqual([
      "del",
      "add",
      "gap",
      "del",
      "add",
    ]);
    expect(parseUnifiedDiff("Edited csvq.py")).toBeNull();
  });
});

describe("diffStrings", () => {
  it("keeps shared lines and interleaves the change", () => {
    expect(diffStrings("a\nb\nc", "a\nB\nc").lines).toMatchObject([
      { kind: "ctx", number: null, text: "a" },
      { kind: "del", number: null, text: "b" },
      { kind: "add", number: null, text: "B" },
      { kind: "ctx", number: null, text: "c" },
    ]);
  });
});

describe("editInlineDiff", () => {
  it("prefers the patch and falls back to old and new text", () => {
    expect(editInlineDiff({ diffStr: "@@ -1 +1 @@\n-x\n+y\n" })?.additions).toBe(1);
    expect(editInlineDiff({ oldStr: "x", newStr: "y" })).toMatchObject({
      additions: 1,
      deletions: 1,
    });
    expect(editInlineDiff({ newStr: "fresh file" })).toMatchObject({ additions: 1, deletions: 0 });
    expect(editInlineDiff({})).toBeNull();
  });
});
