import { cn } from "cn";
import { Loader2Icon } from "lucide-react";

/**
 * Shows a turning loader. The turn runs on a box around the icon, because the browser cannot turn
 * an SVG element on a high-density screen without drawing the page again on every frame.
 */
function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("inline-flex size-4 shrink-0 animate-spin", className)}
      {...props}
    >
      <Loader2Icon aria-hidden className="size-full" />
    </span>
  );
}

export { Spinner };
