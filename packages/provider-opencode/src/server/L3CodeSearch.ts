// @effect-diagnostics-next-line nodeBuiltinImport:off -- runs `git grep` from a plain HTTP handler, outside Effect.
import * as NodeChildProcess from "node:child_process";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- a raw MCP endpoint beside the metering proxy.
import * as NodeHttp from "node:http";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- an unguessable path for the loopback endpoint.
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- reads candidate files from a plain HTTP handler.
import * as NodeFSP from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- resolves result paths from a plain HTTP handler.
import * as NodePath from "node:path";

/**
 * Ranked keyword search over a git checkout for the local model. Small models grep for one exact
 * word at a time; this takes several keywords at once, counts them per file with `git grep`, ranks
 * files BM25-style, then returns the best line ranges. There is no index to keep fresh.
 */

const STOPWORDS = new Set(
  (
    "a an and are as at be by can do does for from get set has have how if in into is it its of on or " +
    "so that the their then there these this to use used uses using was what when where which while " +
    "who why will with you your code file files function functions find handled handle make " +
    "off turn not all one new any only also some like into than"
  ).split(" "),
);

/** Query words plus the parts of camelCase and snake_case identifiers, lowercased. */
export function queryTerms(query: string): ReadonlyArray<string> {
  const terms = new Set<string>();
  for (const word of query.split(/[^A-Za-z0-9_$]+/)) {
    if (!word) continue;
    const parts = word
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[\s_$]+/);
    for (const term of [word, ...parts]) {
      const lower = term.toLowerCase();
      if (lower.length >= 3 && !STOPWORDS.has(lower)) terms.add(lower);
    }
  }
  return [...terms].slice(0, 12);
}

export interface FileCounts {
  readonly path: string;
  /** File size in bytes, for length normalization; long files match many words by chance. */
  readonly bytes: number;
  /** Matching lines per term. */
  readonly counts: ReadonlyMap<string, number>;
}

// Vendored copies, generated output and fixtures crowd out the code a question is about.
const pathWeight = (path: string) => {
  if (/(^|\/)(\.[^/]+|vendor|third_party|node_modules|dist|build|generated)\//.test(path))
    return 0.3;
  if (/(^|\/)(__fixtures__|fixtures|testdata)\//.test(path)) return 0.5;
  if (/\.(test|spec)\.[a-z]+$|(^|\/)(test|tests|__tests__)\//.test(path)) return 0.7;
  if (/\.(md|json|lock|ya?ml|txt|snap)$/.test(path)) return 0.7;
  return 1;
};

/** BM25-style file ranking: rare terms count most, repeats saturate, path matches add weight. */
export function rankFiles(
  files: ReadonlyArray<FileCounts>,
  corpus: { readonly files: number; readonly averageBytes: number },
  terms: ReadonlyArray<string>,
) {
  const documentFrequency = new Map<string, number>();
  for (const file of files) {
    for (const term of file.counts.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const idf = (term: string) => {
    const frequency = documentFrequency.get(term) ?? 0;
    return Math.log(1 + (corpus.files - frequency + 0.5) / (frequency + 0.5));
  };
  return files
    .map((file) => {
      const lowerPath = file.path.toLowerCase();
      const lengthNorm = 0.25 + 0.75 * (file.bytes / Math.max(1, corpus.averageBytes));
      let score = 0;
      let matchedWeight = 0;
      let totalWeight = 0;
      for (const term of terms) {
        totalWeight += idf(term);
        const count = file.counts.get(term) ?? 0;
        const inPath = lowerPath.includes(term);
        if (count === 0 && !inPath) continue;
        matchedWeight += idf(term);
        score += idf(term) * ((count * 2.2) / (count + 1.2 * lengthNorm) + (inPath ? 1.5 : 0));
      }
      // Files that match more of the query, weighted by how rare each word is, beat repeats.
      score *= (matchedWeight / Math.max(totalWeight, 1e-9)) ** 2 * pathWeight(file.path);
      return { path: file.path, score, idf };
    })
    .filter((file) => file.score > 0)
    .toSorted((a, b) => b.score - a.score);
}

export interface Snippet {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly score: number;
  readonly lines: ReadonlyArray<{ readonly number: number; readonly text: string }>;
}

const WINDOW = 30;
const DEFINITION =
  /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|const|let|enum|def|struct|impl|fn|func)\b/;

/** The best windows of one file: lines that match terms, with definitions counting extra. */
export function bestWindows(
  path: string,
  text: string,
  terms: ReadonlyArray<string>,
  idf: (term: string) => number,
  fileScore: number,
): ReadonlyArray<Snippet> {
  const lines = text.split("\n");
  const lineScores = lines.map((line) => {
    const lower = line.toLowerCase();
    let score = 0;
    for (const term of terms) if (lower.includes(term)) score += idf(term);
    return score > 0 && DEFINITION.test(line) ? score * 1.5 : score;
  });
  const windows: Snippet[] = [];
  for (let start = 0; start < lines.length; start += WINDOW / 2) {
    const end = Math.min(lines.length, start + WINDOW);
    let score = 0;
    const seen = new Set<string>();
    for (let index = start; index < end; index++) {
      if ((lineScores[index] ?? 0) === 0) continue;
      score += lineScores[index]!;
      const lower = lines[index]!.toLowerCase();
      for (const term of terms) if (lower.includes(term)) seen.add(term);
    }
    if (score === 0) continue;
    const coverage = [...seen].reduce((sum, term) => sum + idf(term), 0);
    const matching = [];
    for (let index = start; index < end && matching.length < 8; index++) {
      if (lineScores[index]! > 0) {
        matching.push({ number: index + 1, text: lines[index]!.trim().slice(0, 160) });
      }
    }
    windows.push({
      path,
      startLine: start + 1,
      endLine: end,
      score: fileScore * (1 + Math.log1p(score) + coverage),
      lines: matching,
    });
  }
  const sorted = windows.toSorted((a, b) => b.score - a.score);
  // Overlapping halves of the same lines would show twice.
  return sorted.filter(
    (window, index) =>
      !sorted
        .slice(0, index)
        .some((other) => window.startLine < other.endLine && other.startLine < window.endLine),
  );
}

function formatResults(snippets: ReadonlyArray<Snippet>, terms: ReadonlyArray<string>) {
  if (snippets.length === 0) {
    return `No matches for: ${terms.join(", ")}. Try other words or likely identifier names.`;
  }
  return snippets
    .map(
      (snippet, index) =>
        `${index + 1}. ${snippet.path}:${snippet.startLine}-${snippet.endLine}\n` +
        snippet.lines.map((line) => `   ${line.number}: ${line.text}`).join("\n"),
    )
    .join("\n\n");
}

const git = (cwd: string, args: ReadonlyArray<string>) =>
  new Promise<string>((resolve, reject) =>
    NodeChildProcess.execFile(
      "git",
      [...args],
      { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 15_000 },
      (error, stdout) =>
        // git grep exits 1 when nothing matches.
        error && (error as { code?: unknown }).code !== 1 ? reject(error) : resolve(stdout),
    ),
  );

const MAX_FILE_BYTES = 512 * 1024;

// Committed blob sizes; listing 30k files takes ~100 ms, so keep the last listing per HEAD.
const sizeCache = new Map<
  string,
  { head: string; bytes: Map<string, number>; averageBytes: number }
>();
async function fileSizes(root: string) {
  const head = (await git(root, ["rev-parse", "HEAD"]).catch(() => "")).trim();
  const cached = sizeCache.get(root);
  if (cached && cached.head === head && head) return cached;
  const bytes = new Map<string, number>();
  let total = 0;
  for (const line of (await git(root, ["ls-tree", "-r", "-l", "--full-tree", "HEAD"])).split(
    "\n",
  )) {
    const match = /^\S+ blob \S+\s+(\d+)\t(.+)$/.exec(line);
    if (!match) continue;
    bytes.set(match[2]!, Number(match[1]));
    total += Number(match[1]);
  }
  const entry = { head, bytes, averageBytes: bytes.size > 0 ? total / bytes.size : 1 };
  sizeCache.set(root, entry);
  return entry;
}

/** Searches the git checkout that contains `directory`. */
async function searchCode(input: {
  readonly directory: string;
  readonly query: string;
  readonly limit?: number | undefined;
}): Promise<string> {
  const terms = queryTerms(input.query);
  if (terms.length === 0) return "Give a few keywords or identifier names to search for.";
  const root = (await git(input.directory, ["rev-parse", "--show-toplevel"])).trim();
  const sizes = await fileSizes(root);
  const perTerm = await Promise.all(
    terms.map(async (term) => {
      const output = await git(root, ["grep", "-c", "-i", "-I", "-F", "-e", term, "--", "."]);
      return { term, output };
    }),
  );
  const counts = new Map<string, Map<string, number>>();
  for (const { term, output } of perTerm) {
    for (const line of output.split("\n")) {
      const separator = line.lastIndexOf(":");
      if (separator <= 0) continue;
      const path = line.slice(0, separator);
      const fileCounts = counts.get(path) ?? new Map<string, number>();
      fileCounts.set(term, Number(line.slice(separator + 1)));
      counts.set(path, fileCounts);
    }
  }
  const ranked = rankFiles(
    [...counts].map(([path, fileCounts]) => ({
      path,
      counts: fileCounts,
      bytes: sizes.bytes.get(path) ?? sizes.averageBytes,
    })),
    { files: sizes.bytes.size, averageBytes: sizes.averageBytes },
    terms,
  ).slice(0, 25);

  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const snippets: Snippet[] = [];
  for (const file of ranked) {
    const absolute = NodePath.join(root, file.path);
    const stat = await NodeFSP.stat(absolute).catch(() => null);
    if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) continue;
    const text = await NodeFSP.readFile(absolute, "utf8");
    // One range per file shows more files; the agent reads a file for the rest.
    snippets.push(...bestWindows(file.path, text, terms, file.idf, file.score).slice(0, 1));
  }
  const relative = NodePath.relative(input.directory, root);
  return formatResults(
    snippets
      .toSorted((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((snippet) => ({
        ...snippet,
        path: relative ? NodePath.join(relative, snippet.path) : snippet.path,
      })),
    terms,
  );
}

const L3_CODE_SEARCH_TOOL = {
  name: "codebase_search",
  description:
    "Ranked keyword search over the project's code. Use it first for questions like 'where is X " +
    "handled' or 'which file does Y' in a large project: one call checks many words at once and " +
    "returns the most relevant file:line ranges with their matching lines. Pass several keywords, " +
    "synonyms and likely identifier names together, e.g. 'login session expiry expiresAt refresh'. " +
    "Then read the files it points to. Use grep for one exact string.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Keywords, synonyms and likely identifier names." },
      directory: {
        type: "string",
        description: "Absolute path of the project to search. Defaults to your working directory.",
      },
      limit: { type: "number", description: "How many results to return (default 8, at most 20)." },
    },
    required: ["query"],
  },
} as const;

type JsonRpcRequest = {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
};

/**
 * Answers one MCP JSON-RPC message; null for notifications, which get no reply. `defaultDirectory`
 * supplies the agent's working directory when the call leaves it out, as Code Mode calls do.
 */
export async function handleCodeSearchMcp(
  message: JsonRpcRequest,
  defaultDirectory: () => string | null = () => null,
): Promise<object | null> {
  if (message.id === undefined || message.id === null) return null;
  const reply = (result: object) => ({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion:
          typeof message.params?.protocolVersion === "string"
            ? message.params.protocolVersion
            : "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "onyx", version: "1" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: [L3_CODE_SEARCH_TOOL] });
    case "tools/call": {
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      if (message.params?.name !== L3_CODE_SEARCH_TOOL.name) {
        return { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Unknown tool" } };
      }
      const directory =
        typeof args.directory === "string" && args.directory.startsWith("/")
          ? args.directory
          : defaultDirectory();
      if (directory === null) {
        return reply({
          content: [
            {
              type: "text",
              text: "Pass `directory`: the absolute path of your working directory, as shown in your environment.",
            },
          ],
          isError: true,
        });
      }
      try {
        const text = await searchCode({
          query: String(args.query ?? ""),
          directory,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
        return reply({ content: [{ type: "text", text }] });
      } catch (error) {
        const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
        return reply({
          content: [
            { type: "text", text: `Search failed: ${detail}. Is the directory a git checkout?` },
          ],
          isError: true,
        });
      }
    }
    default:
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Method not found" },
      };
  }
}

/** Starts a loopback MCP endpoint (streamable HTTP, JSON replies) and resolves to its URL. */
export function startCodeSearchServer(defaultDirectory: () => string | null = () => null): Promise<{
  readonly url: string;
  readonly close: () => void;
}> {
  const secret = NodeCrypto.randomBytes(16).toString("hex");
  const server = NodeHttp.createServer((request, response) => {
    if (request.url !== `/${secret}/mcp`) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(request.method === "DELETE" ? 200 : 405).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      void (async () => {
        let body: JsonRpcRequest | ReadonlyArray<JsonRpcRequest>;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          response.writeHead(400).end();
          return;
        }
        const replies = (
          await Promise.all(
            (Array.isArray(body) ? body : [body]).map((message) =>
              handleCodeSearchMcp(message, defaultDirectory),
            ),
          )
        ).filter((reply) => reply !== null);
        if (replies.length === 0) {
          response.writeHead(202).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
      })();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/${secret}/mcp`, close: () => server.close() });
    });
  });
}

let l3CodeSearch: Promise<string | null> | undefined;

/** The process-wide search endpoint for OpenCode's config, or null when it could not start. */
export function ensureL3CodeSearchServer(
  defaultDirectory: () => string | null,
): Promise<string | null> {
  l3CodeSearch ??= startCodeSearchServer(defaultDirectory).then(
    ({ url }) => url,
    () => null,
  );
  return l3CodeSearch;
}
