import assert from "node:assert/strict";
import { test } from "node:test";

import { slugify, titleCase, truncate } from "../src/text.js";

test("truncate keeps the result within max, ellipsis included", () => {
  assert.equal(truncate("Hello world", 5), "Hell…");
  assert.equal(truncate("abcdef", 3), "ab…");
});

test("truncate leaves short text alone", () => {
  assert.equal(truncate("Hi", 5), "Hi");
  assert.equal(truncate("Hello", 5), "Hello");
});

test("the other helpers behave as before", () => {
  assert.equal(slugify("  Many   Spaces -- here "), "many-spaces-here");
  assert.equal(titleCase("a tale of two cities"), "A Tale of Two Cities");
});
