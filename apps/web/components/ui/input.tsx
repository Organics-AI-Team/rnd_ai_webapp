import * as React from "react"

import { cn } from "@rnd-ai/shared-utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-8 w-full rounded-xl border border-emerald-100 bg-white/90 px-2.5 py-1 text-sm text-emerald-950 shadow-inner shadow-emerald-950/[0.025] transition-colors file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-emerald-950 placeholder:text-emerald-800/40 focus-visible:border-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/30 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
