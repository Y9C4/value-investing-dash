"use client"

import { RiInformationLine } from "@remixicon/react"

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * One paragraph of explanation, behind an info trigger. Never shown inline.
 *
 * The rule this enforces across the app: a control or a figure says what it is
 * in its label, and the reasoning behind it is one hover away. Prose that sits
 * permanently on the page gets skipped, and then the control it was explaining
 * gets used without being understood.
 */
export function Info({
  title,
  side = "right",
  className,
  children,
}: {
  title: string
  side?: "top" | "right" | "bottom" | "left"
  className?: string
  children: React.ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        aria-label={`About ${title.toLowerCase()}`}
        className={cn("size-4 shrink-0", className)}
      >
        <RiInformationLine className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent side={side} className="max-w-sm">
        <PopoverTitle>{title}</PopoverTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {children}
        </p>
      </PopoverContent>
    </Popover>
  )
}
