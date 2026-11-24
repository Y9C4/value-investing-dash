import { Screener } from "@/components/screener"
import { loadUniverse } from "@/lib/universe"

export const metadata = {
  title: "Screener",
}

/**
 * No page header: the name lives in the context strip. `?sector=` (repeatable)
 * opens the screen filtered, which is how the Overview's sector rows link here.
 */
export default async function ScreenerPage({ searchParams }: PageProps<"/screener">) {
  const [{ stocks }, { sector }] = await Promise.all([loadUniverse(), searchParams])
  const known = new Set(stocks.map((stock) => stock.sector))
  const sectors = [sector ?? []].flat().filter((name) => known.has(name))

  // Keyed so following a different sector link resets the screen's state.
  return <Screener key={sectors.join("|")} stocks={stocks} initialSectors={sectors} />
}
