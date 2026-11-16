"""Runs Python unittest discovery and prints TAP, one line per test, for partial credit."""

import sys
import unittest

suite = unittest.defaultTestLoader.discover(sys.argv[1] if len(sys.argv) > 1 else ".", pattern=sys.argv[2] if len(sys.argv) > 2 else "test*.py")
tests = []
def walk(node):
    for item in node:
        if isinstance(item, unittest.TestSuite):
            walk(item)
        else:
            tests.append(item)
walk(suite)
failed = 0
for number, test in enumerate(tests, 1):
    result = unittest.TestResult()
    test.run(result)
    ok = result.wasSuccessful() and not result.skipped
    failed += not ok
    print(f"{'ok' if ok else 'not ok'} {number} - {test.id().split('.')[-1]}")
print(f"1..{len(tests)}")
sys.exit(1 if failed or not tests else 0)
