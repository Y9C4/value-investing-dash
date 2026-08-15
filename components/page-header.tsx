export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="border-b border-border bg-card px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-2xl flex-col gap-2">
          {eyebrow && (
            <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              {eyebrow}
            </span>
          )}
          <h1 className="font-heading text-2xl font-semibold tracking-wider uppercase">
            {title}
          </h1>
          {description && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </header>
  )
}
