import { Character } from "@clots/character";
import { isNewerVersion, type BotSummary, type UpdateInfo } from "@clots/contracts";
import { cn } from "cn";
import { ArrowUpIcon, ArrowUpRightIcon, CheckIcon, LaptopIcon, ServerIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { client, useStore } from "@/client.ts";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";

/** How often a client asks the server again for the latest release. The server asks GitHub at most hourly. */
const CHECK_INTERVAL_MS = 60 * 60_000;

/** How long the done pill stays before it goes. */
const DONE_MS = 4000;

/** How long the restart fill takes to slow down near its end. */
const FILL_MS = 14_000;

/** How long the fill takes to finish once the server is back, before the pill says that the update is done. */
const FILL_FINISH_MS = 200;

/** The pill's left and right padding together, which its width adds to the width of its label. */
const PILL_PADDING_PX = 17;

/** How long the client waits for the server to come back before it reports a failed update. */
const RESTART_TIMEOUT_MS = 90_000;

/** The Clots app's version, which the app adds to the user agent. A browser has none. */
const DESKTOP_VERSION = /clots-desktop\/\w+\/([\d.]+)/.exec(navigator.userAgent)?.[1];

type UpdatePhase =
  | { readonly name: "idle" }
  | { readonly name: "downloading"; readonly target: string }
  | { readonly name: "restarting"; readonly target: string; readonly since: number }
  | { readonly name: "done"; readonly target: string }
  | { readonly name: "failed"; readonly message: string };

/**
 * Tracks the updates of the server and of the Clots app. A server update runs through download,
 * restart and reconnect. The footer does not say "Connecting…" while this client restarts the server.
 */
export function useUpdates() {
  const connection = useStore(client.connection);
  const [info, setInfo] = useState<UpdateInfo>();
  const [phase, setPhase] = useState<UpdatePhase>({ name: "idle" });

  // A new connection can mean a new server version, so the client asks again on each one.
  useEffect(() => {
    if (connection !== "connected") return;

    const check = () => void client.getUpdateInfo().then(setInfo, () => undefined);
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [connection]);

  // The restart ends when the client is connected to the new version again.
  useEffect(() => {
    if (phase.name !== "restarting") return;

    if (connection === "connected" && info?.current === phase.target) {
      setPhase({ name: "done", target: phase.target });

      return;
    }

    const timer = setTimeout(
      () => setPhase({ name: "failed", message: "The server did not come back after the restart. Check it on its machine." }),
      phase.since + RESTART_TIMEOUT_MS - Date.now(),
    );

    return () => clearTimeout(timer);
  }, [phase, connection, info?.current]);

  useEffect(() => {
    if (phase.name !== "done") return;

    const timer = setTimeout(() => setPhase({ name: "idle" }), DONE_MS);

    return () => clearTimeout(timer);
  }, [phase.name]);

  const latest = info?.latest;
  const appUpdate = latest !== undefined && DESKTOP_VERSION !== undefined && isNewerVersion(latest.version, DESKTOP_VERSION);

  const updateServer = async () => {
    if (latest === undefined) return;

    setPhase({ name: "downloading", target: latest.version });

    try {
      await client.updateServer();
      setPhase({ name: "restarting", target: latest.version, since: Date.now() });
    } catch (error) {
      const message = (error as { message?: unknown }).message;
      setPhase({ name: "failed", message: typeof message === "string" ? message : "The update did not start." });
    }
  };

  return { info, phase, appUpdate, serverUpdate: info?.serverUpdate === true, updateServer, restarting: phase.name === "restarting" };
}

type Updates = ReturnType<typeof useUpdates>;

/** Where the progress line heads, and how long it takes. Without a real percentage it creeps, so it never looks stuck. */
export interface Progress {
  readonly from?: number;
  readonly to: number;
  readonly durationMs: number;
}

/** Draws the thin progress line along the bottom edge of the row. It starts at `from` and moves to `to` on the next frame. */
export function ProgressLine({ from, to, durationMs }: Progress) {
  const [width, setWidth] = useState(from ?? to);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(to));

    return () => cancelAnimationFrame(frame);
  }, [to]);

  return (
    <span
      className="absolute bottom-0 left-2 h-0.5 rounded-full bg-attention transition-[width] ease-out motion-reduce:transition-none"
      style={{ width: `calc((100% - 1rem) * ${width})`, transitionDuration: `${durationMs}ms` }}
    />
  );
}

/** Names the bots that a restart affects, with the character of a single bot. */
function BotsNote({ bots, one, many }: { bots: ReadonlyArray<BotSummary>; one: string; many: string }) {
  const [first] = bots;

  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      {bots.length === 1 && first !== undefined && <Character shape={first.shape} color={first.color} size={16} className="mt-px shrink-0" />}
      {bots.length === 1 ? `${first?.name} ${one}` : `${bots.length} ${many}`}
    </p>
  );
}

/** The server's part of the popover: versions, the bots that a restart interrupts, and the actions. */
function ServerItem({ updates, failed }: { updates: Updates; failed: string | undefined }) {
  const bots = useStore(client.bots);
  const working = bots.filter((bot) => bot.status === "working");
  const waiting = bots.filter((bot) => bot.status === "waiting");
  const { info } = updates;

  if (info?.latest === undefined) return null;

  return (
    <Item className="flex-nowrap items-start px-1 py-1.5">
      <ItemMedia variant="icon" className="mt-0.5 text-muted-foreground">
        <ServerIcon />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1.5">
        <ItemTitle>clots server</ItemTitle>
        <ItemDescription className="tabular-nums">
          {info.current} → {info.latest.version}
        </ItemDescription>
        {working.length > 0 && failed === undefined && (
          <BotsNote
            bots={working}
            one="is working. It stops and picks up again after the restart, about 10 s."
            many="bots are working. They stop and pick up again after the restart, about 10 s."
          />
        )}
        {waiting.length > 0 && failed === undefined && (
          <BotsNote bots={waiting} one="waits for you. The restart cancels its request." many="bots wait for you. The restart cancels their requests." />
        )}
        {failed !== undefined && (
          <pre className="rounded-lg bg-muted/60 px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{failed}</pre>
        )}
        <ItemActions className="mt-1 flex-wrap">
          <Button size="sm" onClick={() => void updates.updateServer()}>
            {failed === undefined ? "Update" : "Try again"}
          </Button>
          <Button variant="ghost" size="sm" render={<a href={info.latest.url} target="_blank" rel="noreferrer" />}>
            What's new
            <ArrowUpRightIcon />
          </Button>
        </ItemActions>
      </ItemContent>
    </Item>
  );
}

/** The app's part of the popover. The app does not update itself yet, so it links to the release. */
function AppItem({ info }: { info: UpdateInfo }) {
  if (info.latest === undefined) return null;

  return (
    <Item className="flex-nowrap items-start px-1 py-1.5">
      <ItemMedia variant="icon" className="mt-0.5 text-muted-foreground">
        <LaptopIcon />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1.5">
        <ItemTitle>Clots app</ItemTitle>
        <ItemDescription className="tabular-nums">
          {DESKTOP_VERSION} → {info.latest.version}
        </ItemDescription>
        <ItemActions className="mt-1 flex-wrap">
          <Button variant="secondary" size="sm" render={<a href={info.latest.url} target="_blank" rel="noreferrer" />}>
            Download
            <ArrowUpRightIcon />
          </Button>
        </ItemActions>
      </ItemContent>
    </Item>
  );
}

type PillView = "available" | "downloading" | "restarting" | "done" | "failed";

/** The look of each pill: its dot, its label, and whether a click opens the popover. */
const PILL: Record<PillView, { dot: string; icon: ReactNode; label: string; opens: boolean }> = {
  available: { dot: "bg-attention text-white", icon: <ArrowUpIcon className="size-3" strokeWidth={2.75} />, label: "Update", opens: true },
  downloading: { dot: "bg-muted", icon: <Spinner className="size-3" />, label: "Downloading…", opens: false },
  restarting: { dot: "bg-muted", icon: <Spinner className="size-3" />, label: "Restarting…", opens: false },
  done: { dot: "bg-emerald-500 text-white dark:bg-emerald-400", icon: <CheckIcon className="size-3" strokeWidth={3} />, label: "Updated", opens: false },
  failed: { dot: "bg-destructive text-white", icon: <XIcon className="size-3" strokeWidth={3} />, label: "Update failed", opens: true },
};

/** Picks the pill for an update phase, or none when nothing is pending. */
const pillViewOf = ({ phase, appUpdate, serverUpdate }: Updates): PillView | undefined => {
  if (phase.name !== "idle") return phase.name;

  return appUpdate || serverUpdate ? "available" : undefined;
};

/**
 * Fills the pill from the left while the server updates. The restart has no real progress, so the
 * fill slows down and stops short of the end. It finishes when the server is back.
 */
function RestartFill({ finishing, gone }: { finishing: boolean; gone: boolean }) {
  return (
    <span
      className="absolute inset-0 rounded-full bg-attention/16 transition-[clip-path,opacity] [clip-path:inset(0_var(--fill-gap)_0_0_round_999px)] starting:[clip-path:inset(0_100%_0_0_round_999px)] motion-reduce:transition-none motion-reduce:[clip-path:inset(0_40%_0_0_round_999px)] dark:bg-attention/24"
      style={{
        "--fill-gap": finishing ? "0%" : "8%",
        opacity: gone ? 0 : 1,
        transitionDuration: finishing ? `${FILL_FINISH_MS}ms` : `${FILL_MS}ms`,
        transitionTimingFunction: finishing ? "var(--ease-out)" : "cubic-bezier(0.16, 1, 0.3, 1)",
      } as React.CSSProperties}
    />
  );
}

/**
 * Shows a pending update as a pill at the end of the sidebar footer. A click opens a popover that
 * confirms a server update, because the restart interrupts running bots. Without an update, the
 * pill is gone.
 */
export function UpdatePill({ updates }: { updates: Updates }) {
  const { info, phase, appUpdate, serverUpdate } = updates;
  const [open, setOpen] = useState(false);
  const [filled, setFilled] = useState(false);
  const failed = phase.name === "failed" ? phase.message : undefined;
  const view = pillViewOf(updates);
  const shown = useRef<{ view: PillView; filled: boolean }>({ view: "available", filled: false });
  const [gone, setGone] = useState(view === undefined);
  const label = useRef<HTMLSpanElement>(null);
  const [labelWidth, setLabelWidth] = useState<number>();

  // A pill that left frees its place, so the text next to the account circle has the whole line.
  if (view !== undefined && gone) setGone(false);

  // A started update closes the popover. The pill shows its progress.
  useEffect(() => {
    if (phase.name === "downloading") setOpen(false);
  }, [phase.name]);

  // The fill finishes first, then the pill says that the update is done.
  useEffect(() => {
    setFilled(false);

    if (phase.name !== "done") return;

    const timer = setTimeout(() => setFilled(true), FILL_FINISH_MS);

    return () => clearTimeout(timer);
  }, [phase.name]);

  // The pill sits at the end of the line, so a snapping width would make its left edge jump. It follows its label instead.
  useLayoutEffect(() => {
    const element = label.current;

    if (element === null) return;

    // A hidden pill measures zero. It keeps its last width, so it does not grow from nothing when it comes back.
    const observer = new ResizeObserver(() => {
      if (element.offsetWidth > 0) setLabelWidth(element.offsetWidth);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  // A closing pill keeps its last look, so it fades out as it was.
  if (view !== undefined) shown.current = { view, filled };

  const look = PILL[shown.current.view === "done" && !shown.current.filled ? "restarting" : shown.current.view];
  const filling = shown.current.view === "downloading" || shown.current.view === "restarting" || shown.current.view === "done";
  let heading = "Update available";

  if (failed !== undefined) heading = "Update failed";
  else if (serverUpdate && appUpdate) heading = "2 updates";

  return (
    <div
      inert={view === undefined}
      onTransitionEnd={(event) => event.target === event.currentTarget && view === undefined && setGone(true)}
      className={cn(
        "ml-auto origin-right transition-[opacity,scale] duration-180 ease-out starting:scale-[0.96] starting:opacity-0 motion-reduce:transition-opacity motion-reduce:starting:scale-100",
        view === undefined && "scale-[0.96] opacity-0 motion-reduce:scale-100",
        gone && "hidden",
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={!look.opens}
              title={shown.current.view === "available" ? `Update clots to ${info?.latest?.version}` : undefined}
              style={{ width: labelWidth === undefined ? undefined : labelWidth + PILL_PADDING_PX }}
              className="relative flex h-8 items-center overflow-hidden rounded-full bg-sidebar-accent/80 pr-3 pl-[5px] text-[13px] font-medium whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-ring/40 [transition:background-color_150ms_var(--ease-out),scale_150ms_var(--ease-out),width_200ms_var(--ease-out)] enabled:hover:bg-sidebar-accent enabled:active:scale-[0.97] data-popup-open:bg-sidebar-accent motion-reduce:[transition:background-color_150ms_var(--ease-out)] motion-reduce:active:scale-100"
            />
          }
        >
          {filling && <RestartFill finishing={shown.current.view === "done"} gone={shown.current.filled} />}
          <span ref={label} className="relative flex shrink-0">
            <span key={look.label} className="flex items-center gap-[7px] transition-opacity duration-150 starting:opacity-0">
              <span className={cn("flex size-[22px] shrink-0 items-center justify-center rounded-full", look.dot)}>{look.icon}</span>
              {look.label}
              {shown.current.view === "available" && <span className="font-normal text-muted-foreground tabular-nums">{info?.latest?.version}</span>}
              {shown.current.view === "failed" && <span className="font-normal text-muted-foreground">Details</span>}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={8} className="w-72 gap-1 rounded-xl p-2 shadow-lg">
          <p className="px-1 pt-0.5 text-xs text-muted-foreground">{heading}</p>
          {(serverUpdate || failed !== undefined) && <ServerItem updates={updates} failed={failed} />}
          {appUpdate && info !== undefined && <AppItem info={info} />}
        </PopoverContent>
      </Popover>
    </div>
  );
}
