import Link from "next/link"
import { RiArrowRightLine } from "@remixicon/react"

/** A quiet "go deeper" link: text, an arrow, an underline on hover. */
export function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {children}
      <RiArrowRightLine className="size-3.5" aria-hidden="true" />
    </Link>
  )
}
