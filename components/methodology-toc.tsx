"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * The page's contents: a sticky rail at xl, a wrapped row above that. The
 * section nearest the top of the reading area is marked, so a long page says
 * where you are.
 */
export function MethodologyToc({ sections }: { sections: readonly (readonly [string, string])[] }) {
  const [active, setActive] = useState(sections[0][0])
  const visible = useRef(new Set<string>())

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.current.add(entry.target.id)
          else visible.current.delete(entry.target.id)
        }
        // The first section in page order that is in the reading band; unchanged when none is.
        const first = sections.find(([id]) => visible.current.has(id))
        if (first) setActive(first[0])
      },
      // A band under the sticky strip and above the lower two thirds of the window.
      { rootMargin: "-80px 0px -60% 0px" }
    )
    for (const [id] of sections) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [sections])

  return (
    <nav aria-label="On this page" className="xl:sticky xl:top-20 xl:self-start">
      <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">On this page</p>
      <ol className="flex flex-wrap gap-x-5 gap-y-1.5 xl:flex-col xl:gap-0 xl:border-l xl:border-border">
        {sections.map(([id, title]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={active === id ? "location" : undefined}
              className={cn(
                "block text-sm transition-colors hover:text-foreground xl:-ml-px xl:border-l-2 xl:py-1.5 xl:pl-4",
                active === id
                  ? "text-foreground xl:border-primary"
                  : "text-muted-foreground xl:border-transparent"
              )}
            >
              {title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
