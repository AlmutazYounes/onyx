import unittest

from pages import page_count, paginate


class PagesTest(unittest.TestCase):
    def test_first_page(self):
        self.assertEqual(paginate(list(range(10)), 1, 4), [0, 1, 2, 3])

    def test_last_partial_page(self):
        self.assertEqual(paginate(list(range(10)), 3, 4), [8, 9])

    def test_page_count_rounds_up(self):
        self.assertEqual(page_count(10, 4), 3)
        self.assertEqual(page_count(8, 4), 2)
        self.assertEqual(page_count(0, 4), 0)


if __name__ == "__main__":
    unittest.main()
