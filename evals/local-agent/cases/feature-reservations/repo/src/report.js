// A plain-text stock table, one row per SKU, sorted by SKU.

export function renderReport(store) {
  const rows = store.list().sort((a, b) => a.sku.localeCompare(b.sku));
  const header = ["SKU", "Name", "Stock"];
  const table = [header, ...rows.map((row) => [row.sku, row.name, String(row.stock)])];
  const widths = header.map((_, column) => Math.max(...table.map((cells) => cells[column].length)));
  return table
    .map((cells) => cells.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd())
    .join("\n");
}
