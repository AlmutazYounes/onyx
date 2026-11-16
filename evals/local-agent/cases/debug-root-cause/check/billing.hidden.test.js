import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { monthKey, monthName } from "../src/dates.js";
import { formatCurrency } from "../src/format.js";
import { invoiceTotals } from "../src/invoice.js";
import { monthlyReport } from "../src/report.js";
import { taxOn } from "../src/tax.js";
import { loadInvoices } from "../src/data.js";

const invoices = loadInvoices();
const byId = (id) => invoices.find((invoice) => invoice.id === id);

test("INV-1004 totals to the cent", () => {
  assert.deepEqual(invoiceTotals(byId("INV-1004")), { subtotal: 13.15, tax: 1.05, total: 14.2 });
});

test("float-unfriendly prices total exactly", () => {
  assert.equal(invoiceTotals({ items: [{ price: 0.1, qty: 3 }] }).subtotal, 0.3);
  assert.equal(invoiceTotals({ items: [{ price: 19.99, qty: 3 }] }).subtotal, 59.97);
  assert.equal(invoiceTotals({ items: [{ price: 4.35, qty: 1 }, { price: 2.2, qty: 2 }] }).subtotal, 8.75);
});

test("month keys match the report argument", () => {
  assert.equal(monthKey("2026-01-14T10:00:00Z"), "2026-01");
  assert.equal(monthKey("2026-03-30T23:45:00Z"), "2026-03");
  assert.equal(monthKey("2026-12-19T12:00:00Z"), "2026-12");
});

test("the March report holds March's invoices", () => {
  const report = monthlyReport(invoices, "2026-03");
  assert.deepEqual(report.rows.map((row) => row.id), ["INV-1003", "INV-1004"]);
  assert.equal(report.total, 28.23);
  assert.equal(report.title, "March 2026");
});

test("the December report holds December's invoice", () => {
  assert.deepEqual(monthlyReport(invoices, "2026-12").rows.map((row) => row.id), ["INV-1006"]);
});

test("the CLI prints the corrected March report", () => {
  const output = execFileSync("node", ["src/cli.js", "report", "2026-03"], { encoding: "utf8" });
  assert.match(output, /INV-1003/);
  assert.match(output, /INV-1004/);
  assert.doesNotMatch(output, /INV-1005/);
  assert.match(output, /Total \$28\.23/);
});

test("what already worked still works", () => {
  assert.equal(taxOn(13.15), 1.05);
  assert.equal(formatCurrency(1234.5), "$1,234.50");
  assert.equal(monthName("2026-12"), "December 2026");
  assert.deepEqual(invoiceTotals({ items: [{ price: 10, qty: 2 }] }), { subtotal: 20, tax: 1.6, total: 21.6 });
});
