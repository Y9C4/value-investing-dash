"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isChecked, setIsChecked] = React.useState(props.checked || false)
  const [isIndeterminate, setIsIndeterminate] = React.useState(false)

  // The handle is the DOM input plus a writable `indeterminate`, which is the
  // one checkbox property with no HTML attribute behind it: it exists only on
  // the element and has to be set from script. Spread last so the real node's
  // methods win, and typed as the element itself rather than `any`, since that
  // is what every caller treats it as.
  React.useImperativeHandle(
    ref,
    () =>
      ({
        get indeterminate() {
          return isIndeterminate
        },
        set indeterminate(value: boolean) {
          setIsIndeterminate(value)
        },
        ...inputRef.current,
      }) as HTMLInputElement
  )

  React.useEffect(() => {
    setIsChecked(props.checked || false)
  }, [props.checked])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsChecked(e.target.checked)
    if (isIndeterminate) {
      setIsIndeterminate(false)
    }
    props.onChange?.(e)
  }

  return (
    <label className={cn("inline-flex cursor-pointer", className)}>
      <input
        ref={inputRef}
        type="checkbox"
        className="sr-only"
        {...props}
        checked={isChecked}
        onChange={handleChange}
      />
      <div
        className={cn(
          "size-4 border transition-all duration-150",
          isChecked || isIndeterminate
            ? "bg-sidebar-primary border-border"
            : "border-border hover:border-muted-foreground"
        )}
        aria-hidden="true"
      >
        {isChecked && (
          <svg
            className="size-full text-primary-foreground"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 11-1.06-1.06l7.25-7.25a.75.75 0 011.06 0z" />
            <path d="M2.22 7.22a.75.75 0 011.06 0L6.5 10.44l-1.06 1.06a.75.75 0 01-1.06 0L2.22 8.28a.75.75 0 010-1.06z" />
          </svg>
        )}
        {isIndeterminate && (
          <svg
            className="size-full text-primary-foreground"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <rect x="3" y="7" width="10" height="2" />
          </svg>
        )}
      </div>
    </label>
  )
})
Checkbox.displayName = "Checkbox"

export { Checkbox }
