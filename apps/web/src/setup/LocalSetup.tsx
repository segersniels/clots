import { Character } from "@clots/character";
import type { InstallStep, SetupChecks } from "@clots/contracts";
import { cn } from "cn";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { Children, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { desktop } from "./bridge.ts";
import { Screen, ScreenDescription, ScreenFooter, ScreenTitle } from "./Screen.tsx";

/** How often the checks run while the window has focus, so a fix in the browser shows up without a click. */
const CHECK_INTERVAL_MS = 2000;

/** The app opens the checklist with this flag when its bundled server is newer than the installed one. */
const REINSTALL = new URLSearchParams(location.search).has("reinstall");

/** The pause on the done state before the app opens clots on its own. */
const OPEN_DELAY_MS = 1500;

const INSTALL_STEPS: ReadonlyArray<{ step: InstallStep; label: string; description: string }> = [
  { step: "install", label: "Install service", description: "Installing the background service…" },
  {
    step: "browser",
    label: "Browser for the bots",
    description: "Getting a browser for the bots…",
  },
  { step: "start", label: "Start server", description: "Starting the server…" },
  { step: "health", label: "Health check", description: "Checking that the server answers…" },
];

type RowStatus = "checking" | "ok" | "missing" | "busy" | "error" | "waiting";

type ServerPhase =
  | { readonly name: "waiting" }
  | { readonly name: "installing"; readonly step: InstallStep }
  | { readonly name: "failed"; readonly message: string; readonly log: string }
  | { readonly name: "running" };

/** Shows a row's state in form as well as color, so it also reads without color. */
function StatusGlyph({ status }: { status: RowStatus }) {
  if (status === "checking" || status === "busy") {
    return <Spinner className="size-5 text-muted-foreground" />;
  }

  if (status === "ok") {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
        <CheckIcon className="size-3.5" strokeWidth={3} />
      </span>
    );
  }

  if (status === "missing") {
    return <CircleAlertIcon className="size-5 text-amber-500" />;
  }

  if (status === "error") {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-destructive text-white">
        <XIcon className="size-3.5" strokeWidth={3} />
      </span>
    );
  }

  return <span className="size-5 rounded-full border-2 border-dashed border-muted-foreground/50" />;
}

/** One check: its glyph, title and description, with its fix actions on their own line below. */
function CheckRow({
  status,
  title,
  description,
  children,
}: {
  status: RowStatus;
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  const waiting = status === "waiting";

  return (
    <Item role="listitem" className="items-start gap-4 px-0 py-[9px]">
      <ItemMedia
        key={status}
        className="mt-0.5 animate-in fade-in duration-150 motion-reduce:animate-none"
      >
        <StatusGlyph status={status} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className={cn("text-[0.9375rem]", waiting && "text-muted-foreground")}>
          {title}
        </ItemTitle>
        <ItemDescription className={cn("line-clamp-none", waiting && "text-muted-foreground/70")}>
          {description}
        </ItemDescription>
        {Children.toArray(children).length > 0 && (
          <ItemActions className="mt-2 flex-wrap">{children}</ItemActions>
        )}
      </ItemContent>
    </Item>
  );
}

/** A link that the app opens in the default browser. */
function ExternalButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      render={<a href={href} target="_blank" rel="noreferrer" />}
    >
      {children}
      <ArrowUpRightIcon />
    </Button>
  );
}

/**
 * Checks what a local clots server needs, helps to fix what is missing, then installs and starts
 * the server. When it runs, the app opens clots.
 */
export function LocalSetup({ onBack }: { onBack: () => void }) {
  const [checks, setChecks] = useState<SetupChecks>();
  const [loggingIn, setLoggingIn] = useState(false);
  const [server, setServer] = useState<ServerPhase>({ name: "waiting" });

  const refresh = () => void desktop.checks().then(setChecks);

  useEffect(() => {
    refresh();

    const timer = setInterval(() => {
      if (document.hasFocus()) {
        refresh();
      }
    }, CHECK_INTERVAL_MS);
    window.addEventListener("focus", refresh);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const ready = checks?.claude.status === "ok" && checks.login.status === "ok";

  const install = async () => {
    setServer({ name: "installing", step: "install" });
    const result = await desktop.installServer((step) => setServer({ name: "installing", step }));
    setServer(
      result.ok
        ? { name: "running" }
        : { name: "failed", message: result.message, log: result.log },
    );
  };

  // The server row waits for the rows above it. A server that already runs needs no install, unless the app brings a newer one.
  useEffect(() => {
    if (!ready || server.name !== "waiting") {
      return;
    }

    if (checks.server.status === "ok" && !REINSTALL) {
      setServer({ name: "running" });

      return;
    }

    void install();
  }, [ready, checks?.server.status, server.name]);

  useEffect(() => {
    if (server.name !== "running") {
      return;
    }

    const timer = setTimeout(() => void desktop.openLocal(), OPEN_DELAY_MS);

    return () => clearTimeout(timer);
  }, [server.name]);

  const logIn = async () => {
    setLoggingIn(true);
    await desktop.loginClaude();
    setLoggingIn(false);
    refresh();
  };

  const rowStatus = (check: keyof Omit<SetupChecks, "server">): RowStatus => {
    if (checks === undefined) {
      return "checking";
    }

    return checks[check].status;
  };

  const detail = (check: keyof SetupChecks) => {
    const result = checks?.[check];

    return result?.status === "ok" ? result.detail : undefined;
  };

  const serverStatus: Record<ServerPhase["name"], RowStatus> = {
    waiting: "waiting",
    installing: "busy",
    failed: "error",
    running: "ok",
  };
  const readyCount = [rowStatus("claude"), rowStatus("login"), serverStatus[server.name]].filter(
    (status) => status === "ok",
  ).length;
  const stepIndex =
    server.name === "installing" ? INSTALL_STEPS.findIndex(({ step }) => step === server.step) : -1;

  return (
    <Screen onBack={onBack}>
      <ScreenTitle>Set up clots on this Mac</ScreenTitle>
      <ScreenDescription>
        Each check runs on its own. Fix what is missing, and it checks again.
      </ScreenDescription>

      <ItemGroup className="mt-5 gap-0">
        <CheckRow
          status={rowStatus("claude")}
          title="Claude Code"
          description={detail("claude") ?? "Install Claude Code, the app that runs each bot."}
        >
          {rowStatus("claude") === "missing" && (
            <>
              <ExternalButton href="https://code.claude.com/docs/en/setup">
                Install Claude Code
              </ExternalButton>
              <Button variant="ghost" size="sm" onClick={refresh}>
                <RotateCwIcon />
                Check again
              </Button>
            </>
          )}
        </CheckRow>

        <CheckRow
          status={loggingIn ? "busy" : rowStatus("login")}
          title="Claude login"
          description={
            loggingIn
              ? "Waiting for the login in your browser…"
              : (detail("login") ??
                "Log in with a Claude subscription. clots does not use API keys.")
          }
        >
          {loggingIn && (
            <Button variant="ghost" size="sm" onClick={() => void desktop.cancelLogin()}>
              Cancel
            </Button>
          )}
          {!loggingIn && rowStatus("login") === "missing" && rowStatus("claude") === "ok" && (
            <Button size="sm" onClick={() => void logIn()}>
              Log in to Claude
            </Button>
          )}
        </CheckRow>

        <CheckRow
          status={serverStatus[server.name]}
          title="clots server"
          description={
            {
              waiting: "Starts when the checks above pass.",
              installing: INSTALL_STEPS[stepIndex]?.description,
              failed: server.name === "failed" ? server.message : undefined,
              running: (
                <>
                  Running in the background at{" "}
                  <code className="font-mono text-[0.8125rem]">127.0.0.1:4587</code>
                </>
              ),
            }[server.name]
          }
        >
          {server.name === "installing" && (
            <div className="flex w-full flex-col gap-2.5 pt-1">
              <Progress
                value={((stepIndex + 1) / INSTALL_STEPS.length) * 100}
                className="[&_[data-slot=progress-track]]:h-1"
              />
              <ol className="flex gap-4 text-xs text-muted-foreground">
                {INSTALL_STEPS.map(({ step, label }, index) => (
                  <li
                    key={step}
                    className={cn(
                      "flex items-center gap-1.5",
                      index === stepIndex && "text-foreground",
                    )}
                  >
                    {index < stepIndex && <StatusGlyph status="ok" />}
                    {label}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {server.name === "failed" && (
            <>
              <Button variant="secondary" size="sm" onClick={() => void install()}>
                <RotateCwIcon />
                Try again
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigator.clipboard.writeText(`${server.message}\n\n${server.log}`)
                }
              >
                <CopyIcon />
                Copy details
              </Button>
              <pre className="mt-1 w-full overflow-x-auto rounded-xl bg-muted/60 px-3.5 py-3 font-mono text-xs whitespace-pre-wrap select-text">
                {server.log}
              </pre>
            </>
          )}
        </CheckRow>
      </ItemGroup>

      {server.name === "running" && (
        <div className="mt-4 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out motion-reduce:animate-none">
          <Character shape="tumble" color="green" mood="waiting" size={40} />
          <div>
            <p className="text-[0.9375rem] font-medium">clots runs on this Mac</p>
            <p className="text-sm text-muted-foreground">
              Your bots keep working when you close this window.
            </p>
          </div>
        </div>
      )}

      <ScreenFooter>
        <p className="text-sm text-muted-foreground">
          {server.name === "running" ? "Opening clots…" : `${readyCount} of 4 ready`}
        </p>
        <Button disabled={server.name !== "running"} onClick={() => void desktop.openLocal()}>
          Open clots
        </Button>
      </ScreenFooter>
    </Screen>
  );
}
