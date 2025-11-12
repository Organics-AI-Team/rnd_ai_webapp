/**
 * Class name utility for merging Tailwind CSS classes
 *
 * Combines clsx for conditional classes and tailwind-merge for
 * intelligent Tailwind class merging (removes conflicts)
 *
 * @module cn
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Merges class names intelligently, resolving Tailwind CSS conflicts
 *
 * @param inputs - Class values to merge
 * @returns Merged class string
 *
 * @example
 * cn('px-2 py-1', 'px-4') // 'py-1 px-4' (px-2 removed due to conflict)
 * cn('text-red-500', condition && 'text-blue-500') // Conditional classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
