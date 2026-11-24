import { COLOR_HEX } from "@clots/character";
import type { Account, UsageWindow } from "@clots/contracts";
import { cn } from "cn";
import { ChevronRightIcon, ContrastIcon, GaugeIcon, MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { client } from "@/client.ts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { currentTheme, setTheme, type Theme } from "@/lib/color-scheme.ts";
import { formatReset } from "@/time.ts";
import { Collapse } from "./Collapse.tsx";

/** How often the client asks for the usage. The server asks Claude Code at most once a minute. */
const CHECK_INTERVAL_MS = 60_000;

/** The percentage from which a limit shows in amber. */
const NEAR_LIMIT = 80;

type Level = "normal" | "near" | "critical";

/** The text color of a level. Light mode needs a darker shade of the palette color to stay readable on white. */
const LEVEL_TEXT: Record<Level, string> = {
  normal: "text-muted-foreground",
  near: "text-[#b07610] dark:text-[#f5a524]",
  critical: "text-[#d63c3c] dark:text-[#ef4444]",
};

/** The bar and ring color of a level, from the character palette. A normal level uses the theme's own color. */
const LEVEL_COLOR: Record<Level, string | undefined> = {
  normal: undefined,
  near: COLOR_HEX.amber,
  critical: COLOR_HEX.red,
};

const THEMES: ReadonlyArray<{ value: Theme; label: string; icon: LucideIcon }> = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

/** Tells how close a window is to its limit. Claude marks a critical one itself. */
const levelOf = (window: UsageWindow | undefined): Level => {
  if (window?.critical) return "critical";

  if ((window?.percent ?? 0) >= NEAR_LIMIT) return "near";

  return "normal";
};

/** Names a window in the menu, such as "Fable this week". */
const meterLabel = (window: UsageWindow) => {
  if (window.kind === "session") return "Session";

  if (window.kind === "model") return `${window.model} this week`;

  return "This week";
};

/** Names a window in the tooltip, such as "this week". */
const shortLabel = (window: UsageWindow) => (window.kind === "session" ? "this session" : meterLabel(window).replace(/^This/, "this"));

/** Picks the window that is closest to its limit. */
const highestOf = (usage: ReadonlyArray<UsageWindow> | null | undefined) =>
  usage?.reduce<UsageWindow | undefined>((highest, window) => (highest === undefined || window.percent > highest.percent ? window : highest), undefined);

/** Keeps the server's account and usage, and asks again each minute while the client is connected. */
function useAccount(connected: boolean) {
  const [account, setAccount] = useState<Account>();
  const refresh = () => void client.getAccount().then(setAccount, () => undefined);

  useEffect(() => {
    if (!connected) return;

    refresh();
    const timer = setInterval(refresh, CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [connected]);

  return { account, refresh };
}

/** Takes the initials of a name ("Ada Lovelace" gives "AL"), or the first letter of the email without a name. */
const initialsOf = (account: Account | undefined) => {
  const words = account?.name?.split(/\s+/) ?? [];

  if (words.length > 1) return `${words[0]!.charAt(0)}${words.at(-1)!.charAt(0)}`;

  return (words[0] ?? account?.email ?? "").charAt(0);
};

/** A circle with the account's initials, ringed by the use of the limit that is closest to its end. */
function UsageGauge({ initials, window, dimmed }: { initials: string; window: UsageWindow | undefined; dimmed: boolean }) {
  const radius = 14.5;
  const length = 2 * Math.PI * radius;
  const percent = Math.min(100, window?.percent ?? 0);
  const color = LEVEL_COLOR[levelOf(window)];

  return (
    <span className="relative size-8 shrink-0">
      <svg viewBox="0 0 32 32" className={cn("absolute inset-0 -rotate-90 transition-opacity duration-200", dimmed && "opacity-55")} aria-hidden>
        <circle cx="16" cy="16" r={radius} fill="none" strokeWidth="3" className="stroke-muted-foreground/22" />
        {percent > 0 && (
          <circle
            cx="16"
            cy="16"
            r={radius}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={length}
            strokeDashoffset={length * (1 - percent / 100)}
            className={cn("transition-[stroke-dashoffset,stroke] duration-600 ease-out motion-reduce:transition-none", color === undefined && "stroke-muted-foreground")}
            style={{ stroke: color }}
          />
        )}
      </svg>
      <span className="absolute inset-1 flex items-center justify-center rounded-full bg-muted text-[10.5px] font-semibold uppercase">{initials}</span>
    </span>
  );
}

/** One usage limit: its name and percentage, a bar, and when it resets. */
function UsageMeter({ window }: { window: UsageWindow }) {
  const level = levelOf(window);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
        <span className="truncate text-muted-foreground">{meterLabel(window)}</span>
        <span className={cn("tabular-nums", LEVEL_TEXT[level])}>{Math.round(window.percent)}%</span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", LEVEL_COLOR[level] === undefined && "bg-foreground/60")}
          style={{ width: `${Math.min(100, window.percent)}%`, backgroundColor: LEVEL_COLOR[level] }}
        />
      </div>
      {window.resetsAt !== null && <p className="text-xs text-muted-foreground tabular-nums">{formatReset(window.resetsAt)}</p>}
    </div>
  );
}

/** A grey bar in place of text that is not there yet. */
function Skeleton({ className }: { className: string }) {
  return <span className={cn("block animate-pulse rounded-full bg-muted motion-reduce:animate-none", className)} />;
}

/** Switches the theme of this device between the system setting, light and dark. */
function ThemeToggle() {
  const [theme, setShownTheme] = useState(currentTheme);

  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-lg bg-muted/70 p-0.5">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => {
            setTheme(value);
            setShownTheme(value);
          }}
          className="flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-150 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/40 aria-checked:bg-popover aria-checked:text-foreground aria-checked:shadow-sm"
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

/** The plan row: the plan and the use of the limit closest to its end. A click unfolds every limit. */
function UsageRow({ account }: { account: Account | undefined }) {
  const [open, setOpen] = useState(false);
  const usage = account?.usage ?? [];
  const highest = highestOf(usage);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        disabled={highest === undefined}
        onClick={() => setOpen(!open)}
        className="flex min-h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-left outline-none transition-[background-color,box-shadow] duration-150 enabled:hover:bg-muted focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring/40"
      >
        <GaugeIcon className="size-4 shrink-0 text-muted-foreground" />
        {account === undefined ? <Skeleton className="h-3.5 w-14" /> : <span className="truncate">{account.plan}</span>}
        <span className={cn("ml-auto shrink-0 tabular-nums", LEVEL_TEXT[levelOf(highest)])}>
          {highest === undefined ? account !== undefined && "Usage unknown" : `${Math.round(highest.percent)}% used`}
        </span>
        {highest !== undefined && (
          <ChevronRightIcon
            className={cn("-mr-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-90")}
          />
        )}
      </button>
      <Collapse open={open}>
        <div className="flex flex-col gap-2.5 pt-1 pr-2.5 pb-2 pl-[2.375rem]">
          {usage.map((window) => (
            <UsageMeter key={`${window.kind}-${window.model ?? ""}`} window={window} />
          ))}
        </div>
      </Collapse>
    </>
  );
}

/**
 * The account circle at the bottom of the sidebar. Its ring shows the limit that is closest to its
 * end, and its menu shows the Claude account of the server, the plan's limits and this device's theme.
 * While the client has no connection, the circle dims and keeps the last known numbers.
 */
export function AccountMenu({ connected, connecting }: { connected: boolean; connecting: boolean }) {
  const { account, refresh } = useAccount(connected);
  const highest = highestOf(account?.usage);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Popover onOpenChange={(open) => open && connected && refresh()}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Account"
              title={highest === undefined ? undefined : `${Math.round(highest.percent)}% used · ${shortLabel(highest)}`}
              className="flex rounded-full outline-none transition-[scale,box-shadow] duration-150 ease-out focus-visible:ring-1 focus-visible:ring-ring/40 active:scale-[0.96] motion-reduce:active:scale-100"
            />
          }
        >
          <UsageGauge initials={initialsOf(account)} window={highest} dimmed={connecting} />
        </PopoverTrigger>
        {/* Only a keyboard open moves focus to the first row. A pointer open leaves every row unhighlighted. */}
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          initialFocus={(openType) => openType === "keyboard"}
          className="w-64 gap-0.5 rounded-2xl p-1.5 shadow-lg"
        >
          <div className="min-w-0 px-2.5 pt-1.5 pb-2">
            {account === undefined ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <>
                <p className="truncate font-medium">{account.name ?? account.email ?? "Claude account"}</p>
                {account.name !== null && account.email !== null && <p className="truncate text-xs text-muted-foreground">{account.email}</p>}
              </>
            )}
          </div>
          <div className="mx-2.5 mb-1 h-px bg-foreground/7" />
          <UsageRow account={account} />
          <div className="flex min-h-9 items-center gap-2.5 rounded-[10px] px-2.5">
            <ContrastIcon className="size-4 shrink-0 text-muted-foreground" />
            <span>Theme</span>
            <span className="ml-auto">
              <ThemeToggle />
            </span>
          </div>
        </PopoverContent>
      </Popover>
      {connecting && <span className="truncate text-xs text-muted-foreground">Connecting…</span>}
    </div>
  );
}
