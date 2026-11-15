import {
  L3_LOCKED_TOOLS,
  l3AgentItemEnabled,
  type L3AgentItems,
  type EnvironmentId,
  type ModelContextBreakdown,
  type ModelContextCategoryId,
  type ThreadId,
} from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
  skills,
  onStartGoal,
  fallback,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  /** Every skill the provider knows; switched-off skills never appear in a request. */
  readonly skills: readonly string[];
  /** Puts `/goal ` in this thread's composer; absent where there is no composer. */
  readonly onStartGoal?: (() => void) | undefined;
  readonly fallback: ReactNode;
}) {
  const { data } = useEnvironmentQuery(
    threadId === null
      ? null
      : serverEnvironment.modelContext({ environmentId, input: { threadId } }),
  );
  return data ? (
    <ModelContextBody
      breakdown={data}
      environmentId={environmentId}
      skills={skills}
      onStartGoal={onStartGoal}
    />
  ) : (
    fallback
  );
}

function ModelContextBody({
  breakdown,
  environmentId,
  skills,
  onStartGoal,
}: {
  readonly breakdown: ModelContextBreakdown;
  readonly environmentId: EnvironmentId;
  readonly skills: readonly string[];
  readonly onStartGoal: (() => void) | undefined;
}) {
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
        {onStartGoal ? (
          <div className="flex items-center justify-between gap-2 border-border/65 border-t pt-1.5">
            <span className="text-muted-foreground">
              Big job? A goal keeps the agent working until it is done.
            </span>
            <Button size="xs" variant="outline" onClick={onStartGoal}>
              Long task
            </Button>
          </div>
        ) : null}
        <AgentItems breakdown={breakdown} environmentId={environmentId} skills={skills} />
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

// Each thread's own T3 MCP server is named after the thread; show what it is instead.
const groupLabel = (name: string) => (name.startsWith("t3-code-") ? "L3 (this thread)" : name);
const BROWSER_GROUP = "browser";
// Lean: skills off (the default), plus web access and the shared browser.
const LEAN_ITEMS: L3AgentItems = {
  "skill:*": false,
  "tool:websearch": false,
  "tool:webfetch": false,
};

interface AgentItem {
  readonly id: string;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly checked: boolean;
  /** Locked items show their state but cannot be switched off. */
  readonly locked?: boolean;
  readonly onChange?: ((checked: boolean) => void) | undefined;
}

/** What the agent can use, with checkboxes. Unchecked items leave the prompt from the next turn. */
function AgentItems({
  breakdown,
  environmentId,
  skills,
}: {
  readonly breakdown: ModelContextBreakdown;
  readonly environmentId: EnvironmentId;
  readonly skills: readonly string[];
}) {
  const items = useEnvironmentSettings(environmentId, (settings) => settings.l3AgentItems);
  const browserOn = useEnvironmentSettings(
    environmentId,
    (settings) => settings.enableAgentBrowserAccess,
  );
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const setItems = (patch: L3AgentItems) => void updateSettings({ l3AgentItems: patch });
  const toggle = (id: string) => (checked: boolean) => setItems({ [id]: checked });
  // Switched-off items drop out of requests, so settings keep them listed.
  const offIds = (prefix: string) =>
    Object.entries(items)
      .filter(([id, enabled]) => id.startsWith(prefix) && !enabled && !id.endsWith("*"))
      .map(([id]) => id.slice(prefix.length));
  const union = (seen: readonly string[], prefix: string) =>
    [...new Set([...seen, ...offIds(prefix)])].toSorted((a, b) => a.localeCompare(b));

  const directTools = union(
    breakdown.tools
      .filter((tool) => tool.kind === "system" && !tool.group)
      .map((tool) => tool.name),
    "tool:",
  );
  const toolItems: AgentItem[] = directTools.map((name) => ({
    id: `tool:${name}`,
    label: name,
    detail: name === "execute" ? "runs every MCP and Code Mode tool" : undefined,
    checked: l3AgentItemEnabled(items, `tool:${name}`),
    locked: L3_LOCKED_TOOLS.has(name),
    onChange: toggle(`tool:${name}`),
  }));

  const groups = new Map(breakdown.toolGroups.map((group) => [group.name, group]));
  const groupNames = union([...groups.keys()], "mcp:");
  if (!browserOn && !groupNames.includes(BROWSER_GROUP)) groupNames.push(BROWSER_GROUP);
  const groupItems: AgentItem[] = groupNames.map((name) => {
    const group = groups.get(name);
    const isBrowser = name === BROWSER_GROUP;
    return {
      id: `mcp:${name}`,
      label: groupLabel(name),
      detail: group ? `${group.tools} tools, ${group.loaded} loaded` : "off",
      checked: isBrowser ? browserOn : l3AgentItemEnabled(items, `mcp:${name}`),
      // The thread's own server names the thread for this panel; keep it on.
      locked: name.startsWith("t3-code-"),
      onChange: isBrowser
        ? (checked: boolean) => void updateSettings({ enableAgentBrowserAccess: checked })
        : toggle(`mcp:${name}`),
    };
  });

  const skillNames = [...new Set([...skills, ...offIds("skill:")])].toSorted((a, b) =>
    a.localeCompare(b),
  );
  const skillsOn = items["skill:*"] ?? false;
  const skillItems: AgentItem[] = skillNames.map((name) => ({
    id: `skill:${name}`,
    label: name,
    checked: l3AgentItemEnabled(items, `skill:${name}`),
    onChange: toggle(`skill:${name}`),
  }));
  const enabledSkills = skillItems.filter((item) => item.checked).length;

  return (
    <div className="flex flex-col border-border/65 border-t pt-1.5">
      <div className="flex items-center justify-between gap-2 pb-1">
        <span className="text-muted-foreground">Fewer items make each reply start sooner.</span>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            // Explicit skill picks would outlive "all skills off", so clear them too.
            const cleared = Object.fromEntries(
              Object.keys(items)
                .filter((id) => id.startsWith("skill:"))
                .map((id) => [id, false]),
            );
            setItems({ ...cleared, ...LEAN_ITEMS });
            void updateSettings({ enableAgentBrowserAccess: false });
          }}
        >
          Lean
        </Button>
      </div>
      <AgentItemList title="System tools" count={toolItems.length} items={toolItems} />
      <AgentItemList
        title="MCP servers"
        count={groupItems.length}
        items={groupItems}
        note="Browser changes apply when the agent session next starts."
      />
      <AgentItemList
        title="Skills"
        count={skillItems.length}
        summary={`${enabledSkills} on`}
        items={skillItems}
        header={
          <AgentItemRow
            item={{
              id: "skill:*",
              label: "All skills",
              checked: skillsOn,
              onChange: (checked) =>
                setItems({
                  "skill:*": checked,
                  ...Object.fromEntries(skillNames.map((name) => [`skill:${name}`, checked])),
                }),
            }}
          />
        }
      />
      <AgentItemList
        title="Memory files"
        count={breakdown.memoryFiles.length}
        items={breakdown.memoryFiles.map((path) => ({ id: path, label: path, checked: true }))}
        readOnly
      />
    </div>
  );
}

function AgentItemList({
  title,
  count,
  summary,
  items,
  header,
  note,
  readOnly = false,
}: {
  readonly title: string;
  readonly count: number;
  readonly summary?: string;
  readonly items: readonly AgentItem[];
  readonly header?: ReactNode;
  readonly note?: string;
  readonly readOnly?: boolean;
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
        <span className="tabular-nums">{summary ?? count}</span>
      </summary>
      <ul className="mb-1 ml-5 flex max-h-56 flex-col gap-0.5 overflow-y-auto pr-1">
        {header}
        {items.map((item) =>
          readOnly ? (
            <li key={item.id} className="break-all font-mono text-2xs text-muted-foreground">
              {item.label}
            </li>
          ) : (
            <AgentItemRow key={item.id} item={item} />
          ),
        )}
      </ul>
      {note ? <p className="mb-1 ml-5 text-2xs text-muted-foreground">{note}</p> : null}
    </details>
  );
}

function AgentItemRow({ item }: { readonly item: AgentItem }) {
  return (
    <li>
      <label className="flex min-h-6 cursor-default items-center gap-2">
        <Checkbox
          checked={item.checked}
          disabled={item.locked === true || item.onChange === undefined}
          onCheckedChange={(checked) => item.onChange?.(checked)}
        />
        <span
          className={cn(
            "min-w-0 flex-1 break-all font-mono text-2xs",
            item.checked ? "text-foreground/85" : "text-muted-foreground line-through",
          )}
        >
          {item.label}
        </span>
        {item.locked ? (
          <span className="text-2xs text-muted-foreground">needed</span>
        ) : item.detail ? (
          <span className="shrink-0 text-2xs text-muted-foreground">{item.detail}</span>
        ) : null}
      </label>
    </li>
  );
}
