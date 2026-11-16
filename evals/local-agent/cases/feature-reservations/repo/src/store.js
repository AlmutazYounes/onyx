// In-memory stock, keyed by SKU. `now` is injectable so time-based behavior can be tested.

export function createStore({ now = () => Date.now() } = {}) {
  const items = new Map();

  function item(sku) {
    const found = items.get(sku);
    if (!found) throw new Error(`Unknown SKU ${sku}`);
    return found;
  }

  return {
    now,
    add(sku, name, qty) {
      const existing = items.get(sku);
      if (existing) existing.stock += qty;
      else items.set(sku, { sku, name, stock: qty });
    },
    remove(sku, qty) {
      const found = item(sku);
      if (qty > found.stock) throw new Error(`Only ${found.stock} of ${sku} in stock`);
      found.stock -= qty;
    },
    get(sku) {
      return { ...item(sku) };
    },
    list() {
      return [...items.values()].map((entry) => ({ ...entry }));
    },
    toJSON() {
      return { items: [...items.values()] };
    },
    load(state) {
      items.clear();
      for (const entry of state.items ?? []) items.set(entry.sku, { ...entry });
    },
  };
}
