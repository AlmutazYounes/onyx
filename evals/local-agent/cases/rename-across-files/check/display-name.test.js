import { test } from "node:test";
import assert from "node:assert/strict";
import { getDisplayName } from "../src/users.js";
import { greeting } from "../src/greet.js";
import { report } from "../src/report.js";
import { emailHeader } from "../src/email.js";

const ada = { first: "Ada", last: "Lovelace", nickname: "Countess" };
const alan = { first: "Alan", last: "Turing" };

test("display names prefer the nickname", () => {
  assert.equal(getDisplayName(ada), "Countess");
  assert.equal(getDisplayName(alan), "Alan Turing");
  assert.equal(greeting(ada), "Hello, Countess!");
  assert.equal(report([ada, alan]), "1. Alan Turing\n2. Countess");
  assert.equal(emailHeader(alan, "alan@example.com"), "To: Alan Turing <alan@example.com>");
});
