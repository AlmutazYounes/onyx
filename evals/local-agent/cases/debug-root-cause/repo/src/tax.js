// Sales tax in the Capital Region is 8%, rounded to the nearest cent.
export const TAX_RATE = 0.08;

export function taxOn(subtotal) {
  return Math.round(subtotal * TAX_RATE * 100) / 100;
}
