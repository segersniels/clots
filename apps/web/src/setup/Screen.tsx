import { cn } from "cn";
import { ChevronLeftIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

/**
 * Lays out one setup screen: a top bar that drags the window and leaves room for the macOS window
 * buttons, and one centered column.
 */
function Screen({ onBack, className, children, ...props }: ComponentProps<"main"> & { onBack?: () => void }) {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground select-none">
      <header className="flex h-13 shrink-0 items-center pl-[88px] [-webkit-app-region:drag]">
        {onBack !== undefined && (
          <Button variant="ghost" size="sm" onClick={onBack} className="[-webkit-app-region:no-drag]">
            <ChevronLeftIcon />
            Back
          </Button>
        )}
      </header>
      <main className={cn("mx-auto flex w-full max-w-[480px] min-h-0 flex-1 flex-col pb-8", className)} {...props}>
        {children}
      </main>
    </div>
  );
}

function ScreenTitle({ className, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn("text-2xl font-semibold tracking-tight", className)} {...props} />;
}

function ScreenDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("mt-2 text-[0.9375rem] text-muted-foreground", className)} {...props} />;
}

/** Holds the screen's status line and its main button at the bottom of the column. */
function ScreenFooter({ className, ...props }: ComponentProps<"footer">) {
  return <footer className={cn("mt-auto flex items-center justify-between gap-4 pt-6", className)} {...props} />;
}

export { Screen, ScreenDescription, ScreenFooter, ScreenTitle };
