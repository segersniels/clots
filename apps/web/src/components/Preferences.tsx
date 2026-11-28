import type { RemoteAccess } from "@clots/contracts";
import { cn } from "cn";
import { CheckIcon, CopyIcon, ExternalLinkIcon, QrCodeIcon } from "lucide-react";
import { useId, useState } from "react";
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

/** A button that sends the operator to a Tailscale page in the browser. */
interface StepAction {
  readonly label: string;
  readonly link: string;
}

/** What the operator does next in one state: the text, a button to a Tailscale page, or the address of the server. */
interface Step {
  readonly text: string;
  readonly action?: StepAction;
  readonly address?: string;
}

/** Tells the operator's next step. A state without an action or an address shows a spinner. */
const stepOf = (access: RemoteAccess | null): Step => {
  if (access?.state === "ready" && access.url !== undefined) {
    return { text: "clots is on your tailnet at this address.", address: access.url };
  }

  if (access?.state === "needs_login" && access.authUrl !== undefined) {
    return {
      text: "Sign in to Tailscale to add clots to your tailnet.",
      action: { label: "Sign in", link: access.authUrl },
    };
  }

  if (access?.state === "needs_https") {
    return {
      text: "Turn on HTTPS certificates for your tailnet.",
      action: { label: "Turn on HTTPS", link: HTTPS_SETTINGS_URL },
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

/** Shows a link with buttons that show its QR code, copy it and open it. */
function LinkRow({
  link,
  qrOpen,
  qrId,
  onToggleQr,
}: {
  link: string;
  qrOpen: boolean;
  /** The id of the area that holds the QR code. */
  qrId: string;
  onToggleQr: () => void;
}) {
  const { copied, copy } = useCopy();

  return (
    <div className="flex h-9 items-center gap-0.5 rounded-xl bg-muted/60 pr-1 pl-2.5">
      <span className="mr-auto truncate text-[0.8125rem]">{link.replace(/^https:\/\//, "")}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="QR code"
        aria-expanded={qrOpen}
        aria-controls={qrId}
        onClick={onToggleQr}
      >
        <QrCodeIcon />
      </Button>
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
 * Shows the part below the switch: the next step, a button to Tailscale until clots is on the
 * tailnet, and then the address. The QR code of the address shows only on request, and the sign-in
 * is a button, so the only code to scan is the one that opens clots.
 */
function RemoteAccessStep({ access }: { access: RemoteAccess | null }) {
  const step = stepOf(access);
  const qrId = useId();
  const [qrOpen, setQrOpen] = useState(false);
  const [shownAddress, setShownAddress] = useState(step.address);

  // The last address stays in place while it collapses, so it does not vanish at once.
  if (step.address !== undefined && step.address !== shownAddress) {
    setShownAddress(step.address);
  }

  // The QR code closes when clots leaves the tailnet, so it does not open by itself when clots is back.
  if (step.address === undefined && qrOpen) {
    setQrOpen(false);
  }

  const starting = step.action === undefined && step.address === undefined;

  return (
    <div className="flex flex-col pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
          {starting && <Spinner className="size-3.5" />}
          {step.text}
        </p>
        {step.action !== undefined && (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            nativeButton={false}
            render={<a href={step.action.link} target="_blank" rel="noreferrer" />}
          >
            {step.action.label}
          </Button>
        )}
      </div>
      <Collapse open={step.address !== undefined}>
        <div className="pt-3">
          <LinkRow
            link={shownAddress ?? ""}
            qrOpen={qrOpen}
            qrId={qrId}
            onToggleQr={() => setQrOpen(!qrOpen)}
          />
        </div>
      </Collapse>
      <Collapse open={step.address !== undefined && qrOpen}>
        <div id={qrId} className="pt-3">
          <div className="mx-auto size-44">
            {shownAddress !== undefined && <QrCode link={shownAddress} />}
          </div>
        </div>
      </Collapse>
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
      <div className="flex min-h-9 items-center justify-between gap-3">
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
          aria-label="Expose over Tailscale"
          checked={enabled}
          disabled={access === null || access.state === "unavailable" || viaTailnet}
          onCheckedChange={change}
        />
      </div>
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
