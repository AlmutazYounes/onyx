"""csvq: query a CSV file with a small SQL-like language. See SPEC.md."""

import csv
import io
import sys


class QueryError(Exception):
    pass


def load(csv_text):
    return list(csv.DictReader(io.StringIO(csv_text)))


def query(csv_text, text):
    raise NotImplementedError


def main(argv):
    if len(argv) != 3:
        print("usage: csvq.py <file.csv> <query>", file=sys.stderr)
        return 2
    raise NotImplementedError


if __name__ == "__main__":
    sys.exit(main(sys.argv))
