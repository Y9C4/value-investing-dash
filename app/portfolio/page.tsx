import { EfficientFrontier } from "@/components/efficient-frontier"
import { PageHeader } from "@/components/page-header"

export const metadata = {
  title: "Portfolio — Margin",
}

export default function PortfolioPage() {
  return (
    <>
      <PageHeader
        eyebrow="Step three"
        title="Portfolio builder"
        description="Convex optimisation over the screened universe, with Ledoit-Wolf shrinkage on the covariance matrix and a risk-free rate taken from the annualised US 13-week treasury."
      />
      <div className="px-6 py-8 lg:px-10">
        <EfficientFrontier />
      </div>
    </>
  )
}
