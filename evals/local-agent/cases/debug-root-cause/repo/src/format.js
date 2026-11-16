// Formats a dollar amount for display, for example 1234.5 -> "$1,234.50".
export function formatCurrency(amount) {
  const [whole, fraction] = amount.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}.${fraction}`;
}
