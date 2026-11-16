import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCurrency } from "../src/format.js";
import { invoiceTotals } from "../src/invoice.js";
import { taxOn } from "../src/tax.js";

test("formats currency with grouping", () => {
  assert.equal(formatCurrency(1234.5), "$1,234.50");
});

test("taxes at 8%", () => {
  assert.equal(taxOn(10), 0.8);
});

test("totals a simple invoice", () => {
  assert.deepEqual(invoiceTotals({ items: [{ price: 10, qty: 2 }] }), {
    subtotal: 20,
    tax: 1.6,
    total: 21.6,
  });
});
