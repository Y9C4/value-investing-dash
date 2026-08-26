import { Screener } from "@/components/screener"
import { loadUniverse } from "@/lib/universe"

export const metadata = {
  title: "Screener — Margin",
}

export default async function ScreenerPage() {
  const { stocks, isBaseline, computedAt } = await loadUniverse()

  return (
    <Screener
      stocks={stocks}
      isBaseline={isBaseline}
      computedAt={computedAt}
    />
  )
}
