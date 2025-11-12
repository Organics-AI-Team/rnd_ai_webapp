import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-gray-300 bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-gray-300 bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-red-600 bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        line: "bg-green-100 text-green-700 border-green-300",
        shopee: "bg-orange-100 text-orange-700 border-orange-300",
        lazada: "bg-blue-100 text-blue-700 border-blue-300",
        other: "bg-gray-100 text-gray-700 border-gray-300",
        pending: "bg-yellow-500 text-white border-yellow-600",
        processing: "bg-blue-500 text-white border-blue-600",
        sent_to_logistic: "bg-purple-500 text-white border-purple-600",
        delivered: "bg-line text-white border-line-dark",
        cancelled: "bg-red-500 text-white border-red-600",
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
