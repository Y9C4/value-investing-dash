import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { MarketContext } from "@/components/market-context";
import { isDataPageEnabled } from "@/lib/market-data-service";
import { loadUniverse } from "@/lib/universe";
import { cn } from "@/lib/utils";

// Two families, both consumed: Inter is --font-sans and --font-heading,
// JetBrains Mono is --font-mono.
//
// Inter replaced Raleway, which is a display face — geometric, small-bodied
// figures, a single-storey 1 that sits a stroke away from a lowercase l. That
// is a poor trade on a page whose content is almost entirely numbers, and it
// showed everywhere a figure is not in the mono column: the match count, the
// stat readouts, the weights on the portfolio page. Inter was drawn for screen
// UI at small sizes and has a proper tabular set, which the `td, th` rule in
// globals.css switches on. The uppercase tracked-wide treatment that carries
// the app's identity is unchanged — it lives in the type styles, not the face.
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

// The figures face, and most of what is on screen: every table cell, every
// weight, every rate. Geist Mono was here and its digits are drawn narrow with
// a small aperture, which is fine in a code editor at one figure per line and
// costs real legibility in a 450-row column read by scanning down it. JetBrains
// Mono was drawn for exactly that — a taller x-height, a slashed zero that
// cannot be an O, and a 1 with a base serif that cannot be a 7.
const mono = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
});

const TITLE = "Margin — value investing dashboard";
const DESCRIPTION =
  "Screen the S&P 500 on margin of safety, value every stock across multiple models, then build an efficient portfolio from what survives.";

export const metadata: Metadata = {
  // Absolute URLs for the share card. Vercel injects the deployment host, so
  // preview builds advertise themselves rather than production.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:3000")
  ),
  title: { default: TITLE, template: "%s — Margin" },
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "Margin",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // One cached snapshot row, deduped with whatever the page itself reads, so
  // the strip runs across every route without costing a request per page.
  const {
    index,
    riskFreeRate,
    computedAt,
    gatheredAt,
    isStale,
    stocks,
    isBaseline,
  } = await loadUniverse();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full antialiased font-sans",
        inter.variable,
        mono.variable
      )}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-background">
        {/* Read here rather than in the shell: the shell is a client
            component and this is a server-only variable. Evaluated at build,
            since making the root layout dynamic would opt every page out of
            static rendering for the sake of one link — and the page behind it
            checks the flag again at request time regardless. */}
        <AppShell
          showDataLink={isDataPageEnabled()}
          contextBar={
            <MarketContext
              index={index}
              riskFreeRate={riskFreeRate}
              computedAt={computedAt}
              gatheredAt={gatheredAt}
              isStale={isStale}
              universeSize={stocks.length}
              isBaseline={isBaseline}
            />
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
