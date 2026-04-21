import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Executes `cn`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
