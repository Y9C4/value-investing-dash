import { ImageResponse } from "next/og"

/**
 * The share card. Recruiters send links to each other, and until now one
 * previewed as a bare URL.
 *
 * Generated rather than drawn so it stays in the repo as code and cannot
 * drift from the palette: every colour below is the literal value of the
 * matching token in `globals.css`. Satori resolves no CSS variables, which is
 * why they are inlined here rather than referenced.
 */

export const alt =
  "Value Investing Dash: see which S&P 500 stocks look cheap for their risk, then build a portfolio from your picks"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

// Literal values of the dark tokens in globals.css (satori reads no CSS vars).
const INK = "#0f1217"
const CARD = "#171b22"
const PAPER = "#e6eaf0"
const MUTED = "#98a2b0"
const GREEN = "#46b087"
const TEAL = "#2fb39d"
const MAGENTA = "#c9609f"

/** Implied minus required return for a handful of rows: the screener's idea. */
const GAPS = [0.062, 0.041, 0.018, -0.009, -0.027, -0.055]

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: INK, color: PAPER, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 0 64px 72px", width: 680 }}>
          <span style={{ fontSize: 30, color: GREEN }}>Value Investing Dash</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <span style={{ fontSize: 60, lineHeight: 1.1 }}>What does the price imply?</span>
            <span style={{ fontSize: 60, lineHeight: 1.1, color: MUTED }}>What does the risk require?</span>
          </div>
          <span style={{ fontSize: 22, color: MUTED, fontFamily: "sans-serif" }}>
            S&amp;P 500 stock ranking, track record and portfolio builder
          </span>
        </div>
        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 18, padding: "0 56px", background: CARD }}>
          {GAPS.map((gap) => (
            <div key={gap} style={{ display: "flex", height: 30, position: "relative" }}>
              <div style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>
                {gap < 0 && <div style={{ width: `${(-gap / 0.07) * 100}%`, background: MAGENTA }} />}
              </div>
              <div style={{ width: 3, background: GREEN }} />
              <div style={{ display: "flex", flex: 1 }}>
                {gap > 0 && <div style={{ width: `${(gap / 0.07) * 100}%`, background: TEAL }} />}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size
  )
}
