// L3 runs every agent and text task on a model served by the local Ollama.
// `scripts/l3-setup.sh` creates the `l3-coder` model these defaults point at.

export const L3_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
export const L3_LOCAL_MODEL = "l3-coder";
const L3_LOCAL_MODEL_NAME = "Qwen 3.6 35B-A3B (local)";
export const L3_LOCAL_CONTEXT_TOKENS = 65_536;

/** OpenCode provider id that carries the local model; OpenCode model slugs are `<provider>/<model>`. */
const L3_OPENCODE_PROVIDER_ID = "l3";
export const L3_OPENCODE_MODEL_SLUG = `${L3_OPENCODE_PROVIDER_ID}/${L3_LOCAL_MODEL}`;

/** Text generator instance id for titles, commit messages and branch names. */
export const L3_TEXT_GENERATOR_ID = "l3-local";

/** OpenCode config for `OPENCODE_CONFIG_CONTENT`; `baseUrl` may be L3's metering proxy. */
export const makeL3OpenCodeConfigContent = (baseUrl: string = L3_OLLAMA_BASE_URL) =>
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
  });

export const L3_OPENCODE_CONFIG_CONTENT = makeL3OpenCodeConfigContent();
