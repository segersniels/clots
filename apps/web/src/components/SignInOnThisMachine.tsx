import type { BotId, BrowserCookie } from "@clots/contracts";
import { LogInIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { client } from "../client.ts";
import { Collapse } from "./Collapse.tsx";

declare global {
  interface Window {
    /** The bridge into the clots desktop app. A plain browser does not have it. */
    clotsDesktop?: { signIn?: (url: string) => Promise<ReadonlyArray<BrowserCookie>> };
  }
}

type Step = "idle" | "waiting" | "saving" | "done" | "failed";

/** Names a site by its host, for example `x.com` for `https://www.x.com/i/flow/login`. */
const siteOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** Matches hosts that only this network reaches, such as a dev server. A sign-in on this machine makes no sense there. */
const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]$)|\.local$/;

/** Reads the page of the bot's browser as a public site to sign in to. Pages such as `about:blank` have none. */
const signInUrl = (pageUrl: string | null) => {
  if (pageUrl === null || !/^https?:\/\//.test(pageUrl)) return null;

  return LOCAL_HOST.test(new URL(pageUrl).hostname) ? null : pageUrl;
};

/**
 * Lets the operator sign in to a site in a window on this machine, where the site sees a normal
 * browser, and passes the login to the bot's browser. It starts on the page that the bot shows.
 * Only the desktop app can open that window.
 */
export function SignInOnThisMachine({ botId, botName, pageUrl }: { botId: BotId; botName: string; pageUrl: string | null }) {
  const signIn = window.clotsDesktop?.signIn;
  const [asking, setAsking] = useState(false);
  const [typedSite, setTypedSite] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [site, setSite] = useState("");

  if (signIn === undefined) return null;

  const startUrl = signInUrl(pageUrl);
  const busy = step === "waiting" || step === "saving";

  const start = async (url: string) => {
    setAsking(false);
    setSite(siteOf(url));
    setStep("waiting");

    try {
      const cookies = await signIn(url);
      setStep("saving");
      await client.importBrowserLogin(botId, url, cookies);
      setStep("done");
    } catch {
      setStep("failed");
    }
  };

  const startTyped = (event: FormEvent) => {
    event.preventDefault();

    const address = typedSite.trim();

    // A bare host name such as `x.com` means HTTPS.
    if (address !== "") void start(/^https?:\/\//.test(address) ? address : `https://${address}`);
  };

  const status = {
    idle: "",
    waiting: `Sign in to ${site} in the window that just opened. Close that window when you are done.`,
    saving: `Giving ${botName} the login…`,
    done: `${botName} is signed in to ${site}.`,
    failed: `${botName} did not get the login. Try again.`,
  }[step];

  return (
    <>
      <div className="flex justify-end pt-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          // With no page to start from, the operator names the site first.
          onClick={() => (startUrl === null ? setAsking(true) : void start(startUrl))}
          className="text-muted-foreground"
        >
          <LogInIcon />
          {startUrl === null ? "Sign in on this machine" : `Sign in to ${siteOf(startUrl)} on this machine`}
        </Button>
      </div>

      <Collapse open={step !== "idle"}>
        <p
          className={`mt-1 rounded-lg bg-background px-3 py-2 text-[0.8125rem] ${step === "failed" ? "text-destructive" : "text-foreground"}`}
        >
          {status}
        </p>
      </Collapse>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <form onSubmit={startTyped} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Which site should {botName} sign in to?</DialogTitle>
              <DialogDescription>
                A window opens on this machine. Sign in there as usual, then close it. {botName} gets the login.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={typedSite}
              onChange={(event) => setTypedSite(event.target.value)}
              placeholder="For example x.com"
              aria-label="Site"
              autoFocus
            />
            <DialogFooter>
              <Button type="submit" disabled={typedSite.trim() === ""}>
                Open sign-in window
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
