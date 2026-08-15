import { PageHeader } from "@/components/page-header"
import { Sp500BackfillButton } from "@/components/sp500-backfill-button"

export const metadata = {
  title: "Data — Margin",
}

export default function DataPage() {
  return (
    <>
      <PageHeader
        eyebrow="Maintenance"
        title="Data"
        description="Everything downstream — the screener, the valuations, the frontier — reads from the stored daily closes. Refill them here when the history goes stale."
      />
      <div className="px-6 py-8 lg:px-10">
        <Sp500BackfillButton />
      </div>
    </>
  )
}
