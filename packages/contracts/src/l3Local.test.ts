import { describe, expect, it } from "vite-plus/test";

import {
  L3_LOCAL_CONTEXT_TOKENS,
  l3CanonicalModelId,
  l3ContextTokensFor,
  makeL3OpenCodeConfigContent,
} from "./l3Local.ts";

const modelsOf = (content: string) =>
  Object.keys(JSON.parse(content).provider.l3.models as Record<string, unknown>);

describe("makeL3OpenCodeConfigContent", () => {
  it("offers only installed local models, always keeping the default", () => {
    expect(
      modelsOf(makeL3OpenCodeConfigContent(undefined, { installedModels: new Set() })),
    ).toEqual(["onyx-qwen"]);
    expect(
      modelsOf(
        makeL3OpenCodeConfigContent(undefined, { installedModels: new Set(["onyx-laguna"]) }),
      ),
    ).toEqual(["onyx-qwen", "onyx-laguna"]);
  });

  it("lists every local model when installed models are unknown", () => {
    expect(modelsOf(makeL3OpenCodeConfigContent())).toEqual(["onyx-qwen", "onyx-laguna"]);
  });

  it("gives each local model its own context window", () => {
    const models = JSON.parse(makeL3OpenCodeConfigContent()).provider.l3.models;
    expect(models["onyx-qwen"].limit.context).toBe(131_072);
    expect(models["onyx-laguna"].limit.context).toBe(65_536);
    expect(l3ContextTokensFor("onyx-laguna:latest")).toBe(65_536);
    // Names from before the rename resolve to the same models.
    expect(l3ContextTokensFor("l3-laguna")).toBe(65_536);
    expect(l3CanonicalModelId("l3-coder:latest")).toBe("onyx-qwen");
    expect(l3CanonicalModelId("someone-else")).toBe("someone-else");
    expect(l3ContextTokensFor("someone-else")).toBe(L3_LOCAL_CONTEXT_TOKENS);
  });

  it("offers a fast variant without making it the only, and so default, choice", () => {
    const models = JSON.parse(makeL3OpenCodeConfigContent()).provider.l3.models;
    expect(models["onyx-qwen"].variants).toEqual({
      thinking: {},
      fast: { reasoningEffort: "none" },
    });
  });

  it("adds Onyx's code search server only when it is running", () => {
    expect(JSON.parse(makeL3OpenCodeConfigContent()).mcp).toBeUndefined();
    expect(
      JSON.parse(
        makeL3OpenCodeConfigContent(undefined, { codeSearchUrl: "http://127.0.0.1:9/s/mcp" }),
      ).mcp,
    ).toEqual({ onyx: { type: "remote", url: "http://127.0.0.1:9/s/mcp" } });
  });
});
