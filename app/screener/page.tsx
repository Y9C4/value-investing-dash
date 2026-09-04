import { PageHeader } from "@/components/page-header"
import { Screener } from "@/components/screener"
import { loadUniverse } from "@/lib/universe"

export const metadata = {
  title: "Screener",
}

export default async function ScreenerPage() {
  const { stocks } = await loadUniverse()

  return (
    <>
      <PageHeader
        eyebrow="Step one"
        title="Screener"
        description="Every stock in the index valued by five models that decline to answer rather than guess. Opens on a value screen — narrow it further, then hand what survives to the optimiser."
      />
      <Screener stocks={stocks} />
    </>
  )
}
