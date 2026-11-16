import { loadInvoices } from "./data.js";
import { formatCurrency } from "./format.js";
import { invoiceTotals } from "./invoice.js";
import { monthlyReport, renderReport } from "./report.js";

const [command, arg] = process.argv.slice(2);
const invoices = loadInvoices();
if (command === "invoice") {
  const invoice = invoices.find((entry) => entry.id === arg);
  if (!invoice) {
    console.error(`No invoice ${arg}`);
    process.exit(1);
  }
  const { subtotal, tax, total } = invoiceTotals(invoice);
  console.log(`${invoice.id} ${invoice.customer}`);
  console.log(`Subtotal ${formatCurrency(subtotal)}`);
  console.log(`Tax      ${formatCurrency(tax)}`);
  console.log(`Total    ${formatCurrency(total)}`);
} else if (command === "report") {
  console.log(renderReport(monthlyReport(invoices, arg)));
} else {
  console.error("Usage: node src/cli.js invoice <id> | report <YYYY-MM>");
  process.exit(1);
}
