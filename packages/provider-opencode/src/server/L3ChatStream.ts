/**
 * Forwards one chat completion from Ollama to OpenCode, for Onyx's proxy and the eval runner alike.
 * Repairs read calls, and retries without thinking a reply that thinks past the budget before any
 * text or tool call (normal replies stay under ~3,300 tokens; one runaway thought for 26,695).
 */
// @effect-diagnostics-next-line nodeBuiltinImport:off -- A raw proxy server must stream bytes through untouched.
import * as NodeHttp from "node:http";

import { repairSseLine } from "./L3ToolCallRepair.ts";

export const L3_THINKING_BUDGET_TOKENS = 6_000;

/** Counts thinking chunks (Ollama sends about one token each) until the reply starts answering. */
export function makeThinkingWatch(budget: number) {
  let buffer = "";
  let thinking = 0;
  let answering = false;
  return {
    /** True once the reply has thought past the budget without text or a tool call. */
    push(text: string): boolean {
      if (answering) return false;
      buffer += text;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        let delta: Record<string, unknown> | undefined;
        try {
          delta = JSON.parse(line.slice(5)).choices?.[0]?.delta;
        } catch {
          continue;
        }
        if (!delta) continue;
        if (delta.content || delta.tool_calls) {
          answering = true;
          return false;
        }
        if (delta.reasoning || delta.reasoning_content) thinking++;
      }
      return thinking > budget;
    },
  };
}

/** The same request with thinking turned off, as Onyx's Fast reasoning setting sends it. */
export function withoutThinking(body: Buffer): Buffer | null {
  try {
    const request = JSON.parse(body.toString("utf8"));
    if (typeof request !== "object" || request === null || Array.isArray(request)) return null;
    return Buffer.from(JSON.stringify({ ...request, reasoning_effort: "none" }));
  } catch {
    return null;
  }
}

export interface ChatStreamOptions {
  readonly upstream: URL;
  readonly request: NodeHttp.IncomingMessage;
  readonly response: NodeHttp.ServerResponse;
  readonly body: Buffer;
  readonly repairReads?: boolean;
  /** Thinking tokens allowed before a reply is retried without thinking; 0 turns the guard off. */
  readonly thinkingBudget?: number;
  /** Upstream text as it arrives, for metering; a retried reply's text follows the cut one. */
  readonly onText?: (text: string) => void;
  /** Called when a reply was cut for thinking too long and asked again without thinking. */
  readonly onThinkingCut?: () => void;
  /** Called once, when the reply to OpenCode is complete or abandoned. */
  readonly onEnd?: () => void;
}

export function streamChatCompletion(options: ChatStreamOptions) {
  const { response } = options;
  const budget = options.thinkingBudget ?? L3_THINKING_BUDGET_TOKENS;
  let current: NodeHttp.ClientRequest | null = null;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    options.onEnd?.();
  };
  // A stopped turn closes the client side first; stop generating upstream too.
  response.on("close", () => {
    if (!ended) current?.destroy();
    end();
  });

  const send = (body: Buffer, mayCut: boolean) => {
    const headers: NodeHttp.OutgoingHttpHeaders = {
      ...options.request.headers,
      host: options.upstream.host,
      "content-length": String(body.length),
    };
    delete headers["transfer-encoding"];
    const upstream = NodeHttp.request(
      {
        hostname: options.upstream.hostname,
        port: options.upstream.port,
        method: options.request.method,
        path: options.request.url,
        headers,
      },
      (upstreamResponse) => {
        if (!response.headersSent) {
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        }
        const streaming = String(upstreamResponse.headers["content-type"]).includes(
          "text/event-stream",
        );
        const watch = streaming && mayCut && budget > 0 ? makeThinkingWatch(budget) : null;
        // Whole lines only, so a cut never leaves half an event for the retry to run into.
        let pending = "";
        let cut = false;
        upstreamResponse.on("data", (chunk: Buffer) => {
          if (cut) return;
          if (!streaming) {
            options.onText?.(chunk.toString("utf8"));
            response.write(chunk);
            return;
          }
          const text = chunk.toString("utf8");
          options.onText?.(text);
          pending += text;
          const last = pending.lastIndexOf("\n");
          if (last !== -1) {
            const lines = pending.slice(0, last + 1);
            pending = pending.slice(last + 1);
            response.write(
              options.repairReads === false || !lines.includes('"tool_calls"')
                ? lines
                : lines.split("\n").map(repairSseLine).join("\n"),
            );
          }
          if (!watch?.push(text)) return;
          const retry = withoutThinking(body);
          if (retry === null) return;
          cut = true;
          upstream.destroy();
          options.onThinkingCut?.();
          // Close any open event before the retry's first one.
          response.write("\n\n");
          send(retry, false);
        });
        upstreamResponse.on("end", () => {
          if (cut) return;
          if (pending) {
            response.write(options.repairReads === false ? pending : repairSseLine(pending));
          }
          response.end();
          end();
        });
        upstreamResponse.on("error", () => {
          if (cut) return;
          response.destroy();
          end();
        });
      },
    );
    upstream.on("error", () => {
      if (upstream.destroyed && current !== upstream) return;
      if (!response.headersSent) response.writeHead(502);
      response.end();
      end();
    });
    current = upstream;
    upstream.end(body);
  };
  send(options.body, true);
}
