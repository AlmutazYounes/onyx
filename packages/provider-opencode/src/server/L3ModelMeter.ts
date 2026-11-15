// @effect-diagnostics-next-line nodeBuiltinImport:off -- A raw proxy server must stream bytes through untouched.
import * as NodeHttp from "node:http";

/**
 * Tracks generation speed for L3's local model. Ollama reports no live rate, so OpenCode reaches
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
  readonly end: (at: number, completionTokens?: number) => void;
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
          lastRate = rate(stream, stream.last || at) ?? lastRate;
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
export function makeSseTokenParser(stream: StreamMeter, now: () => number) {
  let buffer = "";
  let completionTokens: number | undefined;
  const line = (text: string) => {
    if (!text.startsWith("data:")) return;
    const data = text.slice(5).trim();
    if (data === "" || data === "[DONE]") return;
    try {
      const chunk = JSON.parse(data) as {
        choices?: ReadonlyArray<{ delta?: Record<string, unknown> }>;
        usage?: { completion_tokens?: number };
      };
      if (typeof chunk.usage?.completion_tokens === "number") {
        completionTokens = chunk.usage.completion_tokens;
      }
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
      stream.end(now(), completionTokens);
    },
  };
}

/** Starts the metering proxy on a free loopback port; resolves to its port. */
function startLocalModelProxy(input: {
  readonly meter: TokenRateMeter;
  readonly upstream: URL;
}): Promise<{ readonly port: number; readonly close: () => void }> {
  const server = NodeHttp.createServer((request, response) => {
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
        const streaming = String(upstreamResponse.headers["content-type"]).includes(
          "text/event-stream",
        );
        const parser = streaming ? makeSseTokenParser(input.meter.begin(), Date.now) : null;
        let ended = false;
        const finish = () => {
          if (ended) return;
          ended = true;
          parser?.end();
        };
        upstreamResponse.on("data", (chunk: Buffer) => {
          parser?.push(chunk.toString("utf8"));
          response.write(chunk);
        });
        upstreamResponse.on("end", () => {
          finish();
          response.end();
        });
        upstreamResponse.on("error", () => {
          finish();
          response.destroy();
        });
        // A stopped turn closes the client side first; stop generating upstream too.
        response.on("close", () => {
          if (!ended) upstream.destroy();
          finish();
        });
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });
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

/** The process-wide meter that `ensureL3ModelProxy` feeds. */
export const readL3ModelRate = (now: number) => l3Meter.read(now);

/**
 * Starts the process-wide proxy once and resolves to its OpenAI-compatible base URL, or null when
 * it could not start (OpenCode then talks to Ollama directly and no rate is shown).
 */
export function ensureL3ModelProxy(upstreamBaseUrl: string): Promise<string | null> {
  l3Proxy ??= startLocalModelProxy({ meter: l3Meter, upstream: new URL(upstreamBaseUrl) }).then(
    ({ port }) => `http://127.0.0.1:${port}${new URL(upstreamBaseUrl).pathname}`,
    () => null,
  );
  return l3Proxy;
}
