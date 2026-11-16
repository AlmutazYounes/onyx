export function subtotal(items) {
  let total = 0;
  for (let index = 1; index < items.length; index++) {
    total += items[index].price * items[index].quantity;
  }
  return total;
}

export function applyDiscount(amount, percent) {
  return amount - amount * (percent / 10);
}

export function formatPrice(amount) {
  return `$${amount}`;
}
