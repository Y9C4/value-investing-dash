"""The request limits that keep one solve affordable and its bounds feasible."""

import pytest
from fastapi import HTTPException

import frontier


def test_point_count_is_capped_by_the_points_times_assets_budget():
    points, capped = frontier.resolve_point_count(200, 493)
    assert points == frontier.POINT_BUDGET // 493
    assert capped is True


def test_small_sets_keep_the_resolution_asked_for():
    assert frontier.resolve_point_count(40, 20) == (40, False)


def test_maximum_below_one_over_n_is_refused():
    with pytest.raises(HTTPException) as err:
        frontier.resolve_constraints(20, False, None, 0.04, 0.0)
    assert err.value.status_code == 422


def test_minimum_above_maximum_is_refused():
    with pytest.raises(HTTPException):
        frontier.resolve_constraints(20, False, 0.2, 0.1, 0.0)


def test_gamma_out_of_range_is_refused():
    with pytest.raises(HTTPException):
        frontier.resolve_constraints(20, False, None, None, frontier.MAX_L2_GAMMA + 1)


def test_omitted_bounds_scale_to_the_universe():
    c = frontier.resolve_constraints(500, False, None, None, 0.0)
    assert c.lower == 0.0
    assert c.upper * 500 >= 1.0
