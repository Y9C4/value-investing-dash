import { DiscountRatePanel } from "@/components/discount-rate-panel"
import { ImpliedReturnPanel } from "@/components/implied-return-panel"
import { RatioPanel } from "@/components/ratio-panel"
import { SignalPanel, type BlendScore } from "@/components/signal-panel"
import { Panel, PanelHeader, PanelMeta, PanelTitle } from "@/components/ui/panel"
import { KeyStatistics } from "@/components/ticker-history"
import type { RatioContext } from "@/lib/sectors"
import type { Stock } from "@/lib/valuation"

/**
 * The stock page's evidence under the verdict: a row of statistics, then what
 * the price implies, where it ranks and the sector multiples side by side
 * (three across on a wide screen, two at laptop width), and the cost of
 * capital behind the hurdle rates.
 */
export function StockDetail({
  stock,
  riskFreeRate,
  marketReturn,
  valueRank,
  ratios,
  blends,
  standing,
}: {
  stock: Stock
  /** The distribution strip, shown inside the ranking panel. */
  standing: React.ReactNode
  valueRank: number | null
  ratios: RatioContext[]
  blends: BlendScore[]
  /** Both scalars ride on the universe payload this page already loaded. */
  riskFreeRate: number | null
  marketReturn: number | null
}) {
  return (
    <div className="flex flex-col gap-4 px-6 pt-4 pb-6 lg:px-10">
      <KeyStatistics
        beta={stock.beta}
        riskFreeRate={riskFreeRate}
        realisedReturn={stock.realisedReturn}
        marketReturn={marketReturn}
        valueRank={valueRank}
        composite={blends[0]?.score ?? null}
      />

      <div className="grid items-start gap-4 xl:max-[1799px]:grid-cols-2 min-[1800px]:grid-cols-3">
        <ImpliedReturnPanel stock={stock} />
        <SignalPanel stock={stock} valueRank={valueRank} blends={blends}>
          {standing}
        </SignalPanel>
        <div className="min-w-0 xl:max-[1799px]:col-span-2">
          <RatioPanel sector={stock.sector} context={ratios} />
        </div>
      </div>

      {/* Absent on the offline sample, which has no rates to report. */}
      {stock.discountRates && (
        <Panel>
          <PanelHeader>
            <PanelTitle>Cost of capital</PanelTitle>
            <PanelMeta>CAPM · WACC</PanelMeta>
          </PanelHeader>
          <DiscountRatePanel stock={stock} rates={stock.discountRates} />
        </Panel>
      )}
    </div>
  )
}
