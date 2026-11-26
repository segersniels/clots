import { Character } from "@clots/character";
import type { BotId, LoginSource } from "@clots/contracts";
import { CheckIcon, ChevronDownIcon, CircleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useMountEffect } from "@/hooks/use-mount-effect";

import { client } from "../client.ts";
import { formatAgo } from "../time.ts";

/** Tells the operator what a copied login can do to the other bot. */
export const LOGIN_RISK = "Both bots then share one session. Some sites sign one of them out.";

/** How long the bar says that the copy worked after the page reloads. */
const DONE_MS = 2000;

/** The most characters that the bar stacks for several bots. */
const MAX_STACKED = 3;

/** What the bar shows: the offer of the logins, or the copy of one of them. */
type Phase =
  | { readonly kind: "offer" }
  | { readonly kind: "copying" | "done" | "failed"; readonly from: LoginSource };

/** One look of the bar. A new key crossfades the bar from its last look. */
interface View {
  readonly key: string;
  readonly phase: Phase;
  readonly sources: ReadonlyArray<LoginSource>;
}

/** Names the bots that are logged in: "Scout and Writer", or "Scout, Writer and 2 more" for more than three. */
function namesOf(sources: ReadonlyArray<LoginSource>) {
  const names = sources.map((source) => source.name);

  if (names.length <= 2) {
    return names.join(" and ");
  }

  if (names.length === 3) {
    return `${names[0]}, ${names[1]} and ${names[2]}`;
  }

  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Finds the host of a page, or `undefined` for a page that is not on the web. */
function hostOf(address: string) {
  const url = URL.parse(address);

  return url?.protocol === "https:" || url?.protocol === "http:" ? url.hostname : undefined;
}

/**
 * Offers the logins that other bots of the project have on the site of the page, over the top of
 * the take-over page. A click on a bot is the operator's permission for the copy. The X hides the
 * bar for the site until the take-over closes, which unmounts the bar.
 */
export function LoginBar({
  botId,
  botName,
  address,
}: {
  botId: BotId;
  botName: string;
  address: string;
}) {
  const host = hostOf(address);
  const [phase, setPhase] = useState<Phase>({ kind: "offer" });
  const [hiddenHosts, setHiddenHosts] = useState<ReadonlySet<string>>(new Set());
  // A copy changes the bot's logins, so the bar asks the server again after it.
  const [checks, setChecks] = useState(0);

  // A new bot, site or check drops the logins of the last one until the server answers.
  const lookup = `${botId} ${host} ${checks}`;
  const [found, setFound] = useState<{
    lookup: string;
    sources: ReadonlyArray<LoginSource>;
  }>({ lookup, sources: [] });
  const sources = found.lookup === lookup ? found.sources : [];

  const copy = async (from: LoginSource) => {
    setPhase({ kind: "copying", from });

    try {
      await client.copyLogin(botId, from.botId, address);
    } catch {
      setPhase({ kind: "failed", from });

      return;
    }

    const done: Phase = { kind: "done", from };
    setPhase(done);

    // The bar goes back to the offer, unless the operator hid it first.
    setTimeout(() => {
      setPhase((current) => (current === done ? { kind: "offer" } : current));
      setChecks((count) => count + 1);
    }, DONE_MS);
  };

  const hide = () => {
    if (host !== undefined) {
      setHiddenHosts((hosts) => new Set(hosts).add(host));
    }

    setPhase({ kind: "offer" });
  };

  const offered = sources.length > 0 && host !== undefined && !hiddenHosts.has(host);
  const view: View | null =
    phase.kind === "offer" && !offered
      ? null
      : {
          key:
            phase.kind === "offer"
              ? `offer:${sources.map((source) => source.botId).join()}`
              : phase.kind,
          phase,
          sources,
        };

  // The last look stays over the new one while it fades out.
  const [shown, setShown] = useState<{ current: View | null; previous: View | null }>({
    current: view,
    previous: null,
  });

  if (shown.current?.key !== view?.key) {
    setShown({ current: view, previous: shown.current });
  }

  const render = ({ phase, sources }: View) => {
    if (phase.kind === "copying") {
      return (
        <>
          <Spinner className="motion-reduce:animate-none" />
          <span className="pr-3">Copying {phase.from.name}'s login…</span>
        </>
      );
    }

    if (phase.kind === "done") {
      return (
        <>
          <CheckIcon className="size-4 text-attention" />
          <span className="pr-3">Logged in with {phase.from.name}'s login</span>
        </>
      );
    }

    if (phase.kind === "failed") {
      return (
        <>
          <CircleAlertIcon className="size-4 text-destructive" />
          <span>Could not copy {phase.from.name}'s login</span>
          <Button
            variant="secondary"
            className="h-[30px] rounded-full px-3 text-[13px]"
            onClick={() => void copy(phase.from)}
          >
            Try again
          </Button>
          <HideButton onClick={hide} />
        </>
      );
    }

    const [first] = sources;
    if (sources.length === 1 && first !== undefined) {
      return (
        <>
          <Character shape={first.shape} color={first.color} size={22} />
          <span>
            <span className="font-medium">{first.name}</span> is logged in here{" "}
            <span className="text-muted-foreground">· {formatAgo(first.updatedAt)}</span>
          </span>
          <Button
            className="h-[30px] rounded-full px-3 text-[13px]"
            title={LOGIN_RISK}
            onClick={() => void copy(first)}
          >
            Use login
          </Button>
          <HideButton onClick={hide} />
        </>
      );
    }

    return (
      <>
        <span className="flex">
          {sources.slice(0, MAX_STACKED).map((source) => (
            <span key={source.botId} className="not-first:-ml-[7px]">
              <Character shape={source.shape} color={source.color} size={22} />
            </span>
          ))}
        </span>
        <span>{namesOf(sources)} are logged in here</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button className="h-[30px] gap-1 rounded-full px-3 text-[13px]" />}
          >
            Use a login
            <ChevronDownIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" sideOffset={8} className="w-[272px] rounded-[14px]">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Copy a login to {botName}</DropdownMenuLabel>
              {sources.map((source) => (
                <DropdownMenuItem
                  key={source.botId}
                  className="gap-2.5 rounded-[9px] px-2 py-1.5"
                  onClick={() => void copy(source)}
                >
                  <Character shape={source.shape} color={source.color} size={26} />
                  <span className="flex flex-col">
                    <span className="leading-tight font-medium">{source.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Updated {formatAgo(source.updatedAt)}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-xs leading-snug text-muted-foreground">{LOGIN_RISK}</p>
          </DropdownMenuContent>
        </DropdownMenu>
        <HideButton onClick={hide} />
      </>
    );
  };

  const BAR =
    "col-start-1 row-start-1 flex h-10 items-center gap-2 rounded-full bg-popover pr-1 pl-2 text-[13.5px] whitespace-nowrap text-popover-foreground shadow-lg";
  const MOTION =
    "transition-[opacity,translate,scale] duration-180 ease-out motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:starting:translate-y-0 motion-reduce:starting:scale-100";

  return (
    // The bar floats over the page, so the page and its frame do not move when it shows.
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 grid justify-items-center">
      {host !== undefined && (
        <LoginLookup
          key={lookup}
          botId={botId}
          address={address}
          onFound={(sources) => setFound({ lookup, sources })}
        />
      )}
      {shown.previous !== null && (
        <div
          key={shown.previous.key}
          aria-hidden
          inert
          className={`${BAR} ${MOTION} -translate-y-1.5 scale-[.98] opacity-0 starting:translate-y-0 starting:scale-100 starting:opacity-100`}
        >
          {render(shown.previous)}
        </div>
      )}
      {shown.current !== null && (
        <div
          key={shown.current.key}
          className={`${BAR} ${MOTION} pointer-events-auto starting:-translate-y-1.5 starting:scale-[.98] starting:opacity-0`}
        >
          {render(shown.current)}
        </div>
      )}
    </div>
  );
}

/** Asks the server once for the logins that other bots have on the site of the page. */
function LoginLookup({
  botId,
  address,
  onFound,
}: {
  botId: BotId;
  address: string;
  onFound: (sources: ReadonlyArray<LoginSource>) => void;
}) {
  useMountEffect(() => {
    let current = true;
    client
      .findLogins(botId, address)
      .then((found) => current && onFound(found))
      .catch(() => undefined);

    return () => {
      current = false;
    };
  });

  return null;
}

/** Hides the bar for the site of the page until the take-over closes. */
function HideButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Hide"
      title="Hide"
      className="size-[30px] rounded-full text-muted-foreground"
      onClick={onClick}
    >
      <XIcon className="size-[15px]" />
    </Button>
  );
}
