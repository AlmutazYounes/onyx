// L3 runs every agent and text task on a model served by the local Ollama.
// `scripts/l3-setup.sh` creates the `l3-coder` model these defaults point at.

export const L3_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
export const L3_LOCAL_MODEL = "l3-coder";
const L3_LOCAL_MODEL_NAME = "Qwen 3.6 35B-A3B (local)";
export const L3_LOCAL_CONTEXT_TOKENS = 65_536;
const L3_MAX_AGENT_STEPS = 400;

/** OpenCode provider id that carries the local model; OpenCode model slugs are `<provider>/<model>`. */
const L3_OPENCODE_PROVIDER_ID = "l3";
export const L3_OPENCODE_MODEL_SLUG = `${L3_OPENCODE_PROVIDER_ID}/${L3_LOCAL_MODEL}`;

/** Text generator instance id for titles, commit messages and branch names. */
export const L3_TEXT_GENERATOR_ID = "l3-local";

/** OpenCode config for `OPENCODE_CONFIG_CONTENT`; `baseUrl` may be L3's metering proxy. */
export const makeL3OpenCodeConfigContent = (
  baseUrl: string = L3_OLLAMA_BASE_URL,
  options: { readonly instructionsPath?: string | undefined } = {},
) =>
  JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    provider: {
      [L3_OPENCODE_PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: "L3 Local",
        options: { baseURL: baseUrl },
        models: {
          [L3_LOCAL_MODEL]: {
            name: L3_LOCAL_MODEL_NAME,
            tool_call: true,
            reasoning: true,
            limit: { context: L3_LOCAL_CONTEXT_TOKENS, output: 16_384 },
          },
        },
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
