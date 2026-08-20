"use client"

import { Popover as BasePopover } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

/**
 * Popover rather than Tooltip, deliberately. Base UI's guidance is that
 * anything needed to understand a control must not live in a tooltip —
 * tooltips are hover-only, so they are unreachable on touch and unreliable for
 * screen readers. This opens on hover *and* click, which keeps the pointer
 * ergonomics of a tooltip without the accessibility cost.
 */
function Popover({ children, ...props }: BasePopover.Root.Props) {
  return <BasePopover.Root {...props}>{children}</BasePopover.Root>
}

function PopoverTrigger({ className, ...props }: BasePopover.Trigger.Props) {
  return (
    <BasePopover.Trigger
      className={cn(
        "inline-flex items-center justify-center text-muted-foreground transition-colors",
        "hover:text-foreground data-popup-open:text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className
      )}
      {...props}
    />
  )
}

function PopoverContent({
  className,
  sideOffset = 8,
  align = "start",
  side,
  ...props
}: BasePopover.Popup.Props & {
  sideOffset?: number
  align?: BasePopover.Positioner.Props["align"]
  side?: BasePopover.Positioner.Props["side"]
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        sideOffset={sideOffset}
        align={align}
        side={side}
        className="z-50"
      >
        <BasePopover.Popup
          className={cn(
            // Square corners, per the project's no-radius rule.
            "flex max-w-xs flex-col gap-2 border border-border bg-popover px-4 py-3",
            "text-popover-foreground shadow-lg outline-none",
            "origin-[var(--transform-origin)] transition-[opacity,scale] duration-100 ease-out",
            "data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            "data-ending-style:scale-[0.98] data-ending-style:opacity-0",
            className
          )}
          {...props}
        />
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}

function PopoverTitle({ className, ...props }: BasePopover.Title.Props) {
  return (
    <BasePopover.Title
      className={cn(
        "text-xs font-semibold tracking-widest text-muted-foreground uppercase",
        className
      )}
      {...props}
    />
  )
}

export { Popover, PopoverTrigger, PopoverContent, PopoverTitle }
