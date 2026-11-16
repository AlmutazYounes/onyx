#!/usr/bin/env node
// Eval-only runner: drives the real OpenCode CLI against Onyx's local model.
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
// @effect-diagnostics globalConsole:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import {
  L3_FAST_VARIANT,
  L3_LOCAL_MODEL,
  L3_OLLAMA_BASE_URL,
  makeL3OpenCodeConfigContent,
} from "@t3tools/contracts";

import { l3AgentItemRules } from "../../packages/provider-opencode/src/server/L3AgentItems.ts";
import { startCodeSearchServer } from "../../packages/provider-opencode/src/server/L3CodeSearch.ts";
import { L3_INSTRUCTIONS } from "../../packages/provider-opencode/src/server/L3Instructions.ts";
import { ollamaChatRequestBody } from "../../packages/provider-opencode/src/server/L3OllamaRequest.ts";
import {
  L3_THINKING_BUDGET_TOKENS,
  streamChatCompletion,
} from "../../packages/provider-opencode/src/server/L3ChatStream.ts";
import { summarizeBehavior, toolUsesFromEvents } from "./behavior.ts";
import { summarizeRequests, type ModelRequest } from "./requests.ts";
import {
  type Criterion,
  type CriterionResult,
  gradeCriterion,
  scoreOf,
  scoreRun,
} from "./score.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", default: L3_LOCAL_MODEL },
    case: { type: "string", multiple: true },
    samples: { type: "string", default: "1" },
    baseline: { type: "string" },
    opencode: { type: "string", default: "/opt/homebrew/bin/opencode" },
    "timeout-minutes": { type: "string", default: "15" },
    // on: Onyx's code search MCP server, reached through Code Mode as in Onyx.
    search: { type: "string", default: "on" },
    // off: ask the model to skip its reasoning step, as Onyx does for titles.
    thinking: { type: "string", default: "on" },
    // JSON deep-merged into Onyx's OpenCode config, to try settings without code changes.
    "config-patch": { type: "string" },
    // on: fix read calls the way Onyx's model proxy does; off: pass them through as the model wrote them.
    "repair-reads": { type: "string", default: "on" },
    // Thinking tokens a reply may spend before Onyx retries it without thinking; 0 turns that off.
    "thinking-budget": { type: "string", default: String(L3_THINKING_BUDGET_TOKENS) },
    // A file of agent instructions to try in place of Onyx's, to compare wording before shipping it.
    instructions: { type: "string" },
    // Save the last chat request (tools and full history) beside each sample, to see what the model saw.
    "save-request": { type: "boolean", default: false },
  },
});
if (!values.out) throw new Error("Use --out <directory>.");
if (values.thinking !== "off" && values.thinking !== "on") {
  throw new Error("Use --thinking on or --thinking off.");
}
if (values["repair-reads"] !== "off" && values["repair-reads"] !== "on") {
  throw new Error("Use --repair-reads on or --repair-reads off.");
}
if (values.search !== "off" && values.search !== "on") {
  throw new Error("Use --search on or --search off.");
}

const casesDir = NodePath.join(import.meta.dirname, "cases");
const repoRoot = NodePath.resolve(import.meta.dirname, "../..");
const allCases = NodeFS.readdirSync(casesDir).filter((id) =>
  NodeFS.existsSync(NodePath.join(casesDir, id, "case.json")),
);
for (const id of values.case ?? []) {
  if (!allCases.includes(id)) throw new Error(`Unknown case id: ${id}.`);
}
const caseIds = values.case ?? allCases;
const samples = Number(values.samples);
const outDir = NodePath.resolve(values.out);
NodeFS.mkdirSync(outDir, { recursive: true });

interface CaseFile {
  readonly source: string;
  readonly prompt: string;
  /** What a good result does, each graded on its own so partial work earns partial credit. */
  readonly criteria: ReadonlyArray<Criterion>;
  /** A commit of this repository to check out instead of `repo/`, for work in a large codebase. */
  readonly checkout?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function mergeDeep(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value) ? mergeDeep(current, value) : value;
  }
  return merged;
}

/**
 * Onyx's config plus its default agent items (skills off). Onyx applies those as session rules;
 * `opencode run` has no session to update, so they go in the config's permissions instead.
 */
function openCodeConfig(baseUrl: string, instructionsPath: string, codeSearchUrl?: string) {
  const config = JSON.parse(
    makeL3OpenCodeConfigContent(baseUrl, { instructionsPath, codeSearchUrl }),
  ) as Record<string, unknown>;
  const permission: Record<string, Record<string, string>> = {};
  for (const rule of l3AgentItemRules({})) {
    (permission[rule.action] ??= {})[rule.resource] = rule.effect;
  }
  return JSON.stringify(
    mergeDeep(
      { ...config, permission },
      values["config-patch"] ? JSON.parse(values["config-patch"]) : {},
    ),
  );
}

/** Forwards to Ollama and records each chat request's timings and how much of its prompt is new. */
function startRecordingProxy(requests: ModelRequest[]) {
  const upstream = new URL(L3_OLLAMA_BASE_URL);
  let previousPrompt = "";
  const saved = { lastChatBody: "" };
  const server = NodeHttp.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      // Onyx's proxy makes the same change, so OpenCode's output cap reaches Ollama.
      const body = ollamaChatRequestBody(Buffer.concat(chunks));
      const startedAt = performance.now();
      let record: ModelRequest | null = null;
      if (request.url?.includes("/chat/completions")) {
        const parsed = JSON.parse(body.toString("utf8")) as {
          model?: string;
          messages?: unknown[];
          tools?: unknown[];
          reasoning_effort?: string;
        };
        // Tools render ahead of the messages, so both are part of the reusable prefix.
        const prompt = JSON.stringify({ tools: parsed.tools ?? [], messages: parsed.messages });
        let shared = 0;
        while (shared < prompt.length && prompt[shared] === previousPrompt[shared]) shared++;
        record = {
          model: parsed.model ?? "",
          messages: parsed.messages?.length ?? 0,
          tools: parsed.tools?.length ?? 0,
          reasoningEffort: parsed.reasoning_effort ?? null,
          promptChars: prompt.length,
          sharedPrefixChars: shared,
          divergence: shared < previousPrompt.length ? prompt.slice(shared, shared + 120) : null,
          readMs: null,
          writeMs: null,
          promptTokens: null,
          completionTokens: null,
          thinkingCuts: 0,
        };
        previousPrompt = prompt;
        if (parsed.tools?.length) saved.lastChatBody = body.toString("utf8");
        requests.push(record);
      }
      let firstTokenAt: number | null = null;
      let buffer = "";
      streamChatCompletion({
        upstream,
        request,
        response,
        body,
        repairReads: values["repair-reads"] === "on",
        thinkingBudget: Number(values["thinking-budget"]),
        onThinkingCut: () => {
          if (record) record.thinkingCuts++;
        },
        onText: (text) => {
          if (!record) return;
          buffer += text;
          let newline = buffer.indexOf("\n");
          while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
            if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
            try {
              const data = JSON.parse(line.slice(5)) as {
                choices?: Array<{ delta?: Record<string, unknown> }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              const delta = data.choices?.[0]?.delta;
              if (
                firstTokenAt === null &&
                delta &&
                (delta.content || delta.reasoning || delta.reasoning_content || delta.tool_calls)
              ) {
                firstTokenAt = performance.now();
              }
              if (data.usage) {
                record.promptTokens = data.usage.prompt_tokens ?? null;
                record.completionTokens = data.usage.completion_tokens ?? null;
              }
            } catch {}
          }
        },
        onEnd: () => {
          const endedAt = performance.now();
          if (record) {
            record.readMs = Math.round((firstTokenAt ?? endedAt) - startedAt);
            record.writeMs = firstTokenAt === null ? 0 : Math.round(endedAt - firstTokenAt);
          }
        },
      });
    });
  });
  return new Promise<{ url: string; close: () => void; saved: typeof saved }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/v1`, close: () => server.close(), saved });
    }),
  );
}

const sh = (command: string, cwd: string, env: NodeJS.ProcessEnv = process.env) =>
  NodeChildProcess.spawnSync("/bin/sh", ["-c", command], { cwd, env, encoding: "utf8" });

/** Text parts of OpenCode's JSON event stream, in order. */
function answerText(stdout: string) {
  const texts: string[] = [];
  for (const line of stdout.split("\n")) {
    try {
      const event = JSON.parse(line) as { type?: string; part?: { type?: string; text?: string } };
      if (event.part?.type === "text" && event.part.text) texts.push(event.part.text);
    } catch {}
  }
  return texts.join("\n");
}

const snapshot = (dir: string): string =>
  NodeFS.readdirSync(dir, { recursive: true, encoding: "utf8" })
    .toSorted()
    .map((file) => {
      const path = NodePath.join(dir, file);
      return NodeFS.statSync(path).isFile()
        ? `${file}\n${NodeFS.readFileSync(path, "utf8")}`
        : file;
    })
    .join("\n");

/** The case's starting project, committed, in a new temp folder. */
function prepareProject(id: string, spec: CaseFile) {
  const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `onyx-eval-${id}-`));
  const workDir = NodePath.join(scratch, "repo");
  if (spec.checkout) {
    const clone = sh(
      `git clone -q --shared --no-checkout "${repoRoot}" repo && git -C repo checkout -q ${spec.checkout}`,
      scratch,
    );
    if (clone.status !== 0)
      throw new Error(`Could not check out ${spec.checkout}: ${clone.stderr}`);
  } else {
    NodeFS.cpSync(NodePath.join(casesDir, id, "repo"), workDir, { recursive: true });
    sh(
      "git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm fixture",
      workDir,
    );
  }
  return { scratch, workDir };
}

/** Copies in the hidden checks and grades every criterion against the project as it stands. */
function gradeProject(id: string, spec: CaseFile, workDir: string, answerPath: string) {
  const checkDir = NodePath.join(casesDir, id, "check");
  if (NodeFS.existsSync(checkDir)) {
    NodeFS.cpSync(checkDir, NodePath.join(workDir, "check"), { recursive: true });
  }
  // EVAL_TOOLS holds shared check helpers, such as pytap.py for Python tests.
  const env = { ...process.env, EVAL_ANSWER: answerPath, EVAL_TOOLS: import.meta.dirname };
  return spec.criteria.map((criterion) =>
    gradeCriterion(criterion, sh(criterion.tests ?? criterion.check ?? "false", workDir, env)),
  );
}

// How the untouched project grades, for an agent that changes nothing and says nothing; once per case.
const startingResults = new Map<string, CriterionResult[]>();
function gradeStart(id: string, spec: CaseFile) {
  const known = startingResults.get(id);
  if (known !== undefined) return known;
  const { scratch, workDir } = prepareProject(id, spec);
  const answerPath = NodePath.join(scratch, "answer.md");
  NodeFS.writeFileSync(answerPath, "");
  const results = gradeProject(id, spec, workDir, answerPath);
  NodeFS.rmSync(scratch, { recursive: true, force: true });
  startingResults.set(id, results);
  return results;
}

async function runCase(id: string, sample: number) {
  const fixture = snapshot(NodePath.join(casesDir, id));
  const spec = JSON.parse(
    NodeFS.readFileSync(NodePath.join(casesDir, id, "case.json"), "utf8"),
  ) as CaseFile;
  const start = gradeStart(id, spec);
  const { scratch, workDir } = prepareProject(id, spec);
  const instructionsPath = NodePath.join(scratch, "instructions.md");
  NodeFS.writeFileSync(
    instructionsPath,
    values.instructions ? NodeFS.readFileSync(values.instructions, "utf8") : L3_INSTRUCTIONS,
  );

  const requests: ModelRequest[] = [];
  const proxy = await startRecordingProxy(requests);
  // Onyx reads the directory from the agent's own requests; here it is known up front.
  const search = values.search === "on" ? await startCodeSearchServer(() => workDir) : null;
  const env = {
    ...process.env,
    // OpenCode 2 takes its project directory from PWD, not from the process's working directory.
    PWD: workDir,
    OPENCODE_DB: NodePath.join(scratch, "opencode.db"),
    OPENCODE_CONFIG_CONTENT: openCodeConfig(proxy.url, instructionsPath, search?.url),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_FREE_MODELS: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  };
  const startedAt = performance.now();
  const agent = await new Promise<{ code: number | null; stdout: string; timedOut: boolean }>(
    (resolve) => {
      const child = NodeChildProcess.spawn(
        values.opencode!,
        [
          "run",
          "--auto",
          "--archived",
          // Onyx names its sessions, so OpenCode never spends a model call on a title there.
          "--title",
          `eval ${id}`,
          "--format",
          "json",
          "--model",
          // `#fast` is the same variant Onyx's Reasoning picker selects.
          `l3/${values.model}${values.thinking === "off" ? `#${L3_FAST_VARIANT}` : ""}`,
          spec.prompt,
        ],
        { cwd: workDir, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let timedOut = false;
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", () => {});
      const timer = setTimeout(
        () => {
          timedOut = true;
          child.kill("SIGTERM");
        },
        Number(values["timeout-minutes"]) * 60_000,
      );
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, timedOut });
      });
    },
  );
  const wallMs = Math.round(performance.now() - startedAt);
  proxy.close();
  search?.close();
  if (snapshot(NodePath.join(casesDir, id)) !== fixture) {
    throw new Error(`The agent changed the ${id} fixture itself; restore it before running again.`);
  }

  const answer = answerText(agent.stdout);
  const answerPath = NodePath.join(scratch, "answer.md");
  NodeFS.writeFileSync(answerPath, answer);
  const criteria: CriterionResult[] = gradeProject(id, spec, workDir, answerPath);
  const graded = scoreRun(criteria, start);
  // A run cut off by the timeout keeps credit for what it finished; the summary counts timeouts.
  const score = graded.score;
  const diff = sh("git status --short && git diff --stat HEAD", workDir).stdout.trim();

  const sampleDir = NodePath.join(outDir, `${id}.${sample}`);
  NodeFS.mkdirSync(sampleDir, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(sampleDir, "events.jsonl"), agent.stdout);
  NodeFS.writeFileSync(NodePath.join(sampleDir, "answer.md"), answer);
  if (values["save-request"] && proxy.saved.lastChatBody) {
    NodeFS.writeFileSync(NodePath.join(sampleDir, "last-request.json"), proxy.saved.lastChatBody);
  }
  NodeFS.writeFileSync(
    NodePath.join(sampleDir, "requests.json"),
    JSON.stringify(requests, null, 2),
  );
  NodeFS.writeFileSync(
    NodePath.join(sampleDir, "check.txt"),
    criteria
      .map(
        (result) =>
          `${(result.credit * 100).toFixed(0).padStart(3)}%  ${result.guard ? "guard " : ""}${result.name}: ${result.detail}`,
      )
      .join("\n") +
      `\n\nWork ${graded.workScore.toFixed(0)} (${graded.workStart.toFixed(0)} before the agent ran), ` +
      `guards held ${(graded.guardsHeld * 100).toFixed(0)}%, score ${score.toFixed(0)}\n--- changes\n${diff}\n`,
  );
  NodeFS.rmSync(scratch, { recursive: true, force: true });

  return {
    id,
    sample,
    score,
    passed: scoreOf(criteria) === 100 && !agent.timedOut,
    criteria: criteria.map(({ name, credit }) => ({ name, credit })),
    timedOut: agent.timedOut,
    exitCode: agent.code,
    wallMs,
    ...summarizeRequests(requests),
    ...summarizeBehavior(toolUsesFromEvents(agent.stdout)),
  };
}

type Row = Awaited<ReturnType<typeof runCase>>;
const rows: Row[] = [];
for (const id of caseIds) {
  for (let sample = 1; sample <= samples; sample++) {
    const row = await runCase(id, sample);
    rows.push(row);
    console.log(
      `${row.score.toFixed(0).padStart(3)} ${id}#${sample} ${(row.wallMs / 1000).toFixed(0)}s, ` +
        `${row.requests} requests, reading ${(row.readMs / 1000).toFixed(0)}s, ` +
        `${row.reusedRequests}/${row.requests - 1} reused the prompt, ` +
        `${row.compactions} compactions, peak prompt ${row.maxPromptTokens}`,
    );
  }
}
NodeFS.writeFileSync(
  NodePath.join(outDir, "results.jsonl"),
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
);

const baseline: Row[] = values.baseline
  ? NodeFS.readFileSync(NodePath.resolve(values.baseline, "results.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row)
  : [];
const byCase = (list: Row[], id: string) => list.filter((row) => row.id === id);
const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;
const thousands = (value: number) => `${(value / 1000).toFixed(0)}K`;
const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const total = (list: Row[], pick: (row: Row) => number) =>
  list.reduce((sum, row) => sum + pick(row), 0);
// Older result files have no score; their pass flag is the whole of their credit.
const scoreOfRow = (row: Row) => row.score ?? (row.passed ? 100 : 0);
const scoreCell = (list: Row[]) => {
  const scores = list.map(scoreOfRow);
  if (scores.length === 0) return "";
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  return (
    `${mean(scores).toFixed(0)}` + (low === high ? "" : ` (${low.toFixed(0)}-${high.toFixed(0)})`)
  );
};
const lines = [
  `# Local agent eval: ${values.model}, search ${values.search}, thinking ${values.thinking}` +
    (values.instructions ? `, instructions ${NodePath.basename(values.instructions)}` : "") +
    (values["config-patch"] ? `, config ${values["config-patch"]}` : ""),
  "",
  "Score, 0-100 (range across samples): credit for the task's work criteria beyond what the untouched project already met, scaled down by any guard broken (tests, unrelated files, diff size). Doing nothing scores 0. Full is how many samples met every criterion.",
  "",
  "| Case | Score | Full | Timed out | Wall | Longest reply | Thinking cut | Prompt tokens | Tool output | Repeat reads | Long whole reads | Failed tools | Compactions | Prompt reused |" +
    (baseline.length ? " Baseline score | Baseline wall |" : ""),
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |" +
    (baseline.length ? " --- | --- |" : ""),
  ...caseIds.map((id) => {
    const list = byCase(rows, id);
    const base = byCase(baseline, id);
    const cells = [
      id,
      scoreCell(list),
      `${list.filter((row) => row.passed).length}/${list.length}`,
      total(list, (row) => (row.timedOut ? 1 : 0)),
      seconds(mean(list.map((row) => row.wallMs))),
      `${Math.max(0, ...list.map((row) => row.maxCompletionTokens ?? 0))} tok`,
      total(list, (row) => row.thinkingCuts ?? 0),
      thousands(mean(list.map((row) => row.promptTokens))),
      thousands(mean(list.map((row) => row.toolOutputChars))),
      total(list, (row) => row.repeatReads),
      total(list, (row) => row.longWholeReads),
      total(list, (row) => row.failedToolCalls),
      total(list, (row) => row.compactions ?? 0),
      `${total(list, (row) => row.reusedRequests)}/${total(list, (row) => Math.max(0, row.requests - 1))}`,
      ...(baseline.length ? [scoreCell(base), seconds(mean(base.map((row) => row.wallMs)))] : []),
    ];
    return `| ${cells.join(" | ")} |`;
  }),
  "",
  `Mean score ${mean(rows.map(scoreOfRow)).toFixed(1)}` +
    (baseline.length ? ` (baseline ${mean(baseline.map(scoreOfRow)).toFixed(1)})` : "") +
    `. Full ${rows.filter((row) => row.passed).length} of ${rows.length}. ` +
    `Total ${seconds(total(rows, (row) => row.wallMs))}, ${thousands(total(rows, (row) => row.promptTokens))} prompt tokens, ` +
    `${thousands(total(rows, (row) => row.toolOutputChars))} chars of tool output.`,
];
NodeFS.writeFileSync(NodePath.join(outDir, "summary.md"), lines.join("\n") + "\n");
console.log(`\n${lines.join("\n")}`);
