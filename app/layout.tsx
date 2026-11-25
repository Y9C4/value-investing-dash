import Script from "next/script";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { MarketContext } from "@/components/market-context";
import { isDataPageEnabled } from "@/lib/market-data-service";
import { loadUniverse } from "@/lib/universe";
import { cn } from "@/lib/utils";

// IBM Plex Sans at 600 for display (titles, stock names, verdict sentences):
// a sleek, slightly squared sans that reads as a heading beside the UI face
// without changing voice. Inter for the UI and for every figure: with tabular
// digits (globals.css) so columns align. Inter is a variable font with an
// optical-size axis, so large figures get the display cut.
const display = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: "600",
  variable: "--font-plex-sans",
});
const sans = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-inter",
});
// Real code only (the notebook pages), so it is not preloaded on the others.
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  preload: false,
});

// Runs before first paint so a reader who chose light never sees a dark flash.
const THEME_SCRIPT = `try{if(localStorage.getItem("theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

const TITLE = "Value Investing Dash";
const DESCRIPTION =
  "See which S&P 500 stocks look cheap for their risk, check how well that ranking has worked, and build a portfolio from your picks.";

export const metadata: Metadata = {
  // Absolute URLs for the share card. Vercel injects the deployment host, so
  // preview builds advertise themselves rather than production.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:3000")
  ),
  title: { default: TITLE, template: "%s · Value Investing Dash" },
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: TITLE,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // One cached snapshot row, deduped with whatever the page itself reads, so
  // the strip runs across every route without costing a request per page.
  // A warehouse outage must not take down every route, Methodology included:
  // the strip renders empty and the page itself reports the failure.
  const {
    index,
    riskFreeRate,
    computedAt,
    gatheredAt,
    isStale,
    stocks,
    isBaseline,
  } = await loadUniverse().catch(() => ({
    index: null,
    riskFreeRate: null,
    computedAt: null,
    gatheredAt: null,
    isStale: false,
    stocks: [],
    isBaseline: false,
  }));

  return (
    <html
      lang="en"
      // The theme script sets data-theme before React hydrates.
      suppressHydrationWarning
      className={cn("h-full antialiased font-sans", display.variable, sans.variable, mono.variable)}
    >
      <body className="flex min-h-full flex-col bg-background">
        {/* Injected into the initial HTML ahead of first-party code. A raw
            <script> in the layout made React warn on client re-renders. */}
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
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
              stocks={stocks.map(({ ticker, name }) => ({ ticker, name }))}
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
