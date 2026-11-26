import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { Character } from "@clots/character";
import {
  isNewerVersion,
  type AppUpdateState,
  type BotSummary,
  type UpdateInfo,
} from "@clots/contracts";
import { cn } from "cn";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  CheckIcon,
  LaptopIcon,
  RotateCwIcon,
  ServerIcon,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { client, useStore } from "@/client.ts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

/** How often a client asks the server again for the latest release. The desktop app checks itself as often. */
const CHECK_INTERVAL_MS = 15 * 60_000;

/** How long a finished server row stays before it goes. */
const DONE_MS = 4000;

/** How long the pill says "Up to date" after the operator asked and nothing was new. */
const UP_TO_DATE_MS = 2000;

/** How long the server's bar takes to slow down near its end. */
const FILL_MS = 14_000;

/** Where the server's bar stops while the client waits for the server to come back. */
const CREEP_END_PERCENT = 92;

/** How long the app's bar takes to follow a new download percentage. */
const PERCENT_FILL_MS = 300;

/** How long the server's bar takes to fill up once the server is back. */
const FILL_FINISH_MS = 200;

/** The pill's left and right padding together, which its width adds to the width of its label. */
const PILL_PADDING_PX = 17;

/** How long the client waits for the server to come back before it reports a failed update. */
const RESTART_TIMEOUT_MS = 90_000;

/** The Clots app's version, which the app adds to the user agent. A browser has none. */
const DESKTOP_VERSION = /clots-desktop\/\w+\/([\d.]+)/.exec(navigator.userAgent)?.[1];

/** Checks whether the latest release is newer than this Clots app. A browser has no app to update. */
const hasAppUpdate = (info: UpdateInfo | undefined) =>
  info?.latest !== undefined &&
  DESKTOP_VERSION !== undefined &&
  isNewerVersion(info.latest.version, DESKTOP_VERSION);

/**
 * Follows the Clots app's own update. A browser, and an app from before the updater, report `off`:
 * the popover then links to the release.
 */
function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>({ status: "off" });

  useEffect(() => {
    const bridge = window.clotsApp;

    if (bridge?.updateState === undefined || bridge.onUpdateState === undefined) {
      return;
    }

    const stop = bridge.onUpdateState(setState);
    void bridge.updateState().then(setState);

    return stop;
  }, []);

  return state;
}

type UpdatePhase =
  | { readonly name: "idle" }
  | { readonly name: "checking" }
  | { readonly name: "current" }
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
  const app = useAppUpdate();

  // A new connection can mean a new server version, so the client asks again on each one.
  useEffect(() => {
    if (connection !== "connected") {
      return;
    }

    const check = () => void client.getUpdateInfo().then(setInfo, () => undefined);
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [connection]);

  // The restart ends when the client is connected to the new version again.
  useEffect(() => {
    if (phase.name !== "restarting") {
      return;
    }

    if (connection === "connected" && info?.current === phase.target) {
      setPhase({ name: "done", target: phase.target });

      return;
    }

    const timer = setTimeout(
      () =>
        setPhase({
          name: "failed",
          message: "The server did not come back after the restart. Check it on its machine.",
        }),
      phase.since + RESTART_TIMEOUT_MS - Date.now(),
    );

    return () => clearTimeout(timer);
  }, [phase, connection, info?.current]);

  useEffect(() => {
    if (phase.name !== "done" && phase.name !== "current") {
      return;
    }

    const timer = setTimeout(
      () => setPhase({ name: "idle" }),
      phase.name === "done" ? DONE_MS : UP_TO_DATE_MS,
    );

    return () => clearTimeout(timer);
  }, [phase.name]);

  const latest = info?.latest;

  /** Checks whether the app has something to show. An app that updates itself knows better than the server. */
  const appHasUpdate = (found: UpdateInfo | undefined, appState = app) =>
    appState.status === "off" ? hasAppUpdate(found) : appState.status !== "current";
  const appUpdate = appHasUpdate(info);

  /**
   * Asks for the latest server and app releases because the operator asked, so the pill shows the
   * check. Without anything new, it says so for a moment. An update in progress keeps its own pill.
   */
  const checkNow = async () => {
    if (phase.name !== "idle") {
      return;
    }

    setPhase({ name: "checking" });
    const [found, appState] = await Promise.all([
      client.getUpdateInfo().catch(() => undefined),
      window.clotsApp?.checkForUpdates?.().catch(() => undefined),
    ]);

    if (found !== undefined) {
      setInfo(found);
    }

    setPhase(
      found !== undefined && (found.serverUpdate || appHasUpdate(found, appState ?? app))
        ? { name: "idle" }
        : { name: "current" },
    );
  };

  // Check for Updates in the app menu runs the same check as the search command.
  const onMenuCheck = useEffectEvent(() => void checkNow());

  useEffect(() => window.clotsApp?.onCheckForUpdates?.(onMenuCheck), []);

  const updateServer = async () => {
    if (latest === undefined) {
      return;
    }

    setPhase({ name: "downloading", target: latest.version });

    try {
      await client.updateServer();
      setPhase({ name: "restarting", target: latest.version, since: Date.now() });
    } catch (error) {
      const message = (error as { message?: unknown }).message;
      setPhase({
        name: "failed",
        message: typeof message === "string" ? message : "The update did not start.",
      });
    }
  };

  return {
    info,
    phase,
    app,
    appUpdate,
    serverUpdate: info?.serverUpdate === true,
    updateServer,
    checkNow,
    restarting: phase.name === "restarting",
  };
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
function BotsNote({
  bots,
  one,
  many,
}: {
  bots: ReadonlyArray<BotSummary>;
  one: string;
  many: string;
}) {
  const [first] = bots;

  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      {bots.length === 1 && first !== undefined && (
        <Character shape={first.shape} color={first.color} size={16} className="mt-px shrink-0" />
      )}
      {bots.length === 1 ? `${first?.name} ${one}` : `${bots.length} ${many}`}
    </p>
  );
}

/**
 * Draws the progress bar under a row. Without a real `percent`, the bar slows down and stops short
 * of the end, and it finishes when `finished` turns true.
 */
function UpdateProgress({ percent, finished = false }: { percent?: number; finished?: boolean }) {
  const [creep, setCreep] = useState(0);

  // The creep starts on the next frame, so the bar grows from the start.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setCreep(CREEP_END_PERCENT));

    return () => cancelAnimationFrame(frame);
  }, []);

  let value = finished ? 100 : creep;
  let duration = finished ? FILL_FINISH_MS : FILL_MS;
  let easing = finished ? "var(--ease-out)" : "cubic-bezier(0.16, 1, 0.3, 1)";

  if (percent !== undefined) {
    value = percent;
    duration = PERCENT_FILL_MS;
    easing = "var(--ease-out)";
  }

  return (
    <ProgressPrimitive.Root value={value} aria-label="Update progress">
      <ProgressTrack className="bg-foreground/10">
        <ProgressIndicator
          className={cn(
            "rounded-full bg-attention transition-[width] motion-reduce:transition-none",
            percent === undefined && !finished && "motion-reduce:w-3/5!",
          )}
          style={{ transitionDuration: `${duration}ms`, transitionTimingFunction: easing }}
        />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}

/** Gives a row button the same hover step in dark as in light, so its fill shows on the muted row. */
const ROW_BUTTON = "dark:hover:bg-muted";

/** Shows the step of a running update in the place of the row's button. */
function RowStatus({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex h-7 items-center gap-1.5 px-2.5 text-[0.8rem] text-muted-foreground tabular-nums [&_svg]:size-3.5">
      {icon}
      {children}
    </span>
  );
}

/** Lays out one update in the popover: its icon, name and version, its action, and a line under the text. */
function UpdateRow({
  icon,
  name,
  version,
  action,
  under,
}: {
  icon: ReactNode;
  name: string;
  version: string;
  action: ReactNode;
  under?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-lg bg-muted/60 py-2 pr-2 pl-2.5">
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      <p className="truncate text-sm font-medium">
        {name}
        <span className="ml-1.5 text-[0.8125rem] font-normal text-muted-foreground tabular-nums">
          {version}
        </span>
      </p>
      {action}
      {under && <div className="col-span-2 col-start-2 mt-1.5 flex flex-col gap-1.5">{under}</div>}
    </div>
  );
}

/** The server's row: the bots that a restart interrupts, the action, and the progress of the update. */
function ServerRow({ updates }: { updates: Updates }) {
  const bots = useStore(client.bots);
  const { info, phase } = updates;

  if (info?.latest === undefined) {
    return null;
  }

  const working = bots.filter((bot) => bot.status === "working");
  const waiting = bots.filter((bot) => bot.status === "waiting");
  let action: ReactNode;
  let under: ReactNode;

  // The bar keeps its place in each running step, so it creeps on from download to restart and fills up at the end.
  if (phase.name === "failed") {
    action = (
      <Button
        variant="ghost"
        size="sm"
        className={ROW_BUTTON}
        onClick={() => void updates.updateServer()}
      >
        Try again
        <RotateCwIcon />
      </Button>
    );
    under = <p className="text-xs text-muted-foreground">{phase.message}</p>;
  } else if (phase.name === "done") {
    action = <RowStatus icon={<CheckIcon />}>Updated</RowStatus>;
    under = <UpdateProgress finished />;
  } else if (phase.name === "downloading" || phase.name === "restarting") {
    action = (
      <RowStatus icon={<Spinner />}>
        {phase.name === "downloading" ? "Downloading" : "Restarting"}
      </RowStatus>
    );
    under = <UpdateProgress />;
  } else {
    action = (
      <Button
        variant="ghost"
        size="sm"
        className={ROW_BUTTON}
        onClick={() => void updates.updateServer()}
      >
        Update
        <ArrowUpIcon />
      </Button>
    );
    under = (working.length > 0 || waiting.length > 0) && (
      <>
        {working.length > 0 && (
          <BotsNote
            bots={working}
            one="is working. It stops and picks up again after the restart, about 10 s."
            many="bots are working. They stop and pick up again after the restart, about 10 s."
          />
        )}
        {waiting.length > 0 && (
          <BotsNote
            bots={waiting}
            one="waits for you. The restart cancels its request."
            many="bots wait for you. The restart cancels their requests."
          />
        )}
      </>
    );
  }

  return (
    <UpdateRow
      icon={<ServerIcon />}
      name="Server"
      version={info.latest.version}
      action={action}
      under={under}
    />
  );
}

/**
 * Turns an updater error into a sentence the operator can act on. An unknown error keeps its raw
 * message as `detail`.
 */
const describeAppFailure = (message: string): { text: string; detail?: string } => {
  if (
    /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ENOTFOUND|ENETUNREACH/.test(
      message,
    )
  ) {
    return { text: "No internet connection. Check it and try again." };
  }

  if (/checksum|sha512|signature|code requirement/i.test(message)) {
    return { text: "The download was damaged. Try again." };
  }

  return { text: "The download did not finish.", detail: message };
};

/** Says why the app's download failed. */
function AppFailure({ message }: { message: string }) {
  const { text, detail } = describeAppFailure(message);

  return (
    <>
      <p className="text-xs text-muted-foreground">{text}</p>
      {detail !== undefined && (
        <pre className="font-mono text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground">
          {detail}
        </pre>
      )}
    </>
  );
}

/** The app's row. An app that cannot update itself links to the release. */
function AppRow({ info, app }: { info: UpdateInfo | undefined; app: AppUpdateState }) {
  const bridge = window.clotsApp;
  let version = info?.latest?.version;
  let action: ReactNode;
  let under: ReactNode;

  if (app.status === "current") {
    return null;
  }

  if (app.status !== "off") {
    version = app.version;
  }

  if (version === undefined) {
    return null;
  }

  if (app.status === "downloading") {
    action = <RowStatus icon={<Spinner />}>{Math.round(app.percent)}%</RowStatus>;
    under = <UpdateProgress percent={app.percent} />;
  } else if (app.status === "ready") {
    action = (
      <Button
        variant="ghost"
        size="sm"
        className={ROW_BUTTON}
        onClick={() => void bridge?.installUpdate?.()}
      >
        Restart
        <RotateCwIcon />
      </Button>
    );
  } else if (app.status === "failed") {
    action = (
      <Button
        variant="ghost"
        size="sm"
        className={ROW_BUTTON}
        onClick={() => void bridge?.downloadUpdate?.()}
      >
        Try again
        <RotateCwIcon />
      </Button>
    );
    under = <AppFailure message={app.message} />;
  } else if (app.status === "available") {
    action = (
      <Button
        variant="ghost"
        size="sm"
        className={ROW_BUTTON}
        onClick={() => void bridge?.downloadUpdate?.()}
      >
        Update
        <ArrowUpIcon />
      </Button>
    );
  } else {
    action = (
      <Button
        variant="ghost"
        size="sm"
        className={ROW_BUTTON}
        render={<a href={info?.latest?.url} target="_blank" rel="noreferrer" />}
      >
        Download
        <ArrowUpRightIcon />
      </Button>
    );
  }

  return (
    <UpdateRow icon={<LaptopIcon />} name="App" version={version} action={action} under={under} />
  );
}

type PillView = "available" | "running" | "checking" | "current";

/** The look of each pill: its dot, its label, and whether a click opens the popover. */
const PILL: Record<PillView, { dot: string; icon: ReactNode; label: string; opens: boolean }> = {
  available: {
    dot: "bg-attention text-white",
    icon: <ArrowUpIcon className="size-3" strokeWidth={2.75} />,
    label: "Update",
    opens: true,
  },
  running: {
    dot: "bg-muted",
    icon: <Spinner className="size-3" />,
    label: "Update",
    opens: true,
  },
  checking: {
    dot: "bg-muted",
    icon: <Spinner className="size-3" />,
    label: "Checking…",
    opens: false,
  },
  current: {
    dot: "bg-emerald-500 text-white dark:bg-emerald-400",
    icon: <CheckIcon className="size-3" strokeWidth={3} />,
    label: "Up to date",
    opens: false,
  },
};

/** Picks the pill for the updates, or none when no update is left. The popover rows show the details. */
const pillViewOf = ({ phase, app, appUpdate, serverUpdate }: Updates): PillView | undefined => {
  if (phase.name === "checking" || phase.name === "current") {
    return phase.name;
  }

  // A finished server update keeps the spinner until its row leaves, so the pill does not flash the arrow before it goes.
  if (
    phase.name === "downloading" ||
    phase.name === "restarting" ||
    phase.name === "done" ||
    app.status === "downloading"
  ) {
    return "running";
  }

  // A failed server update keeps the pill until its row leaves the popover.
  return phase.name === "failed" || appUpdate || serverUpdate ? "available" : undefined;
};

/**
 * Shows a pending update as a pill at the end of the sidebar footer. A click opens a popover with
 * a row for each update, because a server restart interrupts running bots. Without an update, the
 * pill is gone.
 */
export function UpdatePill({ updates }: { updates: Updates }) {
  const { info, phase, app, appUpdate, serverUpdate } = updates;
  const [open, setOpen] = useState(false);
  const view = pillViewOf(updates);
  const shown = useRef<PillView>("available");
  const [gone, setGone] = useState(view === undefined);
  const label = useRef<HTMLSpanElement>(null);
  const [labelWidth, setLabelWidth] = useState<number>();

  // A pill that left frees its place, so the text next to the account circle has the whole line.
  if (view !== undefined && gone) {
    setGone(false);
  }

  // The popover leaves with the last update. A manual check has nothing to show in it.
  if (open && (view === undefined || !PILL[view].opens)) {
    setOpen(false);
  }

  // The pill sits at the end of the line, so a snapping width would make its left edge jump. It follows its label instead.
  useLayoutEffect(() => {
    const element = label.current;

    if (element === null) {
      return;
    }

    // A hidden pill measures zero. It keeps its last width, so it does not grow from nothing when it comes back.
    const observer = new ResizeObserver(() => {
      if (element.offsetWidth > 0) {
        setLabelWidth(element.offsetWidth);
      }
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  // A closing pill keeps its last look, so it fades out as it was.
  if (view !== undefined) {
    shown.current = view;
  }

  const look = PILL[shown.current];
  const serverShown =
    serverUpdate || ["downloading", "restarting", "done", "failed"].includes(phase.name);
  let heading = "Update available";

  // The heading follows the rows on screen, so a finished server row still counts until it leaves.
  if (phase.name === "failed" || app.status === "failed") {
    heading = "Update failed";
  } else if (serverShown && appUpdate) {
    heading = "2 updates";
  } else if (app.status === "ready") {
    heading = "Ready to restart";
  }

  return (
    <div
      inert={view === undefined}
      onTransitionEnd={(event) =>
        event.target === event.currentTarget && view === undefined && setGone(true)
      }
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
              title={
                shown.current === "available"
                  ? `Update clots to ${info?.latest?.version}`
                  : undefined
              }
              style={{ width: labelWidth === undefined ? undefined : labelWidth + PILL_PADDING_PX }}
              className="relative flex h-8 items-center overflow-hidden rounded-full bg-sidebar-accent/80 pr-3 pl-[5px] text-[13px] font-medium whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-ring/40 [transition:background-color_150ms_var(--ease-out),scale_150ms_var(--ease-out),width_200ms_var(--ease-out)] enabled:hover:bg-sidebar-accent enabled:active:scale-[0.97] data-popup-open:bg-sidebar-accent motion-reduce:[transition:background-color_150ms_var(--ease-out)] motion-reduce:active:scale-100"
            />
          }
        >
          <span ref={label} className="relative flex shrink-0">
            <span
              key={look.label}
              className="flex items-center gap-[7px] transition-opacity duration-150 starting:opacity-0"
            >
              <span
                className={cn(
                  "flex size-[22px] shrink-0 items-center justify-center rounded-full",
                  look.dot,
                )}
              >
                {look.icon}
              </span>
              {look.label}
            </span>
          </span>
        </PopoverTrigger>
        {/* Only a keyboard open moves focus to the first button, so a click shows no focus ring. */}
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          initialFocus={(openType) => openType === "keyboard"}
          className="rounded-xl shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 px-1 text-[0.8125rem]">
            <p className="text-muted-foreground">{heading}</p>
            {info?.latest !== undefined && (
              <a
                href={info.latest.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring/40"
              >
                What's new
                <ArrowUpRightIcon className="size-3" />
              </a>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {serverShown && <ServerRow updates={updates} />}
            {appUpdate && <AppRow info={info} app={app} />}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
