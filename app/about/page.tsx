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
      <p>Based on Benjamin Graham’s Principle of Value Investing, Value-Investing-Dash (VID) is a project that I created to analyses stocks based upon their fundamental value rather than simply based off their historical returns. VID ranks the 500 stocks in the S&amp;P 500 on a backtested signal (value, momentum and earnings surprise), where value is the return each stock’s price implies over the return its risk requires, allowing the user to screen stocks on both to then build an optimized portfolio.</p>
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
      <p>An externally hosted Python API on Gcloud Run using FastAPI, with data science libraries including cvxpy, Clarabel, and numpy. Financial information like share price and earnings is gathered using yfinance and loaded into the database untouched. Portfolio optimization and every data fetch route through the Data API.</p>
      <h3>Database:</h3>
      <p>The database is a Supabase PostgreSQL warehouse: a raw schema holds prices and fundamentals exactly as fetched, a warehouse schema turns them into the signal and implied returns in SQL after each fetch at UTC 18:30, and the public schema serves read-only views to the site.</p>
      <p>The web client and the data API talk over HTTP and deploy separately. Meaning the browser never learns the API address since requests are signed server-side, and the write paths are closed behind a token.</p>

      <h2>Decisions Worth explaining:</h2>
      <h3>Valuation models:</h3>
      <p>Value is read as a return rather than a price. Each of four reverse-DCF models solves for the annual return that makes the company’s cash flows worth today’s price, and the reading is that return minus the return the stock’s risk requires (WACC for firm-level models, CAPM cost of equity for equity-level ones):</p>
      <ul>
        <li><strong>FCFF:</strong> free cash flow to the firm against enterprise value. Works for firms with complex or changing debt structures.</li>
        <li><strong>RIM:</strong> book value plus earnings above it, against market cap. The one model that works for banks.</li>
        <li><strong>Revenue:</strong> revenue with a cash margin fading to the sector median, so it can speak for companies whose cash flow is temporarily negative.</li>
        <li><strong>Shareholder yield:</strong> dividends plus net buybacks, the cash a shareholder actually receives.</li>
      </ul>
      <p>The screener averages whichever of the four solve for a stock, the same rule the backtest tested.</p>

      <h3>Why not fair values?</h3>
      <p>VID used to run five forward models (DDM, FCFE, FCFF, RIM and comps) and screen on a confidence-weighted consensus fair value. A fair value is the price times a multiple levered by 1/(k − g), so a lumpy cash flow year or a low cost of equity sent margins past +700%, while RIM called the median stock 66% overvalued. The backtest found the size of those margins meaningless, so they were removed. An implied return is a root of the same cash flows and stays in a range you can sanity check: a median of about 6% a year.</p>

      <h3>Everything is precomputed in the database:</h3>
      <p>Considering the large universe (500), computing the signal on request would delay the /screener page for no reason, since prices, fundamentals and rates only change at trading close. The warehouse rebuilds it in SQL in a few seconds after each fetch and archives each day’s signal, which builds a forward track record.</p>

      <h3>Solver constraints</h3>
      <p>Position bounds, short selling and L2 regularisation are all on the page, because a frontier with no stated constraints is not a claim about anything. By default it forces a 3% max position size since the solver used for portfolio optimization struggles to find a feasible efficient portfolio.</p>

      <h3>Valuation is relative</h3>
      <p>The valuation bands; “Deep value”, “Undervalued”, “Fair value”, “Overvalued”, “Expensive”, describe relative value over the stock universe. Each band covers a fifth of the implied excess return, with the median stock’s price implying about 1% a year less than CAPM asks for.</p>
      <p>The screener bands are relative. “Deep value” means cheapest fifth of the index, not below intrinsic worth.</p>

      <h2>Limitations</h2>
      <ul>
        <li>Price and Fundamentals data come from yfinance, an unofficial source with major gaps.</li>
        <li>Any results, portfolio weights on Value-Investing-Dash are not investment advice. Past returns are not reliable forecasts, and the VID is simply an demonstrator project.</li>
      </ul>
    </article>
  )
}
