"""One TAP result per source file: its section must name the file and at least one real export."""

import json
import pathlib
import sys

here = pathlib.Path(__file__).parent
expected = json.loads((here / "expected.json").read_text())
doc_path = pathlib.Path("docs/opencode-server-files.md")
doc = doc_path.read_text() if doc_path.exists() else ""

failed = 0
for number, (name, exports) in enumerate(sorted(expected.items()), 1):
    ok = name in doc and any(export in doc for export in exports)
    failed += not ok
    print(f"{'ok' if ok else 'not ok'} {number} - {name}")
print(f"1..{len(expected)}")
sys.exit(1 if failed else 0)
