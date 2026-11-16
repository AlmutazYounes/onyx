import { test } from "node:test";
import assert from "node:assert/strict";
import { getUserName } from "../src/users.js";
import { greeting } from "../src/greet.js";
import { report } from "../src/report.js";
import { emailHeader } from "../src/email.js";

const ada = { first: "Ada", last: "Lovelace" };
const alan = { first: "Alan", last: "Turing" };

test("names", () => {
  assert.equal(getUserName(ada), "Ada Lovelace");
  assert.equal(greeting(alan), "Hello, Alan Turing!");
  assert.equal(report([alan, ada]), "1. Ada Lovelace\n2. Alan Turing");
  assert.equal(emailHeader(ada, "ada@example.com"), "To: Ada Lovelace <ada@example.com>");
});
