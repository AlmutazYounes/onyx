// Amounts are dollars. Totals are shown to the cent.

export function lineTotal(item) {
  return item.price * item.qty;
}

export function sum(amounts) {
  return amounts.reduce((total, amount) => total + amount, 0);
}

/** Drops anything below a cent so we never overcharge. */
export function toCents(amount) {
  return Math.floor(amount * 100) / 100;
}
