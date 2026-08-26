"use client"

import { Dialog as BaseDialog } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

function Dialog(props: BaseDialog.Root.Props) {
  return <BaseDialog.Root {...props} />
}

function DialogTrigger(props: BaseDialog.Trigger.Props) {
  return <BaseDialog.Trigger {...props} />
}

function DialogClose(props: BaseDialog.Close.Props) {
  return <BaseDialog.Close {...props} />
}

function DialogContent({ className, ...props }: BaseDialog.Popup.Props) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-background/70 backdrop-blur-sm transition-opacity duration-150",
          "data-starting-style:opacity-0 data-ending-style:opacity-0"
        )}
      />
      <BaseDialog.Popup
        className={cn(
          // Square corners, per the project's no-radius rule.
          "fixed top-1/2 left-1/2 z-50 flex w-[min(34rem,calc(100vw-2rem))]",
          "max-h-[calc(100vh-2rem)] -translate-1/2 flex-col overflow-y-auto",
          "border border-border bg-card shadow-xl outline-none",
          "transition-[opacity,scale] duration-150 ease-out",
          "data-starting-style:scale-[0.98] data-starting-style:opacity-0",
          "data-ending-style:scale-[0.98] data-ending-style:opacity-0",
          className
        )}
        {...props}
      />
    </BaseDialog.Portal>
  )
}

function DialogTitle({ className, ...props }: BaseDialog.Title.Props) {
  return (
    <BaseDialog.Title
      className={cn(
        "font-heading text-xl font-semibold tracking-wider uppercase",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: BaseDialog.Description.Props) {
  return (
    <BaseDialog.Description
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
}
