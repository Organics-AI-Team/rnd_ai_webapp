import * as React from "react"

import { cn } from "@rnd-ai/shared-utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "ui-field flex h-10 w-full rounded-xl px-3 py-2 text-sm transition-colors file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
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
