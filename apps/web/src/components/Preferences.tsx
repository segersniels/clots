import type { RemoteAccess } from "@clots/contracts";
import { cn } from "cn";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { encode } from "uqr";

import { client, useStore } from "@/client.ts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/hooks/use-copy";
import { Collapse } from "./Collapse.tsx";
import { CreateDialog } from "./CreateDialog.tsx";

/** The Tailscale page where the operator enables HTTPS certificates for the tailnet. */
const HTTPS_SETTINGS_URL = "https://login.tailscale.com/admin/dns";

/** What the operator does next in one state: the text, and the link that the QR code holds. */
interface Step {
  readonly text: string;
  readonly link?: string;
}

/** Tells the operator's next step. A state without a link shows a spinner. */
const stepOf = (access: RemoteAccess | null): Step => {
  if (access?.state === "ready" && access.url !== undefined) {
    return {
      text: "Scan the code or open this address.",
      link: access.url,
    };
  }

  if (access?.state === "needs_login" && access.authUrl !== undefined) {
    return {
      text: "Log in to Tailscale to add clots to your tailnet.",
      link: access.authUrl,
    };
  }

  if (access?.state === "needs_https") {
    return {
      text: "Turn on HTTPS certificates for your tailnet.",
      link: HTTPS_SETTINGS_URL,
    };
  }

  return { text: "Starting Tailscale…" };
};

/** Draws a link as a QR code. The code is black on white in both themes, so a camera reads it. */
function QrCode({ link }: { link: string }) {
  const { data, size } = encode(link, { border: 2 });
  const modules = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code of the link"
      className="size-full rounded-lg bg-white"
    >
      <path d={modules} fill="#000" />
    </svg>
  );
}

/** Shows a link with a button that copies it and a button that opens it. */
function LinkRow({ link }: { link: string }) {
  const { copied, copy } = useCopy();

  return (
    <div className="flex h-9 items-center gap-0.5 rounded-xl bg-muted/60 pr-1 pl-2.5">
      <span className="mr-auto truncate text-[0.8125rem]">{link.replace(/^https:\/\//, "")}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy the link"
        onClick={() => void copy(link)}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open the link"
        nativeButton={false}
        render={<a href={link} target="_blank" rel="noreferrer" />}
      >
        <ExternalLinkIcon />
      </Button>
    </div>
  );
}

/**
 * Shows the part below the switch: a QR code, the next step and the link. Each state fills the same
 * boxes, so a change of state moves nothing.
 */
function RemoteAccessStep({ access }: { access: RemoteAccess | null }) {
  const step = stepOf(access);
  const [shownLink, setShownLink] = useState(step.link);

  // The last link stays in place while it fades out, so the QR code does not vanish at once.
  if (step.link !== undefined && step.link !== shownLink) {
    setShownLink(step.link);
  }

  const fade = "transition-opacity duration-200 ease-out motion-reduce:transition-none";

  return (
    <div className="flex flex-col gap-3 pt-4">
      <div className="relative mx-auto size-44">
        <Spinner
          className={cn(
            "absolute inset-0 m-auto size-5 text-muted-foreground",
            fade,
            step.link !== undefined && "opacity-0",
          )}
        />
        <div className={cn("absolute inset-0", fade, step.link === undefined && "opacity-0")}>
          {shownLink !== undefined && <QrCode link={shownLink} />}
        </div>
      </div>
      <p className="text-center text-[0.8125rem] text-balance text-muted-foreground">{step.text}</p>
      <div
        inert={step.link === undefined}
        className={cn(fade, step.link === undefined && "opacity-0")}
      >
        <LinkRow link={shownLink ?? ""} />
      </div>
    </div>
  );
}

/** Puts the server on the operator's tailnet, so other devices can connect. It shows the Tailscale login when the server needs one, then the address of the server. */
function RemoteAccessSetting({ open }: { open: boolean }) {
  const access = useStore(client.remoteAccess, open);
  const [changeFailed, setChangeFailed] = useState(false);
  const enabled = access !== null && access.state !== "unavailable" && access.state !== "off";

  // A device that came in over the tailnet would cut its own connection, and could not turn it on again.
  const viaTailnet = access?.url !== undefined && window.location.origin === access.url;

  let remoteAccessNote = "Open clots from your other devices.";
  if (access?.state === "unavailable") {
    remoteAccessNote = "This build of clots has no Tailscale sidecar.";
  } else if (viaTailnet) {
    remoteAccessNote = "Turn it off on the machine that runs clots.";
  } else if (changeFailed) {
    remoteAccessNote = "clots did not answer. Try again.";
  }

  const change = (enabled: boolean) => {
    setChangeFailed(false);
    client.setRemoteAccess(enabled).catch(() => setChangeFailed(true));
  };

  return (
    <>
      <label className="flex min-h-9 items-center justify-between gap-3">
        <span className="flex flex-col">
          <span>Expose over Tailscale</span>
          {/* A status line replaces the description, so a row never has more than one line below its label. */}
          <span
            role={changeFailed ? "alert" : undefined}
            className={cn("text-xs text-muted-foreground", changeFailed && "text-destructive")}
          >
            {remoteAccessNote}
          </span>
        </span>
        <Switch
          checked={enabled}
          disabled={access === null || access.state === "unavailable" || viaTailnet}
          onCheckedChange={change}
        />
      </label>
      <Collapse open={enabled}>
        <RemoteAccessStep access={access} />
      </Collapse>
    </>
  );
}

/** Shows the settings of the server on this machine. Only the app that runs the server shows them. */
export function PreferencesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <CreateDialog title="Preferences" open={open} onOpenChange={onOpenChange}>
      <div className="mt-4">
        <RemoteAccessSetting open={open} />
      </div>
    </CreateDialog>
  );
}
