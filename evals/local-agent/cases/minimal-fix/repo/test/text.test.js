import assert from "node:assert/strict";
import { test } from "node:test";

import { slugify, titleCase } from "../src/text.js";

test("slugify", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
});

test("titleCase keeps small words lower", () => {
  assert.equal(titleCase("the lord of the rings"), "The Lord of the Rings");
});
