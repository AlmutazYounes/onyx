import * as NodeOS from "node:os";
import {
  L3_LOCAL_MODEL,
  L3_LOCAL_MODELS,
  L3_OLLAMA_BASE_URL,
  l3CanonicalModelId,
  LocalModelBenchmark,
  LocalModelError,
  type LocalModelInfo,
  type LocalModelsSnapshot,
} from "@t3tools/contracts";
import {
  readL3ModelRate,
  readL3ModelRatesByModel,
} from "@t3tools/provider-opencode/server/L3ModelMeter";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import {
  benchmarkPrompt,
  estimateSpeeds,
  gpuMemoryBudgetBytes,
  parseOllamaShow,
  type LocalModelSpecs,
} from "./localModelSpecs.ts";

export class LocalModels extends Context.Service<
  LocalModels,
  {
    readonly read: Effect.Effect<LocalModelsSnapshot>;
    readonly measure: (model: string) => Effect.Effect<LocalModelBenchmark, LocalModelError>;
    /** Loads a model into memory now, or frees it; Onyx's keep-warm leaves an unloaded one alone. */
    readonly setLoaded: (model: string, loaded: boolean) => Effect.Effect<void, LocalModelError>;
  }
>()("t3/localModels/LocalModels") {}

const ollamaUrl = (path: string) => new URL(path, L3_OLLAMA_BASE_URL).toString();
const stripLatest = (name: string) => name.replace(/:latest$/, "");

const OllamaTags = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      size: Schema.optional(Schema.Number),
      digest: Schema.optional(Schema.String),
      details: Schema.optional(
        Schema.Struct({
          family: Schema.optional(Schema.String),
          quantization_level: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
});
const OllamaRunning = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      size_vram: Schema.optional(Schema.Number),
      context_length: Schema.optional(Schema.Number),
    }),
  ),
});
const OllamaVersion = Schema.Struct({ version: Schema.String });
const OllamaShowResponse = Schema.Struct({
  parameters: Schema.optional(Schema.String),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
  details: Schema.optional(Schema.Struct({ quantization_level: Schema.optional(Schema.String) })),
  model_info: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const OllamaChatResult = Schema.Struct({
  load_duration: Schema.optional(Schema.Number),
  prompt_eval_count: Schema.optional(Schema.Number),
  prompt_eval_duration: Schema.optional(Schema.Number),
  eval_count: Schema.optional(Schema.Number),
  eval_duration: Schema.optional(Schema.Number),
});
const OllamaError = Schema.Struct({ error: Schema.String });
const decodeOllamaError = Schema.decodeUnknownOption(OllamaError);
const decodeOllamaChatResult = Schema.decodeUnknownEffect(OllamaChatResult);
const decodeOllamaShow = Schema.decodeUnknownEffect(OllamaShowResponse);

/** Measurements kept across restarts, keyed by model digest so a rebuilt model starts over. */
const SavedMeasurements = Schema.Struct({
  version: Schema.Literal(1),
  models: Schema.Record(
    Schema.String,
    Schema.Struct({
      benchmark: Schema.optional(LocalModelBenchmark),
      memory: Schema.optional(
        Schema.Struct({ bytes: Schema.Number, contextTokens: Schema.Number }),
      ),
    }),
  ),
});
type SavedMeasurements = typeof SavedMeasurements.Type;
const decodeSaved = Schema.decodeUnknownOption(Schema.fromJsonString(SavedMeasurements));
const encodeSaved = Schema.encodeSync(Schema.fromJsonString(SavedMeasurements));

const perSecond = (count: number | undefined, nanos: number | undefined) =>
  count && nanos ? (count * 1e9) / nanos : null;

const make = Effect.fn("makeLocalModels")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const savedPath = path.join(NodeOS.homedir(), ".l3", "models", "measurements.json");

  const showCache = new Map<string, LocalModelSpecs>();
  const measuring = yield* Ref.make(false);
  const saved = yield* Ref.make<SavedMeasurements>(
    Option.getOrElse(
      decodeSaved(yield* fs.readFileString(savedPath).pipe(Effect.orElseSucceed(() => ""))),
      () => ({ version: 1 as const, models: {} }),
    ),
  );
  const persist = Effect.fn("LocalModels.persist")(function* (
    update: (current: SavedMeasurements) => SavedMeasurements,
  ) {
    const next = yield* Ref.updateAndGet(saved, update);
    yield* fs.makeDirectory(path.dirname(savedPath), { recursive: true }).pipe(Effect.ignore);
    yield* fs.writeFileString(savedPath, encodeSaved(next)).pipe(Effect.ignore);
  });

  const getJson = <S extends Schema.Top>(url: string, schema: S) =>
    http.execute(HttpClientRequest.get(url)).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.timeout("2 seconds"),
      Effect.option,
    );

  const show = Effect.fn("LocalModels.show")(function* (name: string, digest: string | undefined) {
    const cached = digest ? showCache.get(digest) : undefined;
    if (cached) return cached;
    const response = yield* http
      .execute(
        HttpClientRequest.post(ollamaUrl("/api/show")).pipe(
          HttpClientRequest.bodyJsonUnsafe({ model: name }),
        ),
      )
      .pipe(
        Effect.flatMap((result) => result.json),
        Effect.flatMap(decodeOllamaShow),
        Effect.timeout("3 seconds"),
        Effect.option,
      );
    if (Option.isNone(response)) return null;
    const specs = parseOllamaShow(response.value);
    if (digest) showCache.set(digest, specs);
    return specs;
  });

  const read = Effect.fn("LocalModels.read")(function* () {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const [tags, running, version] = yield* Effect.all(
      [
        getJson(ollamaUrl("/api/tags"), OllamaTags),
        getJson(ollamaUrl("/api/ps"), OllamaRunning),
        getJson(ollamaUrl("/api/version"), OllamaVersion),
      ],
      { concurrency: "unbounded" },
    );
    const installed = Option.match(tags, { onNone: () => [], onSome: (value) => value.models });
    const loaded = new Map(
      Option.match(running, { onNone: () => [], onSome: (value) => value.models }).map(
        // A model loaded before Onyx renamed it still runs under its old name.
        (model) => [l3CanonicalModelId(model.name), model] as const,
      ),
    );
    const inUseRates = readL3ModelRatesByModel();

    // Remember what each loaded model really takes, so the page can show it once unloaded.
    const seen = installed.flatMap((model) => {
      const live = loaded.get(stripLatest(model.name));
      return model.digest && live?.size_vram && live.context_length
        ? [{ digest: model.digest, bytes: live.size_vram, contextTokens: live.context_length }]
        : [];
    });
    const current = yield* Ref.get(saved);
    if (
      seen.some(
        (entry) =>
          current.models[entry.digest]?.memory?.bytes !== entry.bytes ||
          current.models[entry.digest]?.memory?.contextTokens !== entry.contextTokens,
      )
    ) {
      yield* persist((value) => ({
        ...value,
        models: {
          ...value.models,
          ...Object.fromEntries(
            seen.map((entry) => [
              entry.digest,
              {
                ...value.models[entry.digest],
                memory: { bytes: entry.bytes, contextTokens: entry.contextTokens },
              },
            ]),
          ),
        },
      }));
    }
    const measurements = (yield* Ref.get(saved)).models;

    const specs = yield* Effect.forEach(installed, (model) => show(model.name, model.digest), {
      concurrency: 4,
    });
    const installedIds = new Set(installed.map((model) => stripLatest(model.name)));
    const picker = new Map(L3_LOCAL_MODELS.map((model) => [model.id, model] as const));

    const rows = [
      ...installed.map((model, index) => {
        const id = stripLatest(model.name);
        const spec = specs[index] ?? null;
        const saved = model.digest ? measurements[model.digest] : undefined;
        const live = loaded.get(id);
        const contextTokens = spec?.contextTokens ?? null;
        const savedMemory =
          saved?.memory && saved.memory.contextTokens === contextTokens ? saved.memory.bytes : null;
        const estimatedMemory =
          model.size !== undefined ? model.size + (spec?.kvCacheBytes ?? 0) : null;
        const memoryBytes = live?.size_vram ?? savedMemory ?? estimatedMemory;
        return {
          id,
          name:
            picker.get(id)?.name.replace(/ \(local.*\)$/, "") ??
            spec?.basename?.replace(/-/g, " ") ??
            id,
          installed: true,
          inPicker: picker.has(id),
          isDefault: id === L3_LOCAL_MODEL,
          installCommand: null,
          digest: model.digest ?? null,
          family: model.details?.family ?? spec?.architecture ?? null,
          license: spec?.license ?? null,
          sizeBytes: model.size ?? null,
          parameterCount: spec?.parameterCount ?? null,
          activeParameterCount: spec?.activeParameterCount ?? null,
          experts: spec?.experts ?? null,
          quantization: spec?.quantization ?? model.details?.quantization_level ?? null,
          bitsPerWeight:
            model.size && spec?.parameterCount ? (model.size * 8) / spec.parameterCount : null,
          contextTokens,
          maxContextTokens: spec?.maxContextTokens ?? null,
          parameters: spec?.parameters ?? [],
          capabilities: spec?.capabilities ?? [],
          loadedMemoryBytes: live?.size_vram ?? null,
          memoryBytes: memoryBytes === null ? null : Math.round(memoryBytes),
          memoryEstimated: live?.size_vram === undefined && savedMemory === null,
          benchmark: saved?.benchmark ?? null,
          inUse: inUseRates.get(id) ?? null,
          estimatedGenerationTokensPerSecond: null,
          estimatedPromptTokensPerSecond: null,
        } satisfies LocalModelInfo;
      }),
      ...L3_LOCAL_MODELS.filter((model) => !installedIds.has(model.id)).map(
        (model) =>
          ({
            id: model.id,
            name: model.name.replace(/ \(local.*\)$/, ""),
            installed: false,
            inPicker: false,
            isDefault: model.id === L3_LOCAL_MODEL,
            installCommand: model.installCommand,
            digest: null,
            family: null,
            license: null,
            sizeBytes: null,
            parameterCount: null,
            activeParameterCount: null,
            experts: null,
            quantization: null,
            bitsPerWeight: null,
            contextTokens: null,
            maxContextTokens: null,
            parameters: [],
            capabilities: [],
            loadedMemoryBytes: null,
            memoryBytes: null,
            memoryEstimated: true,
            benchmark: null,
            inUse: null,
            estimatedGenerationTokensPerSecond: null,
            estimatedPromptTokensPerSecond: null,
          }) satisfies LocalModelInfo,
      ),
    ];
    const estimates = estimateSpeeds(
      rows.map((row) => ({ ...row, inUseTokensPerSecond: row.inUse?.tokensPerSecond ?? null })),
    );
    const totalMemoryBytes = NodeOS.totalmem();
    return {
      readAt: now,
      host: {
        chip: NodeOS.cpus()[0]?.model.trim() || "Unknown processor",
        totalMemoryBytes,
        gpuMemoryBudgetBytes: gpuMemoryBudgetBytes(totalMemoryBytes),
      },
      ollama: {
        running: Option.isSome(tags),
        version: Option.match(version, { onNone: () => null, onSome: (value) => value.version }),
      },
      busy: readL3ModelRate(now).generating,
      models: rows
        .map((row) => ({
          ...row,
          estimatedGenerationTokensPerSecond: estimates.get(row.id)?.generation ?? null,
          estimatedPromptTokensPerSecond: estimates.get(row.id)?.prompt ?? null,
        }))
        .toSorted(
          (a, b) =>
            Number(b.isDefault) - Number(a.isDefault) ||
            Number(b.inPicker) - Number(a.inPicker) ||
            Number(b.installed) - Number(a.installed) ||
            a.name.localeCompare(b.name),
        ),
    } satisfies LocalModelsSnapshot;
  });

  const runBenchmark = Effect.fn("LocalModels.runBenchmark")(function* (model: string) {
    const fail = (message: string) => Effect.fail(new LocalModelError({ message }));
    const tags = yield* getJson(ollamaUrl("/api/tags"), OllamaTags);
    if (Option.isNone(tags)) return yield* fail("Ollama is not running.");
    const entry = tags.value.models.find((candidate) => stripLatest(candidate.name) === model);
    if (!entry) return yield* fail(`${model} is not installed.`);
    const spec = yield* show(entry.name, entry.digest);
    if (spec && spec.capabilities.length > 0 && !spec.capabilities.includes("completion")) {
      return yield* fail(`${model} does not generate text.`);
    }

    const startedAt = DateTime.toEpochMillis(yield* DateTime.now);
    // No num_ctx or keep_alive: either would make Ollama reload the model agents are using.
    const response = yield* http
      .execute(
        HttpClientRequest.post(ollamaUrl("/api/chat")).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            model: entry.name,
            messages: [{ role: "user", content: benchmarkPrompt(String(startedAt)) }],
            stream: false,
            options: { num_predict: 256, temperature: 0 },
          }),
        ),
      )
      .pipe(
        Effect.flatMap((result) => result.json),
        Effect.timeout("4 minutes"),
        Effect.mapError(() => new LocalModelError({ message: "Ollama did not answer." })),
      );
    const failure = decodeOllamaError(response);
    if (Option.isSome(failure)) return yield* fail(failure.value.error || "Ollama failed.");
    const result = yield* decodeOllamaChatResult(response).pipe(
      Effect.mapError(() => new LocalModelError({ message: "Ollama returned no timings." })),
    );
    const benchmark = {
      measuredAt: DateTime.toEpochMillis(yield* DateTime.now),
      promptTokensPerSecond: perSecond(result.prompt_eval_count, result.prompt_eval_duration),
      generationTokensPerSecond: perSecond(result.eval_count, result.eval_duration),
      promptTokens: Math.round(result.prompt_eval_count ?? 0),
      generatedTokens: Math.round(result.eval_count ?? 0),
      loadMs: Math.round((result.load_duration ?? 0) / 1e6),
    } satisfies LocalModelBenchmark;
    if (entry.digest) {
      const digest = entry.digest;
      yield* persist((value) => ({
        ...value,
        models: { ...value.models, [digest]: { ...value.models[digest], benchmark } },
      }));
    }
    return benchmark;
  });

  const measure = Effect.fn("LocalModels.measure")(function* (model: string) {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    if (readL3ModelRate(now).generating) {
      return yield* new LocalModelError({
        message: "An agent is using the local model. Measure when it finishes.",
      });
    }
    if (!(yield* Ref.getAndSet(measuring, true))) {
      return yield* runBenchmark(model).pipe(Effect.ensuring(Ref.set(measuring, false)));
    }
    return yield* new LocalModelError({ message: "Another model is being measured." });
  });

  const setLoaded = Effect.fn("LocalModels.setLoaded")(function* (model: string, loaded: boolean) {
    const tags = yield* getJson(ollamaUrl("/api/tags"), OllamaTags);
    if (Option.isNone(tags))
      return yield* new LocalModelError({ message: "Ollama is not running." });
    const entry = tags.value.models.find((candidate) => stripLatest(candidate.name) === model);
    if (!entry) return yield* new LocalModelError({ message: `${model} is not installed.` });
    // A generate call with no prompt only loads or unloads; keep_alive 0 frees the memory now.
    yield* http
      .execute(
        HttpClientRequest.post(ollamaUrl("/api/generate")).pipe(
          HttpClientRequest.bodyJsonUnsafe({ model: entry.name, keep_alive: loaded ? "10m" : 0 }),
        ),
      )
      .pipe(
        Effect.flatMap((response) => response.text),
        Effect.timeout("2 minutes"),
        Effect.mapError(
          () =>
            new LocalModelError({
              message: loaded ? `Could not load ${model}.` : `Could not unload ${model}.`,
            }),
        ),
      );
  });

  return LocalModels.of({ read: read(), measure, setLoaded });
});

export const layer = Layer.effect(LocalModels, make());
