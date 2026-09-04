import { Screener } from "@/components/screener"
import { loadUniverse } from "@/lib/universe"

export const metadata = {
  title: "Screener",
}

/**
 * No page header. The name lives in the context strip, which is on every route
 * already; the eyebrow-title-paragraph block that used to sit here cost the
 * top eighth of the window to restate the sidebar, on the one page whose
 * useful height is entirely rows of table.
 */
export default async function ScreenerPage() {
  const { stocks } = await loadUniverse()

  return <Screener stocks={stocks} />
}
