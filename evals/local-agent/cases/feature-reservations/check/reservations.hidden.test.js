import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { renderReport } from "../src/report.js";
import { createStore } from "../src/store.js";

const MINUTE = 60_000;

function stocked(clock = { t: 0 }) {
  const store = createStore({ now: () => clock.t });
  store.add("PEN", "Pen", 10);
  store.add("INK", "Ink", 2);
  return { store, clock };
}

test("a hold returns an id and reduces what is available", () => {
  const { store } = stocked();
  const id = store.reserve("PEN", 3);
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);
  assert.equal(store.available("PEN"), 7);
  assert.equal(store.get("PEN").stock, 10);
});

test("holds add up and get distinct ids", () => {
  const { store } = stocked();
  const first = store.reserve("PEN", 3);
  const second = store.reserve("PEN", 4);
  assert.notEqual(first, second);
  assert.equal(store.available("PEN"), 3);
});

test("holds expire after their minutes, 30 by default", () => {
  const { store, clock } = stocked();
  store.reserve("PEN", 3);
  store.reserve("PEN", 2, { minutes: 5 });
  clock.t = 5 * MINUTE + 1;
  assert.equal(store.available("PEN"), 7);
  clock.t = 30 * MINUTE + 1;
  assert.equal(store.available("PEN"), 10);
});

test("release ends a hold early and reports whether it did", () => {
  const { store, clock } = stocked();
  const id = store.reserve("PEN", 3);
  const short = store.reserve("PEN", 1, { minutes: 1 });
  assert.equal(store.release(id), true);
  assert.equal(store.available("PEN"), 9);
  assert.equal(store.release(id), false);
  assert.equal(store.release("no-such-hold"), false);
  clock.t = 2 * MINUTE;
  assert.equal(store.release(short), false);
});

test("a hold cannot take more than is available, and says how many are", () => {
  const { store } = stocked();
  store.reserve("PEN", 8);
  assert.throws(() => store.reserve("PEN", 3), /\b2\b/);
  assert.equal(store.available("PEN"), 2);
});

test("remove cannot take held stock, and says how many are available", () => {
  const { store } = stocked();
  store.reserve("PEN", 6);
  assert.throws(() => store.remove("PEN", 5), /\b4\b/);
  store.remove("PEN", 4);
  assert.equal(store.get("PEN").stock, 6);
  assert.equal(store.available("PEN"), 0);
});

test("the report gets an Available column after Stock", () => {
  const { store } = stocked();
  store.reserve("PEN", 3);
  const lines = renderReport(store).split("\n").map((line) => line.trim().split(/\s{2,}/));
  assert.deepEqual(lines[0], ["SKU", "Name", "Stock", "Available"]);
  assert.deepEqual(lines[1], ["INK", "Ink", "2", "2"]);
  assert.deepEqual(lines[2], ["PEN", "Pen", "10", "7"]);
});

test("the CLI reserves and releases, and holds survive between runs", () => {
  const cli = resolve("cli.js");
  const cwd = mkdtempSync(join(tmpdir(), "stockroom-"));
  const run = (...args) => execFileSync("node", [cli, ...args], { cwd, encoding: "utf8" }).trim();
  run("add", "PEN", "Pen", "10");
  const id = run("reserve", "PEN", "4", "--minutes", "10");
  assert.ok(id.length > 0 && !id.includes("\n"), `expected one hold id, got ${JSON.stringify(id)}`);
  assert.match(run("report"), /PEN\s+Pen\s+10\s+6/);
  run("release", id);
  assert.match(run("report"), /PEN\s+Pen\s+10\s+10/);
});

test("what already worked still works", () => {
  const store = createStore();
  store.add("PEN", "Pen", 10);
  store.add("PEN", "Pen", 5);
  store.remove("PEN", 3);
  assert.equal(store.get("PEN").stock, 12);
  assert.throws(() => store.get("NOPE"), /Unknown SKU/);
});
