import { RiGithubFill, RiLinkedinBoxFill, RiMailLine } from "@remixicon/react"

import { PROFILE_LINKS } from "@/lib/profile"
import { cn } from "@/lib/utils"

const ICONS = { github: RiGithubFill, linkedin: RiLinkedinBoxFill, mail: RiMailLine }

/** The three profile links as icons; `labels` adds the word beside each icon. */
export function ProfileLinks({ labels = false, className }: { labels?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      {PROFILE_LINKS.map(({ label, href, icon }) => {
        const Icon = ICONS[icon]
        return (
          <a
            key={label}
            href={href}
            target={href.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
            aria-label={labels ? undefined : label}
            title={labels ? undefined : label}
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon className="size-5" aria-hidden="true" />
            {labels && label}
          </a>
        )
      })}
    </div>
  )
}
