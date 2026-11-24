import { useState, type ReactNode, type TransitionEvent } from "react";

/**
 * Shows or hides its content with a height change, so that the content below moves and does not
 * jump. The content stays mounted. `inert` keeps the hidden content out of the tab order.
 */
export function Collapse({
  open,
  children,
  className = "",
  unclipWhenOpen = false,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  /** Lets the content spill out once the area is open, such as a picker that opens above a field. */
  unclipWhenOpen?: boolean;
}) {
  const [settled, setSettled] = useState({ open, done: true });

  if (settled.open !== open) setSettled({ open, done: false });

  const finish = (event: TransitionEvent) => {
    if (event.target === event.currentTarget) setSettled({ open, done: true });
  };

  const clipped = !(unclipWhenOpen && open && settled.done);

  return (
    <div
      inert={!open}
      onTransitionEnd={finish}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-[opacity] ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      {/*
        The padding and the negative margin keep focus rings inside the clipped area. A closed area
        drops them, because the padding would still stick out of its zero height and make the page scroll.
      */}
      <div className={`min-h-0 ${clipped ? "overflow-hidden" : ""} ${open ? "-m-1 p-1" : ""} ${className}`}>{children}</div>
    </div>
  );
}
