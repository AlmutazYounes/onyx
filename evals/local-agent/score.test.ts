import { describe, expect, it } from "vite-plus/test";

import { summarizeBehavior, toolUsesFromEvents } from "./behavior.ts";
import { type CriterionResult, gradeCriterion, parseTap, scoreOf, scoreRun } from "./score.ts";

describe("parseTap", () => {
  it("counts top-level results and names the failures", () => {
    const tap = [
      "TAP version 13",
      "# Subtest: a",
      "    ok 1 - inner",
      "ok 1 - reserves stock",
      "not ok 2 - releases expired holds",
      "ok 3 - reports reserved column",
      "1..3",
    ].join("\n");
    expect(parseTap(tap)).toEqual({
      passed: 2,
      total: 3,
      failed: ["releases expired holds"],
    });
    expect(parseTap("all good")).toBeNull();
  });
});

describe("gradeCriterion", () => {
  it("gives tests partial credit and checks all-or-nothing credit", () => {
    expect(
      gradeCriterion(
        { name: "hidden tests", tests: "x" },
        { status: 1, stdout: "ok 1 - a\nnot ok 2 - b\nok 3 - c\nok 4 - d" },
      ).credit,
    ).toBe(0.75);
    expect(
      gradeCriterion({ name: "tests unchanged", check: "x" }, { status: 0, stdout: "" }).credit,
    ).toBe(1);
    // A test command that crashes before printing TAP falls back to its exit code.
    expect(
      gradeCriterion({ name: "t", tests: "x" }, { status: 1, stdout: "SyntaxError" }).credit,
    ).toBe(0);
  });

  it("weights criteria", () => {
    expect(
      scoreOf([
        { name: "a", weight: 3, guard: false, credit: 1, detail: "" },
        { name: "b", weight: 1, guard: false, credit: 0, detail: "" },
      ]),
    ).toBe(75);
  });
});

const result = (name: string, credit: number, guard = false, weight = 1): CriterionResult => ({
  name,
  weight,
  guard,
  credit,
  detail: "",
});

describe("scoreRun", () => {
  // Hidden tests where 2 of 3 already pass before the fix, plus two guards that already hold.
  const start = [
    result("hidden", 2 / 3),
    result("tests pass", 1, true),
    result("small diff", 1, true, 2),
  ];

  it("gives a run that changes nothing 0, however much already held", () => {
    expect(scoreRun(start, start).score).toBe(0);
  });

  it("gives a clean fix 100", () => {
    const fixed = [
      result("hidden", 1),
      result("tests pass", 1, true),
      result("small diff", 1, true, 2),
    ];
    expect(scoreRun(fixed, start).score).toBe(100);
  });

  it("scales a fix down by the guards it broke", () => {
    const overreached = [
      result("hidden", 1),
      result("tests pass", 1, true),
      result("small diff", 0, true, 2),
    ];
    expect(scoreRun(overreached, start).score).toBeCloseTo(100 / 3);
  });

  it("credits partial progress past the start", () => {
    const halfway = [result("spec", 0.5)];
    expect(scoreRun(halfway, [result("spec", 0)]).score).toBe(50);
  });
});

const toolEvent = (tool: string, input: object, output = "", status = "completed") =>
  JSON.stringify({ type: "tool_use", part: { tool, state: { status, input, output } } });

describe("summarizeBehavior", () => {
  it("counts repeated reads, long whole reads and failed calls", () => {
    const stdout = [
      toolEvent("read", { path: "a.ts" }, "Read file a.ts, lines 1-900\n1: x"),
      toolEvent("read", { path: "a.ts" }, "Read file a.ts, lines 1-900\n1: x"),
      toolEvent("edit", { path: "a.ts" }),
      toolEvent("read", { path: "a.ts" }, "Read file a.ts, lines 1-900\n1: x"),
      toolEvent("read", { path: "a.ts", offset: 10, limit: 5 }, "Read file a.ts, lines 10-14"),
      toolEvent("read", { path: "b.ts" }, "Read file b.ts, lines 1-40"),
      toolEvent("grep", { pattern: "x" }, "", "error"),
      '{"type":"text"}',
    ].join("\n");
    expect(summarizeBehavior(toolUsesFromEvents(stdout))).toMatchObject({
      toolCalls: 7,
      failedToolCalls: 1,
      repeatReads: 1,
      longWholeReads: 3,
    });
  });
});
