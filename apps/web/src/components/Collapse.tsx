import type { ReactNode } from "react";

/**
 * Shows or hides its content with a height change, so that the content below moves and does not
 * jump. The content stays mounted. `inert` keeps the hidden content out of the tab order.
 */
export function Collapse({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      inert={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-[opacity] ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      {/* The padding and the negative margin keep focus rings inside the clipped area. */}
      <div className={`-m-1 min-h-0 overflow-hidden p-1 ${className}`}>{children}</div>
    </div>
  );
}
