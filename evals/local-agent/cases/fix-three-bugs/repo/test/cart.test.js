import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount, formatPrice, subtotal } from "../cart.js";

test("subtotal adds every line", () => {
  assert.equal(subtotal([{ price: 2, quantity: 3 }, { price: 5, quantity: 1 }]), 11);
});

test("applyDiscount takes a percentage off", () => {
  assert.equal(applyDiscount(200, 15), 170);
});

test("formatPrice shows two decimals", () => {
  assert.equal(formatPrice(3.5), "$3.50");
});
