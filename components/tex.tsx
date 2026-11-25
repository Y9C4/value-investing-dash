import katex from "katex"

import { cn } from "@/lib/utils"

/**
 * A formula written in LaTeX and set in the site's own face, italic (see
 * globals.css). Only our own strings go in; KaTeX escapes anything it is given.
 */
export function Tex({ children, block = false, className }: { children: string; block?: boolean; className?: string }) {
  return (
    <span
      className={cn(block && "block", className)}
      dangerouslySetInnerHTML={{ __html: katex.renderToString(children, { displayMode: block, throwOnError: false }) }}
    />
  )
}
