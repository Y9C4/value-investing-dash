"use client"

import { useState } from "react"
import {
  RiCloseLine,
  RiFilter3Line,
  RiPieChartLine,
  RiQuestionLine,
  RiStockLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { VALUATION_METHODS } from "@/lib/valuation"

const STEPS = [
  {
    icon: RiFilter3Line,
    label: "Screen",
    body: "Rank the index by how far each price sits below what the models can justify.",
  },
  {
    icon: RiStockLine,
    label: "Analyse",
    body: "Open a stock for its per-model fair values and the rates they were discounted at.",
  },
  {
    icon: RiPieChartLine,
    label: "Optimise",
    body: "Build an efficient frontier from whatever survived the screen.",
  },
]

/**
 * The same three steps the landing page opens with, kept as a dialog for the
 * reader who arrives on a deep link and wants the premise without leaving the
 * page they came for.
 *
 * It used to open itself on a first visit, which was the right call when `/`
 * redirected straight into a 448-row table and nothing else explained the
 * project. Now that the landing page does, an interstitial over the first
 * screen is just something to dismiss.
 */
export function IntroDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="justify-start px-0 text-muted-foreground"
          />
        }
      >
        <RiQuestionLine />
        How this works
      </DialogTrigger>

      <DialogContent aria-describedby="intro-summary">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="flex flex-col gap-2">
            <DialogTitle>What this is</DialogTitle>
            <DialogDescription id="intro-summary">
              A value screener wired to a portfolio optimiser.{" "}
              {VALUATION_METHODS.length} valuation models price every S&amp;P
              500 stock off its own fundamentals — cash flows, dividends,
              book value — and never off its price history.
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="-mt-1 -mr-2 p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <RiCloseLine className="size-4" />
          </DialogClose>
        </div>

        <ol className="flex flex-col">
          {STEPS.map(({ icon: Icon, label, body }, index) => (
            <li
              key={label}
              className="flex items-start gap-4 border-b border-border px-6 py-4"
            >
              <span className="flex items-center gap-2 pt-px">
                <span className="font-mono text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <Icon className="size-4 text-primary" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold tracking-widest uppercase">
                  {label}
                </span>
                <span className="text-sm text-muted-foreground">{body}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2 px-6 py-5">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Why screen first
          </span>
          <p className="text-sm leading-relaxed text-muted-foreground">
            An optimiser estimates expected return from past return, so a stock
            that has already multiplied looks like an exceptional opportunity —
            at exactly the moment its price embeds the most optimism. Valuing on
            fundamentals removes those names before the optimiser sees them.
          </p>
        </div>

        <div className="flex justify-end border-t border-border px-6 py-4">
          <DialogClose render={<Button size="sm">Start screening</Button>} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
