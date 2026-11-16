# csvq

A tiny query tool for CSV files with a header row.

```python
from csvq import query, QueryError
rows = query(csv_text, "SELECT name, age WHERE age >= 30 ORDER BY age DESC LIMIT 2")
```

```bash
python3 csvq.py people.csv "SELECT name WHERE city = 'New York'"
```

## Grammar

```
SELECT <* | column, column, ...>
  [WHERE <condition> [AND <condition>]...]
  [ORDER BY <column> [ASC | DESC]]
  [LIMIT <n>]
```

A condition is `<column> <operator> <value>`. There is no FROM: the query runs over the CSV given.

## Requirements

1. `SELECT *` returns every row, as dicts keyed by the header, in file order.
2. `SELECT a, b` returns only those columns, in the order the query lists them.
3. Values that look like numbers (`42`, `-3`, `2.5`) compare as numbers in WHERE and ORDER BY. Other values compare as text. Returned values stay the strings from the file.
4. WHERE supports `=`, `!=`, `<`, `<=`, `>` and `>=`.
5. A WHERE value may be wrapped in single quotes, and then may contain spaces: `city = 'New York'`.
6. Several conditions joined with `AND` must all hold.
7. `ORDER BY col` sorts ascending, `DESC` descending. Rows that tie keep their file order.
8. `LIMIT n` returns at most n rows, after sorting.
9. Keywords (`SELECT`, `WHERE`, `AND`, `ORDER BY`, `ASC`, `DESC`, `LIMIT`) are case-insensitive. Column names are case-sensitive.
10. A query that names a column the file does not have raises `QueryError`, and the message contains that column name.
11. The command line prints the result as CSV, header first, columns in query order.
12. When no rows match, the command line prints only the header.
