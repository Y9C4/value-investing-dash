"""Fama-French factor returns: download, parse, and store.

One `factor_returns` table serves FF3, FF5 and Carhart-4 — the Mkt-RF/SMB/HML
series are identical across the 3- and 5-factor files, so only the 5-factor
file and the separate momentum file are fetched.

Two things about the source format bite if unhandled: values are in PERCENT
(divided by 100 on ingest), and each file has a daily section followed by a
blank line and an annual one (parsing past it fills the table with years
masquerading as dates).
"""

from __future__ import annotations

import io
import zipfile

import pandas as pd
import requests

FF5_URL = (
    "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
    "F-F_Research_Data_5_Factors_2x3_daily_CSV.zip"
)
MOMENTUM_URL = (
    "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
    "F-F_Momentum_Factor_daily_CSV.zip"
)

DOWNLOAD_TIMEOUT_SECONDS = 60
# Factor values are published as percentages.
PERCENT = 100.0


def _download_csv_text(url: str) -> str:
    """Fetch a zipped CSV from the French library and return its text."""
    response = requests.get(url, timeout=DOWNLOAD_TIMEOUT_SECONDS)
    response.raise_for_status()

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    name = archive.namelist()[0]
    # The files are Windows-encoded and contain a copyright line with
    # non-UTF-8 bytes, so latin-1 rather than utf-8.
    return archive.read(name).decode("latin-1")


def _parse_daily_section(text: str, columns: list[str]) -> pd.DataFrame:
    """Parse the daily block of a French library CSV into a DataFrame.

    The header row is located by its leading comma (e.g. ",Mkt-RF,SMB,..."),
    and parsing stops at the first row that is not an 8-digit date — which is
    the blank line separating the daily section from the annual one.
    """
    lines = [line.strip() for line in text.split("\n")]

    header_index = next(
        (i for i, line in enumerate(lines) if line.startswith(",")), None
    )
    if header_index is None:
        raise ValueError("No header row found in factor CSV")

    rows: list[list[str]] = []
    for line in lines[header_index + 1 :]:
        parts = [part.strip() for part in line.split(",")]
        # A date is YYYYMMDD. Anything else means the daily section has ended.
        if len(parts) != len(columns) + 1 or not (
            len(parts[0]) == 8 and parts[0].isdigit()
        ):
            if rows:
                break
            continue
        rows.append(parts)

    if not rows:
        raise ValueError("No daily rows found in factor CSV")

    df = pd.DataFrame(rows, columns=["date", *columns])
    df["date"] = pd.to_datetime(df["date"], format="%Y%m%d")

    for column in columns:
        # -99.99 and -999 are the library's missing-data sentinels.
        numeric = pd.to_numeric(df[column], errors="coerce")
        df[column] = numeric.where(numeric > -99).div(PERCENT)

    return df.dropna(subset=columns, how="all")


def fetch_factor_returns() -> pd.DataFrame:
    """Download and merge the FF5 and momentum factor series.

    Returns a frame indexed 0..n with columns date, mkt_rf, smb, hml, rmw, cma,
    umd, rf. `umd` is null on dates the momentum file does not cover.
    """
    ff5 = _parse_daily_section(
        _download_csv_text(FF5_URL), ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"]
    ).rename(
        columns={
            "Mkt-RF": "mkt_rf",
            "SMB": "smb",
            "HML": "hml",
            "RMW": "rmw",
            "CMA": "cma",
            "RF": "rf",
        }
    )

    try:
        momentum = _parse_daily_section(
            _download_csv_text(MOMENTUM_URL), ["Mom"]
        ).rename(columns={"Mom": "umd"})
        merged = ff5.merge(momentum, on="date", how="left")
    except Exception:
        # Momentum is optional — FF3 and FF5 do not use it, and losing it
        # should not cost us the factor refresh.
        merged = ff5.assign(umd=None)

    return merged


def factor_rows_since(start_date: str | None) -> list[dict]:
    """Factor rows ready to upsert, optionally limited to dates after
    `start_date` so a daily refresh ships one row rather than 16,000."""
    df = fetch_factor_returns()

    if start_date is not None:
        df = df[df["date"] > pd.Timestamp(start_date)]

    return [
        {
            "date": row["date"].date().isoformat(),
            "mkt_rf": float(row["mkt_rf"]),
            "smb": float(row["smb"]),
            "hml": float(row["hml"]),
            "rmw": None if pd.isna(row["rmw"]) else float(row["rmw"]),
            "cma": None if pd.isna(row["cma"]) else float(row["cma"]),
            "umd": None if pd.isna(row.get("umd")) else float(row["umd"]),
            "rf": float(row["rf"]),
        }
        for _, row in df.iterrows()
    ]
