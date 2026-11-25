"""The scheduled pipeline must report what job_runs records."""

import pytest

import jobs
import pipeline


def _ingest_result(*, failed, upserted, errors=()):
    return {
        "tickers_requested": 3,
        "tickers_failed": list(failed),
        "rows_upserted": upserted,
        "errors": list(errors),
        "duration_seconds": 0.1,
    }


@pytest.fixture(autouse=True)
def no_database(monkeypatch):
    monkeypatch.setattr(jobs, "record", lambda job, res: None)


def test_status_of_has_three_states():
    assert jobs.status_of(_ingest_result(failed=[], upserted=10)) == "succeeded"
    assert jobs.status_of(_ingest_result(failed=["A"], upserted=10)) == "partial"
    assert jobs.status_of(_ingest_result(failed=["A"], upserted=0)) == "failed"


def test_a_stage_that_saved_nothing_is_failed_and_the_run_is_not_ok(monkeypatch):
    dead = _ingest_result(failed=["A", "B", "C"], upserted=0, errors=["blocked"])
    monkeypatch.setattr(pipeline.ingest, "prices", lambda full=False: dead)
    monkeypatch.setattr(pipeline.ingest, "factor_returns", lambda: dead)
    monkeypatch.setattr(
        pipeline, "refresh", lambda: pytest.fail("refresh must not run on stale data")
    )

    out = pipeline.everything(skip_fundamentals=True)

    assert out["ok"] is False
    assert out["failed_stages"] == ["prices", "factor_returns"]
    assert out["stages"]["refresh"]["skipped"] is True


def test_a_partial_stage_is_not_failed(monkeypatch):
    partial = _ingest_result(failed=["A"], upserted=50)
    monkeypatch.setattr(pipeline.ingest, "prices", lambda full=False: partial)
    monkeypatch.setattr(pipeline.ingest, "factor_returns", lambda: partial)
    monkeypatch.setattr(pipeline, "refresh", lambda: {"ok": True})

    out = pipeline.everything(skip_fundamentals=True)

    assert out["ok"] is True


def test_a_raising_stage_hides_the_exception_message(monkeypatch):
    def boom(full=False):
        raise RuntimeError("password=hunter2 host=db.internal")

    monkeypatch.setattr(pipeline.ingest, "prices", boom)

    res = pipeline.prices()

    assert res["failed"] is True
    assert "hunter2" not in str(res)
