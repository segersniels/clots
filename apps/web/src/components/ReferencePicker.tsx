import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** One row of the picker: a skill or a bot. */
export interface PickerItem {
  readonly name: string;
  readonly description: string;
  readonly icon: ReactNode;
}

/**
 * Lists the skills or bots that match what the operator types after `$`, `/` or `@`. It sits above
 * the composer, which keeps the focus and handles the keys, so a click must not take the focus.
 */
export function ReferencePicker({
  open,
  label,
  items,
  activeIndex,
  emptyText,
  onPick,
  onHover,
}: {
  open: boolean;
  label: string;
  items: ReadonlyArray<PickerItem>;
  activeIndex: number;
  emptyText: string;
  onPick: (item: PickerItem) => void;
  onHover: (index: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);

  // The keys move the active row, so it must stay in view.
  useEffect(() => {
    list.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      data-open={open}
      className="absolute inset-x-0 bottom-full mb-2 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-md transition-[opacity,translate] duration-150 ease-out data-[open=false]:pointer-events-none data-[open=false]:translate-y-1 data-[open=false]:opacity-0 motion-reduce:data-[open=false]:translate-y-0"
    >
      {items.length === 0 && <p className="px-2.5 py-2 text-[0.8125rem] text-muted-foreground">{emptyText}</p>}
      {items.map((item, index) => (
        <Button
          key={item.name}
          variant="ghost"
          role="option"
          aria-selected={index === activeIndex}
          tabIndex={-1}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item);
          }}
          onMouseMove={() => onHover(index)}
          className="h-auto w-full justify-start gap-2 rounded-lg px-2.5 py-1.5 text-left font-normal aria-selected:bg-accent"
        >
          {item.icon}
          <span className="shrink-0 font-medium">{item.name}</span>
          <span className="min-w-0 truncate text-[0.8125rem] text-muted-foreground">{item.description}</span>
        </Button>
      ))}
    </div>
  );
}
