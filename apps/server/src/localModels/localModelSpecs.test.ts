import { describe, expect, it } from "vite-plus/test";

import { estimateSpeeds, gpuMemoryBudgetBytes, parseOllamaShow } from "./localModelSpecs.ts";

// Trimmed from `ollama show` for the two models scripts/l3-setup.sh installs.
const qwen = {
  parameters:
    "repeat_penalty                 1\ntemperature                    0.6\nnum_ctx                        65536",
  capabilities: ["completion", "tools", "thinking"],
  details: { quantization_level: "IQ3_S" },
  model_info: {
    "general.architecture": "qwen35moe",
    "general.license": "apache-2.0",
    "general.parameter_count": 34_660_610_688,
    "general.size_label": "35B-A3B",
    "qwen35moe.attention.head_count": 16,
    "qwen35moe.attention.head_count_kv": 2,
    "qwen35moe.attention.key_length": 256,
    "qwen35moe.attention.value_length": 256,
    "qwen35moe.block_count": 40,
    "qwen35moe.context_length": 262_144,
    "qwen35moe.embedding_length": 2048,
    "qwen35moe.expert_count": 256,
    "qwen35moe.expert_feed_forward_length": 512,
    "qwen35moe.expert_used_count": 8,
    "qwen35moe.full_attention_interval": 4,
  },
};
const laguna = {
  parameters: "temperature                    1\nnum_ctx                        65536",
  model_info: {
    "general.architecture": "laguna",
    "general.parameter_count": 33_442_617_088,
    "general.size_label": "256x2.2B",
    "laguna.attention.head_count": [48, 64, 64, 64],
    "laguna.attention.head_count_kv": 8,
    "laguna.attention.key_length": 128,
    "laguna.attention.value_length": 128,
    "laguna.attention.sliding_window": 512,
    "laguna.block_count": 40,
    "laguna.context_length": 262_144,
    "laguna.embedding_length": 2048,
    "laguna.expert_count": 256,
    "laguna.expert_feed_forward_length": 512,
    "laguna.expert_used_count": 8,
    "laguna.leading_dense_block_count": 1,
  },
};

describe("parseOllamaShow", () => {
  it("derives active parameters, context and cache size from model info", () => {
    expect(parseOllamaShow(qwen)).toMatchObject({
      parameterCount: 34_660_610_688,
      activeParameterCount: 3_454_988_928,
      experts: { total: 256, used: 8 },
      quantization: "IQ3_S",
      contextTokens: 65_536,
      maxContextTokens: 262_144,
      parameters: [
        { name: "repeat_penalty", value: "1" },
        { name: "temperature", value: "0.6" },
      ],
      // 10 full-attention layers of 40.
      kvCacheBytes: 65_536 * 10 * 2 * 512 * 2,
    });
    expect(parseOllamaShow(laguna)).toMatchObject({
      activeParameterCount: 3_017_135_872,
      // A quarter of layers cache the full context, the rest only their window.
      kvCacheBytes: 65_536 * 10 * 8 * 256 * 2 + 512 * 30 * 8 * 256 * 2,
    });
  });

  it("treats a dense model as all active and tolerates missing keys", () => {
    expect(
      parseOllamaShow({
        model_info: { "general.architecture": "llama", "general.parameter_count": 8e9 },
      }),
    ).toMatchObject({ activeParameterCount: 8e9, experts: null, kvCacheBytes: null });
    expect(parseOllamaShow({})).toMatchObject({ parameterCount: null, contextTokens: null });
  });
});

describe("estimateSpeeds", () => {
  const benchmark = {
    measuredAt: 1,
    promptTokensPerSecond: 900,
    generationTokensPerSecond: 50,
    promptTokens: 4000,
    generatedTokens: 200,
    loadMs: 0,
  };
  const model = (id: string, active: number) => ({
    id,
    sizeBytes: 16e9,
    parameterCount: 32e9,
    activeParameterCount: active,
    benchmark: null,
    inUseTokensPerSecond: null,
  });

  it("scales unmeasured models from a measured one and leaves measured ones alone", () => {
    const estimates = estimateSpeeds([
      { ...model("measured", 3e9), benchmark },
      model("twice-active", 6e9),
    ]);
    expect(estimates.get("measured")).toEqual({ generation: null, prompt: null });
    expect(estimates.get("twice-active")).toEqual({ generation: 25, prompt: 450 });
  });

  it("falls back to the in-use rate and estimates nothing without a measurement", () => {
    expect(
      estimateSpeeds([
        { ...model("used", 3e9), inUseTokensPerSecond: 40 },
        model("other", 3e9),
      ]).get("other"),
    ).toEqual({ generation: 40, prompt: null });
    expect(estimateSpeeds([model("a", 3e9), model("b", 3e9)]).get("b")).toEqual({
      generation: null,
      prompt: null,
    });
  });
});

it("budgets two thirds of a 32 GB Mac's memory for the GPU", () => {
  expect(gpuMemoryBudgetBytes(32 * 2 ** 30)).toBe(Math.round((32 * 2 ** 30 * 2) / 3));
});
