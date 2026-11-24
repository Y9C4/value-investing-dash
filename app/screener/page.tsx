import { Screener } from "@/components/screener"
import { loadUniverse } from "@/lib/universe"

export const metadata = {
  title: "Stock screener",
}

/**
 * No page header: the name lives in the context strip. Prerendered: the
 * `?sector=` filter is read on the client (see `SectorsFromUrl`).
 */
export default async function ScreenerPage() {
  const { stocks } = await loadUniverse()
  // The screener never reads the discount-rate breakdown; it was a third of the payload.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return <Screener stocks={stocks.map(({ discountRates: _unused, ...stock }) => stock)} />
}
