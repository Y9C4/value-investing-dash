import Image from "next/image"

export const metadata = {
  title: "About",
  description:
    "How Value-Investing-Dash is built: a Next.js frontend, a FastAPI data API, and a Supabase Postgres database, with the decisions behind them.",
}

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-10 text-sm leading-relaxed lg:px-10 [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-1 [&_h3]:font-semibold [&_li]:mb-2 [&_p]:mb-4 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5">
      <h1>About: Value Investing Dash</h1>
      <Image src="/screener.png" alt="…" width={1600} height={900} className="my-6 w-full" />
      <p>Based on Benjamin Graham’s Principle of Value Investing, Value-Investing-Dash (VID) is a project that I created to analyses stocks based upon their fundamental value rather than simply based off their historical returns. VID values the 500 stocks in the S&amp;P 500 and values them based off 5 different methods to generate a consensus fair value for each, allowing the user to screen stocks based of the consensus valued to then build an optimized portfolio.</p>
      <h2>Infrastructure</h2>
      <Image
        src="/Infrastructure-diag.svg"
        alt="Infrastructure diagram"
        width={0}
        height={0}
        sizes="100vw"
        className="my-4 w-full h-auto"
      />
      <figcaption >Figure 1: Architecture diagram of the infrastructure and technology used in Value-Investing-Dash.</figcaption >
      <h3>Frontend:</h3>
      <p>Next.js 16, React 19, TypeScript, Tailwind, Supabase postgreSQL for data queries and deployed on Vercel.</p>
      <h3>Data API:</h3>
      <p>An externally hosted Python API on Gcloud Run using FastAPI, with data science libraries including cvxpy, Clarabel, and numpy. Financial information like share price and earnings is gathered using yfinance. Every valuation model and portfolio optimization and financial data calls route through the Data API.</p>
      <h3>Database:</h3>
      <p>The database is a Supabase PostgreSQL RDBMS that stores raw financial data like prices and fundamentals as well as precomputed valuation data that are backfilled at UTC 18:30 every day. Valuations are precomputed into a table rather than derived per request due to high compute costs.</p>
      <p>The web client and the data API talk over HTTP and deploy separately. Meaning the browser never learns the API address since requests are signed server-side, and the write paths are closed behind a token.</p>

      <h2>Decisions Worth explaining:</h2>
      <h3>Valuation models:</h3>
      <ul>
        <li><strong>DDM:</strong> I picked this since it was most basic model of valuing a stock based on receiving dividends growing into perpetuity.</li>
        <li><strong>FCFE:</strong> FCFE is useful to value stocks that don’t pay dividends in a similar vein to DDM.</li>
        <li><strong>FCFF:</strong> Since it measures the total cash from operations available to both debt and equity holders, FCFF can be used to value firms with complex or rapidly changing debt structures and highly indebted firms.</li>
        <li><strong>RIM:</strong> While RIM values a stock’s value as the profit it generates above its cost of equity, it isn’t very accurate, however it uses data the other models have already pulled meaning it has great coverage.</li>
        <li><strong>COMPS:</strong> I picked COMPS since it promised to be the best valuation method to account for the markets sentiment of a similar company or industry. It combines multiple ratios to give a fair value including EPS, EBITDA, debt EV. This is particularly visible in data from mid 2025-2026 where stocks like SANDISK appeared overvalued across the other models since they don’t capture the markets expectation of high demand in flash memory.</li>
        <Image src="/sandisk.png" alt="…" width={1600} height={900} className="my-6 w-full" />
        <figcaption >Figure 2: Comps values the markets bullish sentiment on the Tech Sector in its valuation of Sandisk.</figcaption >

      </ul>
      <p>The valuations from these 5 models were weighted at “consensus” weights to give a consensus margin, the average weighted sum of each model’s margin (the difference between actual price and each models estimate). These weights were arbitrary and were essentially my “confidence” in each valuation model with adjustments as described:</p>
      <div className="mb-4 overflow-x-auto">
        <table>
          <thead>
            <tr><th>Model</th><th>Base</th><th>Adjustments</th></tr>
          </thead>
          <tbody>
            <tr><td>FCFF</td><td>0.80</td><td>* 0.8 if the tax rate wasn’t available</td></tr>
            <tr><td>FCFE</td><td>0.75</td><td>* 0.6 if net borrowing is more than half of FCFE</td></tr>
            <tr><td>DDM</td><td>0.60</td><td>* payment stability (0-1), then * 0.6 if the payout ratio is above 0.9</td></tr>
            <tr><td>Comps</td><td>0.55</td><td>none</td></tr>
            <tr><td>RIM</td><td>0.35</td><td>* min(1, quarters used / 4)</td></tr>
          </tbody>
        </table>
      </div>

      <h3>Valuations are Precomputed and stored on the database:</h3>
      <p>Considering the large universe (500), actively calculating the valuations would create a significant delay just to load the /screener page. Since financial data like price, fundamentals and rates were only updated at trading close, it seemed more practical to precompute the valuations for each stock, method, date which can quickly be fetched.</p>

      <h3>Solver constraints</h3>
      <p>Position bounds, short selling and L2 regularisation are all on the page, because a frontier with no stated constraints is not a claim about anything. By default it forces a 3% max position size since the solver used for portfolio optimization struggles to find a feasible efficient portfolio.</p>

      <h3>Valuation is relative</h3>
      <p>The valuation bands; “Deep value”, “Undervalued”, “Fair value”, “Overvalued”, “Expensive”, describe relative value over the stock universe rather than intrinsic value as described by the consensus margin. Each band covers a quartile of stock’s margin, with the median margin being around ~-12% or slightly undervalued.</p>
      <p>The screener bands are relative. “Deep value” means cheapest fifth of the index, not below intrinsic worth.</p>

      <h2>Limitations</h2>
      <ul>
        <li>Price and Fundamentals data come from yfinance, an unofficial source with major gaps.</li>
        <li>Any results, portfolio weights on Value-Investing-Dash are not investment advice. Past returns are not reliable forecasts, and the VID is simply an demonstrator project.</li>
      </ul>
    </article>
  )
}
