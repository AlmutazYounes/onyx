import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

writeFileSync("sample.txt", "one two\nthree\n");
const run = (...args) => execFileSync("node", ["count.js", ...args], { encoding: "utf8" }).trim();

test("plain output is unchanged", () => assert.equal(run("sample.txt"), "2 lines, 3 words"));
test("--json before the file prints only JSON", () =>
  assert.deepEqual(JSON.parse(run("--json", "sample.txt")), { lines: 2, words: 3 }));
test("--json after the file prints only JSON", () =>
  assert.deepEqual(JSON.parse(run("sample.txt", "--json")), { lines: 2, words: 3 }));
