import type { FrontierResponse, Portfolio } from "@/lib/baseline-frontier"
import { effectiveHoldings } from "@/lib/portfolio-settings"

/**
 * The solved portfolio, as a file.
 *
 * Everything on the portfolio page is a reading of one solve, and a reading
 * that can only be looked at is a demo. Analysts take the weights away: into
 * a sheet, into a broker's basket upload, into a backtest. So the export
 * carries what would be needed to reconstruct or act on the result, not just
 * what the screen happens to be plotting.
 *
 * Three blocks in one file rather than three files. The blocks are separated
 * by a blank line and each carries its own header row, which is what a
 * spreadsheet needs to treat them as separate tables and what `pandas` needs
 * to be pointed at one with `skiprows`. A single flat table cannot do this:
 * the constraints are one row, the anchors are two, and the holdings are
 * dozens, so flattening them would repeat the whole constraint set on every
 * holding line.
 *
 * The run block is the part that stops the file becoming a lie six months
 * from now. Weights with no constraint set and no as-of are not a portfolio,
 * they are a column of numbers — and `source` says out loud whether these came
 * from a real solve or from the shipped baseline, which is the one claim the
 * page makes that a downloaded file would otherwise lose.
 */

/** RFC 4180, the part of it that matters: quote, and double any quote inside. */
function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ""
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function row(values: (string | number | boolean | null | undefined)[]): string {
  return values.map(cell).join(",")
}

/** Six decimals: weights are read back into a solver, not into prose. */
function num(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(6)
    : ""
}

function holdingRows(
  label: string,
  portfolio: Portfolio,
  sectors: Record<string, string>
): string[] {
  return Object.entries(portfolio.weights)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .map(([ticker, weight]) =>
      row([
        label,
        ticker,
        sectors[ticker] ?? "",
        num(weight),
        // Only the tangency portfolio is sent with a risk decomposition, so
        // this is blank rather than zero for the other anchor. A zero would
        // claim the holding contributes no variance.
        num(portfolio.risk_contributions?.[ticker]),
      ])
    )
}

export function buildPortfolioCsv({
  data,
  isBaseline,
  screenedCount,
}: {
  data: FrontierResponse
  isBaseline: boolean
  /** Names handed over by the screener; 0 means the full index. */
  screenedCount: number
}): string {
  const sectors = data.sectors ?? {}

  const run = [
    row(["field", "value"]),
    row(["source", isBaseline ? "illustrative baseline" : "live solve"]),
    row(["generated_at", new Date().toISOString()]),
    row(["scope", screenedCount > 0 ? "screened set" : "full index"]),
    row(["names_requested", screenedCount > 0 ? screenedCount : ""]),
    row(["names_solved", data.n_assets ?? ""]),
    row(["risk_free_rate", num(data.risk_free_rate)]),
    row(["frontier_points", data.n_portfolios]),
    row(["frontier_points_requested", data.n_portfolios_requested ?? ""]),
    row(["resolution_capped", data.resolution_capped ?? false]),
    row(["max_stock_weight", num(data.max_stock_weight)]),
    row(["min_stock_weight", num(data.min_stock_weight)]),
    row(["l2_gamma", num(data.l2_gamma ?? 0)]),
    row(["short_allowed", data.short_allowed]),
    row(["tangency_beats_risk_free", data.tangency_beats_risk_free ?? true]),
    row(["excluded_short_history", (data.excluded_short_history ?? []).join(" ")]),
  ]

  const anchors = [
    row([
      "portfolio",
      "return",
      "volatility",
      "sharpe",
      "effective_holdings",
      "holdings",
    ]),
    ...(
      [
        ["max_sharpe", data.max_sharpe],
        ["min_volatility", data.min_volatility],
      ] as const
    ).map(([label, portfolio]) =>
      row([
        label,
        num(portfolio.return),
        num(portfolio.volatility),
        portfolio.sharpe.toFixed(4),
        effectiveHoldings(portfolio.weights).toFixed(2),
        Object.keys(portfolio.weights).length,
      ])
    ),
  ]

  const holdings = [
    row(["portfolio", "ticker", "sector", "weight", "risk_contribution"]),
    ...holdingRows("max_sharpe", data.max_sharpe, sectors),
    ...holdingRows("min_volatility", data.min_volatility, sectors),
  ]

  // The frontier itself: every solved point, so the curve on screen can be
  // redrawn or compared against without re-running the solver.
  const envelope = [
    row(["t", "return", "volatility", "sharpe"]),
    ...data.envelope.map((point) =>
      row([
        num(point.t),
        num(point.return),
        num(point.volatility),
        point.sharpe.toFixed(4),
      ])
    ),
  ]

  return [
    run.join("\n"),
    anchors.join("\n"),
    holdings.join("\n"),
    envelope.join("\n"),
  ].join("\n\n")
}

export function downloadPortfolioCsv(input: {
  data: FrontierResponse
  isBaseline: boolean
  screenedCount: number
}): void {
  const blob = new Blob([buildPortfolioCsv(input)], {
    type: "text/csv;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `margin-portfolio-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
