import { useState } from "react";

import { cn } from "~/lib/utils";

import type { InlineDiff } from "./inlineDiff.logic";

const VISIBLE_LINES = 24;

/** An edit's change inside the timeline, as Cursor shows it: numbered lines, removals then additions. */
export function InlineDiffView({ diff }: { diff: InlineDiff }) {
  const [showAll, setShowAll] = useState(false);
  const lines = showAll ? diff.lines : diff.lines.slice(0, VISIBLE_LINES);
  const hidden = diff.lines.length - lines.length;
  const numbered = diff.lines.some((line) => line.number !== null);
  return (
    <div
      className="mt-1 mb-1.5 overflow-hidden rounded-md border border-border/70 bg-background/40 select-text"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="overflow-x-auto py-1 font-mono text-xs leading-5">
        {lines.map((line) =>
          line.kind === "gap" ? (
            <div key={line.id} className="px-3 text-muted-foreground/60" aria-hidden>
              ⋯
            </div>
          ) : (
            <div
              key={line.id}
              className={cn(
                "flex min-w-fit border-l-2",
                line.kind === "add"
                  ? "border-diff-addition bg-diff-addition/12"
                  : line.kind === "del"
                    ? "border-diff-deletion bg-diff-deletion/12"
                    : "border-transparent",
              )}
            >
              {numbered ? (
                <span className="w-11 shrink-0 pr-3 text-right text-muted-foreground/60 tabular-nums select-none">
                  {line.number ?? ""}
                </span>
              ) : null}
              <span
                className={cn(
                  "w-4 shrink-0 select-none",
                  line.kind === "add"
                    ? "text-diff-addition-foreground"
                    : line.kind === "del"
                      ? "text-diff-deletion-foreground"
                      : "text-transparent",
                  !numbered && "pl-2",
                )}
                aria-hidden
              >
                {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
              </span>
              <span
                className={cn(
                  "whitespace-pre pr-3",
                  line.kind === "ctx" ? "text-foreground/70" : "text-foreground/90",
                )}
              >
                {line.text || " "}
              </span>
            </div>
          ),
        )}
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          className="w-full border-t border-border/60 px-3 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowAll(true)}
        >
          Show {hidden} more {hidden === 1 ? "line" : "lines"}
        </button>
      ) : null}
    </div>
  );
}
