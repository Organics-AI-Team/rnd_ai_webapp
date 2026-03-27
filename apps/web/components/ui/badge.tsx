import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@rnd-ai/shared-utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-2xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-gray-900 text-white",
        secondary:
          "border-gray-200 bg-gray-50 text-gray-700",
        destructive:
          "border-transparent bg-red-600 text-white",
        outline: "text-gray-700 border-gray-200",
        line: "bg-emerald-50 text-emerald-700 border-emerald-200",
        shopee: "bg-orange-50 text-orange-700 border-orange-200",
        lazada: "bg-blue-50 text-blue-700 border-blue-200",
        other: "bg-gray-50 text-gray-600 border-gray-200",
        pending: "bg-amber-50 text-amber-700 border-amber-200",
        processing: "bg-blue-50 text-blue-700 border-blue-200",
        sent_to_logistic: "bg-violet-50 text-violet-700 border-violet-200",
        delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
        cancelled: "bg-red-50 text-red-700 border-red-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
