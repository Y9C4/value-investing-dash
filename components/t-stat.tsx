import { cn } from "@/lib/utils"

/**
 * A t-stat with its significance marks: * at |t| ≥ 2, the conventional bar;
 * ** at |t| ≥ 3, the bar Harvey, Liu & Zhu (2016) set once many factors have
 * been tried. Values past the conventional bar are set in the foreground weight.
 */
export function TStat({ t }: { t: number }) {
  return (
    <span className={cn("font-figure", Math.abs(t) >= 2 ? "font-semibold text-foreground" : "text-muted-foreground")}>
      {t.toFixed(2)}
      {Math.abs(t) >= 3 ? "**" : Math.abs(t) >= 2 ? "*" : ""}
    </span>
  )
}
