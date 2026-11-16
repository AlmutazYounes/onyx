import math


def page_count(total, per_page):
    return total // per_page


def paginate(items, page, per_page):
    """Return the items on a 1-based page."""
    start = page * per_page
    return items[start : start + per_page]
