import { l3AgentItemEnabled } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { l3AgentItemRules } from "./L3AgentItems.ts";

describe("l3AgentItemRules", () => {
  it("turns skills off by default and leaves tools and MCP servers on", () => {
    expect(l3AgentItemRules({})).toEqual([{ action: "skill", resource: "*", effect: "deny" }]);
    expect(l3AgentItemEnabled({}, "skill:pdf")).toBe(false);
    expect(l3AgentItemEnabled({}, "tool:websearch")).toBe(true);
    expect(l3AgentItemEnabled({}, "mcp:browser")).toBe(true);
  });

  it("allows chosen skills after the blanket deny, and denies them when all are on", () => {
    expect(l3AgentItemRules({ "skill:pdf": true })).toEqual([
      { action: "skill", resource: "*", effect: "deny" },
      { action: "skill", resource: "pdf", effect: "allow" },
    ]);
    expect(l3AgentItemRules({ "skill:*": true, "skill:docx": false })).toEqual([
      { action: "skill", resource: "docx", effect: "deny" },
    ]);
  });

  it("denies switched-off tools and MCP servers but never the core tools", () => {
    expect(
      l3AgentItemRules({
        "skill:*": true,
        "tool:websearch": false,
        "tool:read": false,
        "mcp:browser": false,
        "tool:grep": true,
      }),
    ).toEqual([
      { action: "websearch", resource: "*", effect: "deny" },
      { action: "browser_*", resource: "*", effect: "deny" },
    ]);
    expect(l3AgentItemEnabled({ "tool:read": false }, "tool:read")).toBe(true);
  });
});
