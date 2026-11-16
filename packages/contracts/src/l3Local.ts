// Onyx runs every agent and text task on models served by the local Ollama.
// `scripts/l3-setup.sh` creates `onyx-qwen`, the default; `L3_WITH_LAGUNA=1` also adds `onyx-laguna`.

export const L3_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
export const L3_LOCAL_MODEL = "onyx-qwen";

/** Ollama models Onyx offers in the model picker; the first is the default. */
export const L3_LOCAL_MODELS: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly installCommand: string;
  /** Must match the model's `num_ctx` in Ollama, or Ollama drops the overflow without a word. */
  readonly contextTokens: number;
}> = [
  {
    id: L3_LOCAL_MODEL,
    name: "Qwen 3.6 35B-A3B (local)",
    installCommand: "scripts/l3-setup.sh",
    // Qwen caches only 10 of its 40 layers, so 128K costs about 0.9 GB more than 64K, and long
    // tasks then finish without a lossy summary midway.
    contextTokens: 131_072,
  },
  {
    id: "onyx-laguna",
    name: "Laguna XS 2.1 (local, US)",
    installCommand: "L3_WITH_LAGUNA=1 scripts/l3-setup.sh",
    contextTokens: 65_536,
  },
];
export const L3_LOCAL_CONTEXT_TOKENS = L3_LOCAL_MODELS[0]!.contextTokens;

/** Ollama names from before the rename; threads and installs that still use them keep working. */
export const L3_LEGACY_MODEL_IDS: Readonly<Record<string, string>> = {
  "l3-coder": L3_LOCAL_MODEL,
  "l3-laguna": "onyx-laguna",
};

/** The current Ollama name for a local model id, old names included; other ids pass through. */
export const l3CanonicalModelId = (model: string) => {
  const bare = model.replace(/:latest$/, "");
  return L3_LEGACY_MODEL_IDS[bare] ?? bare;
};

/** The context window Onyx configures for a local model, by Ollama name. */
export const l3ContextTokensFor = (model: string | undefined) =>
  L3_LOCAL_MODELS.find((entry) => model !== undefined && entry.id === l3CanonicalModelId(model))
    ?.contextTokens ?? L3_LOCAL_CONTEXT_TOKENS;
const L3_MAX_AGENT_STEPS = 400;

/** OpenCode provider id that carries the local model; OpenCode model slugs are `<provider>/<model>`. */
export const L3_OPENCODE_PROVIDER_ID = "l3";
export const L3_OPENCODE_MODEL_SLUG = `${L3_OPENCODE_PROVIDER_ID}/${L3_LOCAL_MODEL}`;

/** Reasoning variants Onyx offers for each local model; `fast` skips the thinking step. */
const L3_THINKING_VARIANT = "thinking";
export const L3_FAST_VARIANT = "fast";

/** MCP server name for Onyx's code search; OpenCode names its tool `onyx_codebase_search`. */
const L3_CODE_SEARCH_MCP_SERVER = "onyx";

/** Text generator instance id for titles, commit messages and branch names. */
export const L3_TEXT_GENERATOR_ID = "l3-local";

/** OpenCode config for `OPENCODE_CONFIG_CONTENT`; `baseUrl` may be Onyx's metering proxy. */
export const makeL3OpenCodeConfigContent = (
  baseUrl: string = L3_OLLAMA_BASE_URL,
  options: {
    readonly instructionsPath?: string | undefined;
    /** Ollama models that are installed; picker entries for missing ones would only fail. */
    readonly installedModels?: ReadonlySet<string> | undefined;
    /** Onyx's loopback MCP endpoint with ranked code search. */
    readonly codeSearchUrl?: string | undefined;
  } = {},
) =>
  JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    provider: {
      [L3_OPENCODE_PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: "Onyx Local",
        options: { baseURL: baseUrl },
        models: Object.fromEntries(
          L3_LOCAL_MODELS.filter(
            (model) =>
              model.id === L3_LOCAL_MODEL ||
              options.installedModels === undefined ||
              options.installedModels.has(model.id),
          ).map((model) => [
            model.id,
            {
              name: model.name,
              tool_call: true,
              reasoning: true,
              limit: { context: model.contextTokens, output: 16_384 },
              // The picker's Reasoning choice. Two entries so neither becomes the default, which
              // keeps thinking on: skipping it was faster on small tasks, worse in large projects.
              variants: {
                [L3_THINKING_VARIANT]: {},
                [L3_FAST_VARIANT]: { reasoningEffort: "none" },
              },
            },
          ]),
        ),
      },
    },
    model: L3_OPENCODE_MODEL_SLUG,
    small_model: L3_OPENCODE_MODEL_SLUG,
    // Keep prompts on this machine: no hosted providers, no share links, no self-updates.
    enabled_providers: [L3_OPENCODE_PROVIDER_ID],
    share: "disabled",
    autoupdate: false,
    // The todo tool gives long tasks a plan T3 shows and `/goal` checks against.
    experimental: { todo: true },
    // Long tasks run many tool steps per turn; do not stop them at a low default.
    agents: { build: { steps: L3_MAX_AGENT_STEPS } },
    ...(options.instructionsPath ? { instructions: [options.instructionsPath] } : {}),
    ...(options.codeSearchUrl
      ? {
          mcp: { [L3_CODE_SEARCH_MCP_SERVER]: { type: "remote", url: options.codeSearchUrl } },
        }
      : {}),
  });

export const L3_OPENCODE_CONFIG_CONTENT = makeL3OpenCodeConfigContent();

/**
 * Agent items a user can switch off to shorten every prompt, keyed `tool:<name>`,
 * `mcp:<server>`, `skill:<name>`, or `skill:*` for all skills. Missing keys use the defaults:
 * tools and MCP servers on, skills off (their catalog is the largest part of the prompt).
 */
export type L3AgentItems = Readonly<Record<string, boolean>>;

/** Tools the agent cannot work without; they never get a checkbox. */
export const L3_LOCKED_TOOLS: ReadonlySet<string> = new Set(["read", "edit", "write", "shell"]);

export const l3AgentItemEnabled = (items: L3AgentItems, id: string): boolean => {
  if (id.startsWith("tool:") && L3_LOCKED_TOOLS.has(id.slice("tool:".length))) return true;
  const explicit = items[id];
  if (explicit !== undefined) return explicit;
  return id.startsWith("skill:") ? (items["skill:*"] ?? false) : true;
};
