import { PageHeader } from "@/components/page-header"
import { Screener } from "@/components/screener"
import { loadUniverse } from "@/lib/universe"

export const metadata = {
  title: "Screener — Margin",
}

export default async function ScreenerPage() {
  const { stocks, isBaseline, computedAt } = await loadUniverse()

  return (
    <>
      <PageHeader
        eyebrow="Step one"
        title="Screener"
        description="Every stock in the universe scored against each valuation model, then reduced to the ones trading below what they're worth. Filter here; optimise what survives."
      />
      <Screener
        stocks={stocks}
        isBaseline={isBaseline}
        computedAt={computedAt}
      />
    </>
  )
}
