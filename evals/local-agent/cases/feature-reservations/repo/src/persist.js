import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { createStore } from "./store.js";

// The CLI keeps its state in stock.json in the current folder.
const FILE = "stock.json";

export function loadStore(options) {
  const store = createStore(options);
  if (existsSync(FILE)) store.load(JSON.parse(readFileSync(FILE, "utf8")));
  return store;
}

export function saveStore(store) {
  writeFileSync(FILE, JSON.stringify(store.toJSON(), null, 2) + "\n");
}
