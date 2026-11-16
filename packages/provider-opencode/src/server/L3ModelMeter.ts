// @effect-diagnostics-next-line nodeBuiltinImport:off -- A raw proxy server must stream bytes through untouched.
import * as NodeHttp from "node:http";

import {
  L3_LEGACY_MODEL_IDS,
  l3CanonicalModelId,
  l3ContextTokensFor,
  type ModelContextBreakdown,
} from "@t3tools/contracts";

import { analyzeChatRequest, threadKeyOf, toContextBreakdown } from "./L3ContextBreakdown.ts";
import { streamChatCompletion } from "./L3ChatStream.ts";
import { ollamaChatRequestBody } from "./L3OllamaRequest.ts";

/**
 * Tracks generation speed for Onyx's local model. Ollama reports no live rate, so OpenCode reaches
 * Ollama through this proxy, which counts streamed chunks (one token each) per response.
 */
export interface TokenRateMeter {
  readonly begin: () => StreamMeter;
  /** Summed live rate of active streams, or the last finished stream's rate. */
  readonly read: (now: number) => {
    readonly generating: boolean;
    readonly tokensPerSecond: number | null;
  };
}

export interface StreamMeter {
  readonly token: (at: number) => void;
  /** `completionTokens` comes from the final usage chunk when the API sends one. */
  readonly end: (
    at: number,
    completionTokens?: number,
  ) => { readonly tokens: number; readonly tokensPerSecond: number | null };
}

// A stream silent this long is waiting on a tool call, not generating.
const IDLE_AFTER_MS = 1_500;

export function makeTokenRateMeter(): TokenRateMeter {
  const active = new Set<{ first: number; last: number; count: number }>();
  let lastRate: number | null = null;
  const rate = (stream: { first: number; last: number; count: number }, until: number) =>
    stream.count > 1 && until > stream.first
      ? ((stream.count - 1) * 1000) / (until - stream.first)
      : null;
  return {
    begin: () => {
      const stream = { first: 0, last: 0, count: 0 };
      active.add(stream);
      return {
        token: (at) => {
          if (stream.count === 0) stream.first = at;
          stream.last = at;
          stream.count++;
        },
        end: (at, completionTokens) => {
          active.delete(stream);
          if (completionTokens !== undefined && completionTokens > stream.count) {
            stream.count = completionTokens;
          }
          const finished = rate(stream, stream.last || at);
          lastRate = finished ?? lastRate;
          return { tokens: stream.count, tokensPerSecond: finished };
        },
      };
    },
    read: (now) => {
      let total = 0;
      let generating = false;
      for (const stream of active) {
        if (stream.count === 0 || now - stream.last > IDLE_AFTER_MS) continue;
        const live = rate(stream, stream.last);
        if (live === null) continue;
        generating = true;
        total += live;
      }
      return { generating, tokensPerSecond: generating ? total : lastRate };
    },
  };
}

/** Feeds one server-sent-events body through `meter`, one `data:` line at a time. */
export interface StreamUsage {
  readonly promptTokens: number | null;
  readonly tokens: number;
  readonly tokensPerSecond: number | null;
}

export function makeSseTokenParser(
  stream: StreamMeter,
  now: () => number,
  onEnd: (usage: StreamUsage) => void = () => {},
) {
  let buffer = "";
  let completionTokens: number | undefined;
  let promptTokens: number | null = null;
  const line = (text: string) => {
    if (!text.startsWith("data:")) return;
    const data = text.slice(5).trim();
    if (data === "" || data === "[DONE]") return;
    try {
      const chunk = JSON.parse(data) as {
        choices?: ReadonlyArray<{ delta?: Record<string, unknown> }>;
        usage?: { completion_tokens?: number; prompt_tokens?: number };
      };
      if (typeof chunk.usage?.completion_tokens === "number") {
        completionTokens = chunk.usage.completion_tokens;
      }
      if (typeof chunk.usage?.prompt_tokens === "number") promptTokens = chunk.usage.prompt_tokens;
      const delta = chunk.choices?.[0]?.delta;
      if (
        delta &&
        (delta.content || delta.reasoning || delta.reasoning_content || delta.tool_calls)
      ) {
        stream.token(now());
      }
    } catch {}
  };
  return {
    push: (text: string) => {
      buffer += text;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        line(buffer.slice(0, newline).trimEnd());
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    },
    end: () => {
      if (buffer) line(buffer.trimEnd());
      onEnd({ promptTokens, ...stream.end(now(), completionTokens) });
    },
  };
}

const MAX_ANALYZED_BODY_BYTES = 32 * 1024 * 1024;

/** What the proxy reports about one chat request as it streams. */
export interface RequestHooks {
  readonly onToken?: (at: number) => void;
  readonly onEnd: (usage: StreamUsage) => void;
}

const withTokenHook = (stream: StreamMeter, onToken: (at: number) => void): StreamMeter => ({
  token: (at) => {
    stream.token(at);
    onToken(at);
  },
  end: stream.end,
});

/** Starts the metering proxy on a free loopback port; resolves to its port. */
function startLocalModelProxy(input: {
  readonly meter: TokenRateMeter;
  readonly upstream: URL;
  /** Sees each chat request body; its result receives the prompt token count when known. */
  readonly onChatRequest?: (body: unknown) => RequestHooks;
}): Promise<{ readonly port: number; readonly close: () => void }> {
  const server = NodeHttp.createServer((request, response) => {
    const isChat = request.method === "POST" && request.url?.includes("/chat/completions");
    if (!isChat) {
      passThrough(request, response);
      return;
    }
    // Chat bodies are read whole so they can be adjusted for Ollama before they go on.
    const bodyChunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(bodyChunks);
      let hooks: RequestHooks = { onEnd: () => {} };
      // Past this size the body is not worth parsing for the meter; the request still goes through.
      if (input.onChatRequest && body.length <= MAX_ANALYZED_BODY_BYTES) {
        try {
          hooks = input.onChatRequest(JSON.parse(body.toString("utf8")));
        } catch {}
      }
      const parser = makeSseTokenParser(
        withTokenHook(input.meter.begin(), (at) => hooks.onToken?.(at)),
        Date.now,
        (usage) => hooks.onEnd(usage),
      );
      streamChatCompletion({
        upstream: input.upstream,
        request,
        response,
        body: ollamaChatRequestBody(body),
        onText: parser.push,
        onEnd: parser.end,
      });
    });
  });

  function passThrough(request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) {
    const upstream = NodeHttp.request(
      {
        hostname: input.upstream.hostname,
        port: input.upstream.port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: input.upstream.host },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  }
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

const l3Meter = makeTokenRateMeter();
let l3Proxy: Promise<string | null> | undefined;
// Latest request per thread; bounded so long-lived servers do not keep every thread forever.
const l3Contexts = new Map<string, ModelContextBreakdown>();
const MAX_TRACKED_THREADS = 64;

// Last reply rate per Ollama model; short replies (titles) are too noisy to keep.
const l3ModelRates = new Map<
  string,
  { readonly measuredAt: number; readonly tokensPerSecond: number }
>();
const MIN_RATED_REPLY_TOKENS = 64;

/** The process-wide meter that `ensureL3ModelProxy` feeds. */
export const readL3ModelRate = (now: number) => l3Meter.read(now);

/** Reply rates the proxy saw per model (`onyx-qwen`, not `onyx-qwen:latest`). */
export const readL3ModelRatesByModel = (): ReadonlyMap<
  string,
  { readonly measuredAt: number; readonly tokensPerSecond: number }
> => l3ModelRates;

/** What filled the model's context on the thread's latest request, or null before one. */
// The newest request per thread, as it happens: reading the prompt, then writing.
const l3Live = new Map<string, LiveRequest>();
interface LiveRequest {
  startedAt: number;
  firstTokenAt: number | null;
  lastTokenAt: number | null;
  finishedAt: number | null;
  promptTokens: number;
  tokens: number;
}

export const readL3ModelContext = (threadId: string) => {
  const key = threadKeyOf(threadId);
  const breakdown = l3Contexts.get(key);
  if (!breakdown) return null;
  const live = l3Live.get(key);
  return live ? { ...breakdown, live: { ...live } } : breakdown;
};

const recordModelRate = (body: unknown, usage: StreamUsage) => {
  const model = (body as { model?: unknown } | null)?.model;
  if (typeof model !== "string" || usage.tokensPerSecond === null) return;
  if (usage.tokens < MIN_RATED_REPLY_TOKENS) return;
  l3ModelRates.set(model.replace(/:latest$/, ""), {
    // @effect-diagnostics-next-line globalDate:off -- the proxy runs on Node callbacks, outside Effect.
    measuredAt: Date.now(),
    tokensPerSecond: usage.tokensPerSecond,
  });
};

// Working directory of each recent agent request, from OpenCode's <env> block, newest last.
const recentDirectories = new Map<string, number>();
const DIRECTORY_WINDOW_MS = 10 * 60_000;

export const recordWorkingDirectory = (body: unknown, now: number) => {
  const system = (
    body as { messages?: ReadonlyArray<{ role?: string; content?: unknown }> } | null
  )?.messages?.find((message) => message.role === "system")?.content;
  const directory =
    typeof system === "string" ? /^\s*Working directory: (\/.+)$/m.exec(system)?.[1]?.trim() : null;
  if (!directory) return;
  recentDirectories.delete(directory);
  recentDirectories.set(directory, now);
  for (const [entry, at] of recentDirectories) {
    if (now - at > DIRECTORY_WINDOW_MS) recentDirectories.delete(entry);
  }
};

/**
 * The directory the local agent is working in, for tools that cannot ask OpenCode. Null when
 * agents in different directories ran recently, since a tool call cannot say which one it is.
 */
export const readL3WorkingDirectory = (now: number): string | null => {
  const live = [...recentDirectories].filter(([, at]) => now - at <= DIRECTORY_WINDOW_MS);
  return live.length === 1 ? live[0]![0] : null;
};

// The model the agents used last, and when, so idle Ollama keeps it and its prompt cache loaded.
let lastAgentRequest: { readonly model: string; readonly at: number } | null = null;

export const recordChatRequest = (body: unknown): RequestHooks => {
  // @effect-diagnostics-next-line globalDate:off -- the proxy runs on Node callbacks, outside Effect.
  const now = Date.now();
  recordWorkingDirectory(body, now);
  const model = (body as { model?: unknown } | null)?.model;
  if (typeof model === "string") lastAgentRequest = { model, at: now };
  const shape = analyzeChatRequest(body);
  const key = shape?.threadKey;
  if (!shape || !key) return { onEnd: (usage: StreamUsage) => recordModelRate(body, usage) };
  const store = (promptTokens: number | null) => {
    l3Contexts.delete(key);
    l3Contexts.set(
      key,
      toContextBreakdown({
        shape,
        promptTokens,
        contextTokens: l3ContextTokensFor((body as { model?: string } | null)?.model),
        // @effect-diagnostics-next-line globalDate:off -- the proxy runs on Node callbacks, outside Effect.
        measuredAt: Date.now(),
      }),
    );
    if (l3Contexts.size > MAX_TRACKED_THREADS) {
      l3Contexts.delete(l3Contexts.keys().next().value!);
    }
  };
  // Show the estimate at once; the usage report replaces it when the response ends.
  store(null);
  const live: LiveRequest = {
    startedAt: now,
    firstTokenAt: null,
    lastTokenAt: null,
    finishedAt: null,
    promptTokens: l3Contexts.get(key)?.usedTokens ?? 0,
    tokens: 0,
  };
  l3Live.delete(key);
  l3Live.set(key, live);
  if (l3Live.size > MAX_TRACKED_THREADS) l3Live.delete(l3Live.keys().next().value!);
  return {
    onToken: (at: number) => {
      live.firstTokenAt ??= at;
      live.lastTokenAt = at;
      live.tokens++;
    },
    onEnd: (usage: StreamUsage) => {
      recordModelRate(body, usage);
      store(usage.promptTokens);
      // @effect-diagnostics-next-line globalDate:off -- the proxy runs on Node callbacks, outside Effect.
      live.finishedAt = Date.now();
      live.promptTokens = usage.promptTokens ?? live.promptTokens;
      live.tokens = Math.max(live.tokens, usage.tokens);
    },
  };
};

/**
 * Starts the process-wide proxy once and resolves to its OpenAI-compatible base URL, or null when
 * it could not start (OpenCode then talks to Ollama directly and no rate is shown).
 */
export function ensureL3ModelProxy(upstreamBaseUrl: string): Promise<string | null> {
  l3Proxy ??= startLocalModelProxy({
    meter: l3Meter,
    upstream: new URL(upstreamBaseUrl),
    onChatRequest: recordChatRequest,
  }).then(
    ({ port }) => `http://127.0.0.1:${port}${new URL(upstreamBaseUrl).pathname}`,
    () => null,
  );
  return l3Proxy;
}

// Ollama unloads a model 5 idle minutes after a request, and the next turn then reloads ~14 GB and
// re-reads the whole conversation. While agents were busy recently, keep it loaded instead.
const KEEP_WARM_AFTER_ACTIVITY_MS = 30 * 60_000;
const KEEP_WARM_EVERY_MS = 4 * 60_000;
const KEEP_WARM_FOR = "10m";

/** Whether to ping Ollama now, and for which model: only within the window after agent work. */
export const keepWarmTarget = (
  last: { readonly model: string; readonly at: number } | null,
  now: number,
): string | null => (last && now - last.at <= KEEP_WARM_AFTER_ACTIVITY_MS ? last.model : null);

/** Whether Ollama's `/api/ps` reply lists `model`, with or without its `:latest` tag. */
export const isOllamaModelLoaded = (running: unknown, model: string) => {
  const name = l3CanonicalModelId(model);
  const models = (running as { models?: ReadonlyArray<{ name?: unknown }> } | null)?.models ?? [];
  return models.some(
    (entry) => typeof entry.name === "string" && l3CanonicalModelId(entry.name) === name,
  );
};

let keepWarm: ReturnType<typeof setInterval> | undefined;

/** Starts the process-wide keep-warm timer once; a model loads with no prompt, so nothing runs. */
export function ensureL3KeepWarm(ollamaBaseUrl: string) {
  // @effect-diagnostics-next-line globalTimers:off -- process-wide, like the metering proxy it serves.
  keepWarm ??= setInterval(() => {
    // @effect-diagnostics-next-line globalDate:off -- a Node timer, outside Effect.
    const model = keepWarmTarget(lastAgentRequest, Date.now());
    if (!model) return;
    void (async () => {
      // Refresh only a model that is still loaded, so one the user unloaded stays unloaded.
      // @effect-diagnostics-next-line globalFetch:off -- a fire-and-forget ping from a Node timer.
      const running = await fetch(new URL("/api/ps", ollamaBaseUrl), {
        signal: AbortSignal.timeout(5_000),
      }).then((response) => response.json());
      if (!isOllamaModelLoaded(running, model)) return;
      // @effect-diagnostics-next-line globalFetch:off -- a fire-and-forget ping from a Node timer.
      await fetch(new URL("/api/generate", ollamaBaseUrl), {
        method: "POST",
        body: JSON.stringify({ model, keep_alive: KEEP_WARM_FOR }),
        signal: AbortSignal.timeout(60_000),
      });
    })().catch(() => {});
  }, KEEP_WARM_EVERY_MS);
  keepWarm.unref();
}

/** What renaming an old install takes: copy each old name unless the new one exists, then drop it. */
export const planL3ModelRenames = (installed: ReadonlySet<string>) =>
  Object.entries(L3_LEGACY_MODEL_IDS)
    .filter(([legacy]) => installed.has(legacy))
    .map(([legacy, current]) => ({ legacy, current, copy: !installed.has(current) }));

/**
 * Moves models installed under Onyx's old names (`l3-coder`) to the current ones. A copy only
 * writes a new manifest for the same weights, so this is instant and uses no disk.
 */
export async function migrateL3ModelNames(ollamaBaseUrl: string): Promise<void> {
  const installed = await listInstalledL3Models(ollamaBaseUrl);
  if (!installed) return;
  for (const { legacy, current, copy } of planL3ModelRenames(installed)) {
    try {
      if (copy) {
        // @effect-diagnostics-next-line globalFetch:off -- one-time Ollama upkeep before OpenCode starts.
        const copied = await fetch(new URL("/api/copy", ollamaBaseUrl), {
          method: "POST",
          body: JSON.stringify({ source: legacy, destination: current }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!copied.ok) continue;
      }
      // @effect-diagnostics-next-line globalFetch:off -- one-time Ollama upkeep before OpenCode starts.
      await fetch(new URL("/api/delete", ollamaBaseUrl), {
        method: "DELETE",
        body: JSON.stringify({ model: legacy }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {}
  }
}

/** Ollama models installed on this machine, or undefined when Ollama does not answer in time. */
export async function listInstalledL3Models(
  ollamaBaseUrl: string,
): Promise<ReadonlySet<string> | undefined> {
  try {
    // @effect-diagnostics-next-line globalFetch:off -- a wall-clock probe; providers' HttpClients may be test doubles.
    const response = await fetch(new URL("/api/tags", ollamaBaseUrl), {
      signal: AbortSignal.timeout(2_000),
    });
    const body = (await response.json()) as { models?: ReadonlyArray<{ name?: unknown }> };
    return new Set(
      (body.models ?? [])
        .map((model) => (typeof model.name === "string" ? model.name.replace(/:latest$/, "") : ""))
        .filter(Boolean),
    );
  } catch {
    return undefined;
  }
}
