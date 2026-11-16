#!/usr/bin/env node
import { loadStore, saveStore } from "./src/persist.js";
import { renderReport } from "./src/report.js";

const [command, ...args] = process.argv.slice(2);
const store = loadStore();

try {
  if (command === "add") {
    const [sku, name, qty] = args;
    store.add(sku, name, Number(qty));
  } else if (command === "remove") {
    const [sku, qty] = args;
    store.remove(sku, Number(qty));
  } else if (command === "report") {
    console.log(renderReport(store));
  } else {
    console.error("Usage: cli.js add <sku> <name> <qty> | remove <sku> <qty> | report");
    process.exit(2);
  }
  saveStore(store);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
