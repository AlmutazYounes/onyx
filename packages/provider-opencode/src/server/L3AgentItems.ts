import { L3_LOCKED_TOOLS, type L3AgentItems } from "@t3tools/contracts";

interface Rule {
  readonly action: string;
  readonly resource: string;
  readonly effect: "allow" | "deny" | "ask";
}

// The server keeps this in step with settings; sessions read it each time their rules are built.
let current: L3AgentItems = {};

export const setL3AgentItems = (items: L3AgentItems) => {
  current = items;
};

/**
 * Permission rules that remove switched-off items from OpenCode's prompt. They go last because
 * OpenCode applies the last matching rule, so they hold even after Full access allows everything.
 */
export function l3AgentItemRules(items: L3AgentItems = current): ReadonlyArray<Rule> {
  const rules: Rule[] = [];
  const skillsOn = items["skill:*"] ?? false;
  if (!skillsOn) rules.push({ action: "skill", resource: "*", effect: "deny" });
  for (const [id, enabled] of Object.entries(items)) {
    const [kind, name] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    if (!name || name === "*") continue;
    if (kind === "skill" && enabled !== skillsOn) {
      rules.push({ action: "skill", resource: name, effect: enabled ? "allow" : "deny" });
    } else if (kind === "tool" && !enabled && !L3_LOCKED_TOOLS.has(name)) {
      rules.push({ action: name, resource: "*", effect: "deny" });
    } else if (kind === "mcp" && !enabled) {
      rules.push({ action: `${name}_*`, resource: "*", effect: "deny" });
    }
  }
  return rules;
}
