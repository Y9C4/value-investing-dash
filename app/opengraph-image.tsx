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
  "Margin — screen the S&P 500 on margin of safety, then optimise what survives"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const INK = "#12100e"
const PAPER = "#f7f6f4"
const MUTED = "#8d8880"
const SERIES_1 = "#3987e5"
const SERIES_3 = "#1baf7a"
const AXIS = "#3a3733"

/**
 * The frontier, as the page draws it: a concave envelope with the capital
 * market line tangent to it.
 *
 * Concave is not decoration. Risk buys return at a diminishing rate, so the
 * curve rises steeply and flattens; drawn the other way up it says the
 * opposite, on the one image a reader sees before they see anything else. The
 * dashed line is placed by taking the actual tangent of the cubic at t = 0.5
 * rather than by eye, so it touches at exactly one point and sits above the
 * envelope everywhere else.
 *
 * Inlined as a data URI because satori renders `img` reliably and nested SVG
 * only partially.
 */
const CURVE = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 300">
     <path d="M20 280 L400 280" stroke="${AXIS}" stroke-width="1.5"/>
     <path d="M20 280 L20 20" stroke="${AXIS}" stroke-width="1.5"/>
     <path d="M20 218 L330 10" stroke="${MUTED}" stroke-width="2"
           stroke-dasharray="7 7"/>
     <path d="M40 262 C 90 150, 190 90, 330 60" fill="none"
           stroke="${SERIES_1}" stroke-width="5" stroke-linecap="round"/>
     <circle cx="151" cy="130" r="9" fill="${SERIES_3}"/>
   </svg>`
)}`

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: INK,
          color: PAPER,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "64px 0 64px 72px",
            width: 700,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 20, height: 20, background: SERIES_1 }} />
            <span style={{ fontSize: 26, letterSpacing: 10, fontWeight: 600 }}>
              MARGIN
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <span style={{ fontSize: 62, lineHeight: 1.12, fontWeight: 600 }}>
              Screen on margin of safety.
            </span>
            <span
              style={{
                fontSize: 62,
                lineHeight: 1.12,
                fontWeight: 600,
                color: SERIES_1,
              }}
            >
              Optimise what survives.
            </span>
          </div>

          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {[
              "5 VALUATION MODELS",
              "493 COMPANIES",
              "MEAN-VARIANCE FRONTIER",
            ].map((label, index) => (
              <div key={label} style={{ display: "flex", gap: 14 }}>
                {index > 0 && <span style={{ color: MUTED }}>·</span>}
                <span
                  style={{ fontSize: 20, letterSpacing: 3, color: MUTED }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            borderLeft: "1px solid #2a2724",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CURVE} width={420} height={300} alt="" />
        </div>
      </div>
    ),
    size
  )
}
