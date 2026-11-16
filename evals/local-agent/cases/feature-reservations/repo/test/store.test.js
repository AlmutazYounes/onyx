import assert from "node:assert/strict";
import { test } from "node:test";

import { renderReport } from "../src/report.js";
import { createStore } from "../src/store.js";

test("adds and removes stock", () => {
  const store = createStore();
  store.add("PEN", "Pen", 10);
  store.remove("PEN", 3);
  assert.equal(store.get("PEN").stock, 7);
  assert.throws(() => store.remove("PEN", 8), /Only 7/);
});

test("reports stock by SKU", () => {
  const store = createStore();
  store.add("PEN", "Pen", 10);
  store.add("INK", "Ink", 2);
  assert.equal(renderReport(store), "SKU  Name  Stock\nINK  Ink   2\nPEN  Pen   10");
});
