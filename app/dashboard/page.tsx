import { ThemeToggle } from "@/components/theme-toggle"
import { TickerHistory } from "@/components/ticker-history"
import { Sp500BackfillButton } from "@/components/sp500-backfill-button"
import { Separator } from "@/components/ui/separator"

export default function Dashboard() {
  return (
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
  )
}


