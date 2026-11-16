import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.getcwd())
from csvq import QueryError, query  # noqa: E402

CSV = open("people.csv").read()
EXTRA = "name,age,city,score\nZoe,9,Paris,2\nAmy,10,Paris,11\n"


def names(rows):
    return [row["name"] for row in rows]


def cli(text, path="people.csv"):
    return subprocess.run(
        [sys.executable, "csvq.py", path, text], capture_output=True, text=True, check=True
    ).stdout.replace("\r\n", "\n")


class Spec(unittest.TestCase):
    def test_01_select_star(self):
        rows = query(CSV, "SELECT *")
        self.assertEqual(names(rows), ["Ada", "Grace", "Alan", "Linus", "Margaret", "Edsger"])
        self.assertEqual(rows[0], {"name": "Ada", "age": "36", "city": "London", "score": "9.5"})

    def test_02_column_order(self):
        rows = query(CSV, "SELECT city, name")
        self.assertEqual(list(rows[0].keys()), ["city", "name"])
        self.assertEqual(rows[1], {"city": "New York", "name": "Grace"})

    def test_03_numbers_compare_as_numbers(self):
        self.assertEqual(names(query(EXTRA, "SELECT name WHERE age < 10")), ["Zoe"])
        self.assertEqual(names(query(EXTRA, "SELECT name ORDER BY score")), ["Zoe", "Amy"])
        self.assertEqual(query(CSV, "SELECT age WHERE name = Ada"), [{"age": "36"}])

    def test_04_operators(self):
        self.assertEqual(names(query(CSV, "SELECT name WHERE age = 41")), ["Alan"])
        self.assertEqual(len(query(CSV, "SELECT name WHERE city != London")), 4)
        self.assertEqual(names(query(CSV, "SELECT name WHERE age <= 33")), ["Linus", "Margaret"])
        self.assertEqual(names(query(CSV, "SELECT name WHERE age > 44")), ["Grace", "Edsger"])
        self.assertEqual(names(query(CSV, "SELECT name WHERE score >= 9.5")), ["Ada", "Alan", "Margaret"])

    def test_05_quoted_values(self):
        self.assertEqual(names(query(CSV, "SELECT name WHERE city = 'New York'")), ["Grace", "Margaret"])

    def test_06_and(self):
        rows = query(CSV, "SELECT name WHERE city = London AND score = 9.5 AND age > 40")
        self.assertEqual(names(rows), ["Alan"])

    def test_07_order_by_stable(self):
        self.assertEqual(names(query(CSV, "SELECT name ORDER BY score DESC")), ["Margaret", "Ada", "Alan", "Grace", "Linus", "Edsger"])
        self.assertEqual(names(query(CSV, "SELECT name ORDER BY city")), ["Edsger", "Linus", "Ada", "Alan", "Grace", "Margaret"])

    def test_08_limit_after_sort(self):
        self.assertEqual(names(query(CSV, "SELECT name ORDER BY age DESC LIMIT 2")), ["Edsger", "Grace"])

    def test_09_case_insensitive_keywords(self):
        self.assertEqual(names(query(CSV, "select name where age > 44 order by age desc limit 1")), ["Edsger"])
        with self.assertRaises(QueryError):
            query(CSV, "SELECT Name")

    def test_10_unknown_column(self):
        with self.assertRaises(QueryError) as caught:
            query(CSV, "SELECT name WHERE height > 3")
        self.assertIn("height", str(caught.exception))

    def test_11_cli_prints_csv(self):
        self.assertEqual(cli("SELECT city, name WHERE age > 44 ORDER BY age"), "city,name\nNew York,Grace\nAustin,Edsger\n")

    def test_12_cli_empty_result(self):
        self.assertEqual(cli("SELECT name, age WHERE age > 100"), "name,age\n")


if __name__ == "__main__":
    unittest.main()
