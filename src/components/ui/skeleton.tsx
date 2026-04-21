import { cn } from "@/lib/utils";

/**
 * Executes `Skeleton`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
