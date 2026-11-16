import { monthKey, monthName } from "./dates.js";
import { formatCurrency } from "./format.js";
import { invoiceTotals } from "./invoice.js";
import { sum, toCents } from "./money.js";

export function invoicesInMonth(invoices, key) {
  return invoices.filter((invoice) => monthKey(invoice.date) === key);
}

export function monthlyReport(invoices, key) {
  const rows = invoicesInMonth(invoices, key).map((invoice) => ({
    id: invoice.id,
    customer: invoice.customer,
    total: invoiceTotals(invoice).total,
  }));
  const total = toCents(sum(rows.map((row) => row.total)));
  return { title: monthName(key), rows, total };
}

export function renderReport(report) {
  const lines = [report.title];
  for (const row of report.rows) {
    lines.push(`${row.id}  ${row.customer.padEnd(8)}${formatCurrency(row.total)}`);
  }
  lines.push(`Total ${formatCurrency(report.total)}`);
  return lines.join("\n");
}
