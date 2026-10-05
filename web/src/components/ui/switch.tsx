import * as React from "react"

import { cn } from "cn"

/**
 * Accessible on/off switch built on a native checkbox (`role="switch"`) inside
 * its own <label>, so it is labelled and operable in server-rendered HTML
 * without JavaScript. Visually identical to the shadcn/ui switch.
 */
function Switch({
  className,
  label,
  labelClassName,
  checked,
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "onChange"> & {
  label: React.ReactNode
  labelClassName?: string
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <label data-slot="switch" className={cn("inline-flex cursor-pointer items-center gap-2 select-none", className)}>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
      <span
        aria-hidden="true"
        className="inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent bg-input shadow-xs transition-all peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 dark:bg-input/80 dark:peer-checked:bg-primary [&>span]:translate-x-0 peer-checked:[&>span]:translate-x-[calc(100%-2px)] dark:[&>span]:bg-foreground dark:peer-checked:[&>span]:bg-primary-foreground"
      >
        <span className="pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform" />
      </span>
      <span className={labelClassName}>{label}</span>
    </label>
  )
}

export { Switch }
