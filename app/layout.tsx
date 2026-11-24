import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { MarketContext } from "@/components/market-context";
import { isDataPageEnabled } from "@/lib/market-data-service";
import { loadUniverse } from "@/lib/universe";
import { cn } from "@/lib/utils";

// Newsreader for display (titles, stock names, verdict sentences): an
// editorial serif, the broadsheet half of the look. IBM Plex Sans for the UI
// and IBM Plex Mono for every figure: drawn as a pair, with tabular digits, a
// slashed zero and a 1 that cannot be read as l or 7.
const display = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

// Runs before first paint so a reader who chose light never sees a dark flash.
const THEME_SCRIPT = `try{if(localStorage.getItem("theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

const TITLE = "Value Investing Dash";
const DESCRIPTION =
  "Rank the S&P 500 on what each price implies against what its risk requires, confirmed by trend, then build an optimised portfolio from the screen.";

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
      // The theme script sets data-theme before React hydrates.
      suppressHydrationWarning
      className={cn("h-full antialiased font-sans", display.variable, sans.variable, mono.variable)}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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
