import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { RiArrowLeftLine } from "@remixicon/react"

import { cn } from "@/lib/utils"
import evidence from "../_data/notebook-evidence.json"
import backtest from "../_data/notebook-backtest.json"

/**
 * A Jupyter notebook, rendered from the export written by
 * python-api/notebooks/export_site.py. The HTML is ours (markdown and Pygments
 * output from our own notebooks, generated at authoring time), not user input,
 * which is why it can be set directly.
 */

type Output =
  | { kind: "image"; src: string; width: number; height: number; opaque: boolean }
  | { kind: "html"; html: string }
  | { kind: "text"; text: string }

type Cell =
  | { kind: "markdown"; html: string }
  | { kind: "code"; html: string; summary: string; count: number | null; outputs: Output[] }

type Notebook = { slug: string; title: string; cells: Cell[] }

const NOTEBOOKS: Record<string, Notebook> = {
  evidence: evidence as Notebook,
  backtest: backtest as Notebook,
}

export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(NOTEBOOKS).map((notebook) => ({ notebook }))
}

export async function generateMetadata({ params }: PageProps<"/research/[notebook]">) {
  const { notebook } = await params
  const nb = NOTEBOOKS[notebook]
  return nb ? { title: nb.title, description: `Jupyter notebook ${nb.slug}.ipynb, rendered.` } : {}
}

function CellOutput({ output, figure }: { output: Output; figure: number | null }) {
  if (output.kind === "image") {
    return (
      <figure className={cn("my-2", output.opaque && "bg-white p-2")}>
        <Image
          src={output.src}
          alt={`Figure ${figure} of the notebook`}
          width={output.width}
          height={output.height}
          sizes="(min-width: 1280px) 64rem, 100vw"
          loading={figure === 1 ? "eager" : "lazy"}
          className="h-auto w-full"
        />
      </figure>
    )
  }
  if (output.kind === "html") {
    return (
      <div
        className="notebook-output my-2 max-h-[28rem] overflow-auto"
        dangerouslySetInnerHTML={{ __html: output.html }}
      />
    )
  }
  return (
    <pre className="my-2 overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre text-muted-foreground">
      {output.text}
    </pre>
  )
}

export default async function NotebookPage({ params }: PageProps<"/research/[notebook]">) {
  const { notebook } = await params
  const nb = NOTEBOOKS[notebook]
  if (!nb) notFound()

  let figure = 0

  return (
    <article className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-6 lg:px-10">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <Link href="/research" className="flex items-center gap-1 hover:text-foreground">
          <RiArrowLeftLine className="size-3.5" aria-hidden="true" />
          Backtest results
        </Link>
        <span className="font-mono">python-api/notebooks/{nb.slug}.ipynb</span>
      </div>

      <aside className="flex max-w-3xl flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm leading-relaxed">
        <p className="font-semibold">In plain terms</p>
        {nb.slug === "backtest" ? (
          <p className="text-muted-foreground">
            This is the working research used to design the ranking, on data from
            Mar 2023 to Jan 2025. It was written before the unseen test, whose
            result is in{" "}
            <Link href="/research/evidence" className="underline underline-offset-2 hover:text-foreground">
              Evidence for the dashboard&rsquo;s claims
            </Link>
            .
          </p>
        ) : (
          <p className="text-muted-foreground">
            This notebook recalculates the numbers shown on the site. The ranking
            was designed on one stretch of history, then tested once on later
            months it had never seen. The short version: on unseen data it pointed
            the right way, but not strongly enough to rule out luck.
          </p>
        )}
        <p className="text-muted-foreground">
          Rank IC: how well a ranking predicted the order of next month&rsquo;s
          returns (0 is chance). Development: the months used for design. Holdout:
          the months kept back for testing. Code is folded away; open any block to
          read it.
        </p>
      </aside>

      {nb.cells.map((cell, i) =>
        cell.kind === "markdown" ? (
          <div key={i} className="notebook-prose max-w-3xl" dangerouslySetInnerHTML={{ __html: cell.html }} />
        ) : (
          <div key={i} className="flex flex-col">
            <details className="group overflow-clip rounded-lg border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-1.5 font-mono text-xs text-muted-foreground select-none hover:text-foreground">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-foreground">
                    <span className="group-open:hidden">+ Code</span>
                    <span className="hidden group-open:inline">− Code</span>
                  </span>
                  <span className="truncate">{cell.summary}</span>
                </span>
                <span className="shrink-0">In [{cell.count ?? " "}]</span>
              </summary>
              <pre className="notebook-code overflow-x-auto border-t border-border px-3 py-2.5 font-mono text-xs leading-relaxed">
                <code dangerouslySetInnerHTML={{ __html: cell.html }} />
              </pre>
            </details>
            {cell.outputs.map((output, j) => (
              <CellOutput
                key={j}
                output={output}
                figure={output.kind === "image" ? ++figure : null}
              />
            ))}
          </div>
        )
      )}
    </article>
  )
}
