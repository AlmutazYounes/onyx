import type { LocalModelBenchmark } from "@t3tools/contracts";

/** The parts of Ollama's `/api/show` response the models page reads. */
export interface OllamaShow {
  readonly parameters?: string | undefined;
  readonly capabilities?: ReadonlyArray<string> | undefined;
  readonly details?: { readonly quantization_level?: string | undefined } | undefined;
  readonly model_info?: Readonly<Record<string, unknown>> | undefined;
}

export interface LocalModelSpecs {
  readonly architecture: string | null;
  readonly license: string | null;
  readonly basename: string | null;
  readonly parameterCount: number | null;
  readonly activeParameterCount: number | null;
  readonly experts: { readonly total: number; readonly used: number } | null;
  readonly quantization: string | null;
  readonly contextTokens: number | null;
  readonly maxContextTokens: number | null;
  readonly parameters: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly capabilities: ReadonlyArray<string>;
  /** f16 key/value cache at `contextTokens`; null when the architecture keys are missing. */
  readonly kvCacheBytes: number | null;
}

const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** `35B-A3B` names the active parameters of a mixture-of-experts model. */
const activeFromSizeLabel = (label: string | null) => {
  const match = label ? /-A(\d+(?:\.\d+)?)B\b/i.exec(label) : null;
  return match ? Math.round(Number(match[1]) * 1e9) : null;
};

export function parseOllamaShow(show: OllamaShow): LocalModelSpecs {
  const info = show.model_info ?? {};
  const architecture = str(info["general.architecture"]);
  const key = (name: string) => (architecture ? info[`${architecture}.${name}`] : undefined);

  const parameters = (show.parameters ?? "")
    .split("\n")
    .map((line) => /^(\S+)\s+(.+)$/.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match) => ({ name: match[1]!, value: match[2]!.trim().replace(/^"(.*)"$/, "$1") }));
  const contextParameter = parameters.find((parameter) => parameter.name === "num_ctx");
  const maxContextTokens = num(key("context_length"));
  const contextTokens = num(Number(contextParameter?.value)) ?? maxContextTokens;

  const parameterCount = num(info["general.parameter_count"]);
  const expertCount = num(key("expert_count"));
  const expertUsed = num(key("expert_used_count"));
  const embedding = num(key("embedding_length"));
  const blocks = num(key("block_count"));
  const experts = expertCount && expertUsed ? { total: expertCount, used: expertUsed } : null;

  let activeParameterCount = parameterCount;
  if (experts && parameterCount) {
    // Each routed expert is a gated FFN (gate, up, down) in every MoE block.
    const expertFfn = num(key("expert_feed_forward_length"));
    const moeBlocks = blocks ? blocks - (num(key("leading_dense_block_count")) ?? 0) : null;
    const unused =
      expertFfn && embedding && moeBlocks
        ? (experts.total - experts.used) * 3 * embedding * expertFfn * moeBlocks
        : null;
    const computed = unused === null ? null : parameterCount - unused;
    activeParameterCount =
      computed !== null && computed > 0
        ? Math.round(computed)
        : (activeFromSizeLabel(str(info["general.size_label"])) ?? parameterCount);
  }

  let kvCacheBytes: number | null = null;
  const kvHeads = num(key("attention.head_count_kv"));
  const heads = num(key("attention.head_count"));
  const keyLength =
    num(key("attention.key_length")) ?? (embedding && heads ? embedding / heads : null);
  const valueLength = num(key("attention.value_length")) ?? keyLength;
  if (contextTokens && blocks && kvHeads && keyLength && valueLength) {
    // Hybrid models (linear attention between full-attention layers) cache only the full ones.
    // GGUF has no sliding-window layer pattern, so assume one full layer in four, the usual mix.
    const interval = num(key("full_attention_interval"));
    const window = num(key("attention.sliding_window"));
    const fullLayers = interval
      ? Math.floor(blocks / interval)
      : window
        ? Math.ceil(blocks / 4)
        : blocks;
    const perToken = kvHeads * (keyLength + valueLength) * 2;
    kvCacheBytes =
      contextTokens * fullLayers * perToken +
      (window ? Math.min(window, contextTokens) * (blocks - fullLayers) * perToken : 0);
  }

  return {
    architecture,
    license: str(info["general.license"]),
    basename: str(info["general.basename"]),
    parameterCount,
    activeParameterCount,
    experts,
    quantization: str(show.details?.quantization_level),
    contextTokens,
    maxContextTokens,
    parameters: parameters.filter((parameter) => parameter.name !== "num_ctx"),
    capabilities: show.capabilities ?? [],
    kvCacheBytes,
  };
}

/** macOS lets Metal keep about this much of unified memory resident. */
export const gpuMemoryBudgetBytes = (totalMemoryBytes: number) =>
  Math.round(totalMemoryBytes * (totalMemoryBytes > 36 * 2 ** 30 ? 0.75 : 2 / 3));

export interface SpeedInput {
  readonly id: string;
  readonly sizeBytes: number | null;
  readonly parameterCount: number | null;
  readonly activeParameterCount: number | null;
  readonly benchmark: LocalModelBenchmark | null;
  readonly inUseTokensPerSecond: number | null;
}

/**
 * Speeds for models with no measurement, scaled from the most recently measured one. Writing is
 * bound by memory bandwidth, so it scales with the bytes read per token (active weights); reading
 * a prompt is bound by compute, so it scales with active parameters.
 */
export function estimateSpeeds(models: ReadonlyArray<SpeedInput>) {
  const activeBytes = (model: SpeedInput) =>
    model.sizeBytes && model.parameterCount && model.activeParameterCount
      ? (model.sizeBytes * model.activeParameterCount) / model.parameterCount
      : null;
  const generation = (model: SpeedInput) =>
    model.benchmark?.generationTokensPerSecond ?? model.inUseTokensPerSecond;
  const reference = models
    .filter((model) => generation(model) !== null && activeBytes(model) !== null)
    .toSorted((a, b) => (b.benchmark?.measuredAt ?? 0) - (a.benchmark?.measuredAt ?? 0))[0];
  const promptReference = models
    .filter((model) => model.benchmark?.promptTokensPerSecond && model.activeParameterCount)
    .toSorted((a, b) => b.benchmark!.measuredAt - a.benchmark!.measuredAt)[0];

  return new Map(
    models.map((model) => {
      const bytes = activeBytes(model);
      const gen =
        generation(model) === null && reference && bytes
          ? (generation(reference)! * activeBytes(reference)!) / bytes
          : null;
      const prompt =
        !model.benchmark?.promptTokensPerSecond && promptReference && model.activeParameterCount
          ? (promptReference.benchmark!.promptTokensPerSecond! *
              promptReference.activeParameterCount!) /
            model.activeParameterCount
          : null;
      return [model.id, { generation: gen, prompt }] as const;
    }),
  );
}

/** About 4k tokens of plain code; a fresh first line keeps Ollama's prompt cache from skipping it. */
export function benchmarkPrompt(nonce: string) {
  const lines = [`// run ${nonce}`];
  for (let index = 0; index < 160; index++) {
    lines.push(
      `export function step${index}(value: number, scale = ${(index % 9) + 1}): number { return value * scale + ${index % 13}; }`,
    );
  }
  lines.push("", "In two sentences, say what the code above does.");
  return lines.join("\n");
}
