import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const Rate = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

/** A short fixed run against Ollama: how fast this machine reads a prompt and writes a reply. */
export const LocalModelBenchmark = Schema.Struct({
  measuredAt: NonNegativeInt,
  /** Prompt reading (prefill), from Ollama's own prompt_eval counters. */
  promptTokensPerSecond: Schema.NullOr(Rate),
  /** Reply writing (decode), from Ollama's own eval counters. */
  generationTokensPerSecond: Schema.NullOr(Rate),
  promptTokens: NonNegativeInt,
  generatedTokens: NonNegativeInt,
  /** Time Ollama spent loading the weights first; 0 when the model was already loaded. */
  loadMs: NonNegativeInt,
});
export type LocalModelBenchmark = typeof LocalModelBenchmark.Type;

export const LocalModelInfo = Schema.Struct({
  /** Ollama model name without `:latest`. */
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  installed: Schema.Boolean,
  /** Offered in Onyx's model picker (an installed `L3_LOCAL_MODELS` entry). */
  inPicker: Schema.Boolean,
  isDefault: Schema.Boolean,
  /** How to install a picker model that is missing. */
  installCommand: Schema.NullOr(Schema.String),
  digest: Schema.NullOr(Schema.String),
  family: Schema.NullOr(Schema.String),
  license: Schema.NullOr(Schema.String),
  sizeBytes: Schema.NullOr(NonNegativeInt),
  parameterCount: Schema.NullOr(NonNegativeInt),
  /** Parameters used per token; below `parameterCount` only for mixture-of-experts models. */
  activeParameterCount: Schema.NullOr(NonNegativeInt),
  experts: Schema.NullOr(Schema.Struct({ total: NonNegativeInt, used: NonNegativeInt })),
  quantization: Schema.NullOr(Schema.String),
  bitsPerWeight: Schema.NullOr(Rate),
  /** The context window Onyx runs it with (`num_ctx`), and the most the model supports. */
  contextTokens: Schema.NullOr(NonNegativeInt),
  maxContextTokens: Schema.NullOr(NonNegativeInt),
  parameters: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
  capabilities: Schema.Array(Schema.String),
  /** Memory Ollama holds for it right now; null while unloaded. */
  loadedMemoryBytes: Schema.NullOr(NonNegativeInt),
  /** Memory it needs when loaded: last seen in Ollama, else weights plus an estimated cache. */
  memoryBytes: Schema.NullOr(NonNegativeInt),
  memoryEstimated: Schema.Boolean,
  benchmark: Schema.NullOr(LocalModelBenchmark),
  /** Last reply rate the metering proxy saw while agents used it. */
  inUse: Schema.NullOr(Schema.Struct({ measuredAt: NonNegativeInt, tokensPerSecond: Rate })),
  /** Scaled from a measured model when this one has no measurement of its own. */
  estimatedGenerationTokensPerSecond: Schema.NullOr(Rate),
  estimatedPromptTokensPerSecond: Schema.NullOr(Rate),
});
export type LocalModelInfo = typeof LocalModelInfo.Type;

export const LocalModelsSnapshot = Schema.Struct({
  readAt: NonNegativeInt,
  host: Schema.Struct({
    chip: Schema.String,
    totalMemoryBytes: NonNegativeInt,
    /** What macOS lets the GPU keep resident; a model above this spills or swaps. */
    gpuMemoryBudgetBytes: NonNegativeInt,
  }),
  ollama: Schema.Struct({ running: Schema.Boolean, version: Schema.NullOr(Schema.String) }),
  /** A local model is writing a reply now; measuring then would slow or evict it. */
  busy: Schema.Boolean,
  models: Schema.Array(LocalModelInfo),
});
export type LocalModelsSnapshot = typeof LocalModelsSnapshot.Type;

export const ServerMeasureLocalModelInput = Schema.Struct({ model: TrimmedNonEmptyString });
export type ServerMeasureLocalModelInput = typeof ServerMeasureLocalModelInput.Type;

export const ServerSetLocalModelLoadedInput = Schema.Struct({
  model: TrimmedNonEmptyString,
  loaded: Schema.Boolean,
});
export type ServerSetLocalModelLoadedInput = typeof ServerSetLocalModelLoadedInput.Type;

export class LocalModelError extends Schema.TaggedError<LocalModelError>()("LocalModelError", {
  message: TrimmedNonEmptyString,
}) {}
