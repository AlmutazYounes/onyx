#!/usr/bin/env node
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: count.js <file>");
  process.exit(1);
}
const text = readFileSync(file, "utf8");
const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
const words = text.split(/\s+/).filter(Boolean).length;
console.log(`${lines} lines, ${words} words`);
