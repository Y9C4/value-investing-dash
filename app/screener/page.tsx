import { PageHeader } from "@/components/page-header"
import { Screener } from "@/components/screener"
import { ScreenerRationale } from "@/components/screener-rationale"
import { loadUniverse } from "@/lib/universe"

export const metadata = {
  title: "Screener — Margin",
}

export default async function ScreenerPage() {
  const { stocks, isBaseline, computedAt } = await loadUniverse()

  return (
    <>
      <PageHeader
        eyebrow="Step one of three"
        title="Screen on value, then optimise"
        description="A mean-variance optimiser fed the whole index will happily concentrate into whatever has recently risen fastest, because a steep past return looks like a high expected return. Screening first removes those names on valuation grounds before the optimiser ever sees them."
      />
      <ScreenerRationale />
      <Screener
        stocks={stocks}
        isBaseline={isBaseline}
        computedAt={computedAt}
      />
    </>
  )
}
