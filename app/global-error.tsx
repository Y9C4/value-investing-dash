"use client"

/**
 * Shown when the root layout itself fails, which in practice means the
 * warehouse read in `loadUniverse()` failed on a cold cache. Once a page has
 * rendered successfully, Next keeps serving it while revalidation fails, so a
 * visitor only lands here when there is no good copy to fall back on.
 *
 * Renders its own document (global styles do not reach it), so the colours are
 * inline and dark, matching the app's default theme.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0f1217",
          color: "#e6eaf0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <title>Market data unavailable</title>
        <main style={{ maxWidth: 440, padding: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            Market data is unavailable
          </h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5, color: "#98a2b0" }}>
            We could not load the data, and there is no saved copy to show.
            Rather than risk showing wrong numbers, we show none. Try again in a
            few minutes.
            {error.digest && ` Reference: ${error.digest}.`}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              padding: "8px 16px",
              background: "#e6eaf0",
              color: "#0f1217",
              border: 0,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
