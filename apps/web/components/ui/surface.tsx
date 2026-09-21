import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@rnd-ai/shared-utils"

const surfaceVariants = cva(
  "border border-border bg-surface text-ink",
  {
    variants: {
      variant: {
        default: "rounded-2xl shadow-sm",
        panel: "rounded-2xl shadow-panel",
        quiet: "rounded-xl bg-subtle",
        modal: "rounded-[28px] shadow-modal",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof surfaceVariants> {
  asChild?: boolean
}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div"
    return <Comp ref={ref} className={cn(surfaceVariants({ variant }), className)} {...props} />
  }
)
Surface.displayName = "Surface"

const SurfaceHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center justify-between border-b border-border px-5 py-4", className)}
    {...props}
  />
))
SurfaceHeader.displayName = "SurfaceHeader"

const IconTile = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { tone?: "neutral" | "brand" }
>(({ className, tone = "neutral", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex size-10 shrink-0 items-center justify-center rounded-xl",
      tone === "brand" ? "bg-brand-soft text-brand" : "border border-border bg-surface text-muted",
      className,
    )}
    {...props}
  />
))
IconTile.displayName = "IconTile"

export { Surface, SurfaceHeader, IconTile, surfaceVariants }
