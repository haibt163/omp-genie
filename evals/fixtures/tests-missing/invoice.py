from calc import average


def total(values: list[float]) -> float:
    """Return the invoice total.

    The first version keeps the calculation simple; edge cases such as an
    empty invoice are not handled yet.
    """
    return average(values)
