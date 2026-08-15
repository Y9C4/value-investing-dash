import { EfficientFrontier } from "@/components/efficient-frontier"
import { ThemeToggle } from "@/components/theme-toggle"
import { TickerHistory } from "@/components/ticker-history"
import { Sp500BackfillButton } from "@/components/sp500-backfill-button"
import { Separator } from "@/components/ui/separator"

export default function Dashboard() {
  return (
    <div>
    <div className="flex w-full h-full items-start justify-center bg-card p-8">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <TickerHistory />
        <Separator />
        <Sp500BackfillButton />
      </div>
      
    </div>
      <div className="flex w-full justify-center bg-secondary p-8">
        <div className="flex w-full max-w-3xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl text-foreground">Portfolio Builder</h1>
            <p className="text-sm text-foreground/50">
              Build an efficient portfolio from the 500 stocks on the S&amp;P500
              with a risk free rate derrived as the annualised average of the US
              13 week treasury bonds. The efficient portfolio is derrived using a
              convex optimization via CVXPY using Ledoit-Wolf shrinkage on the
              VarCov matrix.
            </p>
          </div>

          <EfficientFrontier />
        </div>
      </div>
    </div>
  )
}


