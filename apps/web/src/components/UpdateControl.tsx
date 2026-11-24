import { Character } from "@clots/character";
import { isNewerVersion, type BotSummary, type UpdateInfo } from "@clots/contracts";
import { cn } from "cn";
import { ArrowUpIcon, ArrowUpRightIcon, CheckIcon, LaptopIcon, ServerIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { client, useStore } from "@/client.ts";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Collapse } from "./Collapse.tsx";

/** How often a client asks the server again for the latest release. The server asks GitHub at most hourly. */
const CHECK_INTERVAL_MS = 60 * 60_000;

/** How long the done row stays before the slot closes. */
const DONE_MS = 4000;

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
 * restart and reconnect. The connection footer stays hidden while this client restarts the server.
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

/** The round glyph at the start of the row. */
function Dot({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", className)}>{children}</span>;
}

/** Where the progress line heads, and how long it takes. Without a real percentage it creeps, so it never looks stuck. */
interface Progress {
  readonly from?: number;
  readonly to: number;
  readonly durationMs: number;
}

/** Draws the thin progress line along the bottom edge of the row. It starts at `from` and moves to `to` on the next frame. */
function ProgressLine({ from, to, durationMs }: Progress) {
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

/** The one row of the footer slot. */
function UpdateRow({
  dot,
  label,
  detail,
  meta,
  progress,
  className,
  ...props
}: React.ComponentProps<"button"> & { dot: ReactNode; label: string; detail?: string; meta?: ReactNode; progress?: Progress }) {
  return (
    <button
      type="button"
      className={cn(
        "relative flex min-h-11 w-full items-center gap-2.5 overflow-hidden rounded-xl bg-sidebar-accent/70 px-2 py-1.5 text-left text-sm transition-[background-color,scale] duration-150 ease-out enabled:hover:bg-sidebar-accent enabled:active:scale-[0.985] data-popup-open:bg-sidebar-accent motion-reduce:active:scale-100",
        className,
      )}
      {...props}
    >
      {dot}
      <span key={label} className="min-w-0 flex-1 transition-opacity duration-150 starting:opacity-0">
        <span className="block truncate font-medium">{label}</span>
        {detail !== undefined && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      {meta !== undefined && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>}
      {progress !== undefined && <ProgressLine {...progress} />}
    </button>
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

/**
 * Shows pending updates in the sidebar footer: one row, and a popover that confirms a server
 * update, because the restart interrupts running bots. The slot stays empty when all is current.
 */
export function UpdateFooter({ updates }: { updates: Updates }) {
  const { info, phase, appUpdate, serverUpdate } = updates;
  const [open, setOpen] = useState(false);
  const latest = info?.latest?.version ?? "";
  const failed = phase.name === "failed" ? phase.message : undefined;
  const visible = phase.name !== "idle" || serverUpdate || appUpdate;
  const shownRow = useRef<ReactNode>(null);

  // A started update closes the popover. The row shows its progress.
  useEffect(() => {
    if (phase.name === "downloading") setOpen(false);
  }, [phase.name]);

  const row = () => {
    if (phase.name === "downloading") {
      return <UpdateRow disabled dot={<Dot className="bg-muted"><Spinner className="size-3.5" /></Dot>} label={`Downloading ${phase.target}…`} progress={{ from: 0.1, to: 0.8, durationMs: 8000 }} />;
    }

    if (phase.name === "restarting") {
      return (
        <UpdateRow
          disabled
          dot={<Dot className="bg-muted"><Spinner className="size-3.5" /></Dot>}
          label="Restarting…"
          detail="Bots reconnect in a moment"
          progress={{ to: 0.95, durationMs: 6000 }}
        />
      );
    }

    if (phase.name === "done") {
      return (
        <UpdateRow
          disabled
          dot={<Dot className="bg-emerald-500 text-white dark:bg-emerald-400"><CheckIcon className="size-3.5" strokeWidth={3} /></Dot>}
          label={`Updated to ${phase.target}`}
          progress={{ to: 1, durationMs: 700 }}
        />
      );
    }

    // The app alone needs no confirmation: the click opens the release page.
    if (appUpdate && !serverUpdate && phase.name === "idle") {
      return (
        <UpdateRow
          dot={<Dot className="bg-attention text-white"><ArrowUpIcon className="size-3.5" strokeWidth={2.5} /></Dot>}
          label={`Clots app ${latest}`}
          meta={<span className="inline-flex items-center gap-0.5">Download<ArrowUpRightIcon className="size-3" /></span>}
          onClick={() => window.open(info?.latest?.url, "_blank")}
        />
      );
    }

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            failed === undefined ? (
              <UpdateRow
                title={`Update clots to ${latest}`}
                dot={<Dot className="bg-attention text-white"><ArrowUpIcon className="size-3.5" strokeWidth={2.5} /></Dot>}
                label={serverUpdate && appUpdate ? "2 updates" : "Update available"}
                meta={latest}
              />
            ) : (
              <UpdateRow dot={<Dot className="bg-destructive text-white"><XIcon className="size-3.5" strokeWidth={3} /></Dot>} label="Update failed" meta="Details" />
            )
          }
        />
        <PopoverContent side="top" align="start" sideOffset={8} className="w-72 gap-1 rounded-xl p-2 shadow-lg">
          <p className="px-1 pt-0.5 text-xs text-muted-foreground">{failed === undefined ? (serverUpdate && appUpdate ? "2 updates" : "Update available") : "Update failed"}</p>
          {(serverUpdate || failed !== undefined) && <ServerItem updates={updates} failed={failed} />}
          {appUpdate && info !== undefined && <AppItem info={info} />}
        </PopoverContent>
      </Popover>
    );
  };

  // A closing slot keeps its last row, so the row fades out with the slot instead of changing first.
  if (visible) shownRow.current = row();

  // The outer padding holds the negative margin of the Collapse inside the sidebar, which would scroll sideways otherwise.
  return (
    <div className="px-1">
      <Collapse open={visible}>
        <div className="px-1 pb-2">{shownRow.current}</div>
      </Collapse>
    </div>
  );
}
