import type {
  EnvironmentId,
  ModelContextBreakdown,
  ModelContextCategoryId,
  ThreadId,
} from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

const CATEGORY_STYLE: Record<ModelContextCategoryId, { label: string; swatch: string }> = {
  messages: { label: "Messages", swatch: "bg-blue-500" },
  mcpTools: { label: "MCP tools", swatch: "bg-orange-500" },
  systemTools: { label: "System tools", swatch: "bg-emerald-500" },
  systemPrompt: { label: "System prompt", swatch: "bg-zinc-400" },
  skills: { label: "Skills", swatch: "bg-violet-400" },
  memoryFiles: { label: "Memory files", swatch: "bg-amber-400" },
};
const CATEGORY_ORDER: ReadonlyArray<ModelContextCategoryId> = [
  "messages",
  "mcpTools",
  "systemTools",
  "systemPrompt",
  "skills",
  "memoryFiles",
];
const RESERVE_SWATCH = "bg-muted-foreground/60";

const share = (tokens: number, total: number) =>
  total > 0 ? `${((tokens / total) * 100).toFixed(1)}%` : "0%";

/** What fills the local model's context on this thread, and the tools it can call. */
/** Falls back to the provider's own context row until L3 has measured a request. */
export function ThreadDetailsModelContext({
  environmentId,
  threadId,
  fallback,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly fallback: ReactNode;
}) {
  const { data } = useEnvironmentQuery(
    threadId === null
      ? null
      : serverEnvironment.modelContext({ environmentId, input: { threadId } }),
  );
  return data ? <ModelContextBody breakdown={data} /> : fallback;
}

function ModelContextBody({ breakdown }: { readonly breakdown: ModelContextBreakdown }) {
  const total = breakdown.contextTokens;
  const tokensOf = (id: ModelContextCategoryId) =>
    breakdown.categories.find((category) => category.id === id)?.tokens ?? 0;
  const rows = CATEGORY_ORDER.map((id) => ({ id, tokens: tokensOf(id), ...CATEGORY_STYLE[id] }));
  const reserve = Math.min(
    breakdown.outputReserveTokens,
    Math.max(0, total - breakdown.usedTokens),
  );
  const free = Math.max(0, total - breakdown.usedTokens - reserve);
  const usedPercent = total > 0 ? Math.round((breakdown.usedTokens / total) * 100) : 0;
  const direct = breakdown.tools.filter((tool) => tool.kind === "system" && !tool.group);
  const groupsOf = (kind: "system" | "mcp") =>
    breakdown.toolGroups.filter((group) => group.kind === kind);
  const groupLines = (kind: "system" | "mcp"): ToolListItem[] =>
    groupsOf(kind).flatMap((group) => [
      {
        id: group.name,
        label: `${groupLabel(group.name)}: ${group.tools} tools, ${group.loaded} loaded`,
        nested: false,
      },
      ...breakdown.tools
        .filter((tool) => tool.group === group.name)
        .map((tool) => ({
          id: tool.name,
          label: tool.name.slice(group.name.length + 1),
          nested: true,
        })),
    ]);
  const plain = (names: readonly string[]): ToolListItem[] =>
    names.map((name) => ({ id: name, label: name, nested: false }));
  const totalOf = (kind: "system" | "mcp") =>
    groupsOf(kind).reduce((sum, group) => sum + group.tools, 0);
  const skills = breakdown.tools.filter((tool) => tool.kind === "skill").map((tool) => tool.name);

  return (
    <ThreadDetailsSection headingId="thread-details-model-context-heading" title="Context">
      <div className="flex flex-col gap-2 px-2.5 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-foreground">{usedPercent}% used</span>
          <span className="tabular-nums text-muted-foreground">
            {breakdown.exact ? "" : "≈ "}
            {formatContextWindowTokens(breakdown.usedTokens)} / {formatContextWindowTokens(total)}
          </span>
        </div>
        <div
          className="flex h-1.5 overflow-hidden rounded-full bg-muted-foreground/20"
          role="img"
          aria-label={`${usedPercent}% of the context window used`}
        >
          {rows.map((row) =>
            row.tokens > 0 ? (
              <span
                key={row.id}
                className={row.swatch}
                style={{ width: `${(row.tokens / Math.max(1, total)) * 100}%` }}
              />
            ) : null,
          )}
          {reserve > 0 ? (
            <span
              className={RESERVE_SWATCH}
              style={{ width: `${(reserve / Math.max(1, total)) * 100}%` }}
            />
          ) : null}
        </div>
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <ContextRow
              key={row.id}
              swatch={row.swatch}
              label={row.label}
              tokens={row.tokens}
              total={total}
            />
          ))}
          <ContextRow
            swatch={RESERVE_SWATCH}
            label="Output reserve"
            tokens={reserve}
            total={total}
          />
          <ContextRow
            swatch="border border-border"
            label="Free space"
            tokens={free}
            total={total}
          />
        </ul>
        <div className="flex flex-col border-border/65 border-t pt-1.5">
          <ToolList
            title="System tools"
            count={direct.length + totalOf("system")}
            items={[...plain(direct.map((tool) => tool.name)), ...groupLines("system")]}
          />
          <ToolList title="MCP tools" count={totalOf("mcp")} items={groupLines("mcp")} />
          <ToolList title="Skills" count={skills.length} items={plain(skills)} />
          <ToolList
            title="Memory files"
            count={breakdown.memoryFiles.length}
            items={plain(breakdown.memoryFiles)}
          />
        </div>
      </div>
    </ThreadDetailsSection>
  );
}

function ContextRow({
  swatch,
  label,
  tokens,
  total,
}: {
  readonly swatch: string;
  readonly label: string;
  readonly tokens: number;
  readonly total: number;
}) {
  return (
    <li className="grid grid-cols-[auto_1fr_auto_3.25rem] items-center gap-x-2">
      <span aria-hidden className={cn("size-2.5 rounded-sm", swatch)} />
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="text-end tabular-nums text-foreground/80">
        {formatContextWindowTokens(tokens)}
      </span>
      <span className="text-end tabular-nums text-muted-foreground">{share(tokens, total)}</span>
    </li>
  );
}

interface ToolListItem {
  readonly id: string;
  readonly label: string;
  readonly nested: boolean;
}

// Each thread's own T3 MCP server is named after the thread; show what it is instead.
const groupLabel = (name: string) => (name.startsWith("t3-code-") ? "L3 (this thread)" : name);

function ToolList({
  title,
  count,
  items,
}: {
  readonly title: string;
  readonly count: number;
  readonly items: readonly ToolListItem[];
}) {
  if (count === 0) return null;
  return (
    <details className="group/tools">
      <summary className="flex h-6 cursor-default list-none items-center gap-1.5 rounded-md text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-open/tools:rotate-90"
        />
        <span className="flex-1 truncate">{title}</span>
        <span className="tabular-nums">{count}</span>
      </summary>
      <ul className="mb-1 ml-5 flex max-h-48 flex-col gap-0.5 overflow-y-auto pr-1">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              "break-all font-mono text-2xs",
              item.nested ? "pl-3 text-foreground/75" : "text-muted-foreground",
            )}
          >
            {item.label}
          </li>
        ))}
      </ul>
    </details>
  );
}
