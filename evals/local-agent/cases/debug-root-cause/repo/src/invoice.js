import { lineTotal, sum, toCents } from "./money.js";
import { taxOn } from "./tax.js";

export function invoiceTotals(invoice) {
  const subtotal = toCents(sum(invoice.items.map(lineTotal)));
  const tax = taxOn(subtotal);
  return { subtotal, tax, total: toCents(subtotal + tax) };
}
