"""The index list is editable by anyone upstream, so implausible ones change nothing."""

import pytest

import membership

NAMES = [f"A{chr(65 + i // 26)}{chr(65 + i % 26)}" for i in range(503)]


def test_a_rebalance_is_reported_both_ways():
    added, removed = membership.diff(set(NAMES), [*NAMES[1:], "BRK-B"])
    assert (added, removed) == (["BRK-B"], [NAMES[0]])


@pytest.mark.parametrize(
    "latest",
    [
        NAMES[:100],  # a truncated page
        [*NAMES[1:], "<script>"],  # a vandalised cell
        [*NAMES[:450], *(f"Z{n}" for n in NAMES[:53])],  # too much at once
    ],
)
def test_implausible_lists_are_refused(latest):
    with pytest.raises(ValueError):
        membership.diff(set(NAMES), latest)


def test_nasdaq_tiers_are_one_exchange():
    assert membership.exchange_name("NasdaqGM") == "NASDAQ"
    assert membership.exchange_name("Cboe US") == "Cboe"
    assert membership.exchange_name("NYSE") == "NYSE"
