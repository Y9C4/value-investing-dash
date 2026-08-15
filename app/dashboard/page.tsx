import { ThemeToggle } from "@/components/theme-toggle"
import { TickerHistory } from "@/components/ticker-history"


export default function Dashboard() {
  return (
    <div className="flex w-full h-full items-start justify-center bg-card p-8">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <TickerHistory />
    </div>
  )
}


